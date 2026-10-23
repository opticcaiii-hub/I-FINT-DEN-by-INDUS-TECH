/**
 * Journal Entry Posting Engine — P0 Hardened
 * 
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  THIS IS THE MOST SAFETY-CRITICAL FILE IN THE CODEBASE.    ║
 * ║                                                             ║
 * ║  This file contains the ONLY function allowed to write to   ║
 * ║  journal_entries and journal_lines tables. Every module      ║
 * ║  calls this — nothing writes to ledger tables directly.     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

import { query, transaction, type TransactionClient } from '@/lib/db';
import {
  validateJournalLines,
  validateDate,
  type JournalLineInput,
} from './validation';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type SourceType =
  | 'manual'
  | 'invoice'
  | 'purchase'
  | 'payroll'
  | 'bank_recon'
  | 'opening_balance'
  | 'expense'
  | 'credit_note'
  | 'debit_note'
  | 'payment'
  | 'loan'
  | 'asset_depreciation'
  | 'pdc_clearing'
  | 'pdc_bounce'
  | 'inventory'
  | 'reversal'
  | 'accrual';

export interface PostEntryParams {
  clientId: number;
  entryDate: string;       // YYYY-MM-DD
  description: string;
  sourceType: SourceType;
  sourceId?: number;
  lines: JournalLineInput[];
  postedBy: number;        // staff id
}

// Source type to entry number prefix mapping
const SOURCE_PREFIX: Record<SourceType, string> = {
  manual: 'JV',
  invoice: 'INV',
  purchase: 'PUR',
  payroll: 'PAY',
  bank_recon: 'BR',
  opening_balance: 'OB',
  expense: 'EXP',
  credit_note: 'CN',
  debit_note: 'DN',
  payment: 'PAY',
  loan: 'LN',
  asset_depreciation: 'DEP',
  pdc_clearing: 'PDC',
  pdc_bounce: 'PDC',
  inventory: 'INV',
  reversal: 'JV',
  accrual: 'ACC',
};

// ═══════════════════════════════════════════════════════════════
// POSTING ENGINE
// ═══════════════════════════════════════════════════════════

/**
 * Post a journal entry to the general ledger.
 * 
 * Supports external TransactionClient to ensure ATOMICITY with calling services
 * (e.g. invoice creation + journal posting in 1 transaction).
 */
export async function postJournalEntry(
  params: PostEntryParams,
  tx?: TransactionClient
): Promise<number> {
  const { clientId, entryDate, description, sourceType, sourceId, lines, postedBy } = params;

  // Pure validation checks (no DB calls)
  const dateResult = validateDate(entryDate);
  if (!dateResult.valid) {
    throw new Error(dateResult.error);
  }

  const lineResult = validateJournalLines(lines);
  if (!lineResult.valid) {
    throw new Error(lineResult.error);
  }

  // Execution function inside transaction
  const executePosting = async (client: TransactionClient): Promise<number> => {
    // 1. Mandatory Period Check (inside transaction)
    const periodCheck = await client.query<{ id: number; is_locked: boolean }>(
      `SELECT id, is_locked FROM accounting_periods 
       WHERE client_id = $1 AND start_date <= $2 AND end_date >= $2
       FOR UPDATE`,
      [clientId, entryDate]
    );

    if (periodCheck.rows.length === 0) {
      throw new Error(`No accounting period defined for ${entryDate}. Create an accounting period first.`);
    }
    if (periodCheck.rows.length > 1) {
      throw new Error(`Multiple overlapping accounting periods found for ${entryDate}. Please fix period configuration.`);
    }
    if (periodCheck.rows[0]?.is_locked === true) {
      throw new Error(`Accounting period containing ${entryDate} is locked. Cannot post entries to a locked period.`);
    }

    // 2. Verify Account Ownership & Active Status (inside transaction)
    const accountIds = lines.map((l) => l.accountId);
    const uniqueAccountIds = [...new Set(accountIds)];

    const accountCheck = await client.query<{ id: number; is_active: boolean; client_id: number }>(
      `SELECT id, is_active, client_id FROM chart_of_accounts 
       WHERE id = ANY($1::int[])`,
      [uniqueAccountIds]
    );

    const accountMap = new Map<number, { is_active: boolean; client_id: number }>();
    for (const row of accountCheck.rows) {
      accountMap.set(row.id, { is_active: row.is_active, client_id: row.client_id });
    }

    for (const accountId of uniqueAccountIds) {
      const acc = accountMap.get(accountId);
      if (!acc) {
        throw new Error(`Account ID ${accountId} does not exist`);
      }
      if (acc.client_id !== clientId) {
        throw new Error(`Account ID ${accountId} belongs to a different client`);
      }
      if (!acc.is_active) {
        throw new Error(`Cannot post to inactive account. Account ID ${accountId} is inactive`);
      }
    }

    // 3. Concurrency-Safe Document Sequence Allocation
    const entryNumber = await allocateEntryNumber(client, clientId, sourceType, entryDate);

    // 4. Draft -> Post Pattern (Fires DB Balance Trigger cleanly)
    const headerResult = await client.query<{ id: number }>(
      `INSERT INTO journal_entries 
       (client_id, entry_date, entry_number, description, source_type, source_id,
        status, posted_by, posted_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, now(), $7)
       RETURNING id`,
      [clientId, entryDate, entryNumber, description, sourceType, sourceId ?? null, postedBy]
    );

    const entryId = headerResult.rows[0]?.id;
    if (!entryId) {
      throw new Error('Failed to create journal entry header');
    }

    // 5. Insert Lines
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      await client.query(
        `INSERT INTO journal_lines 
         (journal_entry_id, account_id, debit_paisa, credit_paisa, memo, line_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entryId, line.accountId, String(line.debitPaisa), String(line.creditPaisa), line.memo ?? null, i + 1]
      );
    }

    // 6. Transition to Posted (Trigger check_journal_entry_balance() fires here!)
    await client.query(
      `UPDATE journal_entries SET status = 'posted' WHERE id = $1`,
      [entryId]
    );

    return entryId;
  };

  if (tx) {
    return executePosting(tx);
  }
  return transaction(executePosting);
}

/**
 * Allocate a concurrency-safe document number using ON CONFLICT DO UPDATE.
 * Atomic sequence initialization & increment.
 */
async function allocateEntryNumber(
  client: TransactionClient,
  clientId: number,
  sourceType: SourceType,
  entryDate: string
): Promise<string> {
  const prefix = SOURCE_PREFIX[sourceType];
  const year = parseInt(entryDate.substring(0, 4), 10);

  // Atomic initialization query (subquery MAX syncs legacy rows if sequence counter does not exist)
  await client.query(
    `INSERT INTO document_sequences (client_id, source_type, fiscal_year, next_number)
     SELECT $1, $2, $3, COALESCE(
       (SELECT (SPLIT_PART(entry_number, '-', 3)::bigint + 1)
        FROM journal_entries 
        WHERE client_id = $1 AND entry_number LIKE $4
        ORDER BY entry_number DESC LIMIT 1), 1
     )
     ON CONFLICT (client_id, source_type, fiscal_year) DO NOTHING`,
    [clientId, prefix, year, `${prefix}-${year}-%`]
  );

  const res = await client.query<{ allocated_number: string }>(
    `INSERT INTO document_sequences (client_id, source_type, fiscal_year, next_number)
     VALUES ($1, $2, $3, 2)
     ON CONFLICT (client_id, source_type, fiscal_year)
     DO UPDATE SET next_number = document_sequences.next_number + 1
     RETURNING (next_number - 1)::text AS allocated_number`,
    [clientId, prefix, year]
  );

  const numStr = res.rows[0]?.allocated_number ?? '1';
  return `${prefix}-${year}-${String(numStr).padStart(4, '0')}`;
}

// ═══════════════════════════════════════════════════════════════
// QUERY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

interface JournalEntryRow {
  id: number;
  client_id: number;
  entry_date: string;
  entry_number: string;
  description: string;
  source_type: string;
  source_id: number | null;
  status: string;
  posted_by: number | null;
  posted_at: string | null;
  reversed_by_entry_id: number | null;
  reversal_of_entry_id: number | null;
  created_by: number;
  created_at: string;
}

interface JournalLineRow {
  id: number;
  journal_entry_id: number;
  account_id: number;
  debit_paisa: string;
  credit_paisa: string;
  memo: string | null;
  line_order: number;
  account_code: string;
  account_name: string;
}

export async function getJournalEntry(
  entryId: number,
  clientId: number
): Promise<{ entry: JournalEntryRow; lines: JournalLineRow[] } | null> {
  const entryResult = await query<JournalEntryRow>(
    'SELECT * FROM journal_entries WHERE id = $1 AND client_id = $2',
    [entryId, clientId]
  );

  const entry = entryResult.rows[0];
  if (!entry) return null;

  const linesResult = await query<JournalLineRow>(
    `SELECT jl.*, coa.account_code, coa.account_name
     FROM journal_lines jl
     JOIN chart_of_accounts coa ON jl.account_id = coa.id
     WHERE jl.journal_entry_id = $1
     ORDER BY jl.line_order`,
    [entryId]
  );

  return { entry, lines: linesResult.rows };
}

export async function listJournalEntries(
  clientId: number,
  options: {
    startDate?: string;
    endDate?: string;
    status?: string;
    sourceType?: string;
    limit?: number;
    offset?: number;
  } = {}
): Promise<{ entries: JournalEntryRow[]; total: number }> {
  const conditions: string[] = ['je.client_id = $1'];
  const params: unknown[] = [clientId];
  let paramIdx = 2;

  if (options.startDate) {
    conditions.push(`je.entry_date >= $${paramIdx++}`);
    params.push(options.startDate);
  }
  if (options.endDate) {
    conditions.push(`je.entry_date <= $${paramIdx++}`);
    params.push(options.endDate);
  }
  if (options.status) {
    conditions.push(`je.status = $${paramIdx++}`);
    params.push(options.status);
  }
  if (options.sourceType) {
    conditions.push(`je.source_type = $${paramIdx++}`);
    params.push(options.sourceType);
  }

  const whereClause = conditions.join(' AND ');
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM journal_entries je WHERE ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

  const dataParams = [...params, limit, offset];
  const dataResult = await query<JournalEntryRow>(
    `SELECT je.* FROM journal_entries je
     WHERE ${whereClause}
     ORDER BY je.entry_date DESC, je.entry_number DESC
     LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
    dataParams
  );

  return { entries: dataResult.rows, total };
}

export type { JournalEntryRow, JournalLineRow };

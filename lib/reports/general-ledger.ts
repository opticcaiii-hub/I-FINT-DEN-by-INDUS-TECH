/**
 * General Ledger (per account) Report Generator
 *
 * Lists every posted journal line for a specific account in date order,
 * with opening balance, line debit/credit, and running balance.
 *
 * Security: firmId is always derived from the authenticated session —
 * never trusted from the browser. verifyClientBelongsToFirm() confirms
 * the client belongs to the requesting firm before any data is returned.
 */

import { query } from '@/lib/db';
import { verifyClientBelongsToFirm } from './report-auth';

async function getAccountById(accountId: number, clientId: number) {
  const res = await query<{
    id: number;
    account_code: string;
    account_name: string;
    normal_balance: 'debit' | 'credit';
  }>(
    `SELECT coa.id, coa.account_code, coa.account_name, at.normal_balance
     FROM chart_of_accounts coa
     JOIN account_types at ON coa.account_type_id = at.id
     WHERE coa.id = $1 AND coa.client_id = $2`,
    [accountId, clientId]
  );
  return res.rows[0];
}

export interface GeneralLedgerLine {
  lineId: number;
  entryId: number;
  entryDate: string;
  entryNumber: string;
  description: string;
  sourceType: string;
  debitPaisa: number;
  creditPaisa: number;
  memo: string | null;
  runningBalancePaisa: number;
}

export interface GeneralLedgerReport {
  clientId: number;
  accountId: number;
  accountCode: string;
  accountName: string;
  normalBalance: 'debit' | 'credit';
  startDate: string;
  endDate: string;
  openingBalancePaisa: number;
  lines: GeneralLedgerLine[];
  totalDebitPaisa: number;
  totalCreditPaisa: number;
  closingBalancePaisa: number;
}

/**
 * Generate a General Ledger report for a single account over a date range.
 */
export async function getGeneralLedger(
  firmId: number,
  clientId: number,
  accountId: number,
  startDate: string,
  endDate: string
): Promise<GeneralLedgerReport> {
  // Security: verify the client belongs to the requesting firm before touching any data
  await verifyClientBelongsToFirm(firmId, clientId);

  const account = await getAccountById(accountId, clientId);
  if (!account) {
    throw new Error(`Account ID ${accountId} not found for this client`);
  }

  // 1. Calculate opening balance (all posted activity BEFORE startDate)
  const openingSql = `
    SELECT 
      COALESCE(SUM(jl.debit_paisa), 0)::text as "debitPaisaStr",
      COALESCE(SUM(jl.credit_paisa), 0)::text as "creditPaisaStr"
    FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_entry_id = je.id
    WHERE jl.account_id = $1 
      AND je.status = 'posted' 
      AND je.entry_date < $2
  `;

  const openingResult = await query<{
    debitPaisaStr: string;
    creditPaisaStr: string;
  }>(openingSql, [accountId, startDate]);

  const priorDebits = parseInt(openingResult.rows[0]?.debitPaisaStr ?? '0', 10);
  const priorCredits = parseInt(openingResult.rows[0]?.creditPaisaStr ?? '0', 10);

  const openingBalancePaisa = account.normal_balance === 'debit'
    ? priorDebits - priorCredits
    : priorCredits - priorDebits;

  // 2. Fetch journal lines in the period
  const linesSql = `
    SELECT 
      jl.id as "lineId",
      je.id as "entryId",
      je.entry_date as "entryDate",
      je.entry_number as "entryNumber",
      je.description as "description",
      je.source_type as "sourceType",
      jl.debit_paisa::text as "debitPaisaStr",
      jl.credit_paisa::text as "creditPaisaStr",
      jl.memo as "memo"
    FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_entry_id = je.id
    WHERE jl.account_id = $1 
      AND je.status = 'posted' 
      AND je.entry_date >= $2 
      AND je.entry_date <= $3
    ORDER BY je.entry_date ASC, je.entry_number ASC, jl.line_order ASC
  `;

  const linesResult = await query<{
    lineId: number;
    entryId: number;
    entryDate: string;
    entryNumber: string;
    description: string;
    sourceType: string;
    debitPaisaStr: string;
    creditPaisaStr: string;
    memo: string | null;
  }>(linesSql, [accountId, startDate, endDate]);

  let currentBalance = openingBalancePaisa;
  let totalDebitPaisa = 0;
  let totalCreditPaisa = 0;

  const lines: GeneralLedgerLine[] = linesResult.rows.map((row) => {
    const debitPaisa = parseInt(row.debitPaisaStr, 10) || 0;
    const creditPaisa = parseInt(row.creditPaisaStr, 10) || 0;

    totalDebitPaisa += debitPaisa;
    totalCreditPaisa += creditPaisa;

    if (account.normal_balance === 'debit') {
      currentBalance += (debitPaisa - creditPaisa);
    } else {
      currentBalance += (creditPaisa - debitPaisa);
    }

    return {
      lineId: row.lineId,
      entryId: row.entryId,
      entryDate: row.entryDate,
      entryNumber: row.entryNumber,
      description: row.description,
      sourceType: row.sourceType,
      debitPaisa,
      creditPaisa,
      memo: row.memo,
      runningBalancePaisa: currentBalance,
    };
  });

  return {
    clientId,
    accountId,
    accountCode: account.account_code,
    accountName: account.account_name,
    normalBalance: account.normal_balance as 'debit' | 'credit',
    startDate,
    endDate,
    openingBalancePaisa,
    lines,
    totalDebitPaisa,
    totalCreditPaisa,
    closingBalancePaisa: currentBalance,
  };
}

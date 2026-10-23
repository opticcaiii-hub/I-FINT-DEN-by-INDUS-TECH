/**
 * Trial Balance Report Generator
 *
 * Trial Balance query shape:
 *   SUM(debit_paisa) - SUM(credit_paisa) grouped by account,
 *   for entries where entry_date <= asOfDate and status = 'posted'
 *
 * Accounting rules:
 *   - Assets & Expenses have normal_balance = 'debit'
 *     Net balance = SUM(debits) - SUM(credits)
 *   - Liabilities, Equity, & Income have normal_balance = 'credit'
 *     Net balance = SUM(credits) - SUM(debits)
 *   - SUM(total_debits) MUST EQUAL SUM(total_credits) across all accounts
 *
 * Security: firmId is always derived from the authenticated session —
 * never trusted from the browser. verifyClientBelongsToFirm() confirms
 * the client belongs to the requesting firm before any data is returned.
 */

import { query } from '@/lib/db';
import { verifyClientBelongsToFirm } from './report-auth';
import { calculateSignedBalance } from './signed-balances';

export interface TrialBalanceRow {
  accountId: number;
  accountCode: string;
  accountName: string;
  typeCode: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  normalBalance: 'debit' | 'credit';
  debitPaisa: number;
  creditPaisa: number;
  netPaisa: number;
}

export interface TrialBalanceReport {
  asOfDate: string;
  clientId: number;
  rows: TrialBalanceRow[];
  totalDebitPaisa: number;
  totalCreditPaisa: number;
  isBalanced: boolean;
}

/**
 * Generate a Trial Balance as of a specific date.
 */
export async function getTrialBalance(
  firmId: number,
  clientId: number,
  asOfDate: string
): Promise<TrialBalanceReport> {
  await verifyClientBelongsToFirm(firmId, clientId);

  const sql = `
    SELECT 
      coa.id as "accountId",
      coa.account_code as "accountCode",
      coa.account_name as "accountName",
      at.code as "typeCode",
      at.normal_balance as "normalBalance",
      COALESCE(SUM(jl.debit_paisa), 0)::text as "debitPaisaStr",
      COALESCE(SUM(jl.credit_paisa), 0)::text as "creditPaisaStr"
    FROM chart_of_accounts coa
    JOIN account_types at ON coa.account_type_id = at.id
    LEFT JOIN journal_lines jl ON coa.id = jl.account_id
    LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id AND je.status = 'posted' AND je.entry_date <= $2
    WHERE coa.client_id = $1 AND coa.is_active = true
    GROUP BY coa.id, coa.account_code, coa.account_name, at.code, at.normal_balance
    ORDER BY coa.account_code
  `;

  const result = await query<{
    accountId: number;
    accountCode: string;
    accountName: string;
    typeCode: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
    normalBalance: 'debit' | 'credit';
    debitPaisaStr: string;
    creditPaisaStr: string;
  }>(sql, [clientId, asOfDate]);

  let totalDebitPaisa = 0;
  let totalCreditPaisa = 0;

  const rows: TrialBalanceRow[] = result.rows.map((row) => {
    const debitPaisa = parseInt(row.debitPaisaStr, 10) || 0;
    const creditPaisa = parseInt(row.creditPaisaStr, 10) || 0;

    totalDebitPaisa += debitPaisa;
    totalCreditPaisa += creditPaisa;

    const { balancePaisa } = calculateSignedBalance(
      row.typeCode,
      debitPaisa,
      creditPaisa,
      row.accountCode
    );

    return {
      accountId: row.accountId,
      accountCode: row.accountCode,
      accountName: row.accountName,
      typeCode: row.typeCode,
      normalBalance: row.normalBalance,
      debitPaisa,
      creditPaisa,
      netPaisa: balancePaisa,
    };
  });

  const isBalanced = totalDebitPaisa === totalCreditPaisa;

  return {
    asOfDate,
    clientId,
    rows,
    totalDebitPaisa,
    totalCreditPaisa,
    isBalanced,
  };
}

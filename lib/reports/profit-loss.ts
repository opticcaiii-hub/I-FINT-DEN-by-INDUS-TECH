/**
 * Profit & Loss (Income Statement) Report Generator
 *
 * Filtered to account_type IN ('income', 'revenue', 'expense', 'cost_of_sales') for a date range.
 * Income/Revenue accounts show positive when credits > debits.
 * Expense/COGS accounts show positive when debits > credits.
 * Net Profit / (Loss) = Total Revenue - Total Expenses.
 *
 * Security: firmId is always derived from the authenticated session —
 * never trusted from the browser. verifyClientBelongsToFirm() confirms
 * the client belongs to the requesting firm before any data is returned.
 */

import { query } from '@/lib/db';
import { verifyClientBelongsToFirm } from './report-auth';
import { calculateSignedBalance } from './signed-balances';

export interface PnLAccountRow {
  accountId: number;
  accountCode: string;
  accountName: string;
  amountPaisa: number; // positive number representing revenue or expense amount
}

export interface ProfitAndLossReport {
  clientId: number;
  startDate: string;
  endDate: string;
  incomeAccounts: PnLAccountRow[];
  totalIncomePaisa: number;
  expenseAccounts: PnLAccountRow[];
  totalExpensePaisa: number;
  netProfitPaisa: number; // income - expense (positive = profit, negative = loss)
}

/**
 * Generate a Profit and Loss report for a date range.
 * 
 * Sign Convention (IFRS/GAAP Standard via signed-balances):
 *   Revenue / Income  — normal balance is CREDIT -> amountPaisa = credit - debit (positive if revenue)
 *   Expense / COGS    — normal balance is DEBIT  -> amountPaisa = debit - credit  (positive if expense)
 *   Net Profit = totalIncomePaisa - totalExpensePaisa
 */
export async function getProfitAndLoss(
  firmId: number,
  clientId: number,
  startDate: string,
  endDate: string
): Promise<ProfitAndLossReport> {
  // Security: verify the client belongs to the requesting firm before touching any data
  await verifyClientBelongsToFirm(firmId, clientId);

  const sql = `
    SELECT 
      coa.id as "accountId",
      coa.account_code as "accountCode",
      coa.account_name as "accountName",
      LOWER(at.code) as "typeCode",
      COALESCE(SUM(jl.debit_paisa), 0)::bigint as "debitPaisa",
      COALESCE(SUM(jl.credit_paisa), 0)::bigint as "creditPaisa"
    FROM chart_of_accounts coa
    JOIN account_types at ON coa.account_type_id = at.id
    LEFT JOIN journal_lines jl ON coa.id = jl.account_id
    LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id 
      AND je.status = 'posted' 
      AND je.entry_date >= $2 
      AND je.entry_date <= $3
    WHERE coa.client_id = $1 
      AND LOWER(at.code) IN ('income', 'revenue', 'expense', 'cost_of_sales', 'cogs')
      AND coa.is_active = true
    GROUP BY coa.id, coa.account_code, coa.account_name, at.code
    ORDER BY coa.account_code
  `;

  const result = await query<{
    accountId: number;
    accountCode: string;
    accountName: string;
    typeCode: string;
    debitPaisa: number;
    creditPaisa: number;
  }>(sql, [clientId, startDate, endDate]);

  const incomeAccounts: PnLAccountRow[] = [];
  const expenseAccounts: PnLAccountRow[] = [];
  let totalIncomePaisa = 0;
  let totalExpensePaisa = 0;

  for (const row of result.rows) {
    const debit = Number(row.debitPaisa) || 0;
    const credit = Number(row.creditPaisa) || 0;

    const { balancePaisa, category } = calculateSignedBalance(
      row.typeCode,
      debit,
      credit,
      row.accountCode
    );

    if (category === 'revenue') {
      incomeAccounts.push({
        accountId: Number(row.accountId),
        accountCode: row.accountCode,
        accountName: row.accountName,
        amountPaisa: balancePaisa,
      });
      totalIncomePaisa += balancePaisa;
    } else if (category === 'expense') {
      expenseAccounts.push({
        accountId: Number(row.accountId),
        accountCode: row.accountCode,
        accountName: row.accountName,
        amountPaisa: balancePaisa,
      });
      totalExpensePaisa += balancePaisa;
    }
  }

  const netProfitPaisa = totalIncomePaisa - totalExpensePaisa;

  return {
    clientId,
    startDate,
    endDate,
    incomeAccounts,
    totalIncomePaisa,
    expenseAccounts,
    totalExpensePaisa,
    netProfitPaisa,
  };
}

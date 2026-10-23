/**
 * Balance Sheet Report Generator
 *
 * Filtered to account_type IN ('asset', 'liability', 'equity') as of a single date.
 *
 * Retained Earnings roll-forward:
 *   Net Profit / Loss from all historical income/expense entries up to asOfDate
 *   is automatically rolled into Equity as Retained Earnings.
 *
 * Fundamental Accounting Equation:
 *   Assets = Liabilities + Equity (including Retained Earnings)
 *
 * Security: firmId is always derived from the authenticated session —
 * never trusted from the browser. verifyClientBelongsToFirm() confirms
 * the client belongs to the requesting firm before any data is returned.
 */

import { query } from '@/lib/db';
import { verifyClientBelongsToFirm } from './report-auth';
import { calculateSignedBalance } from './signed-balances';

export interface BSAccountRow {
  accountId: number;
  accountCode: string;
  accountName: string;
  amountPaisa: number;
}

export interface BalanceSheetReport {
  clientId: number;
  asOfDate: string;
  assetAccounts: BSAccountRow[];
  totalAssetsPaisa: number;
  liabilityAccounts: BSAccountRow[];
  totalLiabilitiesPaisa: number;
  equityAccounts: BSAccountRow[];
  retainedEarningsPaisa: number; // calculated from cumulative net profit/loss
  totalEquityPaisa: number; // explicit equity + retained earnings
  totalLiabilitiesAndEquityPaisa: number;
  isBalanced: boolean; // totalAssetsPaisa === totalLiabilitiesAndEquityPaisa
}

/**
 * Generate a Balance Sheet as of a specific date.
 */
export async function getBalanceSheet(
  firmId: number,
  clientId: number,
  asOfDate: string
): Promise<BalanceSheetReport> {
  // Security: verify the client belongs to the requesting firm before touching any data
  await verifyClientBelongsToFirm(firmId, clientId);

  // 1. Get Assets, Liabilities, Equity accounts balances as of date
  const bsSql = `
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
      AND je.entry_date <= $2
    WHERE coa.client_id = $1 
      AND LOWER(at.code) IN ('asset', 'liability', 'equity')
      AND coa.is_active = true
    GROUP BY coa.id, coa.account_code, coa.account_name, at.code
    ORDER BY coa.account_code
  `;

  const bsResult = await query<{
    accountId: number;
    accountCode: string;
    accountName: string;
    typeCode: string;
    debitPaisa: number;
    creditPaisa: number;
  }>(bsSql, [clientId, asOfDate]);

  // 2. Compute retained earnings (cumulative income - cumulative expense as of date)
  const pnlSql = `
    SELECT 
      LOWER(at.code) as "typeCode",
      coa.account_code as "accountCode",
      COALESCE(SUM(jl.debit_paisa), 0)::bigint as "debitPaisa",
      COALESCE(SUM(jl.credit_paisa), 0)::bigint as "creditPaisa"
    FROM chart_of_accounts coa
    JOIN account_types at ON coa.account_type_id = at.id
    JOIN journal_lines jl ON coa.id = jl.account_id
    JOIN journal_entries je ON jl.journal_entry_id = je.id
    WHERE coa.client_id = $1 
      AND je.status = 'posted' 
      AND je.entry_date <= $2
      AND LOWER(at.code) IN ('income', 'revenue', 'expense', 'cost_of_sales', 'cogs')
    GROUP BY at.code, coa.account_code
  `;

  const pnlResult = await query<{
    typeCode: string;
    accountCode: string;
    debitPaisa: number;
    creditPaisa: number;
  }>(pnlSql, [clientId, asOfDate]);

  let cumulativeIncomePaisa = 0;
  let cumulativeExpensePaisa = 0;

  for (const row of pnlResult.rows) {
    const debit = Number(row.debitPaisa) || 0;
    const credit = Number(row.creditPaisa) || 0;
    const { balancePaisa, category } = calculateSignedBalance(row.typeCode, debit, credit, row.accountCode);

    if (category === 'revenue') {
      cumulativeIncomePaisa += balancePaisa;
    } else if (category === 'expense') {
      cumulativeExpensePaisa += balancePaisa;
    }
  }

  const retainedEarningsPaisa = cumulativeIncomePaisa - cumulativeExpensePaisa;

  // 3. Process Asset, Liability, Equity accounts
  const assetAccounts: BSAccountRow[] = [];
  const liabilityAccounts: BSAccountRow[] = [];
  const equityAccounts: BSAccountRow[] = [];

  let totalAssetsPaisa = 0;
  let totalLiabilitiesPaisa = 0;
  let explicitEquityPaisa = 0;

  for (const row of bsResult.rows) {
    const debit = Number(row.debitPaisa) || 0;
    const credit = Number(row.creditPaisa) || 0;

    const { balancePaisa, category } = calculateSignedBalance(
      row.typeCode,
      debit,
      credit,
      row.accountCode
    );

    if (category === 'asset') {
      assetAccounts.push({
        accountId: Number(row.accountId),
        accountCode: row.accountCode,
        accountName: row.accountName,
        amountPaisa: balancePaisa,
      });
      totalAssetsPaisa += balancePaisa;
    } else if (category === 'liability') {
      liabilityAccounts.push({
        accountId: Number(row.accountId),
        accountCode: row.accountCode,
        accountName: row.accountName,
        amountPaisa: balancePaisa,
      });
      totalLiabilitiesPaisa += balancePaisa;
    } else if (category === 'equity') {
      if (row.accountCode === '3020' || row.accountName.toLowerCase().includes('retained earnings')) {
        explicitEquityPaisa += balancePaisa;
      } else {
        equityAccounts.push({
          accountId: Number(row.accountId),
          accountCode: row.accountCode,
          accountName: row.accountName,
          amountPaisa: balancePaisa,
        });
        explicitEquityPaisa += balancePaisa;
      }
    }
  }

  const totalEquityPaisa = explicitEquityPaisa + retainedEarningsPaisa;
  const totalLiabilitiesAndEquityPaisa = totalLiabilitiesPaisa + totalEquityPaisa;
  const isBalanced = totalAssetsPaisa === totalLiabilitiesAndEquityPaisa;

  return {
    clientId,
    asOfDate,
    assetAccounts,
    totalAssetsPaisa,
    liabilityAccounts,
    totalLiabilitiesPaisa,
    equityAccounts,
    retainedEarningsPaisa,
    totalEquityPaisa,
    totalLiabilitiesAndEquityPaisa,
    isBalanced,
  };
}

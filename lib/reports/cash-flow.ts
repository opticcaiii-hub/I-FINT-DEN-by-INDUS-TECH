/**
 * Cash Flow Statement Report — Indirect Method (IAS-7)
 *
 * Starts with Net Profit/Loss then adjusts for non-cash items
 * and working capital changes. Classifies into Operating,
 * Investing, and Financing activities.
 *
 * All values in integer paisa (BIGINT).
 *
 * Security: firmId is always derived from the authenticated session —
 * never trusted from the browser. verifyClientBelongsToFirm() confirms
 * the client belongs to the requesting firm before any data is returned.
 */

import { query } from '@/lib/db';
import { verifyClientBelongsToFirm } from './report-auth';
import { calculateSignedBalance } from './signed-balances';

export interface CashFlowItem {
  label: string;
  amountPaisa: number;
}

export interface CashFlowSection {
  label: string;
  items: CashFlowItem[];
  totalPaisa: number;
}

export interface CashFlowReport {
  clientId: number;
  startDate: string;
  endDate: string;
  operatingActivities: CashFlowSection;
  investingActivities: CashFlowSection;
  financingActivities: CashFlowSection;
  netCashChangePaisa: number;
  openingCashPaisa: number;
  closingCashPaisa: number;
}

interface BalanceRow {
  accountCode: string;
  accountName: string;
  typeCode: string;
  debitPaisaStr: string;
  creditPaisaStr: string;
}

async function getAccountBalanceAsOf(
  clientId: number,
  codePrefix: string,
  asOfDate: string,
  normalSide: 'debit' | 'credit'
): Promise<number> {
  const result = await query<BalanceRow>(`
    SELECT
      COALESCE(SUM(jl.debit_paisa), 0)::text as "debitPaisaStr",
      COALESCE(SUM(jl.credit_paisa), 0)::text as "creditPaisaStr"
    FROM chart_of_accounts coa
    JOIN account_types at ON coa.account_type_id = at.id
    JOIN journal_lines jl ON coa.id = jl.account_id
    JOIN journal_entries je ON jl.journal_entry_id = je.id
    WHERE coa.client_id = $1
      AND je.status = 'posted'
      AND je.entry_date <= $2
      AND coa.account_code LIKE $3
  `, [clientId, asOfDate, codePrefix + '%']);

  const row = result.rows[0];
  if (!row) return 0;

  const debit = parseInt(row.debitPaisaStr, 10) || 0;
  const credit = parseInt(row.creditPaisaStr, 10) || 0;

  return normalSide === 'debit' ? (debit - credit) : (credit - debit);
}

function dayBefore(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().substring(0, 10);
}

async function getDepreciationForPeriod(
  clientId: number,
  startDate: string,
  endDate: string
): Promise<number> {
  const result = await query<{ amountStr: string }>(`
    SELECT COALESCE(SUM(jl.debit_paisa), 0)::text as "amountStr"
    FROM journal_lines jl
    JOIN journal_entries je ON jl.journal_entry_id = je.id
    JOIN chart_of_accounts coa ON jl.account_id = coa.id
    WHERE je.client_id = $1
      AND je.status = 'posted'
      AND je.entry_date >= $2
      AND je.entry_date <= $3
      AND coa.account_code = '5500'
  `, [clientId, startDate, endDate]);

  return parseInt(result.rows[0]?.amountStr || '0', 10);
}

export async function getCashFlowStatement(
  firmId: number,
  clientId: number,
  startDate: string,
  endDate: string
): Promise<CashFlowReport> {
  await verifyClientBelongsToFirm(firmId, clientId);

  const periodStart = dayBefore(startDate);

  // 1. Net Profit / Loss for the period
  const pnlResult = await query<{
    typeCode: string;
    accountCode: string;
    debitPaisaStr: string;
    creditPaisaStr: string;
  }>(`
    SELECT
      LOWER(at.code) as "typeCode",
      coa.account_code as "accountCode",
      COALESCE(SUM(jl.debit_paisa), 0)::text as "debitPaisaStr",
      COALESCE(SUM(jl.credit_paisa), 0)::text as "creditPaisaStr"
    FROM chart_of_accounts coa
    JOIN account_types at ON coa.account_type_id = at.id
    JOIN journal_lines jl ON coa.id = jl.account_id
    JOIN journal_entries je ON jl.journal_entry_id = je.id
    WHERE coa.client_id = $1
      AND je.status = 'posted'
      AND je.entry_date >= $2
      AND je.entry_date <= $3
      AND LOWER(at.code) IN ('income', 'revenue', 'expense', 'cost_of_sales', 'cogs')
    GROUP BY at.code, coa.account_code
  `, [clientId, startDate, endDate]);

  let totalIncome = 0;
  let totalExpense = 0;
  for (const row of pnlResult.rows) {
    const dr = parseInt(row.debitPaisaStr, 10) || 0;
    const cr = parseInt(row.creditPaisaStr, 10) || 0;
    const { balancePaisa, category } = calculateSignedBalance(row.typeCode, dr, cr, row.accountCode);
    if (category === 'revenue') totalIncome += balancePaisa;
    if (category === 'expense') totalExpense += balancePaisa;
  }
  const netProfit = totalIncome - totalExpense;

  // 2. Depreciation add-back
  const depreciationPeriod = await getDepreciationForPeriod(clientId, startDate, endDate);

  // 3. Working capital changes
  const arEnd = await getAccountBalanceAsOf(clientId, '1200', endDate, 'debit');
  const arStart = await getAccountBalanceAsOf(clientId, '1200', periodStart, 'debit');
  const deltaAR = arStart - arEnd;

  const invEnd = await getAccountBalanceAsOf(clientId, '1400', endDate, 'debit');
  const invStart = await getAccountBalanceAsOf(clientId, '1400', periodStart, 'debit');
  const deltaInventory = invStart - invEnd;

  const apEnd = await getAccountBalanceAsOf(clientId, '2010', endDate, 'credit');
  const apStart = await getAccountBalanceAsOf(clientId, '2010', periodStart, 'credit');
  const deltaAP = apEnd - apStart;

  const whtEnd = await getAccountBalanceAsOf(clientId, '2020', endDate, 'credit');
  const whtStart = await getAccountBalanceAsOf(clientId, '2020', periodStart, 'credit');
  const deltaWHT = whtEnd - whtStart;

  const operatingItems: CashFlowItem[] = [
    { label: 'Net Profit / (Loss)', amountPaisa: netProfit },
    { label: 'Adjustments: Depreciation & Amortization', amountPaisa: depreciationPeriod },
    { label: '(Increase) / Decrease in Accounts Receivable', amountPaisa: deltaAR },
    { label: '(Increase) / Decrease in Inventory', amountPaisa: deltaInventory },
    { label: 'Increase / (Decrease) in Accounts Payable', amountPaisa: deltaAP },
    { label: 'Increase / (Decrease) in Taxes Payable', amountPaisa: deltaWHT },
  ];

  const operatingTotal = operatingItems.reduce((s, i) => s + i.amountPaisa, 0);

  // 4. Investing Activities
  const faEnd = await getAccountBalanceAsOf(clientId, '1700', endDate, 'debit');
  const faStart = await getAccountBalanceAsOf(clientId, '1700', periodStart, 'debit');
  const deltaFA = -(faEnd - faStart);

  const investingItems: CashFlowItem[] = [
    { label: 'Purchase of Fixed Assets / Equipment', amountPaisa: deltaFA },
  ];
  const investingTotal = investingItems.reduce((s, i) => s + i.amountPaisa, 0);

  // 5. Financing Activities
  const loanEnd = await getAccountBalanceAsOf(clientId, '2500', endDate, 'credit');
  const loanStart = await getAccountBalanceAsOf(clientId, '2500', periodStart, 'credit');
  const deltaLoan = loanEnd - loanStart;

  const equityEnd = await getAccountBalanceAsOf(clientId, '3010', endDate, 'credit');
  const equityStart = await getAccountBalanceAsOf(clientId, '3010', periodStart, 'credit');
  const deltaEquity = equityEnd - equityStart;

  const financingItems: CashFlowItem[] = [
    { label: 'Proceeds from / (Repayment of) Borrowings', amountPaisa: deltaLoan },
    { label: 'Owner Capital Introduced / (Drawings)', amountPaisa: deltaEquity },
  ];
  const financingTotal = financingItems.reduce((s, i) => s + i.amountPaisa, 0);

  const netCashChange = operatingTotal + investingTotal + financingTotal;

  const cashStart = (await getAccountBalanceAsOf(clientId, '1010', periodStart, 'debit')) +
                    (await getAccountBalanceAsOf(clientId, '1020', periodStart, 'debit'));
  const cashEnd = (await getAccountBalanceAsOf(clientId, '1010', endDate, 'debit')) +
                  (await getAccountBalanceAsOf(clientId, '1020', endDate, 'debit'));

  return {
    clientId,
    startDate,
    endDate,
    operatingActivities: {
      label: 'Cash Flows from Operating Activities',
      items: operatingItems,
      totalPaisa: operatingTotal,
    },
    investingActivities: {
      label: 'Cash Flows from Investing Activities',
      items: investingItems,
      totalPaisa: investingTotal,
    },
    financingActivities: {
      label: 'Cash Flows from Financing Activities',
      items: financingItems,
      totalPaisa: financingTotal,
    },
    netCashChangePaisa: netCashChange,
    openingCashPaisa: cashStart,
    closingCashPaisa: cashEnd,
  };
}

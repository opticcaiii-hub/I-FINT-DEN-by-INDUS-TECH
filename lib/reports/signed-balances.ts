/**
 * lib/reports/signed-balances.ts
 *
 * Single Source of Truth for Ledger Account Balances across All Reports:
 * - Trial Balance
 * - Profit & Loss Statement (Income Statement)
 * - Balance Sheet (Financial Position)
 * - Cash Flow Statement (IAS-7)
 *
 * Sign Conventions (IFRS / GAAP Standard):
 *   - Revenue / Income:  Credit - Debit (positive when earned)
 *   - Expenses / COGS:   Debit - Credit (positive when incurred)
 *   - Assets:            Debit - Credit (positive when owned)
 *   - Liabilities:       Credit - Debit (positive when owed)
 *   - Equity:            Credit - Debit (positive when invested)
 *   - Net Profit:        Total Revenue - Total Expenses
 */

export type AccountCategory = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export function normalizeAccountCategory(typeCode: string, accountCode?: string): AccountCategory {
  const code = (typeCode || '').toLowerCase().trim();
  if (code === 'income' || code === 'revenue') return 'revenue';
  if (code === 'expense' || code === 'cost_of_sales' || code === 'cogs') return 'expense';
  if (code === 'asset') return 'asset';
  if (code === 'liability') return 'liability';
  if (code === 'equity') return 'equity';

  // Heuristic by account code prefix if type code is non-standard
  if (accountCode) {
    const clean = accountCode.trim().replace(/\D/g, '');
    const firstDigit = clean.charAt(0);
    if (firstDigit === '1') return 'asset';
    if (firstDigit === '2') return 'liability';
    if (firstDigit === '3') return 'equity';
    if (firstDigit === '4') return 'revenue';
    if (firstDigit === '5' || firstDigit === '6') return 'expense';
  }

  return 'expense';
}

export function calculateSignedBalance(
  categoryOrTypeCode: string,
  debitPaisa: number,
  creditPaisa: number,
  accountCode?: string
): {
  balancePaisa: number;
  normalSide: 'debit' | 'credit';
  category: AccountCategory;
} {
  const category = normalizeAccountCategory(categoryOrTypeCode, accountCode);

  if (category === 'revenue' || category === 'liability' || category === 'equity') {
    // Normal side is Credit: positive when credits exceed debits
    return {
      balancePaisa: creditPaisa - debitPaisa,
      normalSide: 'credit',
      category,
    };
  } else {
    // Normal side is Debit (Assets, Expenses): positive when debits exceed credits
    return {
      balancePaisa: debitPaisa - creditPaisa,
      normalSide: 'debit',
      category,
    };
  }
}

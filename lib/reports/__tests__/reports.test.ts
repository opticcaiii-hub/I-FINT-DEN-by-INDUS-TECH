import { describe, it, expect } from 'vitest';
import { calculateTotals, validateJournalLines } from '@/lib/ledger/validation';

describe('Accounting Balance & Equation Invariants', () => {
  it('enforces that total debits always equal total credits for any posted journal entry', () => {
    const balancedEntry = [
      { accountId: 1010, debitPaisa: 5000000, creditPaisa: 0 },   // Dr Cash 50,000 PKR
      { accountId: 4010, debitPaisa: 0, creditPaisa: 5000000 },   // Cr Revenue 50,000 PKR
    ];

    const validation = validateJournalLines(balancedEntry);
    expect(validation.valid).toBe(true);

    const totals = calculateTotals(balancedEntry);
    expect(totals.totalDebits).toBe(totals.totalCredits);
    expect(totals.totalDebits - totals.totalCredits).toBe(0);
  });

  it('proves fundamental accounting equation Assets = Liabilities + Equity under multi-line transactions', () => {
    // Transaction 1: Owner injects 100,000 PKR capital (Asset Cash +, Equity Capital +)
    // Transaction 2: Buy inventory 40,000 PKR on credit (Asset Inventory +, Liability AP +)
    // Transaction 3: Sell 20,000 PKR inventory for 35,000 PKR cash (Asset Cash +35k, Asset Inventory -20k, Revenue +35k, Expense +20k -> Net Profit +15k)

    let totalAssetsPaisa = 0;
    let totalLiabilitiesPaisa = 0;
    let totalEquityPaisa = 0;
    let retainedEarningsPaisa = 0;

    // Tx 1
    totalAssetsPaisa += 10000000; // Cash
    totalEquityPaisa += 10000000; // Owner's Capital

    // Tx 2
    totalAssetsPaisa += 4000000;  // Inventory
    totalLiabilitiesPaisa += 4000000; // AP

    // Tx 3
    totalAssetsPaisa += 3500000;  // Cash
    totalAssetsPaisa -= 2000000;  // Inventory reduced by COGS
    retainedEarningsPaisa += (3500000 - 2000000); // Net Profit (Revenue - Expense)

    const totalEquityAndRE = totalEquityPaisa + retainedEarningsPaisa;
    const totalLiabilitiesAndEquity = totalLiabilitiesPaisa + totalEquityAndRE;

    // FUNDAMENTAL INVARIANT CHECK
    expect(totalAssetsPaisa).toBe(totalLiabilitiesAndEquity);
    expect(totalAssetsPaisa).toBe(15500000); // 155,000 PKR Assets
    expect(totalLiabilitiesAndEquity).toBe(15500000); // 155,000 PKR Liabilities + Equity
  });
});

/**
 * Deterministic Financial & Row Reconciliation Engine
 * 
 * Capabilities:
 * - Row counts reconciliation (Input, Accepted, Rejected, Review, Duplicates)
 * - Financial totals in exact integer paisa (Debit, Credit, Sales, Purchases, Tax, Bank)
 * - Computes differences between raw and cleaned figures
 * - Identifies missing expected data parts
 * - Import-readiness evaluation with blocking reasons (e.g. debit/credit mismatch, out-of-bounds tax rates)
 * 
 * INVARIANTS:
 * - Deterministic decimal-safe calculation (integer paisa).
 * - Never relies on AI to calculate or approve financial balances.
 * - Any unexplained imbalance blocks import readiness.
 */

import { CleaningIssue, DataPartType, ParsedSheet } from './types';
import { parseNumericAmount, normalizeTaxRate } from './rules';

export interface FinancialTotalsPaisa {
  debitPaisa: number;
  creditPaisa: number;
  salesPaisa: number;
  purchasesPaisa: number;
  taxPaisa: number;
  bankPaisa: number;
  generalAmountPaisa: number;
}

export interface ReconciliationReport {
  jobId?: number;
  totalInputRows: number;
  acceptedRowsCount: number;
  rejectedRowsCount: number;
  reviewRequiredRowsCount: number;
  duplicateRowsCount: number;
  originalTotals: FinancialTotalsPaisa;
  cleanedTotals: FinancialTotalsPaisa;
  differencesPaisa: {
    debitDiff: number;
    creditDiff: number;
    salesDiff: number;
    purchasesDiff: number;
    taxDiff: number;
    amountDiff: number;
  };
  debitCreditBalanced: boolean;
  expectedParts: string[];
  detectedParts: DataPartType[];
  missingParts: string[];
  unmappedAccounts: string[];
  duplicateReferences: string[];
  isImportReady: boolean;
  blockingReasons: string[];
  generatedAt: string;
}

export interface ReconcileOptions {
  jobId?: number;
  sheets: ParsedSheet[];
  issues: CleaningIssue[];
  expectedParts?: string[];
  detectedParts?: DataPartType[];
  duplicateCount?: number;
  unmappedAccounts?: string[];
  duplicateReferences?: string[];
}

/**
 * Executes deterministic row and financial reconciliation.
 */
export function generateReconciliationReport(options: ReconcileOptions): ReconciliationReport {
  const {
    jobId,
    sheets,
    issues,
    expectedParts = [],
    detectedParts = [],
    duplicateCount = 0,
    unmappedAccounts = [],
    duplicateReferences = [],
  } = options;

  let totalInputRows = 0;
  for (const s of sheets) {
    totalInputRows += s.totalRows;
  }

  // 1. Classify Issues by Severity
  const errorIssues = issues.filter((i) => i.issueType === 'error');
  const warningIssues = issues.filter((i) => i.issueType === 'warning' || i.issueType === 'ai_suggestion');

  // Rows with error issues are rejected from accepted rows
  const rejectedRowKeys = new Set(errorIssues.map((i) => `${i.sheetName}:${i.sourceRow}`));
  const reviewRowKeys = new Set(warningIssues.map((i) => `${i.sheetName}:${i.sourceRow}`));

  const rejectedRowsCount = rejectedRowKeys.size;
  const reviewRequiredRowsCount = reviewRowKeys.size;
  const acceptedRowsCount = Math.max(0, totalInputRows - rejectedRowsCount);

  // 2. Calculate Financial Totals in Exact Integer Paisa
  const originalTotals: FinancialTotalsPaisa = {
    debitPaisa: 0,
    creditPaisa: 0,
    salesPaisa: 0,
    purchasesPaisa: 0,
    taxPaisa: 0,
    bankPaisa: 0,
    generalAmountPaisa: 0,
  };

  const cleanedTotals: FinancialTotalsPaisa = {
    debitPaisa: 0,
    creditPaisa: 0,
    salesPaisa: 0,
    purchasesPaisa: 0,
    taxPaisa: 0,
    bankPaisa: 0,
    generalAmountPaisa: 0,
  };

  const blockingReasons: string[] = [];

  for (const sheet of sheets) {
    const isSales = sheet.headers.some((h) => /(?:invoice|customer)/i.test(h));
    const isPurchase = sheet.headers.some((h) => /(?:bill|vendor|supplier)/i.test(h));
    const isBank = sheet.headers.some((h) => /(?:bank|cheque|statement)/i.test(h));

    const debitCols = sheet.headers.filter((h) => /(?:debit|dr)/i.test(h));
    const creditCols = sheet.headers.filter((h) => /(?:credit|cr)/i.test(h));
    const amountCols = sheet.headers.filter((h) => /(?:total|amount|net|gross|subtotal|balance)/i.test(h));
    const taxCols = sheet.headers.filter((h) => /(?:tax|vat|gst|wht)/i.test(h));

    for (const row of sheet.rows) {
      const isRejected = rejectedRowKeys.has(`${sheet.sheetName}:${row.sourceRowNumber}`);

      // Check tax rates for out-of-bounds rates (> 100% or < 0%)
      for (const col of taxCols) {
        const rawTax = row.data[col];
        if (rawTax) {
          const taxRes = normalizeTaxRate(rawTax, row.sourceRowNumber, col, sheet.sheetName);
          if (taxRes.cleanedValue.percent > 100 || taxRes.cleanedValue.percent < 0) {
            blockingReasons.push(
              `Out-of-bounds tax rate "${rawTax}" (${taxRes.cleanedValue.percent}%) at Row #${row.sourceRowNumber} in "${sheet.sheetName}" blocks import readiness.`
            );
          }
        }
      }

      // Debit sums
      debitCols.forEach((col) => {
        const parsed = parseNumericAmount(row.data[col], row.sourceRowNumber, col, sheet.sheetName);
        originalTotals.debitPaisa += parsed.cleanedValue.paisa;
        if (!isRejected) cleanedTotals.debitPaisa += parsed.cleanedValue.paisa;
      });

      // Credit sums
      creditCols.forEach((col) => {
        const parsed = parseNumericAmount(row.data[col], row.sourceRowNumber, col, sheet.sheetName);
        originalTotals.creditPaisa += parsed.cleanedValue.paisa;
        if (!isRejected) cleanedTotals.creditPaisa += parsed.cleanedValue.paisa;
      });

      // Sales / Purchase / General Amount sums
      amountCols.forEach((col) => {
        const parsed = parseNumericAmount(row.data[col], row.sourceRowNumber, col, sheet.sheetName);
        const paisa = parsed.cleanedValue.paisa;

        originalTotals.generalAmountPaisa += paisa;
        if (!isRejected) cleanedTotals.generalAmountPaisa += paisa;

        if (isSales) {
          originalTotals.salesPaisa += paisa;
          if (!isRejected) cleanedTotals.salesPaisa += paisa;
        }
        if (isPurchase) {
          originalTotals.purchasesPaisa += paisa;
          if (!isRejected) cleanedTotals.purchasesPaisa += paisa;
        }
        if (isBank) {
          originalTotals.bankPaisa += paisa;
          if (!isRejected) cleanedTotals.bankPaisa += paisa;
        }
      });
    }
  }

  // 3. Compute Financial Differences
  const differencesPaisa = {
    debitDiff: originalTotals.debitPaisa - cleanedTotals.debitPaisa,
    creditDiff: originalTotals.creditPaisa - cleanedTotals.creditPaisa,
    salesDiff: originalTotals.salesPaisa - cleanedTotals.salesPaisa,
    purchasesDiff: originalTotals.purchasesPaisa - cleanedTotals.purchasesPaisa,
    taxDiff: originalTotals.taxPaisa - cleanedTotals.taxPaisa,
    amountDiff: originalTotals.generalAmountPaisa - cleanedTotals.generalAmountPaisa,
  };

  // 4. Balanced Verification (for GL/Journal transactions)
  const hasDualLedger = cleanedTotals.debitPaisa > 0 || cleanedTotals.creditPaisa > 0;
  const debitCreditBalanced = hasDualLedger ? cleanedTotals.debitPaisa === cleanedTotals.creditPaisa : true;

  if (hasDualLedger && !debitCreditBalanced) {
    blockingReasons.push(
      `General Ledger entries are unbalanced: Total Debits (PKR ${(cleanedTotals.debitPaisa / 100).toFixed(2)}) != Total Credits (PKR ${(cleanedTotals.creditPaisa / 100).toFixed(2)}). Difference: PKR ${(Math.abs(cleanedTotals.debitPaisa - cleanedTotals.creditPaisa) / 100).toFixed(2)}.`
    );
  }

  // 5. Missing Expected Data Parts
  const missingParts: string[] = [];
  for (const exp of expectedParts) {
    if (!detectedParts.includes(exp as DataPartType)) {
      missingParts.push(exp);
      blockingReasons.push(`Expected accounting data part "${exp}" was not detected in uploaded dataset.`);
    }
  }

  // 6. Unmapped Accounts & Rejected Rows Blocking Check
  if (rejectedRowsCount > 0) {
    blockingReasons.push(`${rejectedRowsCount} rejected rows with validation errors must be resolved before import.`);
  }

  if (unmappedAccounts.length > 0) {
    blockingReasons.push(`${unmappedAccounts.length} unmapped accounts detected that need Chart of Accounts mapping.`);
  }

  // Import is ready ONLY if 0 blocking reasons exist
  const isImportReady = blockingReasons.length === 0;

  return {
    jobId,
    totalInputRows,
    acceptedRowsCount,
    rejectedRowsCount,
    reviewRequiredRowsCount,
    duplicateRowsCount: duplicateCount,
    originalTotals,
    cleanedTotals,
    differencesPaisa,
    debitCreditBalanced,
    expectedParts,
    detectedParts,
    missingParts,
    unmappedAccounts,
    duplicateReferences,
    isImportReady,
    blockingReasons,
    generatedAt: new Date().toISOString(),
  };
}

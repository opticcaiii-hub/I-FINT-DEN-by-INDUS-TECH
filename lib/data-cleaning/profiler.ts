/**
 * Data Profiler for Data Cleaning & Migration Studio
 * 
 * Analyzes parsed sheets and rows to produce comprehensive structural and financial metrics:
 * - Column types inference
 * - Date ranges
 * - Detected currency
 * - Debit/Credit and Amount totals
 * - Missing required fields and blank rows
 * - Candidate data part classification clues
 */

import {
  ColumnProfile,
  DataPartType,
  InferredColumnType,
  ParsedFileResult,
  ParsedSheet,
  ProfileReport,
  SheetProfileSummary,
} from './types';
import { parseNumericAmount } from './rules';

/**
 * Generates a full profile report for a parsed file across all sheets.
 */
export function profileParsedFile(parsedFile: ParsedFileResult): ProfileReport {
  const sheetSummaries: SheetProfileSummary[] = parsedFile.sheets.map((sheet) =>
    profileSheet(sheet)
  );

  return {
    filename: parsedFile.filename,
    fileSizeBytes: parsedFile.fileSizeBytes,
    fileHashSha256: parsedFile.fileHashSha256,
    sheetSummaries,
    totalRows: parsedFile.totalRowsAcrossSheets,
  };
}

/**
 * Profiles an individual sheet.
 */
export function profileSheet(sheet: ParsedSheet): SheetProfileSummary {
  const columnProfiles: Record<string, ColumnProfile> = {};

  // 1. Profile each column
  for (const col of sheet.headers) {
    columnProfiles[col] = profileColumn(col, sheet);
  }

  // 2. Aggregate Date Ranges
  let minDate: string | undefined;
  let maxDate: string | undefined;

  for (const colProfile of Object.values(columnProfiles)) {
    if (colProfile.inferredType === 'date') {
      if (colProfile.minDate && (!minDate || colProfile.minDate < minDate)) {
        minDate = colProfile.minDate;
      }
      if (colProfile.maxDate && (!maxDate || colProfile.maxDate > maxDate)) {
        maxDate = colProfile.maxDate;
      }
    }
  }

  // 3. Detect Currency Clues
  let detectedCurrency = 'PKR'; // default
  for (const row of sheet.rows) {
    for (const val of Object.values(row.data)) {
      if (/\b(?:USD|\$)\b/i.test(val)) detectedCurrency = 'USD';
      if (/\b(?:EUR|€)\b/i.test(val)) detectedCurrency = 'EUR';
      if (/\b(?:GBP|£)\b/i.test(val)) detectedCurrency = 'GBP';
      if (/\b(?:PKR|Rs\.?)\b/i.test(val)) detectedCurrency = 'PKR';
    }
  }

  // 4. Calculate Financial Totals (Debit, Credit, Amount)
  let debitTotalPaisa = 0;
  let creditTotalPaisa = 0;
  let amountTotalPaisa = 0;
  let hasDebitCol = false;
  let hasCreditCol = false;

  const debitCols = sheet.headers.filter((h) => /\b(?:debit|dr)\b/i.test(h));
  const creditCols = sheet.headers.filter((h) => /\b(?:credit|cr)\b/i.test(h));
  const amountCols = sheet.headers.filter((h) => /\b(?:amount|total|net|gross|price|subtotal|balance)\b/i.test(h));

  if (debitCols.length > 0) hasDebitCol = true;
  if (creditCols.length > 0) hasCreditCol = true;

  for (const row of sheet.rows) {
    // Debit totals
    debitCols.forEach((col) => {
      const parsed = parseNumericAmount(row.data[col], row.sourceRowNumber, col, sheet.sheetName);
      debitTotalPaisa += parsed.cleanedValue.paisa;
    });

    // Credit totals
    creditCols.forEach((col) => {
      const parsed = parseNumericAmount(row.data[col], row.sourceRowNumber, col, sheet.sheetName);
      creditTotalPaisa += parsed.cleanedValue.paisa;
    });

    // Amount totals
    amountCols.forEach((col) => {
      const parsed = parseNumericAmount(row.data[col], row.sourceRowNumber, col, sheet.sheetName);
      amountTotalPaisa += parsed.cleanedValue.paisa;
    });
  }

  const debitCreditBalanced = hasDebitCol && hasCreditCol ? debitTotalPaisa === creditTotalPaisa : undefined;

  // 5. Candidate Data-Part Heuristics
  const candidateParts = detectCandidateParts(sheet.headers, sheet.sheetName);

  return {
    sheetName: sheet.sheetName,
    totalRows: sheet.totalRows,
    columnsDetected: sheet.headers,
    columnProfiles,
    blankRowCount: sheet.blankRowCount,
    duplicateHeaderCount: sheet.duplicateHeaderCount,
    detectedCurrency,
    dateRange: minDate && maxDate ? { minDate, maxDate } : undefined,
    totals: {
      debitTotalPaisa,
      creditTotalPaisa,
      amountTotalPaisa,
      debitCreditBalanced,
    },
    candidateParts,
  };
}

/**
 * Profiles a single column across all rows in a sheet.
 */
function profileColumn(columnName: string, sheet: ParsedSheet): ColumnProfile {
  let nullCount = 0;
  const sampleValues: string[] = [];
  const distinctSet = new Set<string>();
  const typeCounts: Record<InferredColumnType, number> = {
    string: 0,
    number: 0,
    integer: 0,
    currency: 0,
    date: 0,
    boolean: 0,
    empty: 0,
    mixed: 0,
  };

  let minNumber: number | undefined;
  let maxNumber: number | undefined;
  let minDate: string | undefined;
  let maxDate: string | undefined;

  for (const row of sheet.rows) {
    const val = (row.data[columnName] || '').trim();

    if (!val) {
      nullCount++;
      typeCounts.empty++;
      continue;
    }

    distinctSet.add(val);
    if (sampleValues.length < 5) {
      sampleValues.push(val);
    }

    // Infer cell type
    const cellType = inferCellType(val);
    typeCounts[cellType]++;

    if (cellType === 'number' || cellType === 'integer' || cellType === 'currency') {
      const num = parseFloat(val.replace(/[^0-9.-]/g, ''));
      if (!isNaN(num)) {
        if (minNumber === undefined || num < minNumber) minNumber = num;
        if (maxNumber === undefined || num > maxNumber) maxNumber = num;
      }
    } else if (cellType === 'date') {
      if (minDate === undefined || val < minDate) minDate = val;
      if (maxDate === undefined || val > maxDate) maxDate = val;
    }
  }

  // Determine dominant column type
  let inferredType: InferredColumnType = 'string';
  const nonNullCount = sheet.totalRows - nullCount;

  if (nonNullCount === 0) {
    inferredType = 'empty';
  } else {
    const maxTypeEntry = Object.entries(typeCounts)
      .filter(([t]) => t !== 'empty')
      .sort((a, b) => b[1] - a[1])[0];

    if (maxTypeEntry && maxTypeEntry[1] / nonNullCount >= 0.7) {
      inferredType = maxTypeEntry[0] as InferredColumnType;
    } else {
      inferredType = 'mixed';
    }
  }

  return {
    name: columnName,
    inferredType,
    sampleValues,
    nullCount,
    distinctCount: distinctSet.size,
    minNumber,
    maxNumber,
    minDate,
    maxDate,
  };
}

/**
 * Infers type for a single cell string value.
 */
function inferCellType(val: string): InferredColumnType {
  const v = val.trim();
  if (!v) return 'empty';

  if (/^(?:true|false|yes|no)$/i.test(v)) return 'boolean';

  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(v) || /^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(v)) {
    return 'date';
  }

  if (/^[-+]?\d+$/.test(v)) return 'integer';

  if (/^[-+]?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?$/.test(v)) return 'number';

  if (/^(?:PKR|Rs\.?|\$|€|£)\s*[-+]?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?$/i.test(v) ||
      /^\([-+]?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?\)$/.test(v)) {
    return 'currency';
  }

  return 'string';
}

/**
 * Heuristic classifier: matches column headers to candidate accounting data parts.
 */
function detectCandidateParts(
  headers: string[],
  sheetName: string
): Array<{ part: DataPartType; confidence: number; reason: string }> {
  const hLower = headers.map((h) => h.toLowerCase());
  const sheetLower = sheetName.toLowerCase();
  const candidates: Array<{ part: DataPartType; confidence: number; reason: string }> = [];

  // Chart of Accounts
  if (
    hLower.some((h) => h.includes('account_code') || h.includes('account code')) &&
    hLower.some((h) => h.includes('account_name') || h.includes('account name'))
  ) {
    candidates.push({
      part: 'chart_of_accounts',
      confidence: 0.95,
      reason: 'Contains "account_code" and "account_name" columns.',
    });
  }

  // Customer Master
  if (
    hLower.some((h) => h.includes('customer') || h.includes('client')) &&
    hLower.some((h) => h.includes('email') || h.includes('phone') || h.includes('ntn') || h.includes('address')) &&
    !hLower.some((h) => h.includes('invoice'))
  ) {
    candidates.push({
      part: 'customer_master',
      confidence: 0.9,
      reason: 'Contains customer contact and identification fields.',
    });
  }

  // Vendor Master
  if (
    hLower.some((h) => h.includes('vendor') || h.includes('supplier')) &&
    hLower.some((h) => h.includes('email') || h.includes('phone') || h.includes('ntn') || h.includes('address')) &&
    !hLower.some((h) => h.includes('bill'))
  ) {
    candidates.push({
      part: 'vendor_master',
      confidence: 0.9,
      reason: 'Contains vendor contact and identification fields.',
    });
  }

  // Sales Invoices
  if (
    hLower.some((h) => h.includes('invoice') || h.includes('inv_num') || h.includes('inv #')) &&
    hLower.some((h) => h.includes('customer') || h.includes('client'))
  ) {
    candidates.push({
      part: 'sales_invoices',
      confidence: 0.92,
      reason: 'Contains invoice numbers and customer references.',
    });
  }

  // Purchase Bills
  if (
    hLower.some((h) => h.includes('bill') || h.includes('bill_num') || h.includes('purchase')) &&
    hLower.some((h) => h.includes('vendor') || h.includes('supplier'))
  ) {
    candidates.push({
      part: 'purchase_bills',
      confidence: 0.92,
      reason: 'Contains bill numbers and vendor references.',
    });
  }

  // General Ledger / Journal Entries
  if (
    hLower.some((h) => h.includes('journal') || h.includes('entry') || h.includes('voucher') || h.includes('narration')) &&
    hLower.some((h) => h.includes('debit') || h.includes('dr')) &&
    hLower.some((h) => h.includes('credit') || h.includes('cr'))
  ) {
    candidates.push({
      part: 'general_ledger',
      confidence: 0.94,
      reason: 'Contains voucher/narration and dual debit/credit columns.',
    });
  }

  // Bank Transactions
  if (
    (sheetLower.includes('bank') || hLower.some((h) => h.includes('bank') || h.includes('cheque') || h.includes('statement'))) &&
    hLower.some((h) => h.includes('date')) &&
    hLower.some((h) => h.includes('withdrawal') || h.includes('deposit') || h.includes('balance') || h.includes('amount'))
  ) {
    candidates.push({
      part: 'bank_transactions',
      confidence: 0.88,
      reason: 'Contains bank statement date, transaction, and balance columns.',
    });
  }

  // Opening Balances
  if (
    sheetLower.includes('opening') ||
    (hLower.some((h) => h.includes('account')) &&
      hLower.some((h) => h.includes('opening') || h.includes('initial')) &&
      hLower.some((h) => h.includes('debit') || h.includes('credit') || h.includes('balance')))
  ) {
    candidates.push({
      part: 'opening_balances',
      confidence: 0.89,
      reason: 'Contains account codes and opening balance figures.',
    });
  }

  // Fallback
  if (candidates.length === 0) {
    candidates.push({
      part: 'other',
      confidence: 0.5,
      reason: 'General tabular structure without specific single accounting master markers.',
    });
  }

  return candidates.sort((a, b) => b.confidence - a.confidence);
}

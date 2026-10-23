/**
 * Data Cleaning & Migration Studio: Core Types & Contracts
 */

export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_ROW_COUNT = 100_000; // 100,000 rows max

export const DATA_PART_TYPES = [
  'chart_of_accounts',
  'customer_master',
  'vendor_master',
  'sales_invoices',
  'purchase_bills',
  'customer_payments',
  'vendor_payments',
  'bank_transactions',
  'general_ledger',
  'trial_balance',
  'opening_balances',
  'payroll',
  'fixed_assets',
  'inventory',
  'tax_wht',
  'other',
] as const;

export type DataPartType = typeof DATA_PART_TYPES[number];

export type InferredColumnType =
  | 'string'
  | 'number'
  | 'integer'
  | 'currency'
  | 'date'
  | 'boolean'
  | 'empty'
  | 'mixed';

export interface RawRow {
  sourceRowNumber: number; // 1-indexed row number from the source sheet/file
  sheetName: string;
  data: Record<string, string>;
  rawValues: Record<string, unknown>;
  isHeader?: boolean;
  isBlank?: boolean;
}

export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: RawRow[];
  totalRows: number;
  duplicateHeaderCount: number;
  blankRowCount: number;
}

export interface ParsedFileResult {
  filename: string;
  fileSizeBytes: number;
  fileHashSha256: string;
  mimeType: string;
  sheets: ParsedSheet[];
  totalRowsAcrossSheets: number;
}

export interface ColumnProfile {
  name: string;
  inferredType: InferredColumnType;
  sampleValues: string[];
  nullCount: number;
  distinctCount: number;
  minNumber?: number;
  maxNumber?: number;
  minDate?: string;
  maxDate?: string;
}

export interface SheetProfileSummary {
  sheetName: string;
  totalRows: number;
  columnsDetected: string[];
  columnProfiles: Record<string, ColumnProfile>;
  blankRowCount: number;
  duplicateHeaderCount: number;
  detectedCurrency?: string;
  dateRange?: {
    minDate: string;
    maxDate: string;
  };
  totals: {
    debitTotalPaisa: number;
    creditTotalPaisa: number;
    amountTotalPaisa: number;
    debitCreditBalanced?: boolean;
  };
  candidateParts: Array<{
    part: DataPartType;
    confidence: number;
    reason: string;
  }>;
}

export interface ProfileReport {
  filename: string;
  fileSizeBytes: number;
  fileHashSha256: string;
  sheetSummaries: SheetProfileSummary[];
  totalRows: number;
}

export type IssueType = 'error' | 'warning' | 'ai_suggestion' | 'duplicate';

export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'edited' | 'deferred';

export interface CleaningIssue {
  sourceRow: number;
  sourceColumn?: string;
  sheetName: string;
  issueType: IssueType;
  ruleCode: string;
  originalValue: string;
  suggestedValue: string;
  reason: string;
  confidence: number;
  reviewStatus: ReviewStatus;
}

export interface CleanedValueResult<T = string> {
  originalValue: string;
  cleanedValue: T;
  wasModified: boolean;
  ruleApplied?: string;
  issue?: CleaningIssue;
}

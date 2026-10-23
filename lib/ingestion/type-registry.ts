/**
 * lib/ingestion/type-registry.ts
 *
 * Core Type Registry & Validation Engine for Data Ingestion.
 *
 * Provides a centralized catalog of 64 built-in subtypes across 15 accounting categories:
 * - Bank Statements (12)
 * - Sales Invoices (9)
 * - Purchase Bills (7)
 * - Customers (2)
 * - Vendors (2)
 * - Chart of Accounts (4)
 * - General Journals (4)
 * - Payments (5)
 * - Expenses (4)
 * - Fixed Assets (3)
 * - Payroll (3)
 * - Tax Registers (3)
 * - Loans (3)
 * - Inventory (4)
 * - Budget (2)
 *
 * Key Architecture:
 * 1. Immutable registry (Object.freeze) preventing tenant pollution.
 * 2. Real normalizer integration (parseDateStrict, parseAmountToPaisa, normalizeText).
 * 3. Separation of RowValidationRule (single row) and FileValidationRule (cross-row / file).
 * 4. Full error traceability (sourceRowNumber, sourceColumn, canonicalColumn, ruleId, severity, message).
 * 5. Extra unmapped columns preserved in extraColumns dictionary (Option A).
 */

import { z } from 'zod';
import { parseAmountToPaisa } from '@/lib/import-wizard/amount-normalizer';
import { parseDateStrict } from '@/lib/import-wizard/date-normalizer';
import { normalizeText, normalizeCounterparty, normalizeReference } from '@/lib/normalization';

// ─── 1. Canonical Types & Enums ──────────────────────────────────────────────

export type DataType =
  | 'bank_statements'
  | 'sales_invoices'
  | 'purchase_bills'
  | 'customers'
  | 'vendors'
  | 'chart_of_accounts'
  | 'journals'
  | 'payments'
  | 'expenses'
  | 'fixed_assets'
  | 'payroll'
  | 'tax_registers'
  | 'loans'
  | 'inventory'
  | 'budget';

export const DATA_TYPES: DataType[] = [
  'bank_statements',
  'sales_invoices',
  'purchase_bills',
  'customers',
  'vendors',
  'chart_of_accounts',
  'journals',
  'payments',
  'expenses',
  'fixed_assets',
  'payroll',
  'tax_registers',
  'loans',
  'inventory',
  'budget',
];

export type ColumnDataType = 'string' | 'number' | 'date' | 'amount' | 'boolean' | 'enum';
export type NormalizerType = 'date' | 'amount' | 'text' | 'counterparty' | 'reference';

export interface ColumnDefinition {
  key: string;
  label: string;
  type: ColumnDataType;
  required: boolean;
  description?: string;
  enumValues?: string[];
  normalizer?: NormalizerType;
}

export interface ValidationIssue {
  sourceRowNumber: number;
  sourceColumn?: string;
  canonicalColumn?: string;
  ruleId: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface RowValidationRule {
  id: string;
  description: string;
  severity: 'error' | 'warning';
  validate: (row: Record<string, any>, rowIndex: number) => ValidationIssue | null;
}

export interface FileValidationRule {
  id: string;
  description: string;
  severity: 'error' | 'warning';
  validate: (rows: Record<string, any>[]) => ValidationIssue[];
}

export interface SubTypeDefinition {
  id: string;
  dataType: DataType;
  label: string;
  description: string;
  requiredColumns: ColumnDefinition[];
  optionalColumns: ColumnDefinition[];
  rowRules: RowValidationRule[];
  fileRules: FileValidationRule[];
  zodSchema: z.ZodTypeAny;
}

export class TypeRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TypeRegistryError';
  }
}

// ─── 2. Normalization Helpers ────────────────────────────────────────────────

export function normalizeDataTypeKey(raw: string): DataType {
  const clean = raw.toLowerCase().trim().replace(/[-\s]/g, '_');
  
  // Mapping synonyms to canonical DataType
  const aliasMap: Record<string, DataType> = {
    bank: 'bank_statements',
    bank_statement: 'bank_statements',
    bank_statements: 'bank_statements',
    sales: 'sales_invoices',
    sales_invoice: 'sales_invoices',
    sales_invoices: 'sales_invoices',
    purchase: 'purchase_bills',
    purchase_bill: 'purchase_bills',
    purchase_bills: 'purchase_bills',
    purchases: 'purchase_bills',
    customer: 'customers',
    customers: 'customers',
    vendor: 'vendors',
    vendors: 'vendors',
    supplier: 'vendors',
    suppliers: 'vendors',
    coa: 'chart_of_accounts',
    chart_of_accounts: 'chart_of_accounts',
    journal: 'journals',
    journals: 'journals',
    journal_entry: 'journals',
    journal_entries: 'journals',
    payment: 'payments',
    payments: 'payments',
    expense: 'expenses',
    expenses: 'expenses',
    asset: 'fixed_assets',
    assets: 'fixed_assets',
    fixed_asset: 'fixed_assets',
    fixed_assets: 'fixed_assets',
    payroll: 'payroll',
    tax: 'tax_registers',
    tax_register: 'tax_registers',
    tax_registers: 'tax_registers',
    wht: 'tax_registers',
    loan: 'loans',
    loans: 'loans',
    inventory: 'inventory',
    stock: 'inventory',
    budget: 'budget',
    budgets: 'budget',
  };

  const resolved = aliasMap[clean];
  if (!resolved) {
    throw new TypeRegistryError(`Unknown or unsupported data type "${raw}". Valid types: ${DATA_TYPES.join(', ')}`);
  }
  return resolved;
}

// ─── 3. Common Column Definitions ────────────────────────────────────────────

const col = (
  key: string,
  label: string,
  type: ColumnDataType,
  required: boolean,
  normalizer?: NormalizerType,
  enumValues?: string[],
  description?: string
): ColumnDefinition => ({
  key,
  label,
  type,
  required,
  normalizer: normalizer || (type === 'date' ? 'date' : type === 'amount' ? 'amount' : undefined),
  enumValues,
  description,
});

// Common reusable columns
const dateCol = (key = 'date', label = 'Transaction Date', required = true) =>
  col(key, label, 'date', required, 'date');

const descCol = (key = 'description', label = 'Description / Narration', required = true) =>
  col(key, label, 'string', required, 'text');

const refCol = (key = 'reference_number', label = 'Reference / Voucher #', required = false) =>
  col(key, label, 'string', required, 'reference');

const amountCol = (key = 'amount', label = 'Amount', required = true) =>
  col(key, label, 'amount', required, 'amount');

const debitCol = (key = 'debit', label = 'Debit Amount', required = false) =>
  col(key, label, 'amount', required, 'amount');

const creditCol = (key = 'credit', label = 'Credit Amount', required = false) =>
  col(key, label, 'amount', required, 'amount');

// Common Row Validation Rules
const XOR_DEBIT_CREDIT_RULE: RowValidationRule = {
  id: 'XOR_DEBIT_CREDIT',
  description: 'A transaction line must specify either a debit or a credit amount, but not both',
  severity: 'error',
  validate: (row, idx) => {
    const dr = typeof row.debit === 'number' ? row.debit : 0;
    const cr = typeof row.credit === 'number' ? row.credit : 0;
    if (dr > 0 && cr > 0) {
      return {
        sourceRowNumber: idx,
        canonicalColumn: 'debit',
        ruleId: 'XOR_DEBIT_CREDIT',
        severity: 'error',
        message: 'Row specifies both Debit and Credit amounts simultaneously. Exactly one is expected.',
      };
    }
    if (dr === 0 && cr === 0 && row.amount === undefined) {
      return {
        sourceRowNumber: idx,
        canonicalColumn: 'debit',
        ruleId: 'XOR_DEBIT_CREDIT',
        severity: 'error',
        message: 'Row must have a non-zero Debit or Credit amount.',
      };
    }
    return null;
  },
};

const XOR_OPENING_BALANCE_RULE: RowValidationRule = {
  id: 'XOR_OPENING_BALANCE',
  description: 'Opening balance cannot specify both Opening Debit and Opening Credit simultaneously',
  severity: 'error',
  validate: (row, idx) => {
    const dr = typeof row.opening_debit === 'number' ? row.opening_debit : 0;
    const cr = typeof row.opening_credit === 'number' ? row.opening_credit : 0;
    if (dr > 0 && cr > 0) {
      return {
        sourceRowNumber: idx,
        canonicalColumn: 'opening_debit',
        ruleId: 'XOR_OPENING_BALANCE',
        severity: 'error',
        message: 'Account specifies both Opening Debit and Opening Credit simultaneously. Exactly one or neither is expected.',
      };
    }
    return null;
  },
};

const POSITIVE_AMOUNT_RULE: RowValidationRule = {
  id: 'POSITIVE_AMOUNT',
  description: 'Transaction amount must be strictly greater than zero',
  severity: 'error',
  validate: (row, idx) => {
    if (typeof row.amount === 'number' && row.amount <= 0) {
      return {
        sourceRowNumber: idx,
        canonicalColumn: 'amount',
        ruleId: 'POSITIVE_AMOUNT',
        severity: 'error',
        message: 'Amount must be greater than zero.',
      };
    }
    return null;
  },
};

const SUBTOTAL_TAX_TOTAL_RULE: RowValidationRule = {
  id: 'SUBTOTAL_TAX_TOTAL',
  description: 'Total amount must equal Subtotal plus Tax amount (within 1 PKR tolerance for rounding)',
  severity: 'error',
  validate: (row, idx) => {
    if (typeof row.subtotal === 'number' && typeof row.tax_amount === 'number' && typeof row.total_amount === 'number') {
      const diff = Math.abs(row.subtotal + row.tax_amount - row.total_amount);
      if (diff > 100) { // 100 paisa = 1 PKR
        return {
          sourceRowNumber: idx,
          canonicalColumn: 'total_amount',
          ruleId: 'SUBTOTAL_TAX_TOTAL',
          severity: 'error',
          message: `Total amount (${row.total_amount / 100}) does not match subtotal (${row.subtotal / 100}) + tax (${row.tax_amount / 100}).`,
        };
      }
    }
    return null;
  },
};

const LINE_TOTAL_RECONCILIATION_RULE: RowValidationRule = {
  id: 'LINE_TOTAL_RECONCILIATION',
  description: 'Line total must equal quantity times unit price (within 1 PKR tolerance for rounding)',
  severity: 'error',
  validate: (row, idx) => {
    if (typeof row.quantity === 'number' && typeof row.unit_price === 'number' && typeof row.line_total === 'number') {
      const computed = Math.round(row.quantity * row.unit_price);
      if (Math.abs(computed - row.line_total) > 100) {
        return {
          sourceRowNumber: idx,
          canonicalColumn: 'line_total',
          ruleId: 'LINE_TOTAL_RECONCILIATION',
          severity: 'error',
          message: `Line total (${row.line_total / 100}) does not equal quantity (${row.quantity}) * unit price (${row.unit_price / 100}).`,
        };
      }
    }
    return null;
  },
};

// Common File Validation Rules
const RUNNING_BALANCE_CONTINUITY_RULE: FileValidationRule = {
  id: 'RUNNING_BALANCE_CONTINUITY',
  description: 'Running balance in consecutive rows must reconcile with debit and credit movements',
  severity: 'error',
  validate: (rows) => {
    const issues: ValidationIssue[] = [];
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const curr = rows[i];
      if (
        curr &&
        prev &&
        typeof prev.balance === 'number' &&
        typeof curr.balance === 'number'
      ) {
        const dr = typeof curr.debit === 'number' ? curr.debit : 0;
        const cr = typeof curr.credit === 'number' ? curr.credit : 0;
        const amt = typeof curr.amount === 'number' ? curr.amount : 0;
        
        let expectedBal = prev.balance;
        if (dr > 0 || cr > 0) {
          expectedBal = prev.balance + cr - dr; // standard bank credit=deposit, debit=withdrawal
        } else if (amt !== 0) {
          expectedBal = prev.balance + amt;
        }

        if (Math.abs(expectedBal - curr.balance) > 100) {
          issues.push({
            sourceRowNumber: curr.sourceRowNumber || (i + 1),
            canonicalColumn: 'balance',
            ruleId: 'RUNNING_BALANCE_CONTINUITY',
            severity: 'error',
            message: `Running balance jump detected at row ${i + 1}: expected ${expectedBal / 100} based on previous balance, found ${curr.balance / 100}.`,
          });
        }
      }
    }
    return issues;
  },
};

const DUPLICATE_INVOICE_NUMBER_RULE: FileValidationRule = {
  id: 'DUPLICATE_INVOICE_NUMBER',
  description: 'Invoice numbers within a single import header file must be distinct',
  severity: 'error',
  validate: (rows) => {
    const issues: ValidationIssue[] = [];
    const seen = new Map<string, number>();

    rows.forEach((row, idx) => {
      const invNum = String(row.invoice_number || '').trim().toUpperCase();
      if (invNum) {
        if (seen.has(invNum)) {
          issues.push({
            sourceRowNumber: row.sourceRowNumber || (idx + 1),
            canonicalColumn: 'invoice_number',
            ruleId: 'DUPLICATE_INVOICE_NUMBER',
            severity: 'error',
            message: `Duplicate invoice number "${invNum}" found (first seen at row ${seen.get(invNum)}).`,
          });
        } else {
          seen.set(invNum, row.sourceRowNumber || (idx + 1));
        }
      }
    });

    return issues;
  },
};

const BALANCED_JOURNAL_BATCH_RULE: FileValidationRule = {
  id: 'BALANCED_JOURNAL_BATCH',
  description: 'Total Debits across the journal batch must strictly equal Total Credits',
  severity: 'error',
  validate: (rows) => {
    const issues: ValidationIssue[] = [];
    let totalDebit = 0;
    let totalCredit = 0;

    rows.forEach((r) => {
      totalDebit += typeof r.debit === 'number' ? r.debit : 0;
      totalCredit += typeof r.credit === 'number' ? r.credit : 0;
    });

    if (totalDebit !== totalCredit) {
      issues.push({
        sourceRowNumber: 1,
        canonicalColumn: 'debit',
        ruleId: 'BALANCED_JOURNAL_BATCH',
        severity: 'error',
        message: `Journal batch is out of balance: Total Debit (${totalDebit / 100}) does not equal Total Credit (${totalCredit / 100}). Difference: ${(totalDebit - totalCredit) / 100}.`,
      });
    }

    return issues;
  },
};

// ─── 4. Subtype Catalog Construction (64 Subtypes) ───────────────────────────

function createDefinitions(): Record<string, SubTypeDefinition> {
  const defs: Record<string, SubTypeDefinition> = {};

  const add = (
    dataType: DataType,
    id: string,
    label: string,
    description: string,
    reqCols: ColumnDefinition[],
    optCols: ColumnDefinition[],
    rowRules: RowValidationRule[] = [],
    fileRules: FileValidationRule[] = [],
    schemaShape: Record<string, z.ZodTypeAny> = {}
  ) => {
    defs[id] = {
      id,
      dataType,
      label,
      description,
      requiredColumns: reqCols,
      optionalColumns: optCols,
      rowRules,
      fileRules,
      zodSchema: z.object(schemaShape).passthrough(),
    };
  };

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 1: BANK STATEMENTS (12 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'bank_statements',
    'bank_both_sides_sep',
    'Bank Statement (Separate Dr/Cr Columns)',
    'Standard bank statement with separate Debit and Credit amount columns',
    [dateCol(), descCol()],
    [debitCol(), creditCol(), refCol(), amountCol('balance', 'Balance', false)],
    [XOR_DEBIT_CREDIT_RULE],
    [],
    { date: z.string(), description: z.string() }
  );

  add(
    'bank_statements',
    'bank_single_debit',
    'Bank Statement (Single Debit Only)',
    'Disbursements or withdrawals statement containing only debit amounts',
    [dateCol(), descCol(), debitCol('debit', 'Debit Amount', true)],
    [refCol(), amountCol('balance', 'Balance', false)],
    [POSITIVE_AMOUNT_RULE],
    [],
    { date: z.string(), description: z.string(), debit: z.number().positive() }
  );

  add(
    'bank_statements',
    'bank_single_credit',
    'Bank Statement (Single Credit Only)',
    'Receipts or collections statement containing only credit amounts',
    [dateCol(), descCol(), creditCol('credit', 'Credit Amount', true)],
    [refCol(), amountCol('balance', 'Balance', false)],
    [POSITIVE_AMOUNT_RULE],
    [],
    { date: z.string(), description: z.string(), credit: z.number().positive() }
  );

  add(
    'bank_statements',
    'bank_single_signed',
    'Bank Statement (Single Signed Amount)',
    'Bank statement with single signed amount (+ for credits/deposits, - for debits/withdrawals)',
    [dateCol(), descCol(), amountCol('amount', 'Signed Amount', true)],
    [refCol(), amountCol('balance', 'Balance', false)],
    [],
    [],
    { date: z.string(), description: z.string(), amount: z.number() }
  );

  add(
    'bank_statements',
    'bank_multi_currency',
    'Bank Statement (Multi-Currency Account)',
    'Foreign currency or multi-currency bank statement with currency code and conversion rate',
    [dateCol(), descCol(), amountCol(), col('currency', 'Currency', 'string', true, 'text')],
    [col('exchange_rate', 'Exchange Rate', 'number', false), refCol(), amountCol('amount_pkr', 'PKR Equivalent', false)],
    [POSITIVE_AMOUNT_RULE],
    [],
    { date: z.string(), description: z.string(), amount: z.number().positive(), currency: z.string().min(3) }
  );

  add(
    'bank_statements',
    'bank_cheque_status',
    'Bank Statement with Cheque Status',
    'Bank statement tracking cheque numbers and clearance statuses',
    [dateCol(), descCol(), amountCol(), col('cheque_number', 'Cheque Number', 'string', true, 'reference')],
    [
      col('cheque_status', 'Status', 'enum', false, undefined, ['cleared', 'bounced', 'presented', 'stale']),
      refCol(),
    ],
    [POSITIVE_AMOUNT_RULE],
    [],
    { date: z.string(), description: z.string(), amount: z.number().positive(), cheque_number: z.string() }
  );

  add(
    'bank_statements',
    'bank_multiline_narration',
    'Bank Statement with Multi-Line Narration',
    'Complex bank statement where narrative particulars span multiple lines or secondary memo columns',
    [dateCol(), descCol()],
    [col('secondary_narration', 'Extended Particulars', 'string', false, 'text'), debitCol(), creditCol(), refCol()],
    [XOR_DEBIT_CREDIT_RULE],
    [],
    { date: z.string(), description: z.string() }
  );

  add(
    'bank_statements',
    'bank_with_running_balance',
    'Bank Statement with Continuous Running Balance',
    'Bank statement containing line-by-line running balance verified continuously',
    [dateCol(), descCol(), amountCol('balance', 'Running Balance', true)],
    [debitCol(), creditCol(), amountCol('amount', 'Net Amount', false), refCol()],
    [XOR_DEBIT_CREDIT_RULE],
    [RUNNING_BALANCE_CONTINUITY_RULE],
    { date: z.string(), description: z.string(), balance: z.number() }
  );

  add(
    'bank_statements',
    'bank_without_running_balance',
    'Bank Statement without Running Balance',
    'Periodic bank export with no balance column; validated purely by movement entries',
    [dateCol(), descCol()],
    [debitCol(), creditCol(), amountCol('amount', 'Net Amount', false), refCol()],
    [XOR_DEBIT_CREDIT_RULE],
    [],
    { date: z.string(), description: z.string() }
  );

  add(
    'bank_statements',
    'bank_card_settlement',
    'Merchant Card / POS Settlement',
    'POS machine settlement statement with gross sales, merchant commission fee, and net settlement',
    [dateCol(), descCol(), amountCol('gross_amount', 'Gross Amount', true), amountCol('net_settlement', 'Net Settlement', true)],
    [amountCol('fee_amount', 'Merchant Fee / MDR', false), col('terminal_id', 'Terminal ID', 'string', false, 'reference'), refCol()],
    [],
    [],
    { date: z.string(), description: z.string(), gross_amount: z.number().positive(), net_settlement: z.number().positive() }
  );

  add(
    'bank_statements',
    'bank_mobile_wallet',
    'Mobile Wallet Statement (Easypaisa / JazzCash / Raast)',
    'Digital micro-payment wallet statement with transaction ID, MSISDN, and fee breakdown',
    [dateCol(), descCol(), amountCol(), col('wallet_tx_id', 'Wallet Tx ID', 'string', true, 'reference')],
    [col('phone_number', 'Sender / Receiver Mobile', 'string', false, 'text'), amountCol('fee', 'Wallet Fee', false)],
    [POSITIVE_AMOUNT_RULE],
    [],
    { date: z.string(), description: z.string(), amount: z.number().positive(), wallet_tx_id: z.string() }
  );

  add(
    'bank_statements',
    'bank_cashbook_mixed',
    'Mixed Cashbook / Bank Log',
    'Unified cash and bank register with account identifier tag per line',
    [dateCol(), descCol(), col('account_type', 'Account Medium', 'enum', true, undefined, ['bank', 'cash'])],
    [debitCol(), creditCol(), amountCol(), refCol()],
    [XOR_DEBIT_CREDIT_RULE],
    [],
    { date: z.string(), description: z.string(), account_type: z.enum(['bank', 'cash']) }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 2: SALES INVOICES (9 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'sales_invoices',
    'sales_header',
    'Sales Invoice Header File',
    'Invoice summary file with one row per invoice document',
    [col('invoice_number', 'Invoice Number', 'string', true, 'reference'), dateCol('invoice_date', 'Invoice Date', true), col('customer_name', 'Customer Name', 'string', true, 'counterparty'), amountCol('total_amount', 'Total Amount', true)],
    [dateCol('due_date', 'Due Date', false), col('customer_ntn', 'Customer NTN', 'string', false, 'reference'), descCol('memo', 'Memo', false)],
    [POSITIVE_AMOUNT_RULE],
    [DUPLICATE_INVOICE_NUMBER_RULE],
    { invoice_number: z.string().min(1), invoice_date: z.string(), customer_name: z.string().min(1), total_amount: z.number().positive() }
  );

  add(
    'sales_invoices',
    'sales_lines',
    'Sales Invoice Line Items',
    'Detailed invoice item lines with quantity, rate, and line totals',
    [col('invoice_number', 'Invoice Number', 'string', true, 'reference'), col('item_description', 'Item Description', 'string', true, 'text'), col('quantity', 'Quantity', 'number', true), amountCol('unit_price', 'Unit Price', true), amountCol('line_total', 'Line Total', true)],
    [col('line_number', 'Line Number', 'number', false), col('account_code', 'Revenue Account Code', 'string', false, 'reference'), col('tax_rate', 'Tax Rate (%)', 'number', false)],
    [LINE_TOTAL_RECONCILIATION_RULE],
    [],
    { invoice_number: z.string().min(1), item_description: z.string(), quantity: z.number().positive(), unit_price: z.number().positive(), line_total: z.number().positive() }
  );

  add(
    'sales_invoices',
    'sales_register_summary',
    'Sales Register Summary',
    'Monthly or periodic sales register with FBR invoice numbers and total values',
    [col('invoice_number', 'Invoice #', 'string', true, 'reference'), dateCol('invoice_date', 'Date', true), col('customer_name', 'Customer', 'string', true, 'counterparty'), amountCol('gross_sales', 'Gross Sales', true), amountCol('tax_amount', 'Tax Amount', true), amountCol('net_sales', 'Net Total', true)],
    [col('customer_strn', 'STRN', 'string', false, 'reference'), col('fbr_pos_id', 'FBR Invoice ID', 'string', false, 'reference')],
    [],
    [],
    { invoice_number: z.string(), invoice_date: z.string(), customer_name: z.string(), gross_sales: z.number(), tax_amount: z.number(), net_sales: z.number() }
  );

  add(
    'sales_invoices',
    'sales_tax_exclusive',
    'Sales Invoices (Tax Exclusive Pricing)',
    'Sales file where prices exclude sales tax; tax added separately to subtotal',
    [col('invoice_number', 'Invoice #', 'string', true, 'reference'), dateCol('invoice_date', 'Date', true), col('customer_name', 'Customer', 'string', true, 'counterparty'), amountCol('subtotal', 'Tax-Exclusive Subtotal', true), amountCol('tax_amount', 'Sales Tax', true), amountCol('total_amount', 'Invoice Total', true)],
    [col('tax_rate', 'Sales Tax Rate %', 'number', false), refCol()],
    [SUBTOTAL_TAX_TOTAL_RULE],
    [],
    { invoice_number: z.string(), invoice_date: z.string(), customer_name: z.string(), subtotal: z.number().positive(), tax_amount: z.number().nonnegative(), total_amount: z.number().positive() }
  );

  add(
    'sales_invoices',
    'sales_tax_inclusive',
    'Sales Invoices (Tax Inclusive Pricing)',
    'Sales file where total amount includes tax; tax extracted backward',
    [col('invoice_number', 'Invoice #', 'string', true, 'reference'), dateCol('invoice_date', 'Date', true), col('customer_name', 'Customer', 'string', true, 'counterparty'), amountCol('total_amount', 'Total (Tax Inclusive)', true)],
    [amountCol('tax_extracted', 'Extracted Tax', false), col('tax_rate', 'Tax Rate %', 'number', false), refCol()],
    [POSITIVE_AMOUNT_RULE],
    [],
    { invoice_number: z.string(), invoice_date: z.string(), customer_name: z.string(), total_amount: z.number().positive() }
  );

  add(
    'sales_invoices',
    'sales_with_wht',
    'Sales Invoices with Withholding Tax Deduction',
    'Sales invoices where buyer deducts income/sales tax withholding at source',
    [col('invoice_number', 'Invoice #', 'string', true, 'reference'), dateCol('invoice_date', 'Date', true), col('customer_name', 'Customer', 'string', true, 'counterparty'), amountCol('invoice_amount', 'Invoice Gross', true), amountCol('wht_deducted', 'WHT Deducted', true), amountCol('net_receivable', 'Net Receivable', true)],
    [col('wht_section', 'Income Tax Section', 'string', false, 'reference'), refCol()],
    [],
    [],
    { invoice_number: z.string(), invoice_date: z.string(), customer_name: z.string(), invoice_amount: z.number().positive(), wht_deducted: z.number().nonnegative(), net_receivable: z.number().positive() }
  );

  add(
    'sales_invoices',
    'sales_with_discount_detail',
    'Sales Invoices with Trade Discount',
    'Invoices itemizing trade or cash discounts deducted from gross total',
    [col('invoice_number', 'Invoice #', 'string', true, 'reference'), dateCol('invoice_date', 'Date', true), col('customer_name', 'Customer', 'string', true, 'counterparty'), amountCol('gross_amount', 'Gross Amount', true), amountCol('discount_amount', 'Trade Discount', true), amountCol('final_amount', 'Payable Amount', true)],
    [col('discount_percentage', 'Discount %', 'number', false), refCol()],
    [],
    [],
    { invoice_number: z.string(), invoice_date: z.string(), customer_name: z.string(), gross_amount: z.number().positive(), discount_amount: z.number().nonnegative(), final_amount: z.number().positive() }
  );

  add(
    'sales_invoices',
    'sales_with_shipping',
    'Sales Invoices with Shipping & Freight',
    'Sales with line items plus courier, delivery, or shipping surcharge',
    [col('invoice_number', 'Invoice #', 'string', true, 'reference'), dateCol('invoice_date', 'Date', true), col('customer_name', 'Customer', 'string', true, 'counterparty'), amountCol('subtotal', 'Goods Subtotal', true), amountCol('shipping_fee', 'Shipping / Freight', true), amountCol('total_amount', 'Grand Total', true)],
    [col('tracking_number', 'Courier Tracking #', 'string', false, 'reference')],
    [],
    [],
    { invoice_number: z.string(), invoice_date: z.string(), customer_name: z.string(), subtotal: z.number().positive(), shipping_fee: z.number().nonnegative(), total_amount: z.number().positive() }
  );

  add(
    'sales_invoices',
    'sales_multi_currency',
    'Export / Foreign Currency Sales Invoices',
    'Export sales invoices billed in foreign currencies (USD, EUR, GBP) with exchange rate',
    [col('invoice_number', 'Invoice #', 'string', true, 'reference'), dateCol('invoice_date', 'Date', true), col('customer_name', 'Overseas Customer', 'string', true, 'counterparty'), col('currency', 'Billing Currency', 'string', true, 'text'), amountCol('foreign_amount', 'Foreign Amount', true)],
    [col('exchange_rate', 'Conversion Rate', 'number', false), amountCol('pkr_amount', 'PKR Equivalent', false)],
    [],
    [],
    { invoice_number: z.string(), invoice_date: z.string(), customer_name: z.string(), currency: z.string().min(3), foreign_amount: z.number().positive() }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 3: PURCHASE BILLS (7 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'purchase_bills',
    'purchase_header',
    'Purchase Bill Header File',
    'Supplier bills summary with bill numbers, vendor names, and total amounts',
    [col('bill_number', 'Bill Number', 'string', true, 'reference'), dateCol('bill_date', 'Bill Date', true), col('vendor_name', 'Vendor Name', 'string', true, 'counterparty'), amountCol('total_amount', 'Total Amount', true)],
    [dateCol('due_date', 'Due Date', false), col('vendor_ntn', 'Vendor NTN', 'string', false, 'reference'), descCol('memo', 'Memo', false)],
    [POSITIVE_AMOUNT_RULE],
    [],
    { bill_number: z.string().min(1), bill_date: z.string(), vendor_name: z.string().min(1), total_amount: z.number().positive() }
  );

  add(
    'purchase_bills',
    'purchase_lines',
    'Purchase Bill Line Items',
    'Detailed purchase lines with inventory item or expense account mapping',
    [col('bill_number', 'Bill Number', 'string', true, 'reference'), col('item_description', 'Item Description', 'string', true, 'text'), col('quantity', 'Quantity', 'number', true), amountCol('unit_price', 'Unit Price', true), amountCol('line_total', 'Line Total', true)],
    [col('line_number', 'Line Number', 'number', false), col('account_code', 'Expense / Inventory Account Code', 'string', false, 'reference'), col('tax_rate', 'Tax Rate (%)', 'number', false)],
    [LINE_TOTAL_RECONCILIATION_RULE],
    [],
    { bill_number: z.string().min(1), item_description: z.string(), quantity: z.number().positive(), unit_price: z.number().positive(), line_total: z.number().positive() }
  );

  add(
    'purchase_bills',
    'purchase_tax_exclusive',
    'Purchase Bills (Tax Exclusive)',
    'Purchase bills where input sales tax is broken out separately from net subtotal',
    [col('bill_number', 'Bill #', 'string', true, 'reference'), dateCol('bill_date', 'Bill Date', true), col('vendor_name', 'Vendor', 'string', true, 'counterparty'), amountCol('subtotal', 'Net Subtotal', true), amountCol('tax_amount', 'Input Sales Tax', true), amountCol('total_amount', 'Bill Total', true)],
    [col('tax_rate', 'Sales Tax Rate %', 'number', false), refCol()],
    [SUBTOTAL_TAX_TOTAL_RULE],
    [],
    { bill_number: z.string(), bill_date: z.string(), vendor_name: z.string(), subtotal: z.number().positive(), tax_amount: z.number().nonnegative(), total_amount: z.number().positive() }
  );

  add(
    'purchase_bills',
    'purchase_tax_inclusive',
    'Purchase Bills (Tax Inclusive)',
    'Purchase bills where entered total represents the full vendor invoice amount',
    [col('bill_number', 'Bill #', 'string', true, 'reference'), dateCol('bill_date', 'Bill Date', true), col('vendor_name', 'Vendor', 'string', true, 'counterparty'), amountCol('total_amount', 'Total (Tax Inclusive)', true)],
    [amountCol('tax_extracted', 'Extracted Tax', false), refCol()],
    [POSITIVE_AMOUNT_RULE],
    [],
    { bill_number: z.string(), bill_date: z.string(), vendor_name: z.string(), total_amount: z.number().positive() }
  );

  add(
    'purchase_bills',
    'purchase_with_wht',
    'Purchase Bills with Withholding Tax Applicable',
    'Purchase bills subject to Section 153/236 income tax or sales tax withholding deductions',
    [col('bill_number', 'Bill #', 'string', true, 'reference'), dateCol('bill_date', 'Bill Date', true), col('vendor_name', 'Vendor', 'string', true, 'counterparty'), amountCol('bill_amount', 'Gross Bill', true), amountCol('wht_payable', 'WHT Deduction', true), amountCol('net_payable', 'Net Vendor Payable', true)],
    [col('wht_section', 'Section / Law', 'string', false, 'reference'), refCol()],
    [],
    [],
    { bill_number: z.string(), bill_date: z.string(), vendor_name: z.string(), bill_amount: z.number().positive(), wht_payable: z.number().nonnegative(), net_payable: z.number().positive() }
  );

  add(
    'purchase_bills',
    'purchase_with_shipping',
    'Purchase Bills with Inward Freight / Carriage',
    'Supplier invoices with freight-in or clearing agency carriage charges',
    [col('bill_number', 'Bill #', 'string', true, 'reference'), dateCol('bill_date', 'Bill Date', true), col('vendor_name', 'Vendor', 'string', true, 'counterparty'), amountCol('goods_subtotal', 'Goods Subtotal', true), amountCol('freight_charge', 'Freight / Shipping', true), amountCol('total_amount', 'Grand Total', true)],
    [refCol()],
    [],
    [],
    { bill_number: z.string(), bill_date: z.string(), vendor_name: z.string(), goods_subtotal: z.number().positive(), freight_charge: z.number().nonnegative(), total_amount: z.number().positive() }
  );

  add(
    'purchase_bills',
    'purchase_multi_currency',
    'Import / Multi-Currency Purchase Bills',
    'Import purchase bills from foreign suppliers with exchange rate and customs duties',
    [col('bill_number', 'Bill #', 'string', true, 'reference'), dateCol('bill_date', 'Bill Date', true), col('vendor_name', 'Foreign Vendor', 'string', true, 'counterparty'), col('currency', 'Currency', 'string', true, 'text'), amountCol('foreign_amount', 'Foreign Amount', true)],
    [col('exchange_rate', 'Conversion Rate', 'number', false), amountCol('customs_duty_paisa', 'Customs Duty', false), amountCol('pkr_equivalent', 'PKR Equivalent', false)],
    [],
    [],
    { bill_number: z.string(), bill_date: z.string(), vendor_name: z.string(), currency: z.string().min(3), foreign_amount: z.number().positive() }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 4: CUSTOMERS (2 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'customers',
    'customer_simple',
    'Customer Master (Simple)',
    'Customer master list with names, contact details, and NTN/STRN tax IDs',
    [col('customer_name', 'Customer Name', 'string', true, 'counterparty')],
    [col('ntn', 'NTN', 'string', false, 'reference'), col('strn', 'STRN', 'string', false, 'reference'), col('phone', 'Phone', 'string', false, 'text'), col('email', 'Email', 'string', false, 'text'), col('address', 'Address', 'string', false, 'text')],
    [],
    [],
    { customer_name: z.string().min(1) }
  );

  add(
    'customers',
    'customer_with_opening',
    'Customer Master with Opening Balance',
    'Customer master import including historical Accounts Receivable opening balances',
    [col('customer_name', 'Customer Name', 'string', true, 'counterparty'), amountCol('opening_balance', 'Opening Balance', true)],
    [col('ntn', 'NTN', 'string', false, 'reference'), dateCol('as_of_date', 'As of Date', false), col('balance_type', 'Balance Type', 'enum', false, undefined, ['debit', 'credit'])],
    [],
    [],
    { customer_name: z.string().min(1), opening_balance: z.number() }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 5: VENDORS (2 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'vendors',
    'vendor_simple',
    'Vendor Master (Simple)',
    'Vendor master list with supplier names, contact details, and CNIC/NTN',
    [col('vendor_name', 'Vendor Name', 'string', true, 'counterparty')],
    [col('ntn', 'NTN / CNIC', 'string', false, 'reference'), col('strn', 'STRN', 'string', false, 'reference'), col('phone', 'Phone', 'string', false, 'text'), col('email', 'Email', 'string', false, 'text'), col('address', 'Address', 'string', false, 'text')],
    [],
    [],
    { vendor_name: z.string().min(1) }
  );

  add(
    'vendors',
    'vendor_with_opening',
    'Vendor Master with Opening Balance',
    'Vendor master import including historical Accounts Payable opening balances',
    [col('vendor_name', 'Vendor Name', 'string', true, 'counterparty'), amountCol('opening_balance', 'Opening Balance', true)],
    [col('ntn', 'NTN', 'string', false, 'reference'), dateCol('as_of_date', 'As of Date', false), col('balance_type', 'Balance Type', 'enum', false, undefined, ['credit', 'debit'])],
    [],
    [],
    { vendor_name: z.string().min(1), opening_balance: z.number() }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 6: CHART OF ACCOUNTS (4 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'chart_of_accounts',
    'coa_flat',
    'Chart of Accounts (Flat)',
    'Standard flat chart of accounts with account code, title, and major head classification',
    [col('account_code', 'Account Code', 'string', true, 'reference'), col('account_name', 'Account Name', 'string', true, 'text'), col('account_type', 'Head Type', 'enum', true, undefined, ['asset', 'liability', 'equity', 'revenue', 'expense'])],
    [descCol('description', 'Description', false)],
    [],
    [],
    { account_code: z.string().min(1), account_name: z.string().min(1), account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']) }
  );

  add(
    'chart_of_accounts',
    'coa_with_parent',
    'Chart of Accounts with Parent Hierarchy',
    'Multi-level COA with parent-child account mapping and sub-account codes',
    [col('account_code', 'Account Code', 'string', true, 'reference'), col('account_name', 'Account Name', 'string', true, 'text'), col('account_type', 'Head Type', 'enum', true, undefined, ['asset', 'liability', 'equity', 'revenue', 'expense'])],
    [col('parent_code', 'Parent Account Code', 'string', false, 'reference'), col('is_header_account', 'Is Header Only', 'boolean', false)],
    [],
    [],
    { account_code: z.string().min(1), account_name: z.string().min(1), account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']) }
  );

  add(
    'chart_of_accounts',
    'coa_with_opening',
    'Chart of Accounts with Opening Balances (Trial Balance)',
    'Trial balance upload setting initial financial position balances per account',
    [col('account_code', 'Account Code', 'string', true, 'reference'), col('account_name', 'Account Name', 'string', true, 'text'), col('account_type', 'Head Type', 'enum', true, undefined, ['asset', 'liability', 'equity', 'revenue', 'expense'])],
    [debitCol('opening_debit', 'Opening Debit', false), creditCol('opening_credit', 'Opening Credit', false)],
    [XOR_OPENING_BALANCE_RULE],
    [],
    { account_code: z.string().min(1), account_name: z.string().min(1), account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']) }
  );

  add(
    'chart_of_accounts',
    'coa_with_segments',
    'Chart of Accounts with Cost Centers / Segments',
    'Multi-segment general ledger accounts mapped to cost centers and branches',
    [col('account_code', 'Account Code', 'string', true, 'reference'), col('account_name', 'Account Name', 'string', true, 'text'), col('account_type', 'Head Type', 'enum', true, undefined, ['asset', 'liability', 'equity', 'revenue', 'expense'])],
    [col('cost_center', 'Cost Center', 'string', false, 'text'), col('branch_code', 'Branch Code', 'string', false, 'reference')],
    [],
    [],
    { account_code: z.string().min(1), account_name: z.string().min(1), account_type: z.enum(['asset', 'liability', 'equity', 'revenue', 'expense']) }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 7: GENERAL JOURNALS (4 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'journals',
    'journal_dr_cr_columns',
    'General Journal (Separate Debit / Credit Columns)',
    'Multi-line balanced journal voucher with separate Dr and Cr columns',
    [col('entry_number', 'Voucher Number', 'string', true, 'reference'), dateCol('entry_date', 'Posting Date', true), col('account_code', 'GL Account Code', 'string', true, 'reference'), descCol()],
    [debitCol(), creditCol(), refCol()],
    [XOR_DEBIT_CREDIT_RULE],
    [BALANCED_JOURNAL_BATCH_RULE],
    { entry_number: z.string().min(1), entry_date: z.string(), account_code: z.string().min(1), description: z.string() }
  );

  add(
    'journals',
    'journal_single_amount',
    'General Journal (Single Signed Amount)',
    'Journal transactions using single signed amount column (+ for Debit, - for Credit)',
    [col('entry_number', 'Voucher Number', 'string', true, 'reference'), dateCol('entry_date', 'Posting Date', true), col('account_code', 'GL Account Code', 'string', true, 'reference'), descCol(), amountCol('signed_amount', 'Signed Amount', true)],
    [refCol()],
    [],
    [],
    { entry_number: z.string().min(1), entry_date: z.string(), account_code: z.string().min(1), description: z.string(), signed_amount: z.number() }
  );

  add(
    'journals',
    'journal_with_tax',
    'General Journal with Tax Line Items',
    'Manual journal entries including sales tax / GST or withholding tax tracking lines',
    [col('entry_number', 'Voucher Number', 'string', true, 'reference'), dateCol('entry_date', 'Posting Date', true), col('account_code', 'GL Account Code', 'string', true, 'reference'), descCol()],
    [debitCol(), creditCol(), col('tax_code', 'Tax Code', 'string', false, 'reference'), amountCol('tax_amount', 'Tax Component', false)],
    [XOR_DEBIT_CREDIT_RULE],
    [],
    { entry_number: z.string().min(1), entry_date: z.string(), account_code: z.string().min(1), description: z.string() }
  );

  add(
    'journals',
    'journal_with_cost_centers',
    'General Journal with Cost Centers',
    'Journal vouchers assigned to department, branch, or project cost centers',
    [col('entry_number', 'Voucher Number', 'string', true, 'reference'), dateCol('entry_date', 'Posting Date', true), col('account_code', 'GL Account Code', 'string', true, 'reference'), descCol(), col('cost_center', 'Cost Center / Project', 'string', true, 'text')],
    [debitCol(), creditCol(), refCol()],
    [XOR_DEBIT_CREDIT_RULE],
    [],
    { entry_number: z.string().min(1), entry_date: z.string(), account_code: z.string().min(1), description: z.string(), cost_center: z.string().min(1) }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 8: PAYMENTS (5 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'payments',
    'bank_payments_receipts',
    'Bank Payments & Receipts Log',
    'Log of bank disbursements and incoming receipts with counterparty name',
    [dateCol('payment_date', 'Payment Date', true), col('payment_type', 'Payment Type', 'enum', true, undefined, ['payment', 'receipt']), amountCol(), col('counterparty_name', 'Payee / Customer', 'string', true, 'counterparty')],
    [col('payment_method', 'Method', 'enum', false, undefined, ['bank_transfer', 'cheque', 'online', 'cash']), refCol(), descCol('memo', 'Memo', false)],
    [POSITIVE_AMOUNT_RULE],
    [],
    { payment_date: z.string(), payment_type: z.enum(['payment', 'receipt']), amount: z.number().positive(), counterparty_name: z.string().min(1) }
  );

  add(
    'payments',
    'cash_payments',
    'Cash Payment Vouchers (CPV)',
    'Petty cash and cashier payment vouchers disbursed in cash',
    [dateCol('payment_date', 'Date', true), amountCol(), col('payee_name', 'Payee', 'string', true, 'counterparty'), descCol('purpose', 'Payment Purpose', true)],
    [col('voucher_number', 'CPV #', 'string', false, 'reference'), col('expense_account', 'Expense Account', 'string', false, 'reference')],
    [POSITIVE_AMOUNT_RULE],
    [],
    { payment_date: z.string(), amount: z.number().positive(), payee_name: z.string().min(1), purpose: z.string().min(1) }
  );

  add(
    'payments',
    'cash_receipts',
    'Cash Receipt Vouchers (CRV)',
    'Cash collections from customers and direct cash receipts',
    [dateCol('receipt_date', 'Date', true), amountCol(), col('received_from', 'Received From', 'string', true, 'counterparty'), descCol('purpose', 'Receipt Narration', true)],
    [col('voucher_number', 'CRV #', 'string', false, 'reference'), col('customer_code', 'Customer Code', 'string', false, 'reference')],
    [POSITIVE_AMOUNT_RULE],
    [],
    { receipt_date: z.string(), amount: z.number().positive(), received_from: z.string().min(1), purpose: z.string().min(1) }
  );

  add(
    'payments',
    'cash_book_both_sides',
    'Cash Book (Two-Column Inflow / Outflow)',
    'Traditional cash book with cash received (inflow) and cash paid (outflow) columns',
    [dateCol(), descCol()],
    [amountCol('cash_inflow', 'Cash Inflow (Receipt)', false), amountCol('cash_outflow', 'Cash Outflow (Payment)', false), amountCol('cash_balance', 'Cash Balance', false), refCol()],
    [],
    [],
    { date: z.string(), description: z.string() }
  );

  add(
    'payments',
    'cash_book_single_amount',
    'Cash Book (Single Signed Column)',
    'Daily petty cash register with signed net cash changes',
    [dateCol(), descCol(), amountCol('cash_amount', 'Signed Net Cash', true)],
    [amountCol('cash_balance', 'Running Cash Balance', false), refCol()],
    [],
    [],
    { date: z.string(), description: z.string(), cash_amount: z.number() }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 9: EXPENSES (4 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'expenses',
    'expense_simple',
    'General Expense Log (Simple)',
    'Straightforward expense claim list with date, description, and paid amount',
    [dateCol('expense_date', 'Expense Date', true), descCol(), amountCol()],
    [col('payment_method', 'Payment Mode', 'string', false, 'text'), refCol()],
    [POSITIVE_AMOUNT_RULE],
    [],
    { expense_date: z.string(), description: z.string(), amount: z.number().positive() }
  );

  add(
    'expenses',
    'expense_with_tax',
    'Expense Log with Provincial Sales Tax / GST',
    'Business expense register separating expense base and provincial service sales tax',
    [dateCol('expense_date', 'Date', true), descCol(), amountCol('subtotal', 'Base Expense', true), amountCol('tax_amount', 'Sales Tax', true), amountCol('total_paid', 'Total Paid', true)],
    [col('tax_rate', 'Tax Rate %', 'number', false), refCol()],
    [],
    [],
    { expense_date: z.string(), description: z.string(), subtotal: z.number().positive(), tax_amount: z.number().nonnegative(), total_paid: z.number().positive() }
  );

  add(
    'expenses',
    'expense_with_vendor',
    'Expense Log with Vendor Breakdown',
    'Expense record identifying payee supplier and invoice reference',
    [dateCol('expense_date', 'Date', true), descCol(), amountCol(), col('vendor_name', 'Vendor / Merchant', 'string', true, 'counterparty')],
    [col('vendor_ntn', 'Merchant NTN', 'string', false, 'reference'), refCol()],
    [POSITIVE_AMOUNT_RULE],
    [],
    { expense_date: z.string(), description: z.string(), amount: z.number().positive(), vendor_name: z.string().min(1) }
  );

  add(
    'expenses',
    'expense_with_category',
    'Categorized Expense Log',
    'Expense claims grouped by chart of accounts category (travel, utilities, rent)',
    [dateCol('expense_date', 'Date', true), descCol(), amountCol(), col('category', 'Expense Category', 'string', true, 'text')],
    [col('account_code', 'COA Code', 'string', false, 'reference'), col('employee_name', 'Claimant Staff', 'string', false, 'counterparty')],
    [POSITIVE_AMOUNT_RULE],
    [],
    { expense_date: z.string(), description: z.string(), amount: z.number().positive(), category: z.string().min(1) }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 10: FIXED ASSETS (3 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'fixed_assets',
    'assets_simple',
    'Fixed Asset Register (Simple)',
    'Inventory list of plant, property, and equipment with purchase date and cost',
    [col('asset_code', 'Asset Tag / Code', 'string', true, 'reference'), col('asset_name', 'Asset Description', 'string', true, 'text'), dateCol('purchase_date', 'Purchase Date', true), amountCol('acquisition_cost', 'Acquisition Cost', true)],
    [col('location', 'Physical Location', 'string', false, 'text'), col('category', 'Asset Class', 'string', false, 'text')],
    [POSITIVE_AMOUNT_RULE],
    [],
    { asset_code: z.string().min(1), asset_name: z.string().min(1), purchase_date: z.string(), acquisition_cost: z.number().positive() }
  );

  add(
    'fixed_assets',
    'assets_with_depreciation',
    'Fixed Asset Register with Accumulated Depreciation',
    'Asset schedule tracking historical cost, method, and accumulated depreciation',
    [col('asset_code', 'Asset Tag', 'string', true, 'reference'), col('asset_name', 'Asset Description', 'string', true, 'text'), amountCol('original_cost', 'Original Cost', true), amountCol('accumulated_depreciation', 'Accum. Depreciation', true)],
    [col('depreciation_method', 'Method', 'enum', false, undefined, ['straight_line', 'reducing_balance']), col('depreciation_rate', 'Rate %', 'number', false), amountCol('net_book_value', 'Net Book Value', false)],
    [],
    [],
    { asset_code: z.string().min(1), asset_name: z.string().min(1), original_cost: z.number().positive(), accumulated_depreciation: z.number().nonnegative() }
  );

  add(
    'fixed_assets',
    'assets_with_disposals',
    'Fixed Asset Disposal Register',
    'Schedule of derecognized or sold assets with sale proceeds and gain/loss',
    [col('asset_code', 'Asset Tag', 'string', true, 'reference'), dateCol('disposal_date', 'Disposal Date', true), amountCol('cost_at_disposal', 'Cost at Disposal', true), amountCol('sale_proceeds', 'Sale Proceeds', true)],
    [amountCol('accumulated_depreciation', 'Accum. Depreciation', false), amountCol('gain_loss', 'Gain / Loss on Disposal', false)],
    [],
    [],
    { asset_code: z.string().min(1), disposal_date: z.string(), cost_at_disposal: z.number().positive(), sale_proceeds: z.number().nonnegative() }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 11: PAYROLL (3 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'payroll',
    'payroll_summary_by_employee',
    'Payroll Summary (By Employee)',
    'Monthly salary distribution sheet itemized by employee with gross and net pay',
    [col('employee_id', 'Employee ID / Code', 'string', true, 'reference'), col('employee_name', 'Employee Name', 'string', true, 'counterparty'), dateCol('pay_period_end', 'Period End Date', true), amountCol('net_salary', 'Net Salary Payable', true)],
    [amountCol('basic_salary', 'Basic Salary', false), amountCol('allowances', 'Total Allowances', false), amountCol('deductions', 'Total Deductions', false), col('bank_account', 'Bank Account #', 'string', false, 'reference')],
    [POSITIVE_AMOUNT_RULE],
    [],
    { employee_id: z.string().min(1), employee_name: z.string().min(1), pay_period_end: z.string(), net_salary: z.number().positive() }
  );

  add(
    'payroll',
    'payroll_summary_by_head',
    'Payroll Summary (By Pay Head / Component)',
    'Aggregated salary breakdown by department or head of account (basic, house rent, medical)',
    [col('pay_head_name', 'Pay Head / Component', 'string', true, 'text'), col('pay_head_type', 'Type', 'enum', true, undefined, ['earning', 'deduction']), amountCol('total_amount', 'Aggregated Amount', true)],
    [col('department', 'Department', 'string', false, 'text'), dateCol('month_year', 'Month', false)],
    [POSITIVE_AMOUNT_RULE],
    [],
    { pay_head_name: z.string().min(1), pay_head_type: z.enum(['earning', 'deduction']), total_amount: z.number().positive() }
  );

  add(
    'payroll',
    'payroll_with_tax',
    'Payroll Register with Section 149 Income Tax',
    'Salary register with gross salary, employee income tax deduction, and net disbursement',
    [col('employee_name', 'Employee Name', 'string', true, 'counterparty'), amountCol('gross_salary', 'Gross Salary', true), amountCol('income_tax_deducted', 'Tax Deducted (Sec 149)', true), amountCol('net_take_home', 'Net Take Home', true)],
    [col('employee_cnic_ntn', 'CNIC / NTN', 'string', false, 'reference'), dateCol('pay_period', 'Payroll Period', false)],
    [],
    [],
    { employee_name: z.string().min(1), gross_salary: z.number().positive(), income_tax_deducted: z.number().nonnegative(), net_take_home: z.number().positive() }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 12: TAX REGISTERS (3 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'tax_registers',
    'sales_tax_register',
    'Output Sales Tax Register (Annexure C)',
    'FBR Sales Tax monthly output register itemizing sales tax charged on taxable supplies',
    [col('invoice_number', 'Invoice #', 'string', true, 'reference'), dateCol('invoice_date', 'Invoice Date', true), col('buyer_ntn', 'Buyer NTN', 'string', true, 'reference'), amountCol('taxable_value', 'Taxable Value', true), amountCol('sales_tax_charged', 'Sales Tax (18%)', true)],
    [col('buyer_strn', 'Buyer STRN', 'string', false, 'reference'), amountCol('extra_tax', 'Extra / Further Tax', false)],
    [],
    [],
    { invoice_number: z.string(), invoice_date: z.string(), buyer_ntn: z.string().min(1), taxable_value: z.number().positive(), sales_tax_charged: z.number().nonnegative() }
  );

  add(
    'tax_registers',
    'purchase_tax_register',
    'Input Sales Tax Register (Annexure A)',
    'FBR Purchase register itemizing input sales tax paid to registered suppliers',
    [col('supplier_ntn', 'Supplier NTN', 'string', true, 'reference'), col('supplier_invoice_number', 'Supplier Invoice #', 'string', true, 'reference'), dateCol('invoice_date', 'Date', true), amountCol('purchase_value', 'Value of Purchases', true), amountCol('input_tax_claimed', 'Input Tax Claimed', true)],
    [col('supplier_strn', 'Supplier STRN', 'string', false, 'reference'), col('status_in_fbr', 'FBR Active Status', 'string', false, 'text')],
    [],
    [],
    { supplier_ntn: z.string().min(1), supplier_invoice_number: z.string().min(1), invoice_date: z.string(), purchase_value: z.number().positive(), input_tax_claimed: z.number().nonnegative() }
  );

  add(
    'tax_registers',
    'withholding_tax_register',
    'Withholding Income Tax Register (Annexure / CPR)',
    'Monthly withholding statement itemizing tax deducted under various sections with CPR #',
    [col('withholdee_name', 'Party Name', 'string', true, 'counterparty'), col('tax_section', 'Income Tax Section', 'string', true, 'reference'), amountCol('transaction_amount', 'Base Amount', true), amountCol('tax_withheld', 'Tax Withheld', true)],
    [col('withholdee_ntn_cnic', 'NTN / CNIC', 'string', false, 'reference'), col('cpr_number', 'CPR Number', 'string', false, 'reference'), dateCol('deduction_date', 'Date', false)],
    [],
    [],
    { withholdee_name: z.string().min(1), tax_section: z.string().min(1), transaction_amount: z.number().positive(), tax_withheld: z.number().nonnegative() }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 13: LOANS (3 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'loans',
    'loan_master',
    'Loan Facility Master File',
    'Financing facility master record with lender bank, principal facility limit, and interest rate',
    [col('loan_reference', 'Facility Reference #', 'string', true, 'reference'), col('lender_name', 'Lender / Bank', 'string', true, 'counterparty'), amountCol('principal_amount', 'Sanctioned Principal', true), dateCol('start_date', 'Facility Start Date', true)],
    [col('annual_rate_bps', 'Interest Rate (bps)', 'number', false), col('tenure_months', 'Tenure (Months)', 'number', false), dateCol('maturity_date', 'Maturity Date', false)],
    [POSITIVE_AMOUNT_RULE],
    [],
    { loan_reference: z.string().min(1), lender_name: z.string().min(1), principal_amount: z.number().positive(), start_date: z.string() }
  );

  add(
    'loans',
    'loan_schedule',
    'Loan Amortization Repayment Schedule',
    'Installment schedule itemizing principal repayment and markup / interest breakdown',
    [col('loan_reference', 'Facility Reference', 'string', true, 'reference'), col('installment_number', 'Installment #', 'number', true), dateCol('due_date', 'Due Date', true), amountCol('principal_component', 'Principal Repayment', true), amountCol('interest_component', 'Markup / Interest', true), amountCol('total_installment', 'Total Installment', true)],
    [amountCol('remaining_principal', 'Remaining Balance', false)],
    [],
    [],
    { loan_reference: z.string().min(1), installment_number: z.number().positive(), due_date: z.string(), principal_component: z.number().nonnegative(), interest_component: z.number().nonnegative(), total_installment: z.number().positive() }
  );

  add(
    'loans',
    'loan_transactions',
    'Loan Disbursement & Repayment Transactions',
    'Transaction log of drawdowns received and repayment amounts settled',
    [col('loan_reference', 'Facility Reference', 'string', true, 'reference'), dateCol('transaction_date', 'Date', true), col('transaction_type', 'Type', 'enum', true, undefined, ['disbursement', 'repayment', 'markup_charge']), amountCol()],
    [refCol(), descCol('memo', 'Memo', false)],
    [POSITIVE_AMOUNT_RULE],
    [],
    { loan_reference: z.string().min(1), transaction_date: z.string(), transaction_type: z.enum(['disbursement', 'repayment', 'markup_charge']), amount: z.number().positive() }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 14: INVENTORY (4 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'inventory',
    'stock_list_opening',
    'Opening Inventory Stock List',
    'Physical opening inventory stock count by item SKU with quantities on hand',
    [col('sku', 'Item SKU / Code', 'string', true, 'reference'), col('item_name', 'Item Name', 'string', true, 'text'), col('opening_quantity', 'Opening Quantity', 'number', true)],
    [col('uom', 'Unit of Measure', 'string', false, 'text'), col('warehouse', 'Warehouse / Location', 'string', false, 'text')],
    [],
    [],
    { sku: z.string().min(1), item_name: z.string().min(1), opening_quantity: z.number().nonnegative() }
  );

  add(
    'inventory',
    'stock_list_with_valuation',
    'Inventory Stock List with Cost Valuation',
    'Stock on hand list with unit cost valuation (FIFO / Weighted Average) and total asset value',
    [col('sku', 'Item SKU / Code', 'string', true, 'reference'), col('item_name', 'Item Name', 'string', true, 'text'), col('quantity', 'Quantity on Hand', 'number', true), amountCol('unit_cost', 'Unit Cost', true), amountCol('total_valuation', 'Total Inventory Value', true)],
    [col('valuation_method', 'Method', 'enum', false, undefined, ['fifo', 'weighted_average']), col('warehouse', 'Warehouse', 'string', false, 'text')],
    [],
    [],
    { sku: z.string().min(1), item_name: z.string().min(1), quantity: z.number().nonnegative(), unit_cost: z.number().nonnegative(), total_valuation: z.number().nonnegative() }
  );

  add(
    'inventory',
    'stock_movement_log',
    'Inventory Stock Movement Log',
    'Log of material issues, goods receipts (GRN), and warehouse transfers',
    [col('sku', 'Item SKU', 'string', true, 'reference'), dateCol('movement_date', 'Movement Date', true), col('movement_type', 'Type', 'enum', true, undefined, ['receipt', 'issue', 'adjustment', 'transfer']), col('quantity', 'Quantity Moved', 'number', true)],
    [col('source_warehouse', 'From Location', 'string', false, 'text'), col('target_warehouse', 'To Location', 'string', false, 'text'), refCol('document_reference', 'GRN / Delivery Note #', false)],
    [],
    [],
    { sku: z.string().min(1), movement_date: z.string(), movement_type: z.enum(['receipt', 'issue', 'adjustment', 'transfer']), quantity: z.number().positive() }
  );

  add(
    'inventory',
    'stock_by_location',
    'Stock Quantities Distributed by Location',
    'Multi-warehouse inventory distribution table',
    [col('sku', 'Item SKU', 'string', true, 'reference'), col('warehouse_code', 'Warehouse Code', 'string', true, 'reference'), col('quantity_available', 'Quantity Available', 'number', true)],
    [col('reorder_point', 'Reorder Level', 'number', false), col('bin_location', 'Aisle / Bin', 'string', false, 'text')],
    [],
    [],
    { sku: z.string().min(1), warehouse_code: z.string().min(1), quantity_available: z.number().nonnegative() }
  );

  // ───────────────────────────────────────────────────────────────────────────
  // CATEGORY 15: BUDGET (2 Subtypes)
  // ───────────────────────────────────────────────────────────────────────────

  add(
    'budget',
    'budget_by_account_monthly',
    'Monthly Budget by Account Head',
    'Annual budget allocated across 12 calendar months for revenue and expense accounts',
    [col('account_code', 'GL Account Code', 'string', true, 'reference'), col('fiscal_year', 'Fiscal Year (e.g. 2026-2027)', 'string', true, 'text'), col('period_month', 'Month (1-12)', 'number', true), amountCol('allocated_budget', 'Allocated Budget', true)],
    [col('cost_center', 'Department / Cost Center', 'string', false, 'text')],
    [POSITIVE_AMOUNT_RULE],
    [],
    { account_code: z.string().min(1), fiscal_year: z.string(), period_month: z.number().min(1).max(12), allocated_budget: z.number().positive() }
  );

  add(
    'budget',
    'budget_vs_actual',
    'Budget vs Actual Comparison Register',
    'Budget variance report with budgeted amounts, actual spend, and variance',
    [col('account_code', 'GL Account Code', 'string', true, 'reference'), col('period', 'Period (e.g. 2026-Q1)', 'string', true, 'text'), amountCol('budget_amount', 'Budgeted Amount', true), amountCol('actual_amount', 'Actual Incurred', true), amountCol('variance', 'Variance Amount', true)],
    [col('variance_percentage', 'Variance %', 'number', false)],
    [],
    [],
    { account_code: z.string().min(1), period: z.string(), budget_amount: z.number().positive(), actual_amount: z.number().nonnegative(), variance: z.number() }
  );

  return defs;
}

// ─── 5. Statically Immutable Registry Export ─────────────────────────────────

const BUILTIN_SUBTYPES: Record<string, SubTypeDefinition> = Object.freeze(createDefinitions());

// ─── 6. Public Accessor & Query APIs ─────────────────────────────────────────

export function listDataTypes(): DataType[] {
  return [...DATA_TYPES];
}

export function listSubTypes(dataType?: string): string[] {
  if (!dataType) {
    return Object.keys(BUILTIN_SUBTYPES);
  }
  const canonical = normalizeDataTypeKey(dataType);
  return Object.values(BUILTIN_SUBTYPES)
    .filter((def) => def.dataType === canonical)
    .map((def) => def.id);
}

export function getDefinition(dataType: string, subType: string): SubTypeDefinition {
  const canonicalType = normalizeDataTypeKey(dataType);
  const def = BUILTIN_SUBTYPES[subType];

  if (!def) {
    throw new TypeRegistryError(
      `Subtype "${subType}" not found in Type Registry. Available for "${canonicalType}": ${listSubTypes(canonicalType).join(', ')}`
    );
  }

  if (def.dataType !== canonicalType) {
    throw new TypeRegistryError(
      `Subtype "${subType}" belongs to "${def.dataType}", not "${canonicalType}".`
    );
  }

  return def;
}

export function getParentDataType(subTypeId: string): DataType {
  const def = BUILTIN_SUBTYPES[subTypeId];
  if (!def) {
    throw new TypeRegistryError(`Subtype "${subTypeId}" not found in Type Registry.`);
  }
  return def.dataType;
}

export function getSchema(dataType: string, subType: string): z.ZodTypeAny {
  return getDefinition(dataType, subType).zodSchema;
}

export function getValidationRules(
  dataType: string,
  subType: string
): { rowRules: RowValidationRule[]; fileRules: FileValidationRule[] } {
  const def = getDefinition(dataType, subType);
  return {
    rowRules: [...def.rowRules],
    fileRules: [...def.fileRules],
  };
}

export function getRequiredColumns(dataType: string, subType: string): ColumnDefinition[] {
  return [...getDefinition(dataType, subType).requiredColumns];
}

export function getOptionalColumns(dataType: string, subType: string): ColumnDefinition[] {
  return [...getDefinition(dataType, subType).optionalColumns];
}

// ─── 7. Full Validation & Normalization Engine ───────────────────────────────

export interface RegistryValidationResult {
  isValid: boolean;
  dataType: DataType;
  subType: string;
  totalRows: number;
  validRowCount: number;
  invalidRowCount: number;
  normalizedRows: Array<{
    sourceRowNumber: number;
    data: Record<string, any>;
    extraColumns: Record<string, any>;
    issues: ValidationIssue[];
  }>;
  issues: ValidationIssue[];
}

/**
 * Validates and normalizes raw tabular data against a specific DataType and SubType.
 * 
 * Invariants:
 * 1. Missing required columns produce fatal validation errors.
 * 2. Extra unmapped columns are preserved into `extraColumns` (Decision 1 Option A).
 * 3. Dates normalize to ISO YYYY-MM-DD using parseDateStrict.
 * 4. Amounts normalize to integer Paisa using parseAmountToPaisa.
 * 5. Executes RowValidationRules and FileValidationRules with full source traceability.
 */
export function validateDataWithRegistry(
  dataType: string,
  subType: string,
  rawRows: Record<string, any>[]
): RegistryValidationResult {
  const def = getDefinition(dataType, subType);
  const issues: ValidationIssue[] = [];
  const normalizedRows: RegistryValidationResult['normalizedRows'] = [];

  const knownColMap = new Map<string, ColumnDefinition>();
  def.requiredColumns.forEach((c) => knownColMap.set(c.key, c));
  def.optionalColumns.forEach((c) => knownColMap.set(c.key, c));

  rawRows.forEach((rawRow, idx) => {
    const sourceRowNumber = typeof rawRow.sourceRowNumber === 'number' ? rawRow.sourceRowNumber : idx + 1;
    const rowIssues: ValidationIssue[] = [];
    const normalizedData: Record<string, any> = { sourceRowNumber };
    const extraColumns: Record<string, any> = {};

    // 1. Separate canonical columns from extra columns (Decision 1 Option A)
    for (const [key, val] of Object.entries(rawRow)) {
      if (key === 'sourceRowNumber') continue;
      if (knownColMap.has(key)) {
        normalizedData[key] = val;
      } else {
        extraColumns[key] = val;
      }
    }

    // 2. Check for missing required columns
    for (const reqCol of def.requiredColumns) {
      const val = normalizedData[reqCol.key];
      const isMissing = val === undefined || val === null || String(val).trim() === '';

      if (isMissing) {
        const issue: ValidationIssue = {
          sourceRowNumber,
          canonicalColumn: reqCol.key,
          ruleId: 'REQUIRED_COLUMN_MISSING',
          severity: 'error',
          message: `Required column "${reqCol.label}" (${reqCol.key}) is missing or blank.`,
        };
        rowIssues.push(issue);
        issues.push(issue);
      }
    }

    // 3. Normalize values for present columns
    for (const [colKey, colDef] of knownColMap.entries()) {
      const rawVal = normalizedData[colKey];
      if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
        continue;
      }

      // 3a. Date Normalization
      if (colDef.type === 'date' || colDef.normalizer === 'date') {
        const dRes = parseDateStrict(rawVal, { preferredFormat: 'DD/MM/YYYY' });
        if (!dRes.isValid) {
          const issue: ValidationIssue = {
            sourceRowNumber,
            canonicalColumn: colKey,
            ruleId: 'INVALID_DATE',
            severity: 'error',
            message: `Column "${colDef.label}" contains invalid date "${rawVal}": ${dRes.error ?? 'Unrecognized format'}`,
          };
          rowIssues.push(issue);
          issues.push(issue);
        } else {
          normalizedData[colKey] = dRes.isoDate;
        }
      }

      // 3b. Amount Normalization (Integer Paisa)
      else if (colDef.type === 'amount' || colDef.normalizer === 'amount') {
        const aRes = parseAmountToPaisa(rawVal);
        if (!aRes.isValid) {
          const issue: ValidationIssue = {
            sourceRowNumber,
            canonicalColumn: colKey,
            ruleId: aRes.isQuarantined ? 'FOREIGN_CURRENCY_QUARANTINE' : 'INVALID_AMOUNT',
            severity: 'error',
            message: `Column "${colDef.label}" amount error: ${aRes.error ?? 'Invalid numeric value'}`,
          };
          rowIssues.push(issue);
          issues.push(issue);
        } else {
          normalizedData[colKey] = aRes.paisa;
        }
      }

      // 3c. Enum Normalization
      else if (colDef.type === 'enum' && colDef.enumValues) {
        const cleanedEnum = String(rawVal).trim().toLowerCase();
        if (!colDef.enumValues.includes(cleanedEnum)) {
          const issue: ValidationIssue = {
            sourceRowNumber,
            canonicalColumn: colKey,
            ruleId: 'INVALID_ENUM_VALUE',
            severity: 'error',
            message: `Invalid value "${rawVal}" for column "${colDef.label}". Allowed: ${colDef.enumValues.join(', ')}`,
          };
          rowIssues.push(issue);
          issues.push(issue);
        } else {
          normalizedData[colKey] = cleanedEnum;
        }
      }

      // 3d. Number Normalization
      else if (colDef.type === 'number') {
        const parsedNum = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal).replace(/,/g, ''));
        if (isNaN(parsedNum)) {
          const issue: ValidationIssue = {
            sourceRowNumber,
            canonicalColumn: colKey,
            ruleId: 'INVALID_NUMBER',
            severity: 'error',
            message: `Column "${colDef.label}" must be a valid number, received "${rawVal}".`,
          };
          rowIssues.push(issue);
          issues.push(issue);
        } else {
          normalizedData[colKey] = parsedNum;
        }
      }

      // 3e. Text / Reference / Counterparty Normalization
      else if (colDef.normalizer === 'counterparty') {
        normalizedData[colKey] = normalizeCounterparty(String(rawVal));
      } else if (colDef.normalizer === 'reference') {
        normalizedData[colKey] = normalizeReference(String(rawVal));
      } else if (typeof rawVal === 'string') {
        normalizedData[colKey] = rawVal.trim();
      }
    }

    // 4. Run Row-Level Validation Rules
    for (const rule of def.rowRules) {
      const ruleIssue = rule.validate(normalizedData, sourceRowNumber);
      if (ruleIssue) {
        rowIssues.push(ruleIssue);
        issues.push(ruleIssue);
      }
    }

    normalizedRows.push({
      sourceRowNumber,
      data: normalizedData,
      extraColumns,
      issues: rowIssues,
    });
  });

  // 5. Run Cross-Row / File-Level Validation Rules
  const justRows = normalizedRows.map((nr) => nr.data);
  for (const fileRule of def.fileRules) {
    const fileIssues = fileRule.validate(justRows);
    fileIssues.forEach((fi) => {
      issues.push(fi);
      // Link issue back to the target row in normalizedRows
      const targetRow = normalizedRows.find((nr) => nr.sourceRowNumber === fi.sourceRowNumber);
      if (targetRow) {
        targetRow.issues.push(fi);
      }
    });
  }

  const invalidRowCount = normalizedRows.filter((nr) => nr.issues.some((i) => i.severity === 'error')).length;
  const validRowCount = normalizedRows.length - invalidRowCount;
  const hasFatalErrors = issues.some((i) => i.severity === 'error');

  return {
    isValid: !hasFatalErrors,
    dataType: def.dataType,
    subType: def.id,
    totalRows: rawRows.length,
    validRowCount,
    invalidRowCount,
    normalizedRows,
    issues,
  };
}

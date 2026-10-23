// lib/data-cleaning/validation-schemas.ts
import { z } from 'zod';

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const accountCodeRegex = /^[0-9A-Za-z\.\-_]{3,20}$/;
const ntnRegex = /^\d{7}-?\d$/;

// ─── 1. Journal Entry Line & Batch Schema ────────────────────────────────────
export const JournalLineSchema = z.object({
  account_code: z.string().trim().regex(accountCodeRegex, 'Invalid account code format'),
  description: z.string().trim().max(255).optional(),
  debit_paisa: z.number().int().nonnegative('Debit must be >= 0'),
  credit_paisa: z.number().int().nonnegative('Credit must be >= 0'),
  memo: z.string().trim().max(255).optional(),
}).strict().refine(
  (line) => (line.debit_paisa > 0 && line.credit_paisa === 0) || (line.credit_paisa > 0 && line.debit_paisa === 0),
  { message: 'A single line must have either debit > 0 or credit > 0, never both or neither.' }
);

export const JournalEntryBatchSchema = z.object({
  entry_date: z.string().regex(dateRegex, 'Date must be in YYYY-MM-DD format'),
  reference_number: z.string().trim().max(50).optional(),
  description: z.string().trim().min(3).max(500),
  lines: z.array(JournalLineSchema).min(2, 'Journal entry requires at least 2 lines'),
}).strict().refine(
  (entry) => {
    const totalDebits = entry.lines.reduce((s, l) => s + l.debit_paisa, 0);
    const totalCredits = entry.lines.reduce((s, l) => s + l.credit_paisa, 0);
    return totalDebits === totalCredits;
  },
  { message: 'Journal entry is unbalanced: Total Debits must exactly equal Total Credits.' }
);

// ─── 2. Sales Invoice Schema ──────────────────────────────────────────────────
export const InvoiceLineSchema = z.object({
  description: z.string().trim().min(2).max(255),
  quantity: z.number().positive('Quantity must be greater than 0'),
  unit_price_paisa: z.number().int().positive('Unit price must be > 0'),
  tax_rate_bps: z.number().int().min(0).max(10000).default(0), // 1800 = 18%
  revenue_account_code: z.string().trim().regex(accountCodeRegex).optional(),
}).strict();

export const InvoiceInputSchema = z.object({
  customer_name: z.string().trim().min(2).max(150),
  customer_ntn: z.string().trim().regex(ntnRegex, 'Invalid NTN format').optional(),
  invoice_date: z.string().regex(dateRegex, 'Date must be YYYY-MM-DD'),
  due_date: z.string().regex(dateRegex, 'Due date must be YYYY-MM-DD'),
  description: z.string().trim().max(500).optional(),
  lines: z.array(InvoiceLineSchema).min(1, 'Invoice requires at least 1 line item'),
}).strict();

// ─── 3. Payment Schema ────────────────────────────────────────────────────────
export const PaymentInputSchema = z.object({
  payment_date: z.string().regex(dateRegex, 'Date must be YYYY-MM-DD'),
  payment_type: z.enum(['customer_receipt', 'vendor_payment']),
  counterparty_name: z.string().trim().min(2).max(150),
  payment_method: z.enum(['bank', 'cash', 'cheque', 'online']),
  bank_account_code: z.string().trim().regex(accountCodeRegex).default('1020'),
  amount_paisa: z.number().int().positive('Payment amount must be > 0'),
  reference_number: z.string().trim().max(50).optional(),
  invoice_or_bill_number: z.string().trim().max(50).optional(),
}).strict();

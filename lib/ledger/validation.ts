/**
 * Journal Entry Validation — Pure Functions
 * 
 * These functions validate journal entry data WITHOUT touching the database.
 * They are unit-testable with no dependencies.
 * 
 * Used by postJournalEntry() as the first line of defense before
 * any database interaction occurs.
 */

export interface JournalLineInput {
  accountId: number;
  debitPaisa: number;   // integer, >= 0
  creditPaisa: number;  // integer, >= 0
  memo?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a single journal line.
 * 
 * Rules:
 *   - Exactly one of debitPaisa or creditPaisa must be > 0
 *   - The other must be exactly 0
 *   - Neither can be negative
 *   - Neither can be a non-integer (defense against float leaking in)
 *   - accountId must be a positive integer
 */
export function validateLine(line: JournalLineInput, index: number): ValidationResult {
  // Check accountId
  if (!Number.isInteger(line.accountId) || line.accountId <= 0) {
    return { valid: false, error: `Line ${index + 1}: accountId must be a positive integer` };
  }

  // Check for non-integers (catches floats that leaked through)
  if (!Number.isInteger(line.debitPaisa)) {
    return { valid: false, error: `Line ${index + 1}: debitPaisa must be an integer (got ${line.debitPaisa})` };
  }
  if (!Number.isInteger(line.creditPaisa)) {
    return { valid: false, error: `Line ${index + 1}: creditPaisa must be an integer (got ${line.creditPaisa})` };
  }

  // Check for negatives
  if (line.debitPaisa < 0) {
    return { valid: false, error: `Line ${index + 1}: debitPaisa cannot be negative` };
  }
  if (line.creditPaisa < 0) {
    return { valid: false, error: `Line ${index + 1}: creditPaisa cannot be negative` };
  }

  // Check exactly one side is set
  const hasDebit = line.debitPaisa > 0;
  const hasCredit = line.creditPaisa > 0;

  if (hasDebit && hasCredit) {
    return { valid: false, error: `Line ${index + 1}: a line cannot have both debit and credit amounts` };
  }
  if (!hasDebit && !hasCredit) {
    return { valid: false, error: `Line ${index + 1}: a line must have either a debit or credit amount` };
  }

  return { valid: true };
}

/**
 * Validate all journal lines together.
 * 
 * Rules:
 *   1. At least 2 lines (a single line can never balance)
 *   2. Every line individually valid (via validateLine)
 *   3. SUM(debits) === SUM(credits), exact integer comparison
 */
export function validateJournalLines(lines: JournalLineInput[]): ValidationResult {
  // Rule 1: minimum 2 lines
  if (lines.length < 2) {
    return { valid: false, error: 'A journal entry must have at least 2 lines' };
  }

  // Rule 2: validate each line individually
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      return { valid: false, error: `Line ${i + 1}: line is undefined` };
    }
    const lineResult = validateLine(line, i);
    if (!lineResult.valid) {
      return lineResult;
    }
  }

  // Rule 3: debits must equal credits
  const totals = calculateTotals(lines);
  if (totals.totalDebits !== totals.totalCredits) {
    return {
      valid: false,
      error: `Entry is unbalanced: total debits (${totals.totalDebits} paisa) !== total credits (${totals.totalCredits} paisa). Difference: ${Math.abs(totals.totalDebits - totals.totalCredits)} paisa`,
    };
  }

  return { valid: true };
}

/**
 * Calculate total debits and credits across all lines.
 * 
 * Uses plain number addition. Since we enforce integer paisa values
 * and realistic transaction sizes (< 10^15 paisa), JavaScript's
 * Number.MAX_SAFE_INTEGER (2^53 - 1) is more than sufficient.
 * 
 * For reference: 10^15 paisa = 10^13 PKR = 10 trillion PKR.
 * No single journal entry will ever approach this limit.
 */
export function calculateTotals(lines: JournalLineInput[]): {
  totalDebits: number;
  totalCredits: number;
} {
  let totalDebits = 0;
  let totalCredits = 0;

  for (const line of lines) {
    totalDebits += line.debitPaisa;
    totalCredits += line.creditPaisa;
  }

  return { totalDebits, totalCredits };
}

/**
 * Validate a date string is a valid YYYY-MM-DD date.
 */
export function validateDate(dateStr: string): ValidationResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return { valid: false, error: 'Date must be in YYYY-MM-DD format' };
  }

  const date = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(date.getTime())) {
    return { valid: false, error: `Invalid date: ${dateStr}` };
  }

  // Verify the parsed date matches the input (catches things like Feb 30)
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const reconstructed = `${year}-${month}-${day}`;

  if (reconstructed !== dateStr) {
    return { valid: false, error: `Invalid date: ${dateStr} (parsed as ${reconstructed})` };
  }

  return { valid: true };
}

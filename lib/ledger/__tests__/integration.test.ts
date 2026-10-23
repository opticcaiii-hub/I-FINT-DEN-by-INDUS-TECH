import { describe, it, expect } from 'vitest';
import { validateJournalLines, validateLine, validateDate } from '../validation';

describe('Accounting Core Principles & Validation Tests', () => {
  it('enforces exact debits equal credits invariant', () => {
    const balancedLines = [
      { accountId: 1, debitPaisa: 100000, creditPaisa: 0 },
      { accountId: 2, debitPaisa: 0, creditPaisa: 100000 },
    ];
    expect(validateJournalLines(balancedLines).valid).toBe(true);

    const unbalancedLines = [
      { accountId: 1, debitPaisa: 100000, creditPaisa: 0 },
      { accountId: 2, debitPaisa: 0, creditPaisa: 99999 },
    ];
    const res = validateJournalLines(unbalancedLines);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('unbalanced');
  });

  it('rejects lines with negative amounts or float values', () => {
    expect(validateLine({ accountId: 1, debitPaisa: -100, creditPaisa: 0 }, 0).valid).toBe(false);
    expect(validateLine({ accountId: 1, debitPaisa: 10.5, creditPaisa: 0 }, 0).valid).toBe(false);
  });

  it('rejects entries with fewer than 2 lines', () => {
    const singleLine = [{ accountId: 1, debitPaisa: 50000, creditPaisa: 0 }];
    expect(validateJournalLines(singleLine).valid).toBe(false);
  });

  it('validates date formats strictly (catches invalid dates like Feb 30)', () => {
    expect(validateDate('2026-08-10').valid).toBe(true);
    expect(validateDate('2026-02-30').valid).toBe(false);
    expect(validateDate('invalid-date').valid).toBe(false);
  });
});

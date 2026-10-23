import { describe, it, expect } from 'vitest';
import {
  validateLine,
  validateJournalLines,
  calculateTotals,
  validateDate,
} from '../validation';

describe('Journal Entry Line Validation', () => {
  it('accepts a valid debit line', () => {
    const res = validateLine({ accountId: 1, debitPaisa: 100000, creditPaisa: 0 }, 0);
    expect(res.valid).toBe(true);
  });

  it('accepts a valid credit line', () => {
    const res = validateLine({ accountId: 2, debitPaisa: 0, creditPaisa: 100000 }, 0);
    expect(res.valid).toBe(true);
  });

  it('rejects a line with both debit and credit set', () => {
    const res = validateLine({ accountId: 1, debitPaisa: 100, creditPaisa: 100 }, 0);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('both debit and credit');
  });

  it('rejects a line with neither debit nor credit set', () => {
    const res = validateLine({ accountId: 1, debitPaisa: 0, creditPaisa: 0 }, 0);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('must have either');
  });

  it('rejects negative debit or credit amounts', () => {
    const res1 = validateLine({ accountId: 1, debitPaisa: -500, creditPaisa: 0 }, 0);
    expect(res1.valid).toBe(false);
    expect(res1.error).toContain('negative');

    const res2 = validateLine({ accountId: 1, debitPaisa: 0, creditPaisa: -500 }, 0);
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('negative');
  });

  it('rejects float / non-integer values', () => {
    const res = validateLine({ accountId: 1, debitPaisa: 10.5, creditPaisa: 0 }, 0);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('must be an integer');
  });

  it('rejects invalid accountId', () => {
    const res = validateLine({ accountId: -1, debitPaisa: 100, creditPaisa: 0 }, 0);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('accountId must be a positive integer');
  });
});

describe('Journal Entry Multi-line Validation', () => {
  it('rejects an entry with only 1 line', () => {
    const res = validateJournalLines([
      { accountId: 1, debitPaisa: 1000, creditPaisa: 0 },
    ]);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('at least 2 lines');
  });

  it('rejects an entry where debits do not equal credits', () => {
    const res = validateJournalLines([
      { accountId: 1, debitPaisa: 1000, creditPaisa: 0 },
      { accountId: 2, debitPaisa: 0, creditPaisa: 900 },
    ]);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('unbalanced');
  });

  it('accepts a balanced 2-line entry', () => {
    const res = validateJournalLines([
      { accountId: 1, debitPaisa: 50000, creditPaisa: 0 },
      { accountId: 2, debitPaisa: 0, creditPaisa: 50000 },
    ]);
    expect(res.valid).toBe(true);
  });

  it('accepts a balanced multi-line entry (3+ lines)', () => {
    const res = validateJournalLines([
      { accountId: 1, debitPaisa: 100000, creditPaisa: 0 }, // Dr AR 1000
      { accountId: 2, debitPaisa: 0, creditPaisa: 85000 },  // Cr Sales 850
      { accountId: 3, debitPaisa: 0, creditPaisa: 15000 },  // Cr Sales Tax 150
    ]);
    expect(res.valid).toBe(true);
  });

  it('correctly calculates total debits and credits', () => {
    const totals = calculateTotals([
      { accountId: 1, debitPaisa: 1000, creditPaisa: 0 },
      { accountId: 2, debitPaisa: 2000, creditPaisa: 0 },
      { accountId: 3, debitPaisa: 0, creditPaisa: 3000 },
    ]);
    expect(totals.totalDebits).toBe(3000);
    expect(totals.totalCredits).toBe(3000);
  });
});

describe('Date Validation', () => {
  it('accepts valid YYYY-MM-DD date', () => {
    expect(validateDate('2026-08-05').valid).toBe(true);
  });

  it('rejects invalid date formats', () => {
    expect(validateDate('05-08-2026').valid).toBe(false);
    expect(validateDate('2026/08/05').valid).toBe(false);
  });

  it('rejects non-existent dates like Feb 30', () => {
    expect(validateDate('2026-02-30').valid).toBe(false);
  });
});

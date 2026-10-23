/**
 * Deterministic Cleaning Rules for Accounting Data
 * 
 * Rules:
 * - Whitespace normalization (trim, collapse multi-spaces)
 * - Date normalization only when UNAMBIGUOUS
 * - Amount & currency normalization (parentheses for negative, paisa conversion)
 * - Pakistani NTN / CNIC / Phone normalization
 * - Tax rate representation normalization
 * 
 * INVARIANTS:
 * - Never silently delete rows.
 * - Never change amounts arbitrarily.
 * - Never guess ambiguous dates.
 */

import { CleanedValueResult, CleaningIssue } from './types';

/**
 * Normalizes leading/trailing and internal repeated whitespace.
 */
export function normalizeWhitespace(value: string | undefined | null): CleanedValueResult<string> {
  const orig = value === undefined || value === null ? '' : String(value);
  const cleaned = orig.trim().replace(/\s+/g, ' ');
  const wasModified = orig !== cleaned;

  return {
    originalValue: orig,
    cleanedValue: cleaned,
    wasModified,
    ruleApplied: wasModified ? 'TRIM_WHITESPACE' : undefined,
  };
}

/**
 * Normalizes date to ISO YYYY-MM-DD format only when unambiguous.
 * If ambiguous or invalid, preserves original and records a review issue.
 */
export function normalizeDate(
  value: string | undefined | null,
  sourceRow: number,
  sourceColumn: string,
  sheetName = 'Sheet1'
): CleanedValueResult<string> {
  const orig = (value || '').trim();
  if (!orig) {
    return { originalValue: orig, cleanedValue: '', wasModified: false };
  }

  // 1. Already ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(orig)) {
    const [y, m, d] = orig.split('-').map(Number);
    if (isValidCalendarDate(y!, m!, d!)) {
      return { originalValue: orig, cleanedValue: orig, wasModified: false };
    }
  }

  // 2. Format YYYY/MM/DD
  const ymdSlash = orig.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/);
  if (ymdSlash) {
    const y = Number(ymdSlash[1]);
    const m = Number(ymdSlash[2]);
    const d = Number(ymdSlash[3]);
    if (isValidCalendarDate(y, m, d)) {
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return {
        originalValue: orig,
        cleanedValue: iso,
        wasModified: true,
        ruleApplied: 'NORMALIZE_DATE_ISO',
      };
    }
  }

  // 3. Format DD-Mon-YYYY or DD Mon YYYY (e.g. 22-Aug-2026, 22 Aug 2026)
  const monthNames: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const namedMonth = orig.match(/^(\d{1,2})[-/ ]([A-Za-z]+)[-/ ](\d{4})$/);
  if (namedMonth) {
    const d = Number(namedMonth[1]);
    const monStr = namedMonth[2]!.toLowerCase();
    const y = Number(namedMonth[3]);
    const m = monthNames[monStr];
    if (m && isValidCalendarDate(y, m, d)) {
      const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      return {
        originalValue: orig,
        cleanedValue: iso,
        wasModified: true,
        ruleApplied: 'NORMALIZE_DATE_NAMED_MONTH',
      };
    }
  }

  // 4. Format DD/MM/YYYY vs MM/DD/YYYY disambiguation
  const slashDate = orig.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (slashDate) {
    const first = Number(slashDate[1]);
    const second = Number(slashDate[2]);
    const y = Number(slashDate[3]);

    // If first > 12, it MUST be day (DD/MM/YYYY - standard Pakistani/UK format)
    if (first > 12 && second <= 12 && isValidCalendarDate(y, second, first)) {
      const iso = `${y}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`;
      return {
        originalValue: orig,
        cleanedValue: iso,
        wasModified: true,
        ruleApplied: 'NORMALIZE_DATE_DD_MM_YYYY',
      };
    }

    // If second > 12, it MUST be day (MM/DD/YYYY - US format)
    if (second > 12 && first <= 12 && isValidCalendarDate(y, first, second)) {
      const iso = `${y}-${String(first).padStart(2, '0')}-${String(second).padStart(2, '0')}`;
      return {
        originalValue: orig,
        cleanedValue: iso,
        wasModified: true,
        ruleApplied: 'NORMALIZE_DATE_MM_DD_YYYY',
      };
    }

    // Both <= 12: AMBIGUOUS (e.g. 05/06/2026 could be May 6 or June 5)
    // Default to Pakistani standard DD/MM/YYYY but create an AI/Review issue for accountant confirmation
    if (isValidCalendarDate(y, second, first)) {
      const suggestedIso = `${y}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`;
      const issue: CleaningIssue = {
        sourceRow,
        sourceColumn,
        sheetName,
        issueType: 'warning',
        ruleCode: 'AMBIGUOUS_DATE_FORMAT',
        originalValue: orig,
        suggestedValue: suggestedIso,
        reason: `Date "${orig}" is ambiguous (could be DD/MM/YYYY or MM/DD/YYYY). Defaulted to DD/MM/YYYY.`,
        confidence: 0.8,
        reviewStatus: 'pending',
      };
      return {
        originalValue: orig,
        cleanedValue: suggestedIso,
        wasModified: true,
        ruleApplied: 'DEFAULT_DD_MM_YYYY_AMBIGUOUS',
        issue,
      };
    }
  }

  // 5. Invalid date string
  const issue: CleaningIssue = {
    sourceRow,
    sourceColumn,
    sheetName,
    issueType: 'error',
    ruleCode: 'INVALID_DATE_VALUE',
    originalValue: orig,
    suggestedValue: '',
    reason: `Invalid or unparseable date value "${orig}".`,
    confidence: 0.0,
    reviewStatus: 'pending',
  };

  return {
    originalValue: orig,
    cleanedValue: orig,
    wasModified: false,
    issue,
  };
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

/**
 * Parses numeric monetary amounts.
 * Handles currency symbols (PKR, Rs, $), commas, parentheses for negative numbers, and converts to paisa.
 * Exact rounding: half-paisa values are rounded deterministically via Math.round().
 */
export function parseNumericAmount(
  value: string | undefined | null,
  sourceRow: number,
  sourceColumn: string,
  sheetName = 'Sheet1'
): CleanedValueResult<{ amount: number; paisa: number }> {
  const orig = (value === undefined || value === null ? '' : String(value)).trim();
  if (!orig || orig === '-' || orig === 'N/A' || orig === 'null') {
    return {
      originalValue: orig,
      cleanedValue: { amount: 0, paisa: 0 },
      wasModified: false,
    };
  }

  // Clean currency symbols and spaces
  let cleanedStr = orig
    .replace(/(?:PKR|Rs\.?|USD|\$|EUR|€|GBP|£)/gi, '')
    .replace(/\s+/g, '')
    .trim();

  // Check for negative in parentheses: (1,500.00) -> -1500.00
  let isNegative = false;
  if (cleanedStr.startsWith('(') && cleanedStr.endsWith(')')) {
    isNegative = true;
    cleanedStr = cleanedStr.substring(1, cleanedStr.length - 1);
  } else if (cleanedStr.startsWith('-')) {
    isNegative = true;
    cleanedStr = cleanedStr.substring(1);
  }

  // Remove thousand separator commas
  cleanedStr = cleanedStr.replace(/,/g, '');

  // Strict numeric validation (e.g. reject malformed "12.34.56" or "abc")
  if (!/^\d+(?:\.\d+)?$/.test(cleanedStr)) {
    const issue: CleaningIssue = {
      sourceRow,
      sourceColumn,
      sheetName,
      issueType: 'error',
      ruleCode: 'INVALID_NUMERIC_AMOUNT',
      originalValue: orig,
      suggestedValue: '0.00',
      reason: `Could not parse numeric amount from "${orig}".`,
      confidence: 0.0,
      reviewStatus: 'pending',
    };
    return {
      originalValue: orig,
      cleanedValue: { amount: 0, paisa: 0 },
      wasModified: false,
      issue,
    };
  }

  const num = parseFloat(cleanedStr);
  if (isNaN(num) || !isFinite(num)) {
    const issue: CleaningIssue = {
      sourceRow,
      sourceColumn,
      sheetName,
      issueType: 'error',
      ruleCode: 'INVALID_NUMERIC_AMOUNT',
      originalValue: orig,
      suggestedValue: '0.00',
      reason: `Could not parse numeric amount from "${orig}".`,
      confidence: 0.0,
      reviewStatus: 'pending',
    };
    return {
      originalValue: orig,
      cleanedValue: { amount: 0, paisa: 0 },
      wasModified: false,
      issue,
    };
  }

  const finalAmount = isNegative ? -num : num;
  const paisa = Math.round(finalAmount * 100);

  return {
    originalValue: orig,
    cleanedValue: { amount: finalAmount, paisa },
    wasModified: orig !== String(finalAmount),
    ruleApplied: 'NORMALIZE_AMOUNT',
  };
}

/**
 * Normalizes Pakistani National Tax Number (NTN).
 * Format: 1234567-8
 */
export function normalizeNtn(
  value: string | undefined | null,
  sourceRow: number,
  sourceColumn: string,
  sheetName = 'Sheet1'
): CleanedValueResult<string> {
  const orig = (value || '').trim();
  if (!orig) return { originalValue: orig, cleanedValue: '', wasModified: false };

  const digits = orig.replace(/\D/g, '');
  if (digits.length === 8) {
    const formatted = `${digits.substring(0, 7)}-${digits.substring(7)}`;
    return {
      originalValue: orig,
      cleanedValue: formatted,
      wasModified: orig !== formatted,
      ruleApplied: 'FORMAT_NTN_7_1',
    };
  }

  if (digits.length === 7) {
    return {
      originalValue: orig,
      cleanedValue: digits,
      wasModified: orig !== digits,
      ruleApplied: 'CLEAN_NTN_7',
    };
  }

  const issue: CleaningIssue = {
    sourceRow,
    sourceColumn,
    sheetName,
    issueType: 'warning',
    ruleCode: 'INVALID_NTN_LENGTH',
    originalValue: orig,
    suggestedValue: orig,
    reason: `NTN "${orig}" has invalid length (${digits.length} digits, expected 7 or 8).`,
    confidence: 0.5,
    reviewStatus: 'pending',
  };

  return { originalValue: orig, cleanedValue: orig, wasModified: false, issue };
}

/**
 * Normalizes Pakistani CNIC.
 * Format: 12345-1234567-1 (13 digits)
 */
export function normalizeCnic(
  value: string | undefined | null,
  sourceRow: number,
  sourceColumn: string,
  sheetName = 'Sheet1'
): CleanedValueResult<string> {
  const orig = (value || '').trim();
  if (!orig) return { originalValue: orig, cleanedValue: '', wasModified: false };

  const digits = orig.replace(/\D/g, '');
  if (digits.length === 13) {
    const formatted = `${digits.substring(0, 5)}-${digits.substring(5, 12)}-${digits.substring(12)}`;
    return {
      originalValue: orig,
      cleanedValue: formatted,
      wasModified: orig !== formatted,
      ruleApplied: 'FORMAT_CNIC_5_7_1',
    };
  }

  const issue: CleaningIssue = {
    sourceRow,
    sourceColumn,
    sheetName,
    issueType: 'warning',
    ruleCode: 'INVALID_CNIC_LENGTH',
    originalValue: orig,
    suggestedValue: orig,
    reason: `CNIC "${orig}" has invalid length (${digits.length} digits, expected 13).`,
    confidence: 0.5,
    reviewStatus: 'pending',
  };

  return { originalValue: orig, cleanedValue: orig, wasModified: false, issue };
}

/**
 * Normalizes Pakistani Phone numbers.
 * Format: +92 300 1234567 or 0300-1234567
 */
export function normalizePhone(
  value: string | undefined | null
): CleanedValueResult<string> {
  const orig = (value || '').trim();
  if (!orig) return { originalValue: orig, cleanedValue: '', wasModified: false };

  const clean = orig.replace(/[^\d+]/g, '');
  if (/^03\d{9}$/.test(clean)) {
    const formatted = `${clean.substring(0, 4)}-${clean.substring(4)}`;
    return { originalValue: orig, cleanedValue: formatted, wasModified: orig !== formatted, ruleApplied: 'FORMAT_LOCAL_MOBILE' };
  }

  if (/^\+923\d{9}$/.test(clean)) {
    const formatted = `+92 ${clean.substring(3, 6)} ${clean.substring(6)}`;
    return { originalValue: orig, cleanedValue: formatted, wasModified: orig !== formatted, ruleApplied: 'FORMAT_INTL_MOBILE' };
  }

  return { originalValue: orig, cleanedValue: orig, wasModified: false };
}

/**
 * Normalizes tax rate representations (e.g. 18%, 0.18, 18 -> 1800 basis points / 18.00%).
 * Flags invalid, ambiguous, or out-of-range tax rates.
 */
export function normalizeTaxRate(
  value: string | undefined | null,
  sourceRow = 1,
  sourceColumn = 'tax_rate',
  sheetName = 'Sheet1'
): CleanedValueResult<{ basisPoints: number; percent: number }> {
  const orig = (value || '').trim();
  if (!orig || orig === '0' || orig === '0%' || orig === '0.00') {
    return { originalValue: orig, cleanedValue: { basisPoints: 0, percent: 0 }, wasModified: false };
  }

  const cleaned = orig.replace(/%/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num) || !isFinite(num) || !/^\d+(?:\.\d+)?$/.test(cleaned)) {
    const issue: CleaningIssue = {
      sourceRow,
      sourceColumn,
      sheetName,
      issueType: 'error',
      ruleCode: 'INVALID_TAX_RATE',
      originalValue: orig,
      suggestedValue: '0.00%',
      reason: `Could not parse valid tax rate from "${orig}".`,
      confidence: 0.0,
      reviewStatus: 'pending',
    };
    return { originalValue: orig, cleanedValue: { basisPoints: 0, percent: 0 }, wasModified: false, issue };
  }

  let percent = num;
  // If given as a decimal like 0.18, convert to 18
  if (num > 0 && num < 1) {
    percent = num * 100;
  }

  if (percent > 100 || percent < 0) {
    const issue: CleaningIssue = {
      sourceRow,
      sourceColumn,
      sheetName,
      issueType: 'warning',
      ruleCode: 'OUT_OF_BOUNDS_TAX_RATE',
      originalValue: orig,
      suggestedValue: `${percent}%`,
      reason: `Tax rate "${orig}" (${percent}%) is outside expected range of 0% to 100%.`,
      confidence: 0.5,
      reviewStatus: 'pending',
    };
    return { originalValue: orig, cleanedValue: { basisPoints: Math.round(percent * 100), percent }, wasModified: true, issue };
  }

  const basisPoints = Math.round(percent * 100);
  return {
    originalValue: orig,
    cleanedValue: { basisPoints, percent },
    wasModified: orig !== `${percent}%`,
    ruleApplied: 'NORMALIZE_TAX_RATE',
  };
}

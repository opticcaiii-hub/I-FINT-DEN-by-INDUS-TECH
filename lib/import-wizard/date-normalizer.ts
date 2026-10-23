/**
 * Phase 2 Feature 1: Date Normalizer
 * 
 * Strict date parser supporting:
 * - DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY
 * - MM/DD/YYYY, MM-DD-YYYY
 * - YYYY-MM-DD, YYYY/MM/DD
 * - DD-MMM-YYYY (e.g. 15-Aug-2026)
 * - Excel numeric serial dates (e.g. 45170)
 * 
 * Enforces calendar reality (leap years, month days) and resolves
 * ambiguous A/B/YYYY dates using user intent or batch distribution.
 */

export interface DateParseOptions {
  preferredFormat?: 'auto' | 'DD/MM/YYYY' | 'MM/DD/YYYY';
}

export interface DateParseResult {
  isoDate: string; // YYYY-MM-DD
  originalValue: string;
  detectedFormat: string;
  isValid: boolean;
  error?: string;
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  if ([4, 6, 9, 11].includes(month)) {
    return 30;
  }
  return 31;
}

/**
 * Converts Excel serial date number to JS Date
 * Excel serial 1 = 1900-01-01, with the famous Lotus 1-2-3 1900 leap year bug
 */
export function excelSerialToIsoDate(serial: number): string {
  // 25569 = days between 1900-01-01 and 1970-01-01 (accounting for 1900 leap day bug)
  const msPerDay = 86400 * 1000;
  const utcDays = serial - 25569;
  const date = new Date(utcDays * msPerDay);
  return date.toISOString().split('T')[0]!;
}

/**
 * Normalizes and parses a single date string
 */
export function parseDateStrict(
  value: unknown,
  options: DateParseOptions = {}
): DateParseResult {
  const original = String(value ?? '').trim();
  if (!original) {
    return {
      isoDate: '',
      originalValue: original,
      detectedFormat: 'empty',
      isValid: false,
      error: 'Date value is empty.',
    };
  }

  // 1. Check if numeric Excel serial date (e.g. 45170 or "45170")
  if (/^\d{5}(\.\d+)?$/.test(original)) {
    const serial = parseFloat(original);
    if (serial >= 20000 && serial <= 60000) {
      try {
        const iso = excelSerialToIsoDate(serial);
        return {
          isoDate: iso,
          originalValue: original,
          detectedFormat: 'excel_serial',
          isValid: true,
        };
      } catch {
        // continue
      }
    }
  }

  // 2. ISO 8601: YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = original.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1]!, 10);
    const month = parseInt(isoMatch[2]!, 10);
    const day = parseInt(isoMatch[3]!, 10);
    return validateAndFormatDate(year, month, day, original, 'YYYY-MM-DD');
  }

  // 3. Named month formats: DD-MMM-YYYY or DD MMM YYYY (e.g. 15-Aug-2026)
  const namedMatch = original.match(/^(\d{1,2})[-\s\/]([A-Za-z]{3,9})[-\s\/](\d{4})/);
  if (namedMatch) {
    const day = parseInt(namedMatch[1]!, 10);
    const monthStr = namedMatch[2]!.toLowerCase();
    const year = parseInt(namedMatch[3]!, 10);
    const month = MONTH_NAMES[monthStr];
    if (!month) {
      return {
        isoDate: '',
        originalValue: original,
        detectedFormat: 'unknown_month',
        isValid: false,
        error: `Unknown month name "${namedMatch[2]}".`,
      };
    }
    return validateAndFormatDate(year, month, day, original, 'DD-MMM-YYYY');
  }

  // 4. A/B/YYYY or A-B-YYYY or A.B.YYYY
  const abMatch = original.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})/);
  if (abMatch) {
    const partA = parseInt(abMatch[1]!, 10);
    const partB = parseInt(abMatch[2]!, 10);
    const year = parseInt(abMatch[3]!, 10);

    // If partA > 12, it must be DD/MM/YYYY
    if (partA > 12 && partB <= 12) {
      return validateAndFormatDate(year, partB, partA, original, 'DD/MM/YYYY');
    }

    // If partB > 12, it must be MM/DD/YYYY
    if (partB > 12 && partA <= 12) {
      return validateAndFormatDate(year, partA, partB, original, 'MM/DD/YYYY');
    }

    // Both partA <= 12 and partB <= 12 -> Ambiguous!
    if (options.preferredFormat === 'MM/DD/YYYY') {
      return validateAndFormatDate(year, partA, partB, original, 'MM/DD/YYYY');
    } else if (options.preferredFormat === 'DD/MM/YYYY') {
      return validateAndFormatDate(year, partB, partA, original, 'DD/MM/YYYY');
    } else {
      // Ambiguous date with no explicit user preference selected.
      // Do NOT silently parse or default to DD/MM/YYYY!
      return {
        isoDate: '',
        originalValue: original,
        detectedFormat: 'ambiguous_a_b_yyyy',
        isValid: false,
        error: `Ambiguous date "${original}". Both day and month are <= 12. Explicit selection between DD/MM/YYYY (recommended for Pakistan) and MM/DD/YYYY is required.`,
      };
    }
  }

  return {
    isoDate: '',
    originalValue: original,
    detectedFormat: 'unrecognized',
    isValid: false,
    error: `Unrecognized date format "${original}". Expected DD/MM/YYYY, YYYY-MM-DD, or DD-MMM-YYYY.`,
  };
}

function validateAndFormatDate(
  year: number,
  month: number,
  day: number,
  originalValue: string,
  detectedFormat: string
): DateParseResult {
  if (year < 1900 || year > 2100) {
    return {
      isoDate: '',
      originalValue,
      detectedFormat,
      isValid: false,
      error: `Year ${year} is outside acceptable range (1900-2100).`,
    };
  }

  if (month < 1 || month > 12) {
    return {
      isoDate: '',
      originalValue,
      detectedFormat,
      isValid: false,
      error: `Invalid month ${month}.`,
    };
  }

  const maxDays = getDaysInMonth(year, month);
  if (day < 1 || day > maxDays) {
    const reason = month === 2 && day === 29
      ? `${year} is not a leap year (February only has 28 days).`
      : `Month ${month} only has ${maxDays} days, but got day ${day}.`;
    return {
      isoDate: '',
      originalValue,
      detectedFormat,
      isValid: false,
      error: reason,
    };
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const isoDate = `${year}-${mm}-${dd}`;

  return {
    isoDate,
    originalValue,
    detectedFormat,
    isValid: true,
  };
}

/**
 * Analyzes a sample of date strings from a batch to determine if explicit user format selection is mandatory.
 *
 * Rules:
 * - If at least one date has first part > 12 and second <= 12, unambiguous DD/MM/YYYY.
 * - If at least one date has second part > 12 and first <= 12, unambiguous MM/DD/YYYY.
 * - If every numeric A/B/YYYY date has A <= 12 and B <= 12, it is strictly AMBIGUOUS.
 *   The system MUST NOT silently default. It must require the user to choose,
 *   with DD/MM/YYYY recommended in the UI, and provide 5-row previews for both interpretations.
 */
export interface DateBatchAmbiguityAnalysis {
  isAmbiguous: boolean;
  unambiguousFormat?: 'DD/MM/YYYY' | 'MM/DD/YYYY';
  recommendedFormat: 'DD/MM/YYYY'; // Pakistani recommended default for user selection prompt
  totalNumericSampled: number;
  ambiguousCount: number;
  previewRows?: {
    original: string;
    asDDMMYYYY: string;
    asMMDDYYYY: string;
  }[];
}

export function inspectDateBatchAmbiguity(dateStrings: string[]): DateBatchAmbiguityAnalysis {
  let hasDayInFirstPosition = false; // first > 12
  let hasDayInSecondPosition = false; // second > 12
  let totalNumeric = 0;
  let ambiguousCount = 0;
  const sampleCandidates: string[] = [];

  for (const s of dateStrings) {
    const trimmed = s.trim();
    const match = trimmed.match(/^(\d{1,2})[-\/\.](\d{1,2})[-\/\.]\d{4}/);
    if (match) {
      totalNumeric++;
      const a = parseInt(match[1]!, 10);
      const b = parseInt(match[2]!, 10);
      if (a > 12 && b <= 12) {
        hasDayInFirstPosition = true;
      } else if (b > 12 && a <= 12) {
        hasDayInSecondPosition = true;
      } else if (a <= 12 && b <= 12) {
        ambiguousCount++;
        if (sampleCandidates.length < 5) {
          sampleCandidates.push(trimmed);
        }
      }
    }
  }

  // If there are unambiguous anchors in the batch:
  if (hasDayInFirstPosition && !hasDayInSecondPosition) {
    return {
      isAmbiguous: false,
      unambiguousFormat: 'DD/MM/YYYY',
      recommendedFormat: 'DD/MM/YYYY',
      totalNumericSampled: totalNumeric,
      ambiguousCount,
    };
  }

  if (hasDayInSecondPosition && !hasDayInFirstPosition) {
    return {
      isAmbiguous: false,
      unambiguousFormat: 'MM/DD/YYYY',
      recommendedFormat: 'DD/MM/YYYY',
      totalNumericSampled: totalNumeric,
      ambiguousCount,
    };
  }

  // If all numeric dates are ambiguous (or zero found)
  const isAmbiguous = totalNumeric > 0 && ambiguousCount === totalNumeric;

  const previewRows = sampleCandidates.map(orig => {
    const dmy = parseDateStrict(orig, { preferredFormat: 'DD/MM/YYYY' });
    const mdy = parseDateStrict(orig, { preferredFormat: 'MM/DD/YYYY' });
    return {
      original: orig,
      asDDMMYYYY: dmy.isoDate,
      asMMDDYYYY: mdy.isoDate,
    };
  });

  return {
    isAmbiguous,
    recommendedFormat: 'DD/MM/YYYY',
    totalNumericSampled: totalNumeric,
    ambiguousCount,
    previewRows,
  };
}

/**
 * Automatically infers date format from a sample batch of date strings if unambiguous.
 * If ambiguous, returns null to enforce user confirmation.
 */
export function inferDateFormatFromBatch(dateStrings: string[]): 'DD/MM/YYYY' | 'MM/DD/YYYY' | null {
  const analysis = inspectDateBatchAmbiguity(dateStrings);
  if (analysis.isAmbiguous) {
    return null; // Ambiguous: User confirmation required!
  }
  return analysis.unambiguousFormat || null;
}


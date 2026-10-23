/**
 * Phase 2 Feature 1: Amount Normalizer
 * 
 * Normalizes flat-data amounts to integer PKR Paisa (1 PKR = 100 Paisa).
 * Features:
 * - South Asian lakh/crore comma grouping (10,00,000) & Western grouping (1,000,000)
 * - Accounting parentheses negative format: (50,000) -> -50,000
 * - Currency token stripping: PKR, Rs., Rs, ₨, trailing /-
 * - Foreign-currency quarantine: flags non-PKR currencies (USD, EUR, GBP, AED, SAR, etc.)
 * - Typo detection & audited override
 */

export interface AmountParseOptions {
  allowTypoOverride?: boolean;
  manualCleanedValue?: string;
  overrideAuditReason?: string;
  overrideActorId?: number;
}

export interface AmountParseResult {
  paisa: number;
  originalValue: string;
  cleanedValue: string;
  isNegative: boolean;
  isQuarantined: boolean;
  quarantineReason?: string;
  isValid: boolean;
  error?: string;
  warnings: string[];
  overrideApplied?: boolean;
}

const FOREIGN_CURRENCY_PATTERNS: Array<{ symbol: string; regex: RegExp; name: string }> = [
  { symbol: '$', regex: /\$|USD/i, name: 'USD (US Dollar)' },
  { symbol: '€', regex: /€|EUR/i, name: 'EUR (Euro)' },
  { symbol: '£', regex: /£|GBP/i, name: 'GBP (British Pound)' },
  { symbol: 'AED', regex: /AED|Dirham/i, name: 'AED (UAE Dirham)' },
  { symbol: 'SAR', regex: /SAR|Riyal/i, name: 'SAR (Saudi Riyal)' },
  { symbol: '¥', regex: /¥|CNY|JPY/i, name: 'CNY/JPY (Yen/Yuan)' },
  { symbol: 'CAD', regex: /CAD/i, name: 'CAD (Canadian Dollar)' },
  { symbol: 'AUD', regex: /AUD/i, name: 'AUD (Australian Dollar)' },
];

/**
 * Normalizes any amount string/number to integer PKR Paisa
 */
export function parseAmountToPaisa(
  value: unknown,
  options: AmountParseOptions = {}
): AmountParseResult {
  const original = String(value ?? '').trim();
  const warnings: string[] = [];

  if (!original) {
    return {
      paisa: 0,
      originalValue: original,
      cleanedValue: '',
      isNegative: false,
      isQuarantined: false,
      isValid: true,
      warnings: [],
    };
  }

  // Check for manual audited typo override first
  if (options.allowTypoOverride && options.manualCleanedValue !== undefined) {
    const cleaned = options.manualCleanedValue.trim();
    const parsed = parseAmountInternal(cleaned);
    return {
      ...parsed,
      originalValue: original,
      overrideApplied: true,
      warnings: [
        ...parsed.warnings,
        `Manual typo override applied: "${original}" -> "${cleaned}" (${options.overrideAuditReason ?? 'No reason provided'})`,
      ],
    };
  }

  // 1. Foreign Currency Quarantine Check
  for (const fc of FOREIGN_CURRENCY_PATTERNS) {
    if (fc.regex.test(original)) {
      return {
        paisa: 0,
        originalValue: original,
        cleanedValue: original,
        isNegative: false,
        isQuarantined: true,
        quarantineReason: `Foreign currency detected (${fc.name}). Phase 2 Feature 1 only processes PKR. Phase 2 Feature 3 handles FX accounting.`,
        isValid: false,
        error: `Quarantined: Foreign currency "${fc.name}" is not permitted in domestic PKR import.`,
        warnings,
      };
    }
  }

  return parseAmountInternal(original);
}

function parseAmountInternal(raw: string): AmountParseResult {
  const warnings: string[] = [];
  let s = raw.trim();

  // 2. Check for accounting negative parentheses: (1,234.50) -> -1234.50
  let isNegative = false;
  if (/^\(.*\)$/.test(s)) {
    isNegative = true;
    s = s.slice(1, -1).trim();
  }

  // 3. Strip PKR / Rs tokens and trailing /-
  s = s.replace(/\bPKR\b/gi, '').trim();
  s = s.replace(/Rs\.?/gi, '').trim();
  s = s.replace(/₨/g, '').trim();
  s = s.replace(/\/-\s*$/, '').trim();

  // 4. Check for leading or trailing minus
  if (s.startsWith('-')) {
    isNegative = true;
    s = s.substring(1).trim();
  } else if (s.endsWith('-')) {
    isNegative = true;
    s = s.substring(0, s.length - 1).trim();
    warnings.push('Trailing negative sign normalized.');
  }

  // 5. Detect and clean letter 'O' or 'o' typo instead of 0
  if (/[0-9][Oo]|[Oo][0-9]/.test(s)) {
    warnings.push('Detected letter "O" instead of digit "0".');
    s = s.replace(/[Oo]/g, '0');
  }

  // 6. Handle decimal and comma formatting
  // Pakistani / South Asian: 10,00,000.50
  // Western: 1,000,000.50
  // Check if multiple decimal dots exist: 100..50 or 1.000.50
  const dotCount = (s.match(/\./g) || []).length;
  if (dotCount > 1) {
    return {
      paisa: 0,
      originalValue: raw,
      cleanedValue: s,
      isNegative,
      isQuarantined: false,
      isValid: false,
      error: `Malformed amount "${raw}": contains multiple decimal points. Use manual typo override if needed.`,
      warnings,
    };
  }

  // Remove commas (thousand / lakh separators)
  s = s.replace(/,/g, '');

  // Verify numerical validity
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return {
      paisa: 0,
      originalValue: raw,
      cleanedValue: s,
      isNegative,
      isQuarantined: false,
      isValid: false,
      error: `Unable to parse amount "${raw}" into numeric value.`,
      warnings,
    };
  }

  // Convert to paisa (avoid float rounding issues)
  const parts = s.split('.');
  const whole = parseInt(parts[0] || '0', 10);
  const fracStr = (parts[1] || '').padEnd(2, '0').substring(0, 2);
  const frac = parseInt(fracStr, 10);

  let paisa = whole * 100 + frac;
  if (isNegative) {
    paisa = -paisa;
  }

  return {
    paisa,
    originalValue: raw,
    cleanedValue: s,
    isNegative,
    isQuarantined: false,
    isValid: true,
    warnings,
  };
}

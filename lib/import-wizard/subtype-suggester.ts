/**
 * lib/import-wizard/subtype-suggester.ts
 *
 * Phase 4 — Heuristic Subtype Auto-Suggestion Engine.
 *
 * Implements Weighted Jaccard Similarity scoring to automatically suggest the most
 * fitting accounting subtype (from the 67 built-in subtypes across 15 categories)
 * based on parsed column headers.
 *
 * Mathematical Specification:
 * - Weight required columns: 2x
 * - Weight optional columns: 1x
 * - Extra columns split into:
 *     - E_known: Extra columns that appear in ANY OTHER subtype's required/optional schema (included in denominator).
 *     - E_unknown: Extra columns that don't appear in ANY subtype's schema (e.g., IBAN, teller_id, branch_code) (excluded from denominator).
 *
 * Formula:
 *   Confidence = (2 * |M_req| + 1 * |M_opt|) / (2 * |R_S| + 1 * |O_S| + 1 * |E_known|) * 100
 *
 * Safeguards:
 * - Low Confidence: top match < 50% -> isLowConfidence = true
 * - Tie Condition: top 2 suggestions differ by <= 10 percentage points -> isTie = true
 */

import {
  DataType,
  SubTypeDefinition,
  listSubTypes,
  getParentDataType,
  getDefinition,
} from '@/lib/ingestion/type-registry';
import { ALIAS_DICTIONARY, CanonicalField } from '@/lib/data-cleaning/column-mapper';

export interface SubtypeMatchDetail {
  subTypeId: string;
  dataType: DataType;
  label: string;
  confidence: number; // 0 to 100
  matchedColumns: string[];
  missedRequiredColumns: string[];
  missedOptionalColumns: string[];
  matchedOptionalColumns: string[];
  eKnownColumns: string[];
  eUnknownColumns: string[];
  totalRequiredCount: number;
  totalOptionalCount: number;
}

export interface SubtypeSuggestionResult {
  topSuggestions: SubtypeMatchDetail[];
  allScores: SubtypeMatchDetail[];
  isTie: boolean;
  isLowConfidence: boolean;
  rawHeaders: string[];
  normalizedHeaders: string[];
}

/**
 * Mapping from ALIAS_DICTIONARY canonical field to typical Type Registry column keys.
 */
const CANONICAL_TO_REGISTRY_KEYS: Record<string, string[]> = {
  entry_date: ['date', 'entry_date', 'transaction_date', 'invoice_date', 'bill_date', 'payment_date', 'start_date', 'end_date'],
  debit_paisa: ['debit', 'debit_paisa', 'debit_amount', 'dr', 'dr_amount'],
  credit_paisa: ['credit', 'credit_paisa', 'credit_amount', 'cr', 'cr_amount'],
  reference_number: ['reference', 'reference_number', 'ref_no', 'invoice_number', 'bill_number', 'voucher_number', 'check_number', 'receipt_number', 'order_number'],
  description: ['description', 'narration', 'memo', 'details', 'particulars', 'item_description'],
  account_code: ['account_code', 'account', 'coa_code', 'gl_code', 'code'],
  counterparty_name: ['customer_name', 'customer', 'vendor_name', 'vendor', 'supplier_name', 'supplier', 'payee', 'employee_name'],
  amount: ['amount', 'total_amount', 'net_amount', 'line_total', 'subtotal', 'gross_amount', 'paid_amount', 'opening_balance'],
  balance: ['balance', 'running_balance', 'closing_balance'],
  tax: ['tax', 'tax_amount', 'gst', 'sales_tax', 'vat_amount', 'wht_amount'],
  tax_rate: ['tax_rate', 'gst_rate', 'vat_rate', 'rate'],
  quantity: ['quantity', 'qty'],
  unit_price: ['unit_price', 'price', 'rate'],
  total: ['total', 'total_amount', 'net_total', 'gross_total'],
  payment_method: ['payment_method', 'payment_mode', 'method'],
  line_number: ['line_number', 'item_no', 'line_no'],
};

/**
 * Normalizes a header to lowercase alphanumeric snake_case.
 */
function cleanHeaderString(h: string): string {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Normalizes an input column header into equivalent candidate canonical keys.
 */
export function normalizeHeaderKeys(header: string): string[] {
  const cleaned = cleanHeaderString(header);
  if (!cleaned) return [];

  const candidates = new Set<string>([cleaned]);

  // Check against ALIAS_DICTIONARY
  for (const [canonicalKey, aliases] of Object.entries(ALIAS_DICTIONARY)) {
    const rawClean = header.trim().toLowerCase();
    const isMatch = aliases.some((alias) => {
      const a = alias.toLowerCase();
      return rawClean === a || cleaned === cleanHeaderString(a);
    });

    if (isMatch) {
      candidates.add(canonicalKey);
      const regKeys = CANONICAL_TO_REGISTRY_KEYS[canonicalKey] || [];
      regKeys.forEach((k) => candidates.add(k));
    }
  }

  // Also check direct aliases if header is e.g. "date" or "debit"
  for (const [canonicalKey, regKeys] of Object.entries(CANONICAL_TO_REGISTRY_KEYS)) {
    if (regKeys.includes(cleaned)) {
      candidates.add(canonicalKey);
      regKeys.forEach((k) => candidates.add(k));
    }
  }

  return Array.from(candidates);
}

/**
 * Lazy cache for all built-in subtypes definitions to avoid repeated instantiations.
 */
let cachedDefinitions: SubTypeDefinition[] | null = null;

export function getAllSubtypeDefs(): SubTypeDefinition[] {
  if (cachedDefinitions) return cachedDefinitions;
  const ids = listSubTypes();
  cachedDefinitions = ids.map((id) => {
    const parent = getParentDataType(id);
    return getDefinition(parent, id);
  });
  return cachedDefinitions;
}

/**
 * Set of all column keys appearing across all subtypes.
 */
let allKnownColumnKeysCache: Set<string> | null = null;

function getAllKnownColumnKeys(): Set<string> {
  if (allKnownColumnKeysCache) return allKnownColumnKeysCache;
  const set = new Set<string>();
  const defs = getAllSubtypeDefs();
  defs.forEach((d) => {
    d.requiredColumns.forEach((c) => set.add(c.key.toLowerCase()));
    d.optionalColumns.forEach((c) => set.add(c.key.toLowerCase()));
  });
  allKnownColumnKeysCache = set;
  return set;
}

/**
 * Computes the schema keys of all subtypes EXCEPT the current one.
 */
function getOtherSubtypesColumnKeys(currentSubtypeId: string): Set<string> {
  const set = new Set<string>();
  const defs = getAllSubtypeDefs();
  defs.forEach((d) => {
    if (d.id === currentSubtypeId) return;
    d.requiredColumns.forEach((c) => set.add(c.key.toLowerCase()));
    d.optionalColumns.forEach((c) => set.add(c.key.toLowerCase()));
  });
  return set;
}

/**
 * Calculates Weighted Jaccard Similarity for a specific subtype definition.
 *
 * Formula:
 *   Confidence = (2 * |M_req| + 1 * |M_opt|) / (2 * |R_S| + 1 * |O_S| + 1 * |E_known|) * 100
 */
export function scoreSubtypeAgainstHeaders(
  subtypeDef: SubTypeDefinition,
  rawHeaders: string[]
): SubtypeMatchDetail {
  const reqCols = subtypeDef.requiredColumns.map((c) => c.key.toLowerCase());
  const optCols = subtypeDef.optionalColumns.map((c) => c.key.toLowerCase());

  const otherSubtypeKeys = getOtherSubtypesColumnKeys(subtypeDef.id);

  // Map each file header to its candidate canonical keys
  const headerCandidatesMap = rawHeaders.map((h) => ({
    original: h,
    candidates: new Set(normalizeHeaderKeys(h)),
  }));

  const matchedRequired: string[] = [];
  const matchedOptional: string[] = [];
  const usedHeaderIndices = new Set<number>();

  // 1. Match Required Columns
  for (const rCol of reqCols) {
    const foundIdx = headerCandidatesMap.findIndex(
      (hc, idx) => !usedHeaderIndices.has(idx) && (hc.candidates.has(rCol) || hc.candidates.has(cleanHeaderString(rCol)))
    );
    if (foundIdx !== -1) {
      matchedRequired.push(rCol);
      usedHeaderIndices.add(foundIdx);
    }
  }

  // 2. Match Optional Columns
  for (const oCol of optCols) {
    const foundIdx = headerCandidatesMap.findIndex(
      (hc, idx) => !usedHeaderIndices.has(idx) && (hc.candidates.has(oCol) || hc.candidates.has(cleanHeaderString(oCol)))
    );
    if (foundIdx !== -1) {
      matchedOptional.push(oCol);
      usedHeaderIndices.add(foundIdx);
    }
  }

  const missedRequired = reqCols.filter((r) => !matchedRequired.includes(r));
  const missedOptional = optCols.filter((o) => !matchedOptional.includes(o));

  // 3. Classify Extra Columns (Unused Headers) into E_known and E_unknown
  const eKnownColumns: string[] = [];
  const eUnknownColumns: string[] = [];

  for (let idx = 0; idx < headerCandidatesMap.length; idx++) {
    if (usedHeaderIndices.has(idx)) continue;

    const { original, candidates } = headerCandidatesMap[idx]!;
    // Does this extra column appear in ANY other subtype's schema?
    const isKnownInOther = Array.from(candidates).some((cand) => otherSubtypeKeys.has(cand));

    if (isKnownInOther) {
      eKnownColumns.push(original);
    } else {
      eUnknownColumns.push(original);
    }
  }

  // 4. Compute Weighted Jaccard Confidence Score
  const numerator = 2 * matchedRequired.length + 1 * matchedOptional.length;
  const denominator = 2 * reqCols.length + 1 * optCols.length + 1 * eKnownColumns.length;

  let confidence = 0;
  if (denominator > 0) {
    confidence = Math.round((numerator / denominator) * 100);
  }
  confidence = Math.min(100, Math.max(0, confidence));

  return {
    subTypeId: subtypeDef.id,
    dataType: subtypeDef.dataType,
    label: subtypeDef.label,
    confidence,
    matchedColumns: [...matchedRequired, ...matchedOptional],
    missedRequiredColumns: missedRequired,
    missedOptionalColumns: missedOptional,
    matchedOptionalColumns: matchedOptional,
    eKnownColumns,
    eUnknownColumns,
    totalRequiredCount: reqCols.length,
    totalOptionalCount: optCols.length,
  };
}

/**
 * Suggests the top-matching subtypes for a given list of raw headers.
 */
export function suggestSubtypes(
  rawHeaders: string[],
  options?: {
    dataTypeScope?: DataType;
    topN?: number;
  }
): SubtypeSuggestionResult {
  const topN = options?.topN ?? 3;
  let allDefs = getAllSubtypeDefs();

  if (options?.dataTypeScope) {
    allDefs = allDefs.filter((d) => d.dataType === options.dataTypeScope);
  }

  const allScores = allDefs
    .map((def) => scoreSubtypeAgainstHeaders(def, rawHeaders))
    .sort((a, b) => {
      // Primary: Confidence score descending
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      // Secondary: More matched required columns
      const bReq = b.totalRequiredCount - b.missedRequiredColumns.length;
      const aReq = a.totalRequiredCount - a.missedRequiredColumns.length;
      if (bReq !== aReq) {
        return bReq - aReq;
      }
      // Tertiary: Alphabetical label
      return a.label.localeCompare(b.label);
    });

  const topSuggestions = allScores.slice(0, topN);

  const top1 = topSuggestions[0];
  const top2 = topSuggestions[1];

  // Tie Condition: top two suggestions differ by ≤ 10 percentage points (spec: "within ≤ 10pp").
  // Exception: when top1.confidence === 0, ALL subtypes scored 0 — the file matches no known
  // schema at all. In that case, the tie warning is suppressed; the low-confidence warning
  // (fired unconditionally below when score < 50%) is the correct and sufficient signal.
  // Showing a tie on top of a 0% score would be misleading noise.
  const isTie = Boolean(
    top1 &&
    top2 &&
    top1.confidence > 0 &&
    Math.abs(top1.confidence - top2.confidence) <= 10
  );

  // Low Confidence: top suggestion is < 50%
  const isLowConfidence = !top1 || top1.confidence < 50;

  const normalizedHeaders = rawHeaders.map((h) => cleanHeaderString(h));

  return {
    topSuggestions,
    allScores,
    isTie,
    isLowConfidence,
    rawHeaders,
    normalizedHeaders,
  };
}

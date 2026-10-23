/**
 * Phase 2 Feature 1 Enhancement: Header Row Auto-Detector & Two-Tier Fingerprinting
 *
 * Implements:
 * 1. `detectHeaderRow(rawRows, maxSearchRows=25)`:
 *    - Preamble banner filtering (disqualifies rows with <=1 non-empty cell)
 *    - ALIAS_DICTIONARY & accounting header scoring
 *    - Data contrast lookahead (row i has word headers, row i+1 has numbers/dates)
 *    - Returns { suggestedHeaderRow, confidence: 'high' | 'medium' | 'low', reason }
 * 
 * 2. `normalizeCellForFingerprint(cell)` & `normalizeRowForFingerprint(row)`:
 *    - Static label extraction ("Company: X" -> "company:<TEXT>")
 *    - Date/time masking (YYYY-MM-DD -> <DATE>, HH:MM:SS -> <TIME>)
 *    - Numeric/ID masking (long numbers -> <NUM>)
 *    - Divider detection (----- -> <DIVIDER>)
 *    - Empty cells -> <EMPTY>
 * 
 * 3. Two-Tier Fingerprinting:
 *    - `structuralFingerprint`: SHA-256 of normalized preamble skeleton + header columns
 *    - `exactTextFingerprint`: SHA-256 of raw preamble text for strict audit lineage
 */

import { ALIAS_DICTIONARY } from '@/lib/data-cleaning/column-mapper';

export interface HeaderDetectionResult {
  /** 0-based index of the detected header row (e.g. 3 means row 4 is header, skipTopNRows = 3) */
  suggestedHeaderRow: number;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  candidateScores?: { index: number; score: number; nonBlankCount: number; aliasMatches: number }[];
}

// Flat set of all lowercase aliases for fast O(1) matching
const ALL_ALIASES = new Set<string>(
  Object.values(ALIAS_DICTIONARY).flat().map((a) => a.toLowerCase().trim())
);

// Supplementary accounting header words common in Pakistani & global exports
const SUPPLEMENTARY_HEADER_WORDS = new Set<string>([
  'particulars', 'narration', 'vch', 'voucher', 'vch no', 'voucher no', 'vr no',
  'cheque', 'chq', 'cheque no', 'withdrawal', 'deposit', 'dr', 'cr', 'balance',
  'running balance', 'trans date', 'posting date', 'value date', 'doc date',
  'account id', 'account name', 'account description', 'title of account',
  'gl code', 'head of account', 'subtotal', 'goods subtotal', 'shipping', 'freight',
  'grand total', 'net total', 'tax amount', 'sales tax', 'wht', 'discount',
  'customer', 'vendor', 'supplier', 'payee', 'buyer', 'seller', 'ntn', 'strn',
  'item code', 'item description', 'qty', 'quantity', 'rate', 'unit price',
  'line total', 'remarks', 'notes', 'status', 'currency', 'iban'
]);

/**
 * Checks whether a single cell string matches known accounting headers/aliases.
 */
function isHeaderWord(cell: string): boolean {
  const norm = cell.toLowerCase().trim().replace(/[_./#-]/g, ' ').replace(/\s+/g, ' ');
  if (!norm) return false;
  if (ALL_ALIASES.has(norm) || SUPPLEMENTARY_HEADER_WORDS.has(norm)) return true;
  for (const alias of ALL_ALIASES) {
    if (norm === alias || norm.startsWith(alias) || norm.endsWith(alias)) return true;
  }
  for (const word of SUPPLEMENTARY_HEADER_WORDS) {
    if (norm === word || norm.startsWith(word) || norm.endsWith(word)) return true;
  }
  return false;
}

/**
 * Determines whether a cell looks like tabular data (numeric, currency, or formatted date).
 */
function isDataLike(cell: string): boolean {
  const s = cell.trim();
  if (!s) return false;
  // Numeric or currency: e.g. "5000", "5000.00", "150,000.00", "(2500)", "-100.50"
  if (/^[-+]?\(?\$?PKR?[\s\d,.]+\)?$/i.test(s) && /\d/.test(s)) return true;
  if (/^[-+]?\d{1,3}(,\d{3})*(\.\d+)?$/.test(s)) return true;
  // Date: e.g. "2025-01-01", "01/01/2025", "12-Sep-2026"
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(s)) return true;
  if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$/.test(s)) return true;
  if (/^\d{1,2}-[A-Za-z]{3}-\d{2,4}$/.test(s)) return true;
  return false;
}

/**
 * Heuristically detects the header row from raw tabular rows.
 */
export function detectHeaderRow(rawRows: string[][], maxSearchRows = 25): HeaderDetectionResult {
  if (!rawRows || rawRows.length === 0) {
    return { suggestedHeaderRow: 0, confidence: 'low', reason: 'Empty input rows' };
  }

  const limit = Math.min(rawRows.length, maxSearchRows);
  const scores: { index: number; score: number; nonBlankCount: number; aliasMatches: number }[] = [];

  for (let i = 0; i < limit; i++) {
    const row = rawRows[i] || [];
    const nonBlankCells = row.map((c) => String(c || '').trim()).filter((c) => c.length > 0);
    const nonBlankCount = nonBlankCells.length;

    // 1. Preamble Banner Filtering: Disqualify rows with <=1 non-empty cell
    // (e.g. "ALPHA TRADING CO (PVT) LTD" or "Report: General Ledger")
    if (nonBlankCount <= 1) {
      scores.push({ index: i, score: -10, nonBlankCount, aliasMatches: 0 });
      continue;
    }

    // 2. Alias dictionary and header keyword scoring
    let aliasMatches = 0;
    let dataLikeCells = 0;

    for (const cell of nonBlankCells) {
      if (isHeaderWord(cell)) {
        aliasMatches++;
      } else if (isDataLike(cell)) {
        dataLikeCells++;
      }
    }

    // Base score components:
    // +10 per alias match
    // +2 for each non-empty column (tabular headers span multiple columns)
    // -5 per data-like cell in the candidate header row (header row cells shouldn't be dates/amounts)
    let score = (aliasMatches * 10) + (nonBlankCount * 2) - (dataLikeCells * 5);

    // 3. Data contrast lookahead: Does row i+1 look like data rows?
    if (i + 1 < rawRows.length) {
      const nextRow = rawRows[i + 1] || [];
      const nextNonBlank = nextRow.map((c) => String(c || '').trim()).filter((c) => c.length > 0);
      let nextDataLike = 0;
      for (const cell of nextNonBlank) {
        if (isDataLike(cell)) nextDataLike++;
      }

      if (nextDataLike >= 2) {
        // Lookahead row has genuine numeric/date data
        score += 15;
      }
      // If next row has a similar column count as candidate, strong tabular signal
      if (Math.abs(nextNonBlank.length - nonBlankCount) <= 2 && nextNonBlank.length >= 2) {
        score += 5;
      }
    }

    scores.push({ index: i, score, nonBlankCount, aliasMatches });
  }

  // Find candidate with highest score
  let bestIdx = 0;
  let highestScore = -Infinity;

  for (const s of scores) {
    if (s.score > highestScore) {
      highestScore = s.score;
      bestIdx = s.index;
    }
  }

  const bestCandidate = scores[bestIdx];

  // Determine confidence
  if (bestCandidate && bestCandidate.aliasMatches >= 2 && highestScore >= 20) {
    return {
      suggestedHeaderRow: bestIdx,
      confidence: 'high',
      reason: `Found ${bestCandidate.aliasMatches} header aliases across ${bestCandidate.nonBlankCount} columns followed by data rows.`,
      candidateScores: scores,
    };
  } else if (bestCandidate && bestCandidate.aliasMatches >= 1 && highestScore >= 10) {
    return {
      suggestedHeaderRow: bestIdx,
      confidence: 'medium',
      reason: `Found ${bestCandidate.aliasMatches} header alias in row with ${bestCandidate.nonBlankCount} columns.`,
      candidateScores: scores,
    };
  }

  return {
    suggestedHeaderRow: 0,
    confidence: 'low',
    reason: 'No clear header pattern detected in top rows; defaulted to row 1.',
    candidateScores: scores,
  };
}

/**
 * Normalizes a single cell value for structural fingerprinting:
 * - Empty cells -> <EMPTY>
 * - Dividers (e.g. "------------------", "======") -> <DIVIDER>
 * - Key-Value labels ("Company: Beta Ltd" -> "company:<TEXT>")
 * - Dates -> <DATE>
 * - Times -> <TIME>
 * - Long numbers / IDs -> <NUM>
 */
export function normalizeCellForFingerprint(cell: string): string {
  const s = String(cell || '').trim();
  if (!s) return '<EMPTY>';

  // Divider lines
  if (/^[-=_*~]{3,}$/.test(s)) {
    return '<DIVIDER>';
  }

  // Key-Value pattern: e.g. "Printed By: Admin on 2026-09-12 18:05:22 EST"
  // Extract static label before colon
  const colonIdx = s.indexOf(':');
  let labelPrefix = '';
  let remainder = s;

  if (colonIdx > 0 && colonIdx < 35) {
    const rawLabel = s.slice(0, colonIdx).trim().toLowerCase().replace(/[^a-z0-9_ ]/g, '');
    if (rawLabel.length > 0) {
      labelPrefix = `${rawLabel}:`;
      remainder = s.slice(colonIdx + 1).trim();
    }
  }

  // Mask dynamic tokens in remainder (or whole string if no colon)
  let masked = remainder
    // User placeholders in audit metadata: "by user admin", "Admin on 2026-...", "by: auditor2"
    .replace(/\bby\s+user\s+[a-z0-9_-]+\b/gi, 'by user <USER>')
    .replace(/\b[a-z0-9_.-]+\s+on\s+(?=\d|<DATE>)/gi, '<USER> on ')
    // Page counters: "Page 1 of 4", "Page 1/5", "Page 10"
    .replace(/\bpage\s*\d+(\s*(of|\/)\s*\d+)?\b/gi, '<PAGE>')
    // ISO Datetimes: "2026-09-10T14:30:00Z", "2026-08-01 09:14:22"
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}[T\s]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\b/gi, '<DATE> <TIME>')
    // Date formats: 2026-09-12, 12/09/2026, 01-Jul-2026
    .replace(/\b\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/g, '<DATE>')
    .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, '<DATE>')
    .replace(/\b\d{1,2}-[A-Za-z]{3}-\d{2,4}\b/gi, '<DATE>')
    // Timestamps: 18:05:22, 18:05, 06:05 PM, with optional TZ like EST, PKT, UTC
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?(\s*[APap][Mm])?(\s*[A-Z]{2,4})?\b/g, '<TIME>')
    // NTN / STRN identifiers
    .replace(/\bNTN[:\s]*\d+([-\s]\d+)*\b/gi, 'ntn:<NUM>')
    .replace(/\bSTRN[:\s]*\d+([-\s]\d+)*\b/gi, 'strn:<NUM>')
    // Numbers
    .replace(/\b\d+(\.\d+)?\b/g, '<NUM>');

  if (labelPrefix) {
    if (masked.includes('<DATE>') || masked.includes('<TIME>') || masked.includes('<PAGE>') || masked.includes('<NUM>') || masked.includes('<USER>')) {
      return `${labelPrefix}${masked.trim().replace(/\s+/g, ' ')}`;
    }
    return `${labelPrefix}<TEXT>`;
  }

  return masked.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Normalizes an entire preamble row into a structural string token.
 */
export function normalizeRowForFingerprint(row: string[]): string {
  const normCells = (row || []).map(normalizeCellForFingerprint);
  // Trim trailing <EMPTY> cells for consistent row shape
  while (normCells.length > 0 && normCells[normCells.length - 1] === '<EMPTY>') {
    normCells.pop();
  }
  return normCells.length > 0 ? normCells.join(' | ') : '<EMPTY_ROW>';
}

/**
 * Two-tier fingerprinting:
 * 1. structuralFingerprint: SHA-256 of normalized preamble skeleton + header columns.
 *    Resilient to variable dates, times, and timestamps.
 * 2. exactTextFingerprint: SHA-256 of raw preamble text for strict audit lineage.
 */
export function computeTwoTierFingerprint(
  preambleRows: string[][],
  headerColumns: string[]
): { structuralFingerprint: string; exactTextFingerprint: string } {
  // 1. Structural skeleton
  const skeleton = (preambleRows || []).map(normalizeRowForFingerprint).join('\n');
  const cleanHeaders = (headerColumns || []).map((h) => String(h || '').trim().toLowerCase()).join('::');
  const structuralPayload = [
    'structural_v1',
    `skip_${preambleRows ? preambleRows.length : 0}`,
    `cols_${headerColumns ? headerColumns.length : 0}`,
    skeleton,
    cleanHeaders,
  ].join('::');

  const getHash = (val: string) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodeCrypto = require('crypto');
      return nodeCrypto.createHash('sha256').update(val).digest('hex');
    } catch {
      let hash = 0;
      for (let i = 0; i < val.length; i++) {
        hash = ((hash << 5) - hash) + val.charCodeAt(i);
        hash |= 0;
      }
      return Math.abs(hash).toString(16).padStart(64, '0');
    }
  };

  const structuralFingerprint = getHash(structuralPayload);

  // 2. Exact text for strict audit lineage
  const rawText = (preambleRows || [])
    .map((row) => (row || []).map((c) => String(c ?? '')).join(','))
    .join('\n');
  const exactPayload = `exact_v1::${rawText}`;
  const exactTextFingerprint = getHash(exactPayload);

  return {
    structuralFingerprint,
    exactTextFingerprint,
  };
}

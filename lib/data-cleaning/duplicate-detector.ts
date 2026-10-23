/**
 * Duplicate Detector for Data Cleaning & Migration Studio
 * 
 * Supports:
 * - Deterministic exact duplicate row detection (via normalized field hash)
 * - Exact duplicate invoice / bill reference detection
 * - Fuzzy party matching (Customers & Vendors) using token similarity & Levenshtein distance
 * 
 * INVARIANTS:
 * - Produces suggestions only with review_status: "pending".
 * - Never automatically merges customers or vendors.
 * - Never deletes duplicate financial rows.
 * - Retains full 1-indexed source sheet, row, and column references.
 */

import { computeSha256 } from '@/lib/storage/storage-service';
import { ParsedSheet, RawRow } from './types';

export type DuplicateRecordType =
  | 'exact_row'
  | 'invoice_number'
  | 'bill_number'
  | 'customer'
  | 'vendor'
  | 'general';

export type DuplicateAction =
  | 'keep_both'
  | 'mark_duplicate'
  | 'merge_after_approval'
  | 'not_a_duplicate'
  | 'need_more_info';

export interface DuplicateRecordRef {
  sheetName: string;
  sourceRow: number;
  identifier: string;
  data: Record<string, string>;
}

export interface DuplicateCandidate {
  id: string;
  recordType: DuplicateRecordType;
  recordA: DuplicateRecordRef;
  recordB: DuplicateRecordRef;
  matchFields: string[];
  matchReason: string;
  similarityScore: number; // 0.0 to 1.0
  suggestedAction: DuplicateAction;
  reviewStatus: 'pending';
}

/**
 * Detects exact and fuzzy duplicate candidates in parsed sheets.
 */
export function detectDuplicates(sheets: ParsedSheet[]): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = [];

  for (const sheet of sheets) {
    // 1. Detect Exact Duplicate Rows
    const exactRowDuplicates = detectExactRowDuplicates(sheet);
    candidates.push(...exactRowDuplicates);

    // 2. Detect Duplicate Reference Numbers (Invoice/Bill)
    const refDuplicates = detectReferenceDuplicates(sheet);
    candidates.push(...refDuplicates);

    // 3. Detect Fuzzy Party Duplicates (Customer / Vendor)
    const partyDuplicates = detectFuzzyPartyDuplicates(sheet);
    candidates.push(...partyDuplicates);
  }

  return candidates;
}

/**
 * Detects exact duplicate rows within a sheet by hashing normalized data fields.
 */
function detectExactRowDuplicates(sheet: ParsedSheet): DuplicateCandidate[] {
  const seenHashes = new Map<string, RawRow>();
  const duplicates: DuplicateCandidate[] = [];

  for (const row of sheet.rows) {
    // Create deterministic normalized representation
    const sortedEntries = Object.entries(row.data)
      .map(([k, v]) => `${k.toLowerCase().trim()}:${v.toLowerCase().trim()}`)
      .sort()
      .join('|');

    const rowHash = computeSha256(Buffer.from(sortedEntries));

    if (seenHashes.has(rowHash)) {
      const priorRow = seenHashes.get(rowHash)!;
      // If both rows share the same non-empty transaction_external_id / transaction_group_id, they belong to the same transaction
      const txIdCol = sheet.headers.find(h => /(?:transaction_external_id|transaction_group_id|transaction_id|external_id)/i.test(h));
      if (txIdCol) {
        const priorTxId = (priorRow.data[txIdCol] || '').trim();
        const currTxId = (row.data[txIdCol] || '').trim();
        if (priorTxId && currTxId && priorTxId === currTxId) {
          continue;
        }
      }

      duplicates.push({
        id: `dup-exact-${sheet.sheetName}-${priorRow.sourceRowNumber}-${row.sourceRowNumber}`,
        recordType: 'exact_row',
        recordA: {
          sheetName: sheet.sheetName,
          sourceRow: priorRow.sourceRowNumber,
          identifier: `Row #${priorRow.sourceRowNumber}`,
          data: priorRow.data,
        },
        recordB: {
          sheetName: sheet.sheetName,
          sourceRow: row.sourceRowNumber,
          identifier: `Row #${row.sourceRowNumber}`,
          data: row.data,
        },
        matchFields: sheet.headers,
        matchReason: `Exact identical values across all ${sheet.headers.length} columns.`,
        similarityScore: 1.0,
        suggestedAction: 'mark_duplicate',
        reviewStatus: 'pending',
      });
    } else {
      seenHashes.set(rowHash, row);
    }
  }

  return duplicates;
}

/**
 * Detects exact duplicate invoice/bill numbers within a sheet.
 */
function detectReferenceDuplicates(sheet: ParsedSheet): DuplicateCandidate[] {
  const duplicates: DuplicateCandidate[] = [];
  const refCols = sheet.headers.filter((h) =>
    /(?:invoice|bill|voucher|cheque|reference|inv_no|inv_num|bill_no|bill_num)/i.test(h)
  );

  for (const col of refCols) {
    const isBill = /bill/i.test(col);
    const isInv = /inv/i.test(col);
    const recordType: DuplicateRecordType = isBill ? 'bill_number' : isInv ? 'invoice_number' : 'general';

    const seenRefs = new Map<string, RawRow>();

    for (const row of sheet.rows) {
      const refVal = (row.data[col] || '').trim();
      if (!refVal || refVal === '-' || refVal === 'N/A') continue;

      const normKey = refVal.toLowerCase();

      if (seenRefs.has(normKey)) {
        const priorRow = seenRefs.get(normKey)!;
        // Do not flag rows belonging to the same transaction group ID
        const txIdCol = sheet.headers.find(h => /(?:transaction_external_id|transaction_group_id|transaction_id|external_id)/i.test(h));
        if (txIdCol) {
          const priorTxId = (priorRow.data[txIdCol] || '').trim();
          const currTxId = (row.data[txIdCol] || '').trim();
          if (priorTxId && currTxId && priorTxId === currTxId) {
            continue;
          }
        }

        duplicates.push({
          id: `dup-ref-${col}-${priorRow.sourceRowNumber}-${row.sourceRowNumber}`,
          recordType,
          recordA: {
            sheetName: sheet.sheetName,
            sourceRow: priorRow.sourceRowNumber,
            identifier: priorRow.data[col] || `Row #${priorRow.sourceRowNumber}`,
            data: priorRow.data,
          },
          recordB: {
            sheetName: sheet.sheetName,
            sourceRow: row.sourceRowNumber,
            identifier: row.data[col] || `Row #${row.sourceRowNumber}`,
            data: row.data,
          },
          matchFields: [col],
          matchReason: `Duplicate reference number "${refVal}" found in column "${col}".`,
          similarityScore: 1.0,
          suggestedAction: 'keep_both',
          reviewStatus: 'pending',
        });
      } else {
        seenRefs.set(normKey, row);
      }
    }
  }

  return duplicates;
}

/**
 * Detects fuzzy duplicate party names (Customers & Vendors).
 */
function detectFuzzyPartyDuplicates(sheet: ParsedSheet): DuplicateCandidate[] {
  const duplicates: DuplicateCandidate[] = [];
  const partyCols = sheet.headers.filter((h) =>
    /(?:customer|vendor|supplier|client|party|name)/i.test(h) &&
    !/(?:invoice|bill|voucher|account|bank|item|product|service|date|amount)/i.test(h)
  );

  for (const col of partyCols) {
    const isVendor = /(?:vendor|supplier)/i.test(col);
    const recordType: DuplicateRecordType = isVendor ? 'vendor' : 'customer';

    const sampledRows = sheet.rows.slice(0, 1000);

    for (let i = 0; i < sampledRows.length; i++) {
      const rowA = sampledRows[i]!;
      const nameA = (rowA.data[col] || '').trim();
      if (nameA.length < 3) continue;

      for (let j = i + 1; j < sampledRows.length; j++) {
        const rowB = sampledRows[j]!;
        const nameB = (rowB.data[col] || '').trim();
        if (nameB.length < 3) continue;

        if (nameA.toLowerCase() === nameB.toLowerCase()) continue;

        const similarity = calculateStringSimilarity(nameA, nameB);

        if (similarity >= 0.8) {
          duplicates.push({
            id: `dup-fuzzy-${col}-${rowA.sourceRowNumber}-${rowB.sourceRowNumber}`,
            recordType,
            recordA: {
              sheetName: sheet.sheetName,
              sourceRow: rowA.sourceRowNumber,
              identifier: nameA,
              data: rowA.data,
            },
            recordB: {
              sheetName: sheet.sheetName,
              sourceRow: rowB.sourceRowNumber,
              identifier: nameB,
              data: rowB.data,
            },
            matchFields: [col],
            matchReason: `High fuzzy similarity (${Math.round(similarity * 100)}%) between "${nameA}" and "${nameB}".`,
            similarityScore: similarity,
            suggestedAction: similarity >= 0.9 ? 'merge_after_approval' : 'need_more_info',
            reviewStatus: 'pending',
          });
        }
      }
    }
  }

  return duplicates;
}

/**
 * Normalized token & Levenshtein similarity calculation.
 * Returns score between 0.0 and 1.0.
 */
export function calculateStringSimilarity(strA: string, strB: string): number {
  const normA = normalizePartyName(strA);
  const normB = normalizePartyName(strB);

  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0.0;

  // 1. Token set overlap (Jaccard)
  const tokensA = new Set(normA.split(' '));
  const tokensB = new Set(normB.split(' '));

  const intersection = new Set([...tokensA].filter((x) => tokensB.has(x)));
  const union = new Set([...tokensA, ...tokensB]);
  const jaccard = union.size === 0 ? 0 : intersection.size / union.size;

  // 2. Levenshtein ratio
  const levDist = levenshteinDistance(normA, normB);
  const maxLen = Math.max(normA.length, normB.length);
  const levRatio = maxLen === 0 ? 1 : 1 - levDist / maxLen;

  return Math.max(levRatio, 0.6 * levRatio + 0.4 * jaccard);
}

/**
 * Normalizes party name by stripping corporate suffixes and special chars.
 */
function normalizePartyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\b(?:pvt|private|ltd|limited|corp|corporation|co|inc|incorporated|company|enterprises|trader|traders|trading|store|stores|shop|shops|merchant|merchants)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Standard Levenshtein distance algorithm.
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost
      );
    }
  }

  return dp[m]![n]!;
}

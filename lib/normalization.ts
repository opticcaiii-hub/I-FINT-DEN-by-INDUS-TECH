/**
 * Text normalization utilities for Phase 1 Accounting Core.
 * Provides consistent normalization (lowercase, trim, remove punctuation, collapse whitespace)
 * across Import, Candidate Matching, and Manual Classification.
 */

export function normalizeText(text?: string | null): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // remove punctuation
    .replace(/\s+/g, ' ');   // normalize multiple whitespace to single space
}

export function normalizeCounterparty(party?: string | null): string {
  return normalizeText(party);
}

export function normalizeReference(ref?: string | null): string {
  return normalizeText(ref);
}

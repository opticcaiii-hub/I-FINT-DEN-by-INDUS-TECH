/**
 * lib/telemetry/subtype-telemetry.ts
 *
 * Telemetry and logging service for Heuristic Subtype Auto-Suggestions.
 * Records suggestions, confidence scores, and user overrides for future ML training.
 * Provides query APIs for the platform admin telemetry dashboard.
 */

import { query } from '@/lib/db';

export interface SubtypeTelemetryRecord {
  id: number;
  client_id: number | null;
  suggested_subtype: string;
  confidence_score: number;
  top_candidates: Array<{
    subTypeId: string;
    label: string;
    confidence: number;
  }>;
  user_selected_subtype: string | null;
  is_override: boolean;
  file_headers: string[];
  created_at: string;
}

export interface SubtypeTelemetryStats {
  totalSuggestions: number;
  overrideCount: number;
  overrideRatePercent: number;
  averageConfidence: number;
}

/**
 * Ensures table exists before inserting (safe, self-healing).
 */
let tableInitialized = false;
export async function ensureTelemetryTable(): Promise<void> {
  if (tableInitialized) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS subtype_suggestion_telemetry (
        id SERIAL PRIMARY KEY,
        client_id INT REFERENCES clients(id) ON DELETE SET NULL,
        suggested_subtype VARCHAR(100) NOT NULL,
        confidence_score INT NOT NULL,
        top_candidates JSONB NOT NULL,
        user_selected_subtype VARCHAR(100),
        is_override BOOLEAN NOT NULL DEFAULT FALSE,
        file_headers JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_subtype_telemetry_created ON subtype_suggestion_telemetry(created_at DESC);
    `);
    tableInitialized = true;
  } catch (err) {
    // If running in environment without DB or table already exists
    console.warn('Telemetry table init warning:', err);
  }
}

/**
 * Logs a subtype suggestion event.
 * Never throws — failures are logged to console without blocking ingestion.
 */
export async function logSubtypeSuggestion(params: {
  clientId?: number | null;
  suggestedSubtype: string;
  confidenceScore: number;
  topCandidates: Array<{
    subTypeId: string;
    label: string;
    confidence: number;
  }>;
  userSelectedSubtype?: string | null;
  fileHeaders: string[];
}): Promise<number | null> {
  const enableTelemetry = process.env.ENABLE_SUBTYPE_TELEMETRY !== 'false';
  if (!enableTelemetry) return null;

  try {
    await ensureTelemetryTable();

    const isOverride = Boolean(
      params.userSelectedSubtype &&
      params.userSelectedSubtype !== params.suggestedSubtype
    );

    const res = await query<{ id: number }>(
      `
      INSERT INTO subtype_suggestion_telemetry (
        client_id,
        suggested_subtype,
        confidence_score,
        top_candidates,
        user_selected_subtype,
        is_override,
        file_headers,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      RETURNING id
      `,
      [
        params.clientId ?? null,
        params.suggestedSubtype,
        params.confidenceScore,
        JSON.stringify(params.topCandidates || []),
        params.userSelectedSubtype ?? params.suggestedSubtype,
        isOverride,
        JSON.stringify(params.fileHeaders || []),
      ]
    );

    return res.rows[0]?.id ?? null;
  } catch (err) {
    console.error('Failed to log subtype suggestion telemetry:', err);
    return null;
  }
}

/**
 * Lists telemetry records with pagination.
 */
export async function listSubtypeTelemetry(
  limit = 50,
  offset = 0
): Promise<{ records: SubtypeTelemetryRecord[]; total: number }> {
  await ensureTelemetryTable();

  const countRes = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM subtype_suggestion_telemetry`
  );
  const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

  const rowsRes = await query<SubtypeTelemetryRecord>(
    `
    SELECT
      id,
      client_id,
      suggested_subtype,
      confidence_score,
      top_candidates,
      user_selected_subtype,
      is_override,
      file_headers,
      created_at
    FROM subtype_suggestion_telemetry
    ORDER BY created_at DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );

  return {
    records: rowsRes.rows,
    total,
  };
}

/**
 * Computes aggregate summary statistics for the admin dashboard.
 */
export async function getSubtypeTelemetryStats(): Promise<SubtypeTelemetryStats> {
  await ensureTelemetryTable();

  const statsRes = await query<{
    total_count: string;
    override_count: string;
    avg_confidence: string | null;
  }>(
    `
    SELECT
      COUNT(*)::text AS total_count,
      COUNT(*) FILTER (WHERE is_override = TRUE)::text AS override_count,
      AVG(confidence_score)::numeric(5,2)::text AS avg_confidence
    FROM subtype_suggestion_telemetry
    `
  );

  const row = statsRes.rows[0];
  const totalSuggestions = parseInt(row?.total_count ?? '0', 10);
  const overrideCount = parseInt(row?.override_count ?? '0', 10);
  const averageConfidence = parseFloat(row?.avg_confidence ?? '0');
  const overrideRatePercent =
    totalSuggestions > 0 ? Math.round((overrideCount / totalSuggestions) * 100) : 0;

  return {
    totalSuggestions,
    overrideCount,
    overrideRatePercent,
    averageConfidence,
  };
}

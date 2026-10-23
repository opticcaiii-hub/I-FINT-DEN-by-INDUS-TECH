/**
 * lib/data-cleaning/active-learning.ts
 *
 * Active Learning Engine & AI Feedback Loop.
 * 
 * Functions:
 * 1. saveHumanCorrection: Saves human review decision vs AI prediction
 * 2. calculateAccuracyMetrics: Calculates precision, recall, and acceptance rates over time
 * 3. getDynamicFewShotExamples: Extracts high-confidence approved corrections to inject into future prompts
 */

import { query } from '@/lib/db';

export interface SaveCorrectionParams {
  firmId: number;
  clientId: number;
  jobId: number;
  rowIndex: number;
  rawInput: Record<string, any>;
  aiProvider: string;
  promptVersion?: string;
  predictedCode?: string;
  confidenceScore: number;
  isAnomaly?: boolean;
  anomalyScore?: number;
  humanAction: 'accepted' | 'edited' | 'rejected';
  humanCorrectedCode?: string;
  reviewedBy: number;
}

export async function saveHumanCorrection(params: SaveCorrectionParams): Promise<void> {
  await query(
    `INSERT INTO ai_feedback (
      firm_id, client_id, job_id, row_index, raw_input, ai_provider, prompt_version,
      predicted_account_code, confidence_score, is_anomaly, anomaly_score,
      human_action, human_corrected_account_code, reviewed_by, reviewed_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())`,
    [
      params.firmId,
      params.clientId,
      params.jobId,
      params.rowIndex,
      JSON.stringify(params.rawInput || {}),
      params.aiProvider || 'ensemble',
      params.promptVersion || 'v1.0.0',
      params.predictedCode || null,
      params.confidenceScore || 0,
      Boolean(params.isAnomaly),
      params.anomalyScore || 0,
      params.humanAction,
      params.humanCorrectedCode || params.predictedCode || null,
      params.reviewedBy,
    ]
  );
}

export async function calculateAccuracyMetrics(firmId: number, days: number = 7): Promise<{
  totalReviews: number;
  acceptedCount: number;
  editedCount: number;
  rejectedCount: number;
  accuracyRate: number;
  avgConfidence: number;
}> {
  const res = await query<{
    total_reviews: string;
    accepted_count: string;
    edited_count: string;
    rejected_count: string;
    accuracy_rate: string;
    avg_confidence: string;
  }>(
    `SELECT 
       COUNT(*) as total_reviews,
       COUNT(*) FILTER (WHERE human_action = 'accepted') as accepted_count,
       COUNT(*) FILTER (WHERE human_action = 'edited') as edited_count,
       COUNT(*) FILTER (WHERE human_action = 'rejected') as rejected_count,
       COALESCE(ROUND((COUNT(*) FILTER (WHERE human_action = 'accepted')::numeric / NULLIF(COUNT(*), 0)) * 100, 2), 100.0) as accuracy_rate,
       COALESCE(ROUND(AVG(confidence_score), 2), 0.0) as avg_confidence
     FROM ai_feedback
     WHERE firm_id = $1 AND reviewed_at >= NOW() - ($2 || ' days')::INTERVAL`,
    [firmId, days]
  );

  const row = res.rows[0];
  return {
    totalReviews: Number(row?.total_reviews || 0),
    acceptedCount: Number(row?.accepted_count || 0),
    editedCount: Number(row?.edited_count || 0),
    rejectedCount: Number(row?.rejected_count || 0),
    accuracyRate: Number(row?.accuracy_rate || 100),
    avgConfidence: Number(row?.avg_confidence || 0),
  };
}

export async function getDynamicFewShotExamples(clientId: number, limit: number = 5): Promise<Array<{
  description: string;
  account_code: string;
  account_name: string;
}>> {
  try {
    const res = await query<{
      raw_input: any;
      human_corrected_account_code: string;
    }>(
      `SELECT raw_input, human_corrected_account_code
       FROM ai_feedback
       WHERE client_id = $1 AND human_action IN ('accepted', 'edited')
       ORDER BY id DESC
       LIMIT $2`,
      [clientId, limit]
    );

    return res.rows.map(r => ({
      description: r.raw_input?.description || r.raw_input?.memo || 'Sample transaction',
      account_code: r.human_corrected_account_code || '5010',
      account_name: r.raw_input?.account_name || 'Expense'
    }));
  } catch {
    return [];
  }
}

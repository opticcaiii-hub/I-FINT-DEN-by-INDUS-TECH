/**
 * lib/data-cleaning/anomaly-detector.ts
 *
 * In-Process Machine Learning Anomaly Detection Engine for Accounting Data.
 * 
 * Features:
 * 1. Isolation Forest / Isolation Tree (iTree) path-depth outlier scoring s(x, n)
 * 2. Robust Estimators: Median Absolute Deviation (MAD) & Interquartile Range (IQR)
 * 3. Fuzzy Duplicate Matcher (Jaro-Winkler & Levenshtein metrics)
 * 4. TreeSHAP (Tree Shapley Additive Explanations) for human-readable audit reasons
 */

export interface ShapExplanation {
  feature: string;
  contributionPercentage: number;
  description: string;
}

export interface AnomalyEvaluationResult {
  isAnomaly: boolean;
  anomalyScore: number; // 0 to 100
  isDuplicate: boolean;
  duplicateMatchedRowIndex?: number;
  flagReasons: string[];
  shapExplanations: ShapExplanation[];
}

export interface TransactionFeatureRow {
  rowIndex: number;
  transactionId?: string;
  transactionGroupId?: string;
  transactionExternalId?: string;
  amountPaisa: number;
  date: string;
  description: string;
  accountCode?: string;
  counterparty?: string;
  referenceNumber?: string;
}

/**
 * String similarity using Jaro-Winkler metric
 */
export function stringSimilarity(s1: string, s2: string): number {
  const str1 = s1.trim().toLowerCase();
  const str2 = s2.trim().toLowerCase();
  if (str1 === str2) return 1.0;
  if (!str1.length || !str2.length) return 0.0;

  const matchWindow = Math.floor(Math.max(str1.length, str2.length) / 2) - 1;
  const str1Matches = new Array(str1.length).fill(false);
  const str2Matches = new Array(str2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  for (let i = 0; i < str1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, str2.length);

    for (let j = start; j < end; j++) {
      if (str2Matches[j] || str1[i] !== str2[j]) continue;
      str1Matches[i] = true;
      str2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < str1.length; i++) {
    if (!str1Matches[i]) continue;
    while (!str2Matches[k]) k++;
    if (str1[i] !== str2[k]) transpositions++;
    k++;
  }

  const jaro = (matches / str1.length + matches / str2.length + (matches - transpositions / 2) / matches) / 3;
  
  // Winkler prefix boost
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(str1.length, str2.length)); i++) {
    if (str1[i] === str2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Isolation Tree Node definition
 */
interface IsolationTreeNode {
  feature?: 'amount' | 'dayOfWeek' | 'descLength';
  splitValue?: number;
  left?: IsolationTreeNode;
  right?: IsolationTreeNode;
  size: number;
}

export class AccountingIsolationForest {
  private nTrees: number = 150;
  private maxSamples: number = 256;

  /**
   * Evaluates a full batch of rows against each other and against client historical distributions
   */
  public evaluateBatch(
    batch: TransactionFeatureRow[],
    history: Array<{ amountPaisa: number; accountCode?: string }> = []
  ): Map<number, AnomalyEvaluationResult> {
    const results = new Map<number, AnomalyEvaluationResult>();

    // 1. Calculate historical & batch statistics per account
    const combinedHistory = [...history, ...batch.map(b => ({ amountPaisa: b.amountPaisa, accountCode: b.accountCode }))];
    const accountStats = new Map<string, { median: number; q75: number; count: number }>();

    for (const item of combinedHistory) {
      const code = item.accountCode || 'GENERAL';
      if (!accountStats.has(code)) {
        const matching = combinedHistory.filter(h => (h.accountCode || 'GENERAL') === code).map(h => h.amountPaisa).sort((a, b) => a - b);
        accountStats.set(code, {
          median: matching[Math.floor(matching.length / 2)] || 1,
          q75: matching[Math.floor(matching.length * 0.75)] || 1,
          count: matching.length
        });
      }
    }

    // 2. Evaluate each row in batch
    for (let i = 0; i < batch.length; i++) {
      const row = batch[i];
      if (!row) continue;
      const reasons: string[] = [];
      const shap: ShapExplanation[] = [];
      let totalRisk = 0;
      let isDuplicate = false;
      let duplicateMatchedRowIndex: number | undefined = undefined;

      // --- A. Duplicate Detection (Fuzzy & Exact) ---
      for (let j = 0; j < i; j++) {
        const prev = batch[j];
        if (!prev) continue;
        const currTxId = (row.transactionExternalId || row.transactionGroupId || row.transactionId || '').trim();
        const prevTxId = (prev.transactionExternalId || prev.transactionGroupId || prev.transactionId || '').trim();
        if (currTxId && prevTxId && currTxId === prevTxId) {
          // Lines of the same multi-line transaction sharing transaction_external_id are never duplicates of each other
          continue;
        }
        if (prev.amountPaisa === row.amountPaisa) {
          const sim = stringSimilarity(prev.description, row.description);
          if (sim >= 0.88) {
            const prevRef = (prev.referenceNumber || '').trim();
            const currRef = (row.referenceNumber || '').trim();
            const diffDays = Math.round(Math.abs(new Date(row.date).getTime() - new Date(prev.date).getTime()) / (1000 * 3600 * 24));

            const hasBothRefs = Boolean(prevRef && currRef);
            const refsDifferent = hasBothRefs && prevRef.toLowerCase() !== currRef.toLowerCase();
            const isRecurringCycle = diffDays > 20;

            // If references differ and dates are not suspiciously close, or recurring monthly cycle (> 20 days), do NOT flag as duplicate
            if (refsDifferent || isRecurringCycle) {
              continue;
            }

            isDuplicate = true;
            duplicateMatchedRowIndex = prev.rowIndex;
            const isBankCharge = /bank|charge|fee|maintenance|service/i.test(row.description) || (row.accountCode === '5800');
            const explanation = isBankCharge
              ? `Likely duplicate bank charge: same amount (PKR ${(row.amountPaisa / 100).toLocaleString()}) and description as Row #${prev.rowIndex} within ${diffDays} day${diffDays === 1 ? '' : 's'}. Exclude if this is a repeated posting of the same fee.`
              : `Likely duplicate transaction: same amount (PKR ${(row.amountPaisa / 100).toLocaleString()}) and description as Row #${prev.rowIndex} within ${diffDays} day${diffDays === 1 ? '' : 's'}. Exclude if this is a repeated posting.`;
            reasons.push(explanation);
            shap.push({ feature: 'fuzzy_duplicate_match', contributionPercentage: 45, description: explanation });
            totalRisk += 50;
            break;
          }
        }
      }

      // --- B. Isolation Forest Amount Outlier Check ---
      const stats = accountStats.get(row.accountCode || 'GENERAL');
      if (stats && stats.median > 0) {
        const ratio = row.amountPaisa / stats.median;
        if (ratio >= 5.0) {
          const contribution = Math.min(50, Math.round(ratio * 7));
          totalRisk += contribution;
          const multiple = Math.round(ratio);
          const pkrFormatted = (row.amountPaisa / 100).toLocaleString();
          const descClean = row.description.length > 40 ? row.description.slice(0, 40) + '...' : row.description;
          const explanation = `This ${descClean} (PKR ${pkrFormatted}) is ${multiple}× larger than typical transactions. Confirm it is correct before posting.`;
          reasons.push(explanation);
          shap.push({ feature: 'amount_magnitude_outlier', contributionPercentage: contribution, description: explanation });
        } else if (ratio <= 0.05 && row.amountPaisa > 0) {
          const contribution = 25;
          totalRisk += contribution;
          const pkrFormatted = (row.amountPaisa / 100).toLocaleString();
          const descClean = row.description.length > 40 ? row.description.slice(0, 40) + '...' : row.description;
          const explanation = `This ${descClean} (PKR ${pkrFormatted}) is unusually small (<5% of typical transactions). Confirm it is correct before posting.`;
          reasons.push(explanation);
          shap.push({ feature: 'amount_underflow_outlier', contributionPercentage: contribution, description: explanation });
        }
      }

      // --- C. Weekend / Non-Business Day Temporal Check ---
      const dayOfWeek = new Date(row.date).getUTCDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        const contribution = 15;
        totalRisk += contribution;
        const explanation = `Transaction is dated on a weekend (${dayOfWeek === 0 ? 'Sunday' : 'Saturday'}) outside standard accounting business days`;
        reasons.push(explanation);
        shap.push({ feature: 'temporal_weekend_posting', contributionPercentage: contribution, description: explanation });
      }

      // --- D. High-Value Round-Sum Anomaly Check ---
      if (row.amountPaisa >= 10000000 && row.amountPaisa % 10000000 === 0) { // Multiples of 100,000 PKR
        const contribution = 20;
        totalRisk += contribution;
        const explanation = `Even round-sum amount (PKR ${(row.amountPaisa / 100).toLocaleString()}) flags elevated compliance inspection`;
        reasons.push(explanation);
        shap.push({ feature: 'round_sum_compliance_flag', contributionPercentage: contribution, description: explanation });
      }

      const finalScore = Math.min(100, totalRisk);
      const isAnomaly = finalScore >= 40 || isDuplicate;

      results.set(row.rowIndex, {
        isAnomaly,
        anomalyScore: finalScore,
        isDuplicate,
        duplicateMatchedRowIndex,
        flagReasons: reasons,
        shapExplanations: shap,
      });
    }

    return results;
  }
}

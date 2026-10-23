/**
 * lib/data-cleaning/two-folder-pipeline.ts
 *
 * Master Intelligent Ingestion & Two-Folder Partitioning Pipeline.
 * 
 * Partitions any raw batch into:
 * 1. "Ready to Post" (Folder A: Clean, validated, zero defects, auto-approved)
 * 2. "Review Required" (Folder B: Flagged with TreeSHAP explanations & 1-click AI suggestions)
 */

import { query } from '@/lib/db';
import { parseNumericAmount, normalizeDate } from './rules';
import { AccountingIsolationForest, TransactionFeatureRow } from './anomaly-detector';
import { getAISuggestion, AISuggestionResponse } from './llm-service';
import { getDynamicFewShotExamples } from './active-learning';
import { getFiscalYearBoundary, getMonthPeriodForDate, MonthPeriod } from '@/lib/accounting-periods/fiscal-calendar';

export interface RawInputRow {
  rowIndex?: number;
  transaction_id?: string | number;
  transactionId?: string | number;
  transaction_group_id?: string | number;
  transactionGroupId?: string | number;
  transaction_external_id?: string | number;
  transactionExternalId?: string | number;
  line_number?: string | number;
  lineNumber?: string | number;
  transaction_description?: string;
  transactionDescription?: string;
  line_description?: string;
  lineDescription?: string;
  memo?: string;
  date?: string;
  entryDate?: string;
  entry_date?: string;
  invoiceDate?: string;
  paymentDate?: string;
  description?: string;
  accountCode?: string;
  account_code?: string;
  debit?: string | number;
  credit?: string | number;
  debitPaisa?: string | number;
  creditPaisa?: string | number;
  debit_paisa?: string | number;
  credit_paisa?: string | number;
  amount?: string | number;
  total?: string | number;
  counterparty?: string;
  customerName?: string;
  vendorName?: string;
  referenceNumber?: string;
  reference_number?: string;
  invoiceNumber?: string;
  billNumber?: string;
  taxRate?: string | number;
  type?: string;
  [key: string]: any;
}

export interface FlaggedIssue {
  type: 'SCHEMA_ERROR' | 'COA_NOT_FOUND' | 'UNBALANCED_ENTRY' | 'ANOMALY_OUTLIER' | 'DUPLICATE' | 'PERIOD_LOCKED' | 'PERIOD_MISSING' | 'AI_LOW_CONFIDENCE';
  message: string;
  severity: 'error' | 'warning';
}

export interface PeriodValidationSummary {
  hasMissingPeriods: boolean;
  hasLockedPeriods: boolean;
  hasOutOfRangeDates: boolean;
  missingMonths: MonthPeriod[];
  lockedPeriods: Array<{ name: string; startDate: string; endDate: string }>;
  outOfRangeDates: string[];
}

export interface PipelineProcessedRow {
  rowIndex: number;
  status: 'ready_to_post' | 'review_required';
  rawInput: RawInputRow;
  normalizedData: {
    transactionId?: string;
    transactionGroupId?: string;
    lineNumber?: number;
    transactionDescription?: string;
    lineDescription?: string;
    memo?: string;
    date: string;
    description: string;
    accountCode?: string;
    accountName?: string;
    amountPaisa: number;
    debitPaisa: number;
    creditPaisa: number;
    counterparty?: string;
    referenceNumber?: string;
    taxRateBps?: number;
    type?: string;
  };
  flags: FlaggedIssue[];
  aiSuggestion?: AISuggestionResponse;
  anomalyScore?: number;
  shapExplanations?: Array<{ feature: string; contributionPercentage: number; description: string }>;
}

export interface PipelineValidationResult {
  totalRows: number;
  readyToPostCount: number;
  reviewRequiredCount: number;
  readyRows: PipelineProcessedRow[];
  flaggedRows: PipelineProcessedRow[];
  estimatedTimeSavedMinutes: number;
  firmId: number;
  clientId: number;
  periodValidation: PeriodValidationSummary;
}

export async function processTwoFolderPipeline(params: {
  firmId: number;
  clientId: number;
  rows: RawInputRow[];
  batchType?: 'journal_entry' | 'invoice' | 'payment' | 'auto';
}): Promise<PipelineValidationResult> {
  const { firmId, clientId, rows } = params;

  // 1. Fetch live Chart of Accounts for client
  const coaRes = await query<{ id: number; account_code: string; account_name: string }>(
    `SELECT id, account_code, account_name 
     FROM chart_of_accounts 
     WHERE client_id = $1 AND is_active = true`,
    [clientId]
  );
  const coaList = coaRes.rows;
  const coaMap = new Map<string, { id: number; name: string }>();
  for (const c of coaList) {
    coaMap.set(c.account_code, { id: c.id, name: c.account_name });
  }

  // 2. Fetch periods and client fiscal year calendar
  const periodsRes = await query<{ id: number; period_name: string; start_date: string; end_date: string; is_locked: boolean }>(
    `SELECT id, period_name, start_date::text, end_date::text, is_locked FROM accounting_periods WHERE client_id = $1`,
    [clientId]
  );
  const periods = periodsRes.rows;

  const clientRes = await query<{ fiscal_year_start_month: number; created_at: string }>(
    `SELECT fiscal_year_start_month, created_at FROM clients WHERE id = $1`,
    [clientId]
  );
  const clientInfo = clientRes.rows[0];
  const fiscalYearStartMonth = clientInfo?.fiscal_year_start_month || 7;
  const clientCreatedAt = clientInfo?.created_at ? new Date(clientInfo.created_at).toISOString().slice(0, 10) : '2000-01-01';

  // 3. Fetch historical transactions for ML anomaly baselining
  const historyRes = await query<{ amount_paisa: string; account_code: string }>(
    `SELECT jl.debit_paisa as amount_paisa, coa.account_code
     FROM journal_lines jl
     JOIN journal_entries je ON je.id = jl.journal_entry_id
     JOIN chart_of_accounts coa ON coa.id = jl.account_id
     WHERE je.client_id = $1 AND jl.debit_paisa > 0
     ORDER BY je.id DESC LIMIT 1000`,
    [clientId]
  );
  const history = historyRes.rows.map(h => ({ amountPaisa: Number(h.amount_paisa), accountCode: h.account_code }));

  // 4. Fetch dynamic few-shot examples
  const fewShotExamples = await getDynamicFewShotExamples(clientId, 5);

  // 5. Pre-parse and normalize batch rows
  const parsedRows: Array<{
    rowIndex: number;
    transactionId?: string;
    transactionGroupId?: string;
    lineNumber?: number;
    transactionDescription?: string;
    lineDescription?: string;
    memo?: string;
    raw: RawInputRow;
    date: string;
    description: string;
    accountCode: string;
    debitPaisa: number;
    creditPaisa: number;
    amountPaisa: number;
    counterparty: string;
    reference: string;
    taxRateBps: number;
    flags: FlaggedIssue[];
  }> = [];

  const featureRows: TransactionFeatureRow[] = [];
  const missingMonthsMap = new Map<string, MonthPeriod>();
  const lockedPeriodsMap = new Map<string, { name: string; startDate: string; endDate: string }>();
  const outOfRangeDatesSet = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw) continue;
    const rowIndex = raw.rowIndex !== undefined ? raw.rowIndex : i + 1;
    const flags: FlaggedIssue[] = [];

    // Extract Date
    const rawDate = raw.date || raw.entryDate || raw.entry_date || raw.invoiceDate || raw.paymentDate || '';
    const dateRes = normalizeDate(String(rawDate || ''), rowIndex, 'date');
    const normDate = dateRes.cleanedValue || '';
    if (!normDate || dateRes.issue?.issueType === 'error') {
      flags.push({ type: 'SCHEMA_ERROR', message: `Invalid or missing date: "${rawDate}"`, severity: 'error' });
    } else {
      // Period verification check
      const matchedPeriod = periods.find(p => p.start_date <= normDate && p.end_date >= normDate);
      if (matchedPeriod) {
        if (matchedPeriod.is_locked) {
          flags.push({
            type: 'PERIOD_LOCKED',
            message: `Transaction date (${normDate}) falls in locked accounting period "${matchedPeriod.period_name || `${matchedPeriod.start_date} to ${matchedPeriod.end_date}`}".`,
            severity: 'error',
          });
          const key = matchedPeriod.period_name || `${matchedPeriod.start_date} to ${matchedPeriod.end_date}`;
          lockedPeriodsMap.set(key, {
            name: key,
            startDate: matchedPeriod.start_date,
            endDate: matchedPeriod.end_date,
          });
        }
      } else {
        flags.push({
          type: 'PERIOD_MISSING',
          message: `No accounting period defined for date ${normDate}. Create an accounting period first.`,
          severity: 'error',
        });
        const monthInfo = getMonthPeriodForDate(normDate);
        const boundary = getFiscalYearBoundary(normDate, fiscalYearStartMonth);
        if (monthInfo.endDate <= boundary.endDate) {
          missingMonthsMap.set(monthInfo.monthKey, monthInfo);
        } else {
          outOfRangeDatesSet.add(normDate);
        }
      }
    }

    // Extract Amounts
    const rawDebit = raw.debit !== undefined ? raw.debit : (raw.debitPaisa !== undefined ? raw.debitPaisa : raw.debit_paisa);
    const rawCredit = raw.credit !== undefined ? raw.credit : (raw.creditPaisa !== undefined ? raw.creditPaisa : raw.credit_paisa);
    const rawAmount = raw.amount !== undefined ? raw.amount : (raw.amountPaisa !== undefined ? raw.amountPaisa : raw.total);

    const isDebitPaisa = raw.debit === undefined && (raw.debitPaisa !== undefined || raw.debit_paisa !== undefined);
    const isCreditPaisa = raw.credit === undefined && (raw.creditPaisa !== undefined || raw.credit_paisa !== undefined);
    const isAmountPaisa = raw.amount === undefined && raw.amountPaisa !== undefined;

    const debitRes = parseNumericAmount(rawDebit !== undefined && rawDebit !== '' ? (isDebitPaisa ? String(Number(rawDebit) / 100) : String(rawDebit)) : '', rowIndex, 'debit');
    const creditRes = parseNumericAmount(rawCredit !== undefined && rawCredit !== '' ? (isCreditPaisa ? String(Number(rawCredit) / 100) : String(rawCredit)) : '', rowIndex, 'credit');
    const amountRes = parseNumericAmount(rawAmount !== undefined && rawAmount !== '' ? (isAmountPaisa ? String(Number(rawAmount) / 100) : String(rawAmount)) : '', rowIndex, 'amount');

    let debitPaisa = debitRes.cleanedValue?.paisa || 0;
    let creditPaisa = creditRes.cleanedValue?.paisa || 0;
    let amountPaisa = amountRes.cleanedValue?.paisa || 0;

    if (amountPaisa === 0) {
      amountPaisa = Math.max(debitPaisa, creditPaisa);
    }

    if (amountPaisa === 0) {
      flags.push({ type: 'SCHEMA_ERROR', message: 'Transaction amount cannot be zero', severity: 'error' });
    }

    // Extract Transaction Group / External ID
    const transactionGroupId = (
      raw.transaction_group_id ||
      raw.transactionGroupId ||
      raw.transaction_external_id ||
      raw.transactionExternalId ||
      raw.transaction_id ||
      raw.transactionId ||
      raw.tx_id ||
      raw.txn_id ||
      raw.entry_id ||
      ''
    ).toString().trim();

    // Extract Line Number
    const rawLineNum = raw.line_number !== undefined ? raw.line_number : (raw.lineNumber !== undefined ? raw.lineNumber : raw.line);
    const lineNumber = rawLineNum !== undefined && rawLineNum !== '' ? (Number(rawLineNum) || 0) : undefined;

    // Extract 3 separate description fields
    const transactionDescription = (raw.transaction_description || raw.transactionDescription || '').toString().trim();
    const lineDescription = (raw.line_description || raw.lineDescription || '').toString().trim();
    const memo = (raw.memo || raw.narration || '').toString().trim();

    // Combine transaction_description + line_description + memo (if present)
    const descParts = [transactionDescription, lineDescription, memo].filter(Boolean);
    const combinedDescription = descParts.length > 0
      ? descParts.join(' – ')
      : (raw.description || raw.details || raw.memo || raw.narration || '').toString().trim();

    const description = combinedDescription;
    if (!description || description.length < 2) {
      flags.push({ type: 'SCHEMA_ERROR', message: 'Description is required (at least 2 characters)', severity: 'warning' });
    }

    const counterparty = (raw.counterparty || raw.customerName || raw.vendorName || raw.payee || '').toString().trim();
    const reference = (raw.referenceNumber || raw.reference_number || raw.invoiceNumber || raw.billNumber || raw.ref || '').toString().trim();
    const accountCode = (raw.accountCode || raw.account_code || raw.code || '').toString().trim();

    const transactionId = transactionGroupId;

    // Verify COA
    if (accountCode && !coaMap.has(accountCode)) {
      flags.push({ type: 'COA_NOT_FOUND', message: `Account code "${accountCode}" not found in active Chart of Accounts`, severity: 'warning' });
    }

    // Row-level debit/credit validation
    if (debitPaisa > 0 && creditPaisa > 0) {
      flags.push({ type: 'SCHEMA_ERROR', message: 'Row cannot have both debit and credit amounts on the same line.', severity: 'error' });
    }

    if (transactionId) {
      if (debitPaisa === 0 && creditPaisa === 0) {
        flags.push({ type: 'SCHEMA_ERROR', message: 'Row in a multi-line transaction must have either debit_paisa > 0 or credit_paisa > 0.', severity: 'error' });
      }
    } else if (!accountCode && debitPaisa === 0 && creditPaisa === 0) {
      // Single-line CSV with only a single amount, missing balancing line or debit/credit direction
      flags.push({
        type: 'SCHEMA_ERROR',
        message: 'Account suggestion available, but this row needs a balancing line or debit/credit direction before posting.',
        severity: 'warning',
      });
    }

    const taxRateBps = Math.round(parseFloat(String(raw.taxRate || 0)) * 100);

    parsedRows.push({
      rowIndex,
      raw,
      transactionId: transactionId || undefined,
      transactionGroupId: transactionGroupId || undefined,
      lineNumber,
      transactionDescription: transactionDescription || undefined,
      lineDescription: lineDescription || undefined,
      memo: memo || undefined,
      date: normDate || new Date().toISOString().slice(0, 10),
      description,
      accountCode,
      debitPaisa,
      creditPaisa,
      amountPaisa,
      counterparty,
      reference,
      taxRateBps,
      flags,
    });

    featureRows.push({
      rowIndex,
      transactionId: transactionId || undefined,
      amountPaisa,
      date: normDate || new Date().toISOString().slice(0, 10),
      description,
      accountCode,
      counterparty,
      referenceNumber: reference,
    });
  }

  // Check transaction-level balancing for rows with transactionGroupId / transactionId
  const txGroups = new Map<string, typeof parsedRows>();
  for (const item of parsedRows) {
    const txId = item.transactionGroupId || item.transactionId;
    if (txId) {
      const existing = txGroups.get(txId) || [];
      existing.push(item);
      txGroups.set(txId, existing);
    }
  }

  for (const [txId, group] of txGroups.entries()) {
    // Sort rows within group by lineNumber if available
    group.sort((a, b) => {
      const lineA = a.lineNumber !== undefined ? a.lineNumber : a.rowIndex;
      const lineB = b.lineNumber !== undefined ? b.lineNumber : b.rowIndex;
      return lineA - lineB;
    });

    const totalDebits = group.reduce((sum, r) => sum + r.debitPaisa, 0);
    const totalCredits = group.reduce((sum, r) => sum + r.creditPaisa, 0);
    const hasDebit = group.some(r => r.debitPaisa > 0);
    const hasCredit = group.some(r => r.creditPaisa > 0);

    const isUnbalanced = totalDebits !== totalCredits;
    const hasInsufficientLines = group.length < 2 || !hasDebit || !hasCredit;

    if (isUnbalanced || hasInsufficientLines) {
      let message = '';
      if (isUnbalanced) {
        message = `Transaction "${txId}" is unbalanced: total debits (${(totalDebits / 100).toFixed(2)}) != total credits (${(totalCredits / 100).toFixed(2)}).`;
      } else if (group.length < 2) {
        message = `Transaction "${txId}" must have at least two lines (one debit, one credit).`;
      } else {
        message = `Transaction "${txId}" must have at least one debit line and at least one credit line.`;
      }

      for (const r of group) {
        r.flags.push({
          type: 'UNBALANCED_ENTRY',
          message,
          severity: 'error',
        });
      }
    }
  }

  // 6. Run Isolation Forest & TreeSHAP Anomaly Engine
  const isolationForest = new AccountingIsolationForest();
  const anomalyMap = isolationForest.evaluateBatch(featureRows, history);

  // 7. First pass: assign anomaly flags to each row
  const rowAnomalyData = new Map<number, { anomalyScore: number; shap: Array<{ feature: string; contributionPercentage: number; description: string }> }>();

  for (const item of parsedRows) {
    const anomaly = anomalyMap.get(item.rowIndex);
    let anomalyScore = 0;
    let shap: Array<{ feature: string; contributionPercentage: number; description: string }> = [];

    if (anomaly) {
      anomalyScore = anomaly.anomalyScore;
      shap = anomaly.shapExplanations;
      if (anomaly.isDuplicate) {
        item.flags.push({ type: 'DUPLICATE', message: anomaly.flagReasons[0] || 'Potential duplicate transaction detected', severity: 'warning' });
      } else if (anomaly.isAnomaly) {
        item.flags.push({ type: 'ANOMALY_OUTLIER', message: anomaly.flagReasons[0] || 'High-risk statistical outlier detected', severity: 'warning' });
      }
    }
    rowAnomalyData.set(item.rowIndex, { anomalyScore, shap });
  }

  // 8. Identify rows needing AI and fire all LLM calls in parallel
  const aiPromises: Array<{ rowIndex: number; promise: Promise<AISuggestionResponse> }> = [];
  for (const item of parsedRows) {
    const needsAi = !item.accountCode || !coaMap.has(item.accountCode) || item.flags.length > 0;
    const direction: 'debit' | 'credit' | 'unknown' =
      item.debitPaisa > 0 ? 'debit' :
      item.creditPaisa > 0 ? 'credit' : 'unknown';

    if (needsAi) {
      aiPromises.push({
        rowIndex: item.rowIndex,
        promise: getAISuggestion({
          description: item.description,
          counterparty: item.counterparty,
          amountPaisa: item.amountPaisa,
          direction,
          chartOfAccounts: coaList,
          fewShotExamples,
        }).catch(err => {
          console.warn('AI suggestion failed for row', item.rowIndex, err);
          return undefined as any;
        }),
      });
    }
  }

  // Await all LLM calls concurrently
  const aiResults = await Promise.allSettled(aiPromises.map(p => p.promise));
  const aiSuggestionMap = new Map<number, AISuggestionResponse | undefined>();
  for (let i = 0; i < aiPromises.length; i++) {
    const pItem = aiPromises[i];
    const result = aiResults[i];
    if (pItem && result && result.status === 'fulfilled') {
      aiSuggestionMap.set(pItem.rowIndex, (result as PromiseFulfilledResult<AISuggestionResponse>).value);
    }
  }

  // Attach AI low confidence flags
  for (const item of parsedRows) {
    const aiSuggestion = aiSuggestionMap.get(item.rowIndex);
    if (aiSuggestion && (aiSuggestion.confidenceScore < 80 || aiSuggestion.isFlaggedForReview)) {
      const isEobiNote = aiSuggestion.reasoning && aiSuggestion.reasoning.includes('EOBI payment');
      const message = isEobiNote
        ? aiSuggestion.reasoning
        : `AI confidence is low (${aiSuggestion.confidenceScore}%). Requires accountant confirmation.`;
      if (!item.flags.some(f => f.type === 'AI_LOW_CONFIDENCE')) {
        item.flags.push({
          type: 'AI_LOW_CONFIDENCE',
          message,
          severity: 'warning'
        });
      }
    }
  }

  // 9. Group-level readiness check across all lines of multi-line transactions:
  // If any line in the group has errors/warnings or lacks a verified account code,
  // the ENTIRE group stays in Folder B.
  // Only when all lines in the group are valid, balanced, and verified does the entire group move to Folder A.
  const txGroupReadiness = new Map<string, boolean>();
  for (const item of parsedRows) {
    const txId = item.transactionGroupId || item.transactionId;
    if (txId) {
      const hasErrors = item.flags.some(f => f.severity === 'error');
      const hasWarnings = item.flags.some(f => f.severity === 'warning');
      const selfReady = !hasErrors && !hasWarnings && Boolean(item.accountCode && coaMap.has(item.accountCode));

      if (!txGroupReadiness.has(txId)) {
        txGroupReadiness.set(txId, selfReady);
      } else if (!selfReady) {
        txGroupReadiness.set(txId, false);
      }
    }
  }

  // Assemble final processed rows
  const processedRows: PipelineProcessedRow[] = [];
  for (const item of parsedRows) {
    const { anomalyScore, shap } = rowAnomalyData.get(item.rowIndex) || { anomalyScore: 0, shap: [] };
    const aiSuggestion = aiSuggestionMap.get(item.rowIndex);

    const hasErrors = item.flags.some(f => f.severity === 'error');
    const hasWarnings = item.flags.some(f => f.severity === 'warning');
    const selfReady = !hasErrors && !hasWarnings && Boolean(item.accountCode && coaMap.has(item.accountCode));

    const txId = item.transactionGroupId || item.transactionId;
    let isReady = false;

    if (txId) {
      const groupAllReady = txGroupReadiness.get(txId) === true;
      isReady = groupAllReady;
      if (!groupAllReady && selfReady && !item.flags.some(f => f.type === 'UNBALANCED_ENTRY')) {
        item.flags.push({
          type: 'AI_LOW_CONFIDENCE',
          message: `Companion lines in transaction "${txId}" require review before this transaction can post.`,
          severity: 'warning',
        });
      }
    } else {
      isReady = selfReady;
    }

    const status: 'ready_to_post' | 'review_required' = isReady ? 'ready_to_post' : 'review_required';

    processedRows.push({
      rowIndex: item.rowIndex,
      status,
      rawInput: item.raw,
      normalizedData: {
        transactionId: item.transactionId || undefined,
        transactionGroupId: item.transactionGroupId || undefined,
        lineNumber: item.lineNumber,
        transactionDescription: item.transactionDescription || undefined,
        lineDescription: item.lineDescription || undefined,
        memo: item.memo || undefined,
        date: item.date,
        description: item.description,
        accountCode: item.accountCode || (aiSuggestion?.suggestedAccountCode ? aiSuggestion.suggestedAccountCode : undefined),
        accountName: (item.accountCode && coaMap.get(item.accountCode)?.name) || (aiSuggestion?.suggestedAccountCode ? aiSuggestion.suggestedAccountName : undefined),
        amountPaisa: item.amountPaisa,
        debitPaisa: item.debitPaisa,
        creditPaisa: item.creditPaisa,
        counterparty: item.counterparty,
        referenceNumber: item.reference,
        taxRateBps: item.taxRateBps,
      },
      flags: item.flags,
      aiSuggestion,
      anomalyScore,
      shapExplanations: shap,
    });
  }

  const readyRows = processedRows.filter(r => r.status === 'ready_to_post');
  const flaggedRows = processedRows.filter(r => r.status === 'review_required');

  // Estimate time saved: standard manual review takes ~30 seconds per transaction
  const estimatedTimeSavedMinutes = Math.round((readyRows.length * 30) / 60);

  const missingMonths = Array.from(missingMonthsMap.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const lockedPeriods = Array.from(lockedPeriodsMap.values()).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const outOfRangeDates = Array.from(outOfRangeDatesSet).sort();

  const periodValidation: PeriodValidationSummary = {
    hasMissingPeriods: missingMonths.length > 0,
    hasLockedPeriods: lockedPeriods.length > 0,
    hasOutOfRangeDates: outOfRangeDates.length > 0,
    missingMonths,
    lockedPeriods,
    outOfRangeDates,
  };

  return {
    totalRows: processedRows.length,
    readyToPostCount: readyRows.length,
    reviewRequiredCount: flaggedRows.length,
    readyRows,
    flaggedRows,
    estimatedTimeSavedMinutes,
    firmId,
    clientId,
    periodValidation,
  };
}

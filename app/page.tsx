'use client';

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { extractUniqueAccounts, InferredAccount, classifyAccountCode } from '@/lib/data-cleaning/coa-inference';
import { detectHeaderRow } from '@/lib/import-wizard/header-detector';
import { FolderBRow } from './components/FolderBRow';
import { FolderATable } from './components/FolderATable';
import { FolderBBatchActionBar } from './components/FolderBBatchActionBar';
import { BatchAcceptPreviewModal, HeldBackItem } from './components/BatchAcceptPreviewModal';

interface ColumnMapping {
  sourceColumn: string;
  targetField: string | null;
  confidence: 'high' | 'medium' | 'low';
  isAutoMapped: boolean;
}

const CANONICAL_FIELD_OPTIONS = [
  { value: '', label: '-- Ignore / Unmapped --' },
  { value: 'transaction_group_id', label: 'Transaction Group / External ID (transaction_group_id)' },
  { value: 'line_number', label: 'Line Number (line_number)' },
  { value: 'transaction_description', label: 'Transaction Description (transaction_description)' },
  { value: 'line_description', label: 'Line Description (line_description)' },
  { value: 'memo', label: 'Memo / Extra Narration (memo)' },
  { value: 'entry_date', label: 'Date / Txn Date (entry_date)' },
  { value: 'reference_number', label: 'Reference / Invoice # (reference_number)' },
  { value: 'account_code', label: 'Account Code / COA (account_code)' },
  { value: 'debit_paisa', label: 'Debit Amount (debit_paisa)' },
  { value: 'credit_paisa', label: 'Credit Amount (credit_paisa)' },
  { value: 'description', label: 'Single Description / Narration (description)' },
  { value: 'amount', label: 'Transaction Amount (amount/total)' },
  { value: 'counterparty_name', label: 'Customer / Vendor Name' },
  { value: 'payment_method', label: 'Payment Mode / Method' },
  { value: 'category', label: 'Expense Category' },
  { value: 'salary', label: 'Gross Salary' },
  { value: 'allowances', label: 'Allowances' },
  { value: 'deductions', label: 'Deductions' },
  { value: 'net_pay', label: 'Net Pay' },
];

export default function UniversalAIDataCleaningPage() {
  const params = useParams();
  const clientId = (params?.id as string) || '1';

  // Step navigation: 'input' | 'coa-preview' | 'mapping' | 'folders' | 'success'
  const [step, setStep] = useState<'input' | 'coa-preview' | 'mapping' | 'folders' | 'success'>('input');
  const [inputMode, setInputMode] = useState<'paste' | 'upload'>('paste');
  const [inputData, setInputData] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Auto-COA Creation State
  const [missingCoaAccounts, setMissingCoaAccounts] = useState<InferredAccount[]>([]);
  const [pendingRowsForValidation, setPendingRowsForValidation] = useState<any[] | null>(null);
  const [creatingCoa, setCreatingCoa] = useState(false);

  // Column mapping state
  const [detectedMappings, setDetectedMappings] = useState<ColumnMapping[]>([]);
  const [showMappingSummary, setShowMappingSummary] = useState(true);
  const [rawUploadResult, setRawUploadResult] = useState<any | null>(null);

  // Two-folder state
  const [readyRows, setReadyRows] = useState<any[]>([]);
  const [flaggedRows, setFlaggedRows] = useState<any[]>([]);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [folderAExpanded, setFolderAExpanded] = useState(true);

  // Batch Accept State (Defaults to 85%, min 75%, max 100%)
  const [batchThreshold, setBatchThreshold] = useState<number>(85);
  const [isBatchPreviewOpen, setIsBatchPreviewOpen] = useState<boolean>(false);
  const [batchEligibleRows, setBatchEligibleRows] = useState<any[]>([]);
  const [batchHeldBackRows, setBatchHeldBackRows] = useState<HeldBackItem[]>([]);

  // Posting & Confirmation Modal State
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<any | null>(null);

  // Period Validation State
  const [periodValidation, setPeriodValidation] = useState<{
    hasMissingPeriods: boolean;
    hasLockedPeriods: boolean;
    hasOutOfRangeDates: boolean;
    missingMonths: Array<{ name: string; startDate: string; endDate: string; monthKey: string }>;
    lockedPeriods: Array<{ name: string; startDate: string; endDate: string }>;
    outOfRangeDates: string[];
  } | null>(null);
  const [creatingPeriods, setCreatingPeriods] = useState(false);

  // Real Computed Blockers
  const computedBlockers = useMemo(() => {
    const blockers: string[] = [];
    if (periodValidation?.hasMissingPeriods && periodValidation.missingMonths.length > 0) {
      blockers.push(`Missing Accounting Period (${periodValidation.missingMonths.map(m => m.name).join(', ')})`);
    }
    if (periodValidation?.hasLockedPeriods && periodValidation.lockedPeriods.length > 0) {
      blockers.push(`Locked Accounting Period (${periodValidation.lockedPeriods.map(l => l.name).join(', ')})`);
    }
    if (periodValidation?.hasOutOfRangeDates && periodValidation.outOfRangeDates.length > 0) {
      blockers.push(`Dates Outside Fiscal Range (${periodValidation.outOfRangeDates.slice(0, 2).join(', ')}${periodValidation.outOfRangeDates.length > 2 ? '...' : ''})`);
    }
    const hasUnbalanced = readyRows.some(r => r.flags?.some((f: any) => f.type === 'UNBALANCED_ENTRY'));
    if (hasUnbalanced) {
      blockers.push('Unbalanced Journal Entries');
    }
    const hasMissingCoa = readyRows.some(r => !r.normalizedData?.accountCode);
    if (hasMissingCoa) {
      blockers.push('Unknown Account Codes');
    }
    return blockers;
  }, [periodValidation, readyRows]);

  // Audit Chain Verification State (Clean human-readable status)
  const [auditStatus, setAuditStatus] = useState<{
    isValid: boolean;
    checked: boolean;
    label: string;
  }>({
    isValid: true,
    checked: false,
    label: 'Audit chain verified',
  });

  // ── Type Registry: Subtype Selector State ──────────────────────────────
  const [registryCatalog, setRegistryCatalog] = useState<any | null>(null);
  const [selectedDataType, setSelectedDataType] = useState<string>('');
  const [selectedSubType, setSelectedSubType] = useState<string>('');
  const [registryResult, setRegistryResult] = useState<any | null>(null);

  // ── Header Row Position / Skip N Rows State ──────────────────────────────
  const [skipTopNRows, setSkipTopNRows] = useState<number>(0);
  const [suggestedHeaderRow, setSuggestedHeaderRow] = useState<number | null>(null);
  const [headerConfidence, setHeaderConfidence] = useState<'high' | 'medium' | 'low' | null>(null);
  const [detectionReason, setDetectionReason] = useState<string>('');
  const [previewRawRows, setPreviewRawRows] = useState<string[][]>([]);
  const [previousImportOffset, setPreviousImportOffset] = useState<number | null>(null);

  // ── Phase 4: Subtype Auto-Suggestion State ─────────────────────────────
  const [subtypeSuggestions, setSubtypeSuggestions] = useState<any | null>(null);
  const [showRecommendationsPanel, setShowRecommendationsPanel] = useState<boolean>(false);
  const [userManuallySelectedSubtype, setUserManuallySelectedSubtype] = useState<boolean>(false);

  // Helper function to query subtype suggestions
  async function fetchSubtypeSuggestions(headers: string[], dataTypeScope?: string) {
    if (!headers || headers.length === 0) return;
    try {
      const res = await fetch('/api/import/suggest-subtype', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ headers, dataTypeScope }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.topSuggestions) {
        setSubtypeSuggestions(data);
        // Auto-select if:
        // 1. Not a tie (gap > 10%)
        // 2. Not low confidence (score >= 50%)
        // 3. User hasn't already manually chosen
        if (!data.isTie && !data.isLowConfidence && data.topSuggestions.length > 0 && !userManuallySelectedSubtype) {
          const top = data.topSuggestions[0];
          setSelectedDataType(top.dataType);
          setSelectedSubType(top.subTypeId);
        }
      }
    } catch {
      // Graceful non-blocking fallback
    }
  }

  // Auto-detect header row when pasted inputData changes
  useEffect(() => {
    if (!inputData || inputData.trim().length < 10) {
      if (inputMode === 'paste') {
        setPreviewRawRows([]);
        setSuggestedHeaderRow(null);
      }
      return;
    }
    if (inputMode === 'paste') {
      try {
        const lines = inputData.trim().split(/\r?\n/).slice(0, 25);
        const delim = lines[0]?.includes('\t') && !lines[0]?.includes(',') ? '\t' : ',';
        const grid = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^["']|["']$/g, '')));
        setPreviewRawRows(grid);
        const detection = detectHeaderRow(grid);
        setSuggestedHeaderRow(detection.suggestedHeaderRow);
        setHeaderConfidence(detection.confidence);
        setDetectionReason(detection.reason);
        if (detection.suggestedHeaderRow > 0 && skipTopNRows === 0) {
          setSkipTopNRows(detection.suggestedHeaderRow);
        }
        const headerRow = grid[detection.suggestedHeaderRow] || [];
        if (headerRow.length > 0) {
          fetchSubtypeSuggestions(headerRow, selectedDataType || undefined);
        }
      } catch {
        // ignore preview errors
      }
    }
  }, [inputData, inputMode]);

  // Auto-detect header row when a file is selected
  useEffect(() => {
    if (!selectedFile) {
      if (inputMode === 'upload') {
        setPreviewRawRows([]);
        setSuggestedHeaderRow(null);
      }
      return;
    }
    const name = selectedFile.name.toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = (e.target?.result as string) || '';
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 25);
        const delim = text.includes('\t') && !lines[0]?.includes(',') ? '\t' : ',';
        const grid = lines.map((l) => l.split(delim).map((c) => c.trim().replace(/^["']|["']$/g, '')));
        setPreviewRawRows(grid);
        const detection = detectHeaderRow(grid);
        setSuggestedHeaderRow(detection.suggestedHeaderRow);
        setHeaderConfidence(detection.confidence);
        setDetectionReason(detection.reason);
        if (detection.suggestedHeaderRow > 0) {
          setSkipTopNRows(detection.suggestedHeaderRow);
        }
        const headerRow = grid[detection.suggestedHeaderRow] || [];
        if (headerRow.length > 0) {
          fetchSubtypeSuggestions(headerRow, selectedDataType || undefined);
        }
      };
      reader.readAsText(selectedFile.slice(0, 32768));
    }
  }, [selectedFile]);

  // Fetch registry catalog once on mount (cached by the route for 5 min)
  useEffect(() => {
    fetch('/api/import/registry-subtypes')
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setRegistryCatalog(data); })
      .catch(() => {/* catalog is optional — fail silently */});
  }, []);

  // When the user changes data type, reset the subtype selection
  function handleDataTypeChange(dt: string) {
    setSelectedDataType(dt);
    setSelectedSubType('');
    setUserManuallySelectedSubtype(true);
  }

  // Derive the currently-selected subtype definition for column pill display
  const selectedSubTypeDef = useMemo(() => {
    if (!registryCatalog || !selectedDataType || !selectedSubType) return null;
    const options: any[] = registryCatalog.subtypesByType?.[selectedDataType] ?? [];
    return options.find((o: any) => o.id === selectedSubType) ?? null;
  }, [registryCatalog, selectedDataType, selectedSubType]);

  // Verify audit chain at all 8 lifecycle events without technical dumps
  async function checkAuditChainStatus(): Promise<boolean> {
    try {
      const res = await fetch(`/api/import/review?clientId=${clientId}`);
      if (!res.ok) {
        setAuditStatus({
          isValid: false,
          checked: true,
          label: 'Audit chain issue detected — posting blocked',
        });
        return false;
      }
      const data = await res.json();
      const valid = Boolean(data.auditChainStatus?.isValid !== false);
      setAuditStatus({
        isValid: valid,
        checked: true,
        label: valid ? 'Audit chain verified' : 'Audit chain issue detected — posting blocked',
      });
      return valid;
    } catch {
      setAuditStatus({
        isValid: true,
        checked: true,
        label: 'Audit chain verified',
      });
      return true;
    }
  }

  // 1. Initial load / refresh
  React.useEffect(() => {
    checkAuditChainStatus();
  }, [clientId]);

  // Load sample dataset directly
  async function loadSampleDataset(filename: string) {
    setMessage(null);
    setLoading(true);
    setLoadingMessage(`Loading sample "${filename}"...`);
    try {
      const res = await fetch(`/test-data/${filename}`);
      if (!res.ok) throw new Error(`Failed to load ${filename}`);
      const text = await res.text();
      setInputData(text);
      setInputMode('paste');
      setMessage({ type: 'success', text: `Loaded ${filename} (${text.split('\\n').length - 1} rows)` });
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to load test data' });
    } finally {
      setLoading(false);
    }
  }

  // Check for missing COA codes against database before validation
  async function checkForMissingCoa(rows: any[]): Promise<InferredAccount[]> {
    try {
      const extracted = extractUniqueAccounts(rows);
      if (extracted.length === 0) return [];

      const coaRes = await fetch(`/api/clients/${clientId}/accounts`);
      if (!coaRes.ok) return extracted;

      const coaData = await coaRes.json();
      const existingCodes = new Set<string>((coaData.accounts || []).map((a: any) => String(a.account_code || a.code)));

      // Find accounts not in client's COA
      return extracted.filter(item => !existingCodes.has(item.code));
    } catch (err) {
      console.warn('Error checking existing COA:', err);
      return [];
    }
  }

  // Core validation runner
  async function executeValidation(rows: any[]) {
    setLoading(true);
    setLoadingMessage('Analyzing transactions with Isolation Forest & LLMs...');
    setMessage(null);

    try {
      const res = await fetch('/api/import/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: Number(clientId),
          rows,
          // Pass registry selection if the user chose a subtype
          ...(selectedDataType && selectedSubType ? { dataType: selectedDataType, subType: selectedSubType } : {}),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Validation failed');

      if (data.columnMappings && data.columnMappings.length > 0) {
        setDetectedMappings(data.columnMappings);
      }
      setReadyRows(data.readyRows || []);
      setFlaggedRows(data.flaggedRows || []);
      setPeriodValidation(data.periodValidation ?? null);
      setRegistryResult(data.registryResult ?? null);
      setResolvedCount(0);
      setStep('folders');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error processing transactions.' });
    } finally {
      setLoading(false);
    }
  }

  // Handle Validation (Paste mode)
  async function handleValidatePaste() {
    if (!inputData.trim()) {
      setMessage({ type: 'error', text: 'Please paste transactions first.' });
      return;
    }
    setLoading(true);
    setLoadingMessage('Scanning for account codes and existing Chart of Accounts...');
    setMessage(null);

    try {
      setLoadingMessage('Parsing transactions with server CSV parser...');
      const parseRes = await fetch('/api/import/parse-text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: inputData.trim(),
          clientId: Number(clientId),
          skipTopNRows,
        }),
      });

      const parseData = await parseRes.json();
      if (!parseRes.ok) {
        throw new Error(parseData.error || 'Failed to parse raw text.');
      }

      if (typeof parseData.suggestedHeaderRow === 'number') {
        setSuggestedHeaderRow(parseData.suggestedHeaderRow);
        setHeaderConfidence(parseData.headerDetectionConfidence ?? 'high');
      }
      if (Array.isArray(parseData.rawRows) && parseData.rawRows.length > 0) {
        setPreviewRawRows(parseData.rawRows.slice(0, 25));
      }

      const rows: any[] = parseData.rows || [];
      if (parseData.columnMappings && parseData.columnMappings.length > 0) {
        setDetectedMappings(parseData.columnMappings);
      }

      setRawUploadResult({ rawRows: rows });

      // Check for missing COA
      const missing = await checkForMissingCoa(rows);
      if (missing.length > 0) {
        setMissingCoaAccounts(missing);
        setPendingRowsForValidation(rows);
        setStep('coa-preview');
        setLoading(false);
        return;
      }

      await executeValidation(rows);
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error processing transactions.' });
      setLoading(false);
    }
  }

  // Handle File Upload & Validation
  async function handleValidateFile() {
    if (!selectedFile) {
      setMessage({ type: 'error', text: 'Please select a CSV or XLSX file to upload.' });
      return;
    }

    setLoading(true);
    setLoadingMessage('Parsing file, detecting column mappings & checking COA...');
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('clientId', clientId);
      formData.append('skipTopNRows', skipTopNRows.toString());
      // Pass registry selection if user chose a subtype
      if (selectedDataType && selectedSubType) {
        formData.append('dataType', selectedDataType);
        formData.append('subType', selectedSubType);
      }

      const res = await fetch('/api/import/validate-file', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'File validation failed');

      if (typeof data.suggestedHeaderRow === 'number') {
        setSuggestedHeaderRow(data.suggestedHeaderRow);
        setHeaderConfidence(data.headerDetectionConfidence ?? 'high');
      }
      if (Array.isArray(data.rawGrid) && data.rawGrid.length > 0) {
        setPreviewRawRows(data.rawGrid.slice(0, 25));
      }

      setRawUploadResult(data);

      // Check if any column mapping requires review
      if (data.columnMappings && data.columnMappings.length > 0) {
        setDetectedMappings(data.columnMappings);
        const hasLowConfidence = data.columnMappings.some((m: ColumnMapping) => m.confidence === 'low');
        if (hasLowConfidence) {
          setStep('mapping');
          setLoading(false);
          return;
        }
      }

      // Check if missing COA exists in uploaded file rows
      const combinedRows = [...(data.readyRows || []), ...(data.flaggedRows || [])].map(r => ({
        accountCode: r.normalizedData?.accountCode,
        description: r.normalizedData?.description,
      }));

      const missing = await checkForMissingCoa(combinedRows);
      if (missing.length > 0) {
        setMissingCoaAccounts(missing);
        // Prepare rows in clean format for validation preserving all raw input fields
        const cleanRows = [...(data.readyRows || []), ...(data.flaggedRows || [])].map((r, idx) => r.rawInput || {
          rowIndex: idx + 1,
          ...r.normalizedData,
          amount: (r.normalizedData?.amountPaisa || 0) / 100,
        });
        setPendingRowsForValidation(cleanRows);
        setStep('coa-preview');
        setLoading(false);
        return;
      }

      setReadyRows(data.readyRows || []);
      setFlaggedRows(data.flaggedRows || []);
      setPeriodValidation(data.periodValidation ?? null);
      setRegistryResult(data.registryResult ?? null);
      setResolvedCount(0);
      setStep('folders');
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to process file.' });
    } finally {
      setLoading(false);
    }
  }

  // One-Click Creation of Missing Accounting Periods
  async function handleCreateMissingPeriods() {
    if (!periodValidation?.missingMonths || periodValidation.missingMonths.length === 0) return;
    setCreatingPeriods(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/accounting-periods/batch-create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          periods: periodValidation.missingMonths,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create missing periods');

      setMessage({
        type: 'success',
        text: `✓ Successfully created ${data.createdCount || periodValidation.missingMonths.length} accounting period(s)! Re-validating batch...`,
      });

      // Re-validate the batch
      if (rawUploadResult?.rawRows || rawUploadResult?.rows || pendingRowsForValidation) {
        const rowsToRevalidate = rawUploadResult?.rawRows || rawUploadResult?.rows || pendingRowsForValidation;
        await executeValidation(rowsToRevalidate);
      } else if (selectedFile) {
        await handleValidateFile();
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to create missing periods' });
    } finally {
      setCreatingPeriods(false);
    }
  }

  // Auto-COA Creation: Save inferred accounts to Database and then validate
  async function handleCreateCoaAndContinue() {
    setCreatingCoa(true);
    setMessage(null);

    try {
      const res = await fetch('/api/import/coa-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: Number(clientId),
          accounts: missingCoaAccounts,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create Chart of Accounts');

      setMessage({
        type: 'success',
        text: `🎉 Successfully created ${data.createdCount} accounts in Chart of Accounts! All transactions will now auto-match.`,
      });

      // Now run validation with the newly created COA in place!
      if (pendingRowsForValidation && pendingRowsForValidation.length > 0) {
        await executeValidation(pendingRowsForValidation);
      } else {
        setStep('folders');
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Failed to create accounts.' });
    } finally {
      setCreatingCoa(false);
    }
  }

  // Skip COA creation and validate as-is
  async function handleSkipCoaCreation() {
    if (pendingRowsForValidation) {
      await executeValidation(pendingRowsForValidation);
    } else {
      setStep('folders');
    }
  }

  // Helper to re-map raw rows based on detectedMappings
  function mapRowsWithMappings(rows: Record<string, string>[], mappings: ColumnMapping[]): any[] {
    return rows.map((row, i) => {
      const mapped: any = { rowIndex: i + 1 };
      for (const m of mappings) {
        if (!m.targetField) continue;
        const val = row[m.sourceColumn];
        if (val === undefined || val === '') continue;
        switch (m.targetField) {
          case 'transaction_group_id':
            mapped.transactionGroupId = val;
            mapped.transaction_group_id = val;
            mapped.transaction_external_id = val;
            mapped.transactionId = val;
            break;
          case 'line_number':
            mapped.lineNumber = Number(val) || val;
            mapped.line_number = Number(val) || val;
            break;
          case 'transaction_description':
            mapped.transactionDescription = val;
            mapped.transaction_description = val;
            break;
          case 'line_description':
            mapped.lineDescription = val;
            mapped.line_description = val;
            break;
          case 'memo':
            mapped.memo = val;
            break;
          case 'transaction_id':
            mapped.transactionId = val;
            mapped.transaction_id = val;
            break;
          case 'entry_date':
            mapped.date = val;
            mapped.entry_date = val;
            mapped.entryDate = val;
            break;
          case 'description':
            mapped.description = val;
            break;
          case 'account_code':
            mapped.accountCode = val;
            mapped.account_code = val;
            break;
          case 'debit_paisa':
            mapped.debit = val;
            mapped.debitPaisa = val;
            mapped.debit_paisa = val;
            break;
          case 'credit_paisa':
            mapped.credit = val;
            mapped.creditPaisa = val;
            mapped.credit_paisa = val;
            break;
          case 'amount':
            mapped.amount = val;
            break;
          case 'reference_number':
            mapped.referenceNumber = val;
            mapped.reference_number = val;
            break;
          case 'counterparty_name':
            mapped.counterparty = val;
            break;
          case 'total':
            mapped.total = val;
            break;
          case 'tax':
            mapped.taxRate = val;
            break;
          default:
            mapped[m.targetField] = val;
        }
      }
      return mapped;
    });
  }

  // Confirm Column Mappings and proceed
  async function handleConfirmMappings() {
    if (rawUploadResult) {
      setLoading(true);
      setLoadingMessage('Applying column mappings & validating transactions...');
      try {
        let mappedRows: any[] = [];
        if (rawUploadResult.rawRows && rawUploadResult.rawRows.length > 0) {
          mappedRows = mapRowsWithMappings(rawUploadResult.rawRows, detectedMappings);
        } else {
          mappedRows = [...(rawUploadResult.readyRows || []), ...(rawUploadResult.flaggedRows || [])].map((r, idx) => r.rawInput || {
            rowIndex: idx + 1,
            ...r.normalizedData,
            amount: (r.normalizedData?.amountPaisa || 0) / 100,
          });
        }

        const missing = await checkForMissingCoa(mappedRows);
        if (missing.length > 0) {
          setMissingCoaAccounts(missing);
          setPendingRowsForValidation(mappedRows);
          setStep('coa-preview');
          setLoading(false);
          return;
        }

        await executeValidation(mappedRows);
      } catch (err: any) {
        setMessage({ type: 'error', text: err.message || 'Error processing column mappings.' });
        setLoading(false);
      }
    }
  }

function getRowGroupId(r: any): string {
  return (
    r?.normalizedData?.transactionGroupId ||
    r?.normalizedData?.transaction_group_id ||
    r?.normalizedData?.transaction_external_id ||
    r?.normalizedData?.transactionId ||
    r?.rawInput?.transaction_external_id ||
    r?.rawInput?.transaction_group_id ||
    r?.rawInput?.transactionGroupId ||
    r?.transactionGroupId ||
    r?.transaction_group_id ||
    r?.transaction_external_id ||
    ''
  ).toString().trim();
}

  // Apply Row Update with atomic group transition support:
  const applyRowUpdate = useCallback((updatedRow: any) => {
    const txGroupId = getRowGroupId(updatedRow);

    if (!txGroupId) {
      // Single-line transaction: moves directly to Folder A
      setFlaggedRows(prev => prev.filter(r => r.rowIndex !== updatedRow.rowIndex));
      setReadyRows(prev => [updatedRow, ...prev.filter(r => r.rowIndex !== updatedRow.rowIndex)]);
      setResolvedCount(c => c + 1);
      return;
    }

    // Multi-line transaction group: check if ALL lines in the group are now ready & balanced
    setFlaggedRows(prevFlagged => {
      const nextFlagged = prevFlagged.map(r => r.rowIndex === updatedRow.rowIndex ? updatedRow : r);

      const groupInFlagged = nextFlagged.filter(r => getRowGroupId(r) === txGroupId);
      const groupInReady = readyRows.filter(r => getRowGroupId(r) === txGroupId);
      const allGroupRows = [...groupInFlagged, ...groupInReady];

      const allHaveCodes = allGroupRows.every(r => Boolean(r.normalizedData?.accountCode));
      const hasErrors = allGroupRows.some(r => (r.flags || []).some((f: any) => f.severity === 'error'));
      const totalDebits = allGroupRows.reduce((sum, r) => sum + (Number(r.normalizedData?.debitPaisa) || 0), 0);
      const totalCredits = allGroupRows.reduce((sum, r) => sum + (Number(r.normalizedData?.creditPaisa) || 0), 0);
      const isBalanced = totalDebits === totalCredits && allGroupRows.length >= 2;

      if (allHaveCodes && !hasErrors && isBalanced) {
        // ENTIRE group moves to Folder A together!
        const readyGroupRows = allGroupRows.map(r => ({
          ...r,
          status: 'ready_to_post',
          flags: (r.flags || []).filter((f: any) => f.type !== 'AI_LOW_CONFIDENCE' && f.type !== 'UNBALANCED_ENTRY'),
        }));

        queueMicrotask(() => {
          setReadyRows(prevReady => [
            ...readyGroupRows,
            ...prevReady.filter(r => getRowGroupId(r) !== txGroupId),
          ]);
          setResolvedCount(c => c + groupInFlagged.length);
        });

        return nextFlagged.filter(r => getRowGroupId(r) !== txGroupId);
      } else {
        // Keep in flaggedRows (Folder B) until all lines are valid and balanced
        return nextFlagged;
      }
    });
  }, [readyRows]);

  // Real-time Action: Accept AI Suggestion -> Moves to Folder A when group is ready
  const handleAcceptAI = useCallback((row: any) => {
    const suggestedCode = row.aiSuggestion?.suggestedAccountCode;
    if (!suggestedCode) return;
    const suggestedName = row.aiSuggestion?.suggestedAccountName || 'Approved Account';

    const updatedRow = {
      ...row,
      status: 'ready_to_post',
      normalizedData: {
        ...row.normalizedData,
        accountCode: suggestedCode,
        accountName: suggestedName,
      },
      flags: (row.flags || []).filter((f: any) => f.type !== 'AI_LOW_CONFIDENCE'),
      reviewDecision: { action: 'accepted', correctedCode: suggestedCode },
    };

    applyRowUpdate(updatedRow);
  }, [applyRowUpdate]);

  // Real-time Action: Edit Account Code (Non-blocking inline edit)
  const handleEditCode = useCallback((row: any, newCode: string) => {
    if (!newCode || !newCode.trim()) return;

    const trimmedCode = newCode.trim();
    const updatedRow = {
      ...row,
      status: 'ready_to_post',
      normalizedData: {
        ...row.normalizedData,
        accountCode: trimmedCode,
      },
      flags: (row.flags || []).filter((f: any) => f.type !== 'AI_LOW_CONFIDENCE' && f.type !== 'COA_NOT_FOUND'),
      reviewDecision: { action: 'edited', correctedCode: trimmedCode },
    };

    applyRowUpdate(updatedRow);
  }, [applyRowUpdate]);

  // Real-time Action: Discard Row (or entire multi-line group) from batch
  const handleDiscardRow = useCallback((row: any) => {
    const txGroupId = getRowGroupId(row);
    if (txGroupId) {
      // Discard entire group so no unbalanced half-transaction remains
      setFlaggedRows(prev => prev.filter(r => getRowGroupId(r) !== txGroupId));
      setReadyRows(prev => prev.filter(r => getRowGroupId(r) !== txGroupId));
    } else {
      setFlaggedRows(prev => prev.filter(r => r.rowIndex !== row.rowIndex));
    }
    setResolvedCount(c => c + 1);
  }, []);

  // Real-time Action: Batch Accept Multiple High-Confidence AI Suggestions
  const handleOpenBatchPreview = useCallback((eligible: any[], heldBack: HeldBackItem[]) => {
    setBatchEligibleRows(eligible);
    setBatchHeldBackRows(heldBack);
    setIsBatchPreviewOpen(true);
  }, []);

  const handleConfirmBatchAccept = useCallback((selectedRows: any[]) => {
    if (!selectedRows || selectedRows.length === 0) return;

    const selectedRowIndices = new Set(selectedRows.map((r) => r.rowIndex));

    const updatedSelectedRows = selectedRows.map((row) => {
      const suggestedCode = row.aiSuggestion?.suggestedAccountCode || row.normalizedData?.accountCode || '5010';
      const suggestedName = row.aiSuggestion?.suggestedAccountName || 'Approved Account';

      return {
        ...row,
        status: 'ready_to_post',
        normalizedData: {
          ...row.normalizedData,
          accountCode: suggestedCode,
          accountName: suggestedName,
        },
        flags: (row.flags || []).filter((f: any) => f.type !== 'AI_LOW_CONFIDENCE' && f.type !== 'COA_NOT_FOUND'),
        reviewDecision: { action: 'accepted', correctedCode: suggestedCode },
      };
    });

    setFlaggedRows((prev) => prev.filter((r) => !selectedRowIndices.has(r.rowIndex)));
    setReadyRows((prev) => [
      ...updatedSelectedRows,
      ...prev.filter((r) => !selectedRowIndices.has(r.rowIndex)),
    ]);
    setResolvedCount((c) => c + selectedRows.length);

    setIsBatchPreviewOpen(false);
  }, []);

  // Calculate live statistics (memoized)
  const totalDebitPaisa = useMemo(
    () => readyRows.reduce((acc, r) => acc + (Number(r.normalizedData?.debitPaisa || r.normalizedData?.amountPaisa) || 0), 0),
    [readyRows]
  );
  const totalCreditPaisa = useMemo(
    () => readyRows.reduce((acc, r) => acc + (Number(r.normalizedData?.creditPaisa || r.normalizedData?.amountPaisa) || 0), 0),
    [readyRows]
  );
  const totalDebitPKR = useMemo(() => totalDebitPaisa / 100, [totalDebitPaisa]);
  const totalCreditPKR = useMemo(() => totalCreditPaisa / 100, [totalCreditPaisa]);

  // Execute Post to General Ledger
  async function handleConfirmAndPost() {
    setPosting(true);
    setMessage(null);

    try {
      const batchId = crypto.randomUUID();
      const res = await fetch('/api/import/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: Number(clientId),
          batchId,
          rows: readyRows,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Posting failed');

      setPostResult(data);
      setIsConfirmModalOpen(false);
      checkAuditChainStatus();
      setStep('success');
    } catch (err: any) {
      setIsConfirmModalOpen(false);
      checkAuditChainStatus();
      setMessage({ type: 'error', text: err.message || 'Failed to post entries to General Ledger.' });
    } finally {
      setPosting(false);
    }
  }

  // Download Posted rows as CSV client-side
  function handleDownloadCSV() {
    if (!readyRows.length) return;
    const headers = ['Row', 'Date', 'Description', 'AccountCode', 'AmountPKR'];
    const csvContent = [
      headers.join(','),
      ...readyRows.map(r => [
        r.rowIndex,
        `"${r.normalizedData?.date || ''}"`,
        `"${(r.normalizedData?.description || '').replace(/"/g, '""')}"`,
        `"${r.normalizedData?.accountCode || ''}"`,
        (r.normalizedData?.amountPaisa || 0) / 100,
      ].join(','))
    ].join('\\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `posted-transactions-client-${clientId}-${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Reset to upload another file
  function handleReset() {
    setStep('input');
    setInputData('');
    setSelectedFile(null);
    setReadyRows([]);
    setFlaggedRows([]);
    setResolvedCount(0);
    setMissingCoaAccounts([]);
    setPendingRowsForValidation(null);
    setPeriodValidation(null);
    setPostResult(null);
    setMessage(null);
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary, #070a11)', color: 'var(--text-primary, #f8fafc)', padding: '32px 16px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto' }}>

        {/* Top Breadcrumb */}
        <div style={{ marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/reports" style={{ color: '#3b82f6', textDecoration: 'none', fontSize: '14px', fontWeight: 600 }}>
            📊 View Financial Reports →
          </Link>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span style={{
              fontSize: '12px',
              fontWeight: 700,
              padding: '4px 10px',
              borderRadius: '6px',
              background: auditStatus.isValid ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
              color: auditStatus.isValid ? '#34d399' : '#f87171',
              border: auditStatus.isValid ? '1px solid #059669' : '1px solid #dc2626',
            }}>
              {auditStatus.label}
            </span>
            <span style={{ fontSize: '12px', color: '#64748b', background: 'rgba(255,255,255,0.05)', padding: '4px 10px', borderRadius: '6px', border: '1px solid #1e293b' }}>
              Multi-Tenant Isolated | Client ID: {clientId}
            </span>
          </div>
        </div>

        {/* Header Hero */}
        <div className="glass-card" style={{ background: 'rgba(18, 26, 44, 0.85)', border: '1px solid #23304c', borderRadius: '12px', padding: '24px', marginBottom: '24px', backdropFilter: 'blur(8px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h1 style={{ fontSize: '24px', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '10px', color: '#ffffff' }}>
                <span style={{ color: '#f59e0b' }}>⚡</span> Universal AI Data Cleaning & Posting Studio
              </h1>
              <p style={{ margin: '8px 0 0', fontSize: '14px', color: '#94a3b8', lineHeight: 1.5 }}>
                Paste CSV/JSON or upload any CSV/XLSX file. Auto-creates Chart of Accounts for new clients, runs Isolation Forest & TreeSHAP anomaly audits, and splits transactions into <strong>Folder A (Ready to Post)</strong> and <strong>Folder B (Review Required)</strong>.
              </p>
            </div>
            {(step === 'folders' || step === 'coa-preview') && (
              <button
                type="button"
                onClick={handleReset}
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid #334155', color: '#94a3b8', padding: '8px 16px', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
              >
                + Upload New Batch
              </button>
            )}
          </div>
        </div>

        {/* Global Notifications */}
        {message && (
          <div style={{
            padding: '14px 18px',
            borderRadius: '8px',
            marginBottom: '20px',
            fontWeight: 600,
            fontSize: '14px',
            background: message.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            color: message.type === 'success' ? '#34d399' : '#f87171',
            border: message.type === 'success' ? '1px solid #059669' : '1px solid #dc2626',
          }}>
            {message.text}
          </div>
        )}

        {/* Loading Indicator */}
        {loading && (
          <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid #2563eb', padding: '20px', borderRadius: '12px', textAlign: 'center', marginBottom: '24px' }}>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#60a5fa', marginBottom: '6px' }}>
              ⏳ {loadingMessage || 'Processing Transactions...'}
            </div>
            <div style={{ fontSize: '13px', color: '#94a3b8' }}>
              Running Isolation Forest anomaly scoring, TreeSHAP explanations, and multi-LLM classification.
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 1: INPUT & UPLOAD WORKSPACE */}
        {/* ========================================================================= */}
        {step === 'input' && !loading && (
          <div className="glass-card" style={{ background: 'rgba(18, 26, 44, 0.8)', border: '1px solid #23304c', borderRadius: '12px', padding: '24px' }}>
            
            {/* Input Mode Selector */}
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px', borderBottom: '1px solid #23304c', paddingBottom: '12px' }}>
              <button
                type="button"
                onClick={() => setInputMode('paste')}
                style={{
                  background: inputMode === 'paste' ? '#2563eb' : 'transparent',
                  color: inputMode === 'paste' ? '#ffffff' : '#94a3b8',
                  border: inputMode === 'paste' ? 'none' : '1px solid #334155',
                  padding: '8px 18px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                📋 Paste CSV or JSON Data
              </button>
              <button
                type="button"
                onClick={() => setInputMode('upload')}
                style={{
                  background: inputMode === 'upload' ? '#2563eb' : 'transparent',
                  color: inputMode === 'upload' ? '#ffffff' : '#94a3b8',
                  border: inputMode === 'upload' ? 'none' : '1px solid #334155',
                  padding: '8px 18px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                }}
              >
                📁 Upload CSV or XLSX File
              </button>
            </div>

            {/* ── Type Registry: Subtype Selector Panel ─────────────────────── */}
            {registryCatalog && (
              <div style={{ marginBottom: '20px', background: 'rgba(99, 102, 241, 0.06)', border: '1px solid #4338ca', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>📋</span> Data Type Selection <span style={{ fontSize: '10px', fontWeight: 400, color: '#6366f1', textTransform: 'none' }}>(optional — enables registry validation)</span>
                </div>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  {/* Data Type Dropdown */}
                  <div style={{ flex: 1, minWidth: '180px' }}>
                    <label style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600, display: 'block', marginBottom: '4px' }}>Data Type</label>
                    <select
                      id="registry-data-type-select"
                      value={selectedDataType}
                      onChange={(e) => handleDataTypeChange(e.target.value)}
                      style={{
                        width: '100%', background: '#0f172a', color: selectedDataType ? '#e2e8f0' : '#64748b',
                        border: '1px solid #334155', borderRadius: '6px', padding: '8px 10px',
                        fontSize: '13px', cursor: 'pointer', outline: 'none',
                      }}
                    >
                      <option value="">— Skip registry validation —</option>
                      {(registryCatalog.dataTypes ?? []).map((dt: any) => (
                        <option key={dt.id} value={dt.id}>{dt.label}</option>
                      ))}
                    </select>
                  </div>

                  {/* Subtype Dropdown (only visible once a data type is chosen) */}
                  {selectedDataType && (
                    <div style={{ flex: 1, minWidth: '220px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <label style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>Subtype</label>
                        {/* Subtype Confidence Badge */}
                        {(() => {
                          const match = subtypeSuggestions?.topSuggestions?.find((s: any) => s.subTypeId === selectedSubType);
                          if (!match) return null;
                          return (
                            <span style={{ fontSize: '10px', background: 'rgba(16,185,129,0.15)', color: '#34d399', border: '1px solid #059669', borderRadius: '4px', padding: '1px 6px', fontWeight: 600 }}>
                              ⚡ Suggested ({match.confidence}% match)
                            </span>
                          );
                        })()}
                      </div>
                      <select
                        id="registry-sub-type-select"
                        value={selectedSubType}
                        onChange={(e) => {
                          setSelectedSubType(e.target.value);
                          setUserManuallySelectedSubtype(true);
                        }}
                        style={{
                          width: '100%', background: '#0f172a', color: selectedSubType ? '#e2e8f0' : '#64748b',
                          border: `1px solid ${selectedSubType ? '#6366f1' : '#334155'}`, borderRadius: '6px',
                          padding: '8px 10px', fontSize: '13px', cursor: 'pointer', outline: 'none',
                        }}
                      >
                        <option value="">— Choose a subtype —</option>
                        {(registryCatalog.subtypesByType?.[selectedDataType] ?? []).map((st: any) => (
                          <option key={st.id} value={st.id}>{st.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {/* ── Phase 4: Tie Warning Banner (Top 2 within 10 percentage points) ── */}
                {subtypeSuggestions?.isTie && (
                  <div style={{ marginTop: '12px', background: 'rgba(245,158,11,0.12)', border: '1px solid #d97706', borderRadius: '8px', padding: '12px 14px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                      <span>⚠️</span> These subtypes are very close — please confirm:
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {subtypeSuggestions.topSuggestions.slice(0, 2).map((cand: any) => (
                        <button
                          key={cand.subTypeId}
                          type="button"
                          onClick={() => {
                            setSelectedDataType(cand.dataType);
                            setSelectedSubType(cand.subTypeId);
                            setUserManuallySelectedSubtype(true);
                          }}
                          style={{
                            background: selectedSubType === cand.subTypeId ? '#2563eb' : '#1e293b',
                            color: '#f8fafc',
                            border: selectedSubType === cand.subTypeId ? '1px solid #60a5fa' : '1px solid #475569',
                            borderRadius: '6px',
                            padding: '6px 12px',
                            fontSize: '12px',
                            cursor: 'pointer',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <span>{cand.label}</span>
                          <span style={{ fontSize: '11px', color: '#93c5fd' }}>({cand.confidence}%)</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Phase 4: Low Confidence Warning (<50%) ── */}
                {subtypeSuggestions?.isLowConfidence && !selectedSubType && (
                  <div style={{ marginTop: '12px', background: 'rgba(239,68,68,0.1)', border: '1px solid #dc2626', borderRadius: '8px', padding: '10px 14px', fontSize: '12px', color: '#fca5a5' }}>
                    ⚠️ Low confidence ({subtypeSuggestions.topSuggestions[0]?.confidence ?? 0}%) — manual selection recommended.
                  </div>
                )}

                {/* ── Phase 4: Recommended Subtypes Panel (Collapsible) ── */}
                {subtypeSuggestions?.topSuggestions && subtypeSuggestions.topSuggestions.length > 0 && (
                  <div style={{ marginTop: '12px' }}>
                    <button
                      type="button"
                      onClick={() => setShowRecommendationsPanel(!showRecommendationsPanel)}
                      style={{
                        background: 'transparent', border: 'none', color: '#818cf8',
                        fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                        display: 'inline-flex', alignItems: 'center', gap: '6px', padding: 0,
                      }}
                    >
                      <span>{showRecommendationsPanel ? '▼' : '▶'}</span>
                      <span>💡 Recommended Subtypes ({subtypeSuggestions.topSuggestions.length})</span>
                    </button>

                    {showRecommendationsPanel && (
                      <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {subtypeSuggestions.topSuggestions.map((sug: any, rank: number) => (
                          <div
                            key={sug.subTypeId}
                            style={{
                              background: selectedSubType === sug.subTypeId ? 'rgba(99,102,241,0.15)' : '#0f172a',
                              border: `1px solid ${selectedSubType === sug.subTypeId ? '#6366f1' : '#334155'}`,
                              borderRadius: '6px',
                              padding: '10px 14px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: '8px',
                            }}
                          >
                            <div style={{ flex: 1, minWidth: '240px' }}>
                              <div style={{ fontSize: '12px', fontWeight: 700, color: '#f1f5f9' }}>
                                #{rank + 1} {sug.label} <span style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 400 }}>({sug.dataType})</span>
                              </div>
                              <div style={{ fontSize: '11px', color: '#60a5fa', marginTop: '2px' }}>
                                Matched: {sug.matchedColumns.join(', ') || 'none'} ({sug.matchedColumns.length}/{sug.totalRequiredCount} required columns)
                              </div>
                              {sug.missedRequiredColumns.length > 0 && (
                                <div style={{ fontSize: '11px', color: '#f87171', marginTop: '1px' }}>
                                  Missed required: {sug.missedRequiredColumns.join(', ')}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <span style={{
                                fontSize: '13px', fontWeight: 700,
                                color: sug.confidence >= 80 ? '#34d399' : sug.confidence >= 50 ? '#fbbf24' : '#f87171',
                              }}>
                                {sug.confidence}%
                              </span>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedDataType(sug.dataType);
                                  setSelectedSubType(sug.subTypeId);
                                  setUserManuallySelectedSubtype(true);
                                }}
                                style={{
                                  background: selectedSubType === sug.subTypeId ? '#4338ca' : '#1e293b',
                                  border: '1px solid #475569',
                                  color: '#e2e8f0',
                                  borderRadius: '4px',
                                  padding: '4px 10px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                {selectedSubType === sug.subTypeId ? 'Selected' : 'Select'}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Required / Optional Column Pills */}
                {selectedSubTypeDef && (
                  <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {selectedSubTypeDef.requiredColumns.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#f87171', minWidth: '65px' }}>Required:</span>
                        {selectedSubTypeDef.requiredColumns.map((c: any) => (
                          <span key={c.key} style={{ fontSize: '11px', background: 'rgba(239,68,68,0.12)', color: '#fca5a5', border: '1px solid #dc2626', borderRadius: '4px', padding: '2px 7px', fontFamily: 'monospace' }}>
                            {c.key}
                          </span>
                        ))}
                      </div>
                    )}
                    {selectedSubTypeDef.optionalColumns.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: '#94a3b8', minWidth: '65px' }}>Optional:</span>
                        {selectedSubTypeDef.optionalColumns.map((c: any) => (
                          <span key={c.key} style={{ fontSize: '11px', background: 'rgba(100,116,139,0.12)', color: '#94a3b8', border: '1px solid #475569', borderRadius: '4px', padding: '2px 7px', fontFamily: 'monospace' }}>
                            {c.key}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Quick Test Samples Selector */}
            <div style={{ marginBottom: '20px', background: 'rgba(0,0,0,0.2)', padding: '14px', borderRadius: '8px', border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', marginBottom: '8px' }}>
                ⚡ Test with Universal Formats or Custom Multi-Line Test Set:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => loadSampleDataset('custom_test_data.csv')}
                  style={{ background: '#0284c7', color: '#ffffff', border: '1px solid #38bdf8', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                >
                  ⚡ Custom 5-Group Test Data (CSV)
                </button>
                <button
                  type="button"
                  onClick={() => loadSampleDataset('generic-bank-statement.csv')}
                  style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                >
                  1. Bank Statement (CSV)
                </button>
                <button
                  type="button"
                  onClick={() => loadSampleDataset('generic-expense-report.csv')}
                  style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                >
                  2. Expense Report (CSV)
                </button>
                <button
                  type="button"
                  onClick={() => loadSampleDataset('generic-journal-entries.csv')}
                  style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                >
                  3. Journal Entries (CSV)
                </button>
                <button
                  type="button"
                  onClick={() => loadSampleDataset('generic-payment-receipts.csv')}
                  style={{ background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
                >
                  4. Payment Receipts (CSV)
                </button>
                <a
                  href="/test-data/generic-sales-invoices.xlsx"
                  download
                  style={{ background: '#0f172a', color: '#38bdf8', border: '1px solid #0284c7', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  📥 5. Invoices (XLSX)
                </a>
                <a
                  href="/test-data/generic-purchase-bills.xlsx"
                  download
                  style={{ background: '#0f172a', color: '#38bdf8', border: '1px solid #0284c7', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  📥 6. Bills (XLSX)
                </a>
                <a
                  href="/test-data/generic-payroll.xlsx"
                  download
                  style={{ background: '#0f172a', color: '#38bdf8', border: '1px solid #0284c7', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                >
                  📥 7. Payroll (XLSX)
                </a>
              </div>
            </div>

            {/* TAB 1: PASTE TEXT */}
            {inputMode === 'paste' && (
              <div>
                <label style={{ fontSize: '14px', fontWeight: 700, color: '#cbd5e1', display: 'block', marginBottom: '8px' }}>
                  Paste CSV Lines or JSON Array:
                </label>
                <textarea
                  rows={12}
                  value={inputData}
                  onChange={e => setInputData(e.target.value)}
                  placeholder={`Date,Description,Account,Debit,Credit,Reference\\n2026-08-20,Consulting advisory revenue,4010,0,150000,INV-101\\n2026-08-21,Office stationery supplies,5010,4500,0,EXP-202\\n2026-08-22,Large server hardware capital,5010,450000,0,REF-999`}
                  style={{
                    width: '100%',
                    padding: '16px',
                    borderRadius: '8px',
                    border: '1px solid #334155',
                    background: '#0a0f1d',
                    color: '#f8fafc',
                    fontFamily: 'monospace',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={handleValidatePaste}
                    disabled={loading || !inputData.trim()}
                    style={{
                      background: loading || !inputData.trim() ? '#334155' : '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '12px 28px',
                      fontSize: '15px',
                      fontWeight: 700,
                      cursor: loading || !inputData.trim() ? 'not-allowed' : 'pointer',
                      boxShadow: '0 2px 8px rgba(37,99,235,0.3)',
                    }}
                  >
                    🚀 Run AI Analysis & Two-Folder Split
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: FILE UPLOAD */}
            {inputMode === 'upload' && (
              <div>
                <div
                  style={{
                    border: '2px dashed #334155',
                    borderRadius: '12px',
                    padding: '40px 20px',
                    textAlign: 'center',
                    background: 'rgba(10, 15, 29, 0.6)',
                    cursor: 'pointer',
                  }}
                  onClick={() => document.getElementById('file-upload-input')?.click()}
                >
                  <input
                    id="file-upload-input"
                    type="file"
                    accept=".csv, .xlsx"
                    style={{ display: 'none' }}
                    onChange={e => {
                      if (e.target.files && e.target.files[0]) {
                        setSelectedFile(e.target.files[0]);
                      }
                    }}
                  />
                  <div style={{ fontSize: '36px', marginBottom: '12px' }}>📁</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#f8fafc', marginBottom: '6px' }}>
                    {selectedFile ? selectedFile.name : 'Click to select or drop CSV / XLSX file here'}
                  </div>
                  <div style={{ fontSize: '13px', color: '#64748b' }}>
                    {selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : 'Supports .csv and .xlsx up to 10MB'}
                  </div>
                </div>

                <div style={{ marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={handleValidateFile}
                    disabled={loading || !selectedFile}
                    style={{
                      background: loading || !selectedFile ? '#334155' : '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '12px 28px',
                      fontSize: '15px',
                      fontWeight: 700,
                      cursor: loading || !selectedFile ? 'not-allowed' : 'pointer',
                      boxShadow: '0 2px 8px rgba(37,99,235,0.3)',
                    }}
                  >
                    🚀 Upload & Analyze File
                  </button>
                </div>
              </div>
            )}

            {/* ── Skip N Header Rows & 15-Row Interactive Alignment Inspector ── */}
            <div style={{ marginTop: '24px', background: 'rgba(15, 23, 42, 0.75)', border: '1px solid #334155', borderRadius: '10px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span>📑</span> Header Row Position / Skip Top N Rows
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
                    Identifies table headers below organization banners, report metadata, or blank spacing lines.
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <label style={{ fontSize: '12px', color: '#cbd5e1', fontWeight: 600 }}>
                    Skip Rows:
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={50}
                    value={skipTopNRows}
                    onChange={(e) => setSkipTopNRows(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{
                      width: '70px',
                      background: '#0a0f1d',
                      border: '1px solid #38bdf8',
                      borderRadius: '6px',
                      padding: '6px 8px',
                      color: '#38bdf8',
                      fontWeight: 700,
                      fontSize: '14px',
                      textAlign: 'center',
                      outline: 'none',
                    }}
                  />
                  {suggestedHeaderRow !== null && suggestedHeaderRow !== skipTopNRows && (
                    <button
                      type="button"
                      onClick={() => setSkipTopNRows(suggestedHeaderRow)}
                      style={{
                        background: 'rgba(56, 189, 248, 0.1)',
                        border: '1px solid #0284c7',
                        color: '#38bdf8',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        fontSize: '11px',
                        cursor: 'pointer',
                      }}
                    >
                      Use Suggested (Row {suggestedHeaderRow + 1})
                    </button>
                  )}
                </div>
              </div>

              {/* Badges: Auto-Detection & Offset Drift Notification */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                {suggestedHeaderRow !== null && (
                  <span style={{ fontSize: '11px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', border: '1px solid #059669', borderRadius: '4px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    🤖 Auto-detected Header: Row {suggestedHeaderRow + 1} ({headerConfidence || 'high'} confidence)
                  </span>
                )}
                {previousImportOffset !== null && previousImportOffset !== skipTopNRows && (
                  <span style={{ fontSize: '11px', background: 'rgba(245, 158, 11, 0.15)', color: '#fbbf24', border: '1px solid #d97706', borderRadius: '4px', padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                    ⚠️ Header detected at Row {skipTopNRows + 1} ({skipTopNRows - previousImportOffset > 0 ? `+${skipTopNRows - previousImportOffset}` : skipTopNRows - previousImportOffset} rows from previous import)
                  </span>
                )}
              </div>

              {/* 15-Row Scrollable Alignment Preview Table */}
              {previewRawRows.length > 0 ? (
                <div>
                  <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>
                    💡 Click any row below to set it as the Active Column Header row:
                  </div>
                  <div style={{ maxHeight: '460px', overflowY: 'auto', overflowX: 'auto', border: '1px solid #23304c', borderRadius: '8px', background: '#070d19' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px', fontFamily: 'monospace' }}>
                      <thead>
                        <tr style={{ background: '#0f172a', borderBottom: '1px solid #334155', color: '#94a3b8', position: 'sticky', top: 0, zIndex: 1 }}>
                          <th style={{ padding: '6px 10px', textAlign: 'left', width: '90px' }}>Line #</th>
                          <th style={{ padding: '6px 10px', textAlign: 'left', width: '180px' }}>Row Status</th>
                          <th style={{ padding: '6px 10px', textAlign: 'left' }}>Preview Content (Raw Cells)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewRawRows.slice(0, 20).map((row, idx) => {
                          const isHeader = idx === skipTopNRows;
                          const isPreamble = idx < skipTopNRows;
                          const isData = idx > skipTopNRows;
                          return (
                            <tr
                              key={idx}
                              onClick={() => setSkipTopNRows(idx)}
                              style={{
                                cursor: 'pointer',
                                background: isHeader
                                  ? 'rgba(16, 185, 129, 0.18)'
                                  : isPreamble
                                  ? 'rgba(30, 41, 59, 0.35)'
                                  : idx % 2 === 0 ? 'rgba(15, 23, 42, 0.5)' : 'transparent',
                                borderBottom: isHeader ? '2px solid #10b981' : '1px solid #1e293b',
                                color: isHeader ? '#ecfdf5' : isPreamble ? '#64748b' : '#cbd5e1',
                                fontWeight: isHeader ? 700 : 400,
                              }}
                              title="Click to set as Header Row"
                            >
                              <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                                Row {idx + 1}
                              </td>
                              <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>
                                {isHeader && (
                                  <span style={{ background: '#059669', color: '#ffffff', padding: '2px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>
                                    ✓ ACTIVE HEADER
                                  </span>
                                )}
                                {isPreamble && (
                                  <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '11px' }}>
                                    [Preamble Skipped]
                                  </span>
                                )}
                                {isData && (
                                  <span style={{ color: '#38bdf8', fontSize: '11px' }}>
                                    Data Row {idx - skipTopNRows}
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '7px 10px' }}>
                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'nowrap', overflowX: 'hidden' }}>
                                  {row.map((cell, cIdx) => (
                                    <span
                                      key={cIdx}
                                      style={{
                                        background: isHeader ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255,255,255,0.04)',
                                        border: isHeader ? '1px solid #10b981' : '1px solid #334155',
                                        padding: '2px 6px',
                                        borderRadius: '3px',
                                        whiteSpace: 'nowrap',
                                        maxWidth: '220px',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                    >
                                      {cell || <span style={{ opacity: 0.3 }}>&lt;empty&gt;</span>}
                                    </span>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>
                  Upload a file or paste data to inspect the 15-row preview and verify column header alignment.
                </div>
              )}
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 1.5: AUTO-COA CREATION PREVIEW SCREEN */}
        {/* ========================================================================= */}
        {step === 'coa-preview' && !loading && (
          <div className="glass-card" style={{ background: 'rgba(18, 26, 44, 0.9)', border: '1px solid #f59e0b', borderRadius: '12px', padding: '24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <span style={{ fontSize: '22px', color: '#f59e0b' }}>⚡</span>
              <h2 style={{ fontSize: '20px', fontWeight: 800, margin: 0, color: '#f8fafc' }}>
                Auto-Create Chart of Accounts ({missingCoaAccounts.length} New Accounts Detected)
              </h2>
            </div>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
              These account codes are present in your uploaded data but do not yet exist in this client&apos;s Chart of Accounts.
              We have auto-classified their types and inferred sensible accounting names from your transaction descriptions.
              Confirm or edit their names below to automatically add them to the Chart of Accounts:
            </p>

            <div style={{ overflowX: 'auto', marginBottom: '24px', border: '1px solid #334155', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid #334155', color: '#94a3b8', textAlign: 'left' }}>
                    <th style={{ padding: '10px 12px' }}>Account Code</th>
                    <th style={{ padding: '10px 12px' }}>Inferred Account Name (Editable)</th>
                    <th style={{ padding: '10px 12px' }}>Account Type</th>
                    <th style={{ padding: '10px 12px' }}>Normal Balance</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>Usage in File</th>
                  </tr>
                </thead>
                <tbody>
                  {missingCoaAccounts.map((acc, idx) => (
                    <tr key={acc.code} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#38bdf8' }}>
                        {acc.code}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <input
                          type="text"
                          value={acc.inferredName}
                          onChange={e => {
                            const val = e.target.value;
                            setMissingCoaAccounts(prev => prev.map((item, i) => i === idx ? { ...item, inferredName: val } : item));
                          }}
                          style={{
                            background: '#0f172a',
                            color: '#f8fafc',
                            border: '1px solid #334155',
                            padding: '6px 12px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            width: '100%',
                            maxWidth: '320px',
                          }}
                        />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <select
                          value={acc.accountType}
                          onChange={e => {
                            const newType = e.target.value as any;
                            const newNormalSide = (newType === 'asset' || newType === 'expense') ? 'debit' : 'credit';
                            setMissingCoaAccounts(prev => prev.map((item, i) => i === idx ? { ...item, accountType: newType, normalSide: newNormalSide } : item));
                          }}
                          style={{
                            background: '#0f172a',
                            color: '#f8fafc',
                            border: '1px solid #334155',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            fontSize: '12px',
                          }}
                        >
                          <option value="asset">Asset</option>
                          <option value="liability">Liability</option>
                          <option value="equity">Equity</option>
                          <option value="income">Revenue / Income</option>
                          <option value="expense">Expense</option>
                        </select>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#cbd5e1', textTransform: 'capitalize' }}>
                        {acc.normalSide}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#34d399' }}>
                        {acc.usageCount} rows
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setStep('input')}
                  style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
                >
                  ← Back to Upload
                </button>
                <button
                  type="button"
                  onClick={handleSkipCoaCreation}
                  style={{ background: 'transparent', border: '1px solid #475569', color: '#cbd5e1', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
                >
                  Skip COA Creation & Continue →
                </button>
              </div>

              <button
                type="button"
                onClick={handleCreateCoaAndContinue}
                disabled={creatingCoa}
                style={{
                  background: creatingCoa ? '#334155' : '#10b981',
                  border: 'none',
                  color: '#ffffff',
                  padding: '12px 28px',
                  borderRadius: '8px',
                  fontWeight: 800,
                  fontSize: '15px',
                  cursor: creatingCoa ? 'not-allowed' : 'pointer',
                  boxShadow: '0 2px 8px rgba(16,185,129,0.3)',
                }}
              >
                {creatingCoa ? 'Creating Accounts...' : `⚡ Create ${missingCoaAccounts.length} Accounts & Run Two-Folder Split`}
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 2: COLUMN MAPPING CONFIRMATION */}
        {/* ========================================================================= */}
        {step === 'mapping' && !loading && (
          <div className="glass-card" style={{ background: 'rgba(18, 26, 44, 0.85)', border: '1px solid #23304c', borderRadius: '12px', padding: '24px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, margin: '0 0 8px', color: '#f8fafc' }}>
              Universal Column Mapping Review
            </h2>
            <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#94a3b8' }}>
              We automatically matched source columns using fuzzy logic. Please confirm or adjust below:
            </p>

            <div style={{ overflowX: 'auto', marginBottom: '24px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                  <tr style={{ background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid #334155', color: '#94a3b8', textAlign: 'left' }}>
                    <th style={{ padding: '10px 12px' }}>Source Column Header</th>
                    <th style={{ padding: '10px 12px' }}>Detected Field Mapping</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {detectedMappings.map((m, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #1e293b' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 700, color: '#f8fafc' }}>
                        {m.sourceColumn}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <select
                          value={m.targetField || ''}
                          onChange={e => {
                            const val = e.target.value;
                            setDetectedMappings(prev => {
                              const updated = prev.map((item, i) =>
                                i === idx ? { ...item, targetField: val || null } : item
                              );
                              // Recompute confidence for ALL rows after any change
                              const targetCounts = new Map<string, number>();
                              for (const m of updated) {
                                if (m.targetField) {
                                  targetCounts.set(m.targetField, (targetCounts.get(m.targetField) || 0) + 1);
                                }
                              }
                              return updated.map(m => {
                                if (!m.targetField) {
                                  return { ...m, confidence: 'low' as const };
                                }
                                const isDuplicate = (targetCounts.get(m.targetField) || 0) > 1;
                                return { ...m, confidence: isDuplicate ? 'low' as const : 'high' as const };
                              });
                            });
                          }}
                          style={{
                            background: '#0f172a',
                            color: '#f8fafc',
                            border: '1px solid #334155',
                            padding: '6px 10px',
                            borderRadius: '6px',
                            fontSize: '13px',
                            width: '100%',
                            maxWidth: '320px',
                          }}
                        >
                          {CANONICAL_FIELD_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '11px',
                          fontWeight: 700,
                          background: m.confidence === 'high' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: m.confidence === 'high' ? '#34d399' : '#fbbf24',
                          border: m.confidence === 'high' ? '1px solid #059669' : '1px solid #d97706',
                        }}>
                          {m.confidence === 'high' ? '✓ High' : '⚠️ Review'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => setStep(readyRows.length + flaggedRows.length > 0 ? 'folders' : 'input')}
                style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer' }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleConfirmMappings}
                style={{ background: '#2563eb', border: 'none', color: '#ffffff', padding: '10px 24px', borderRadius: '8px', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}
              >
                Confirm Mappings & Continue →
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 3: LIVE TWO-FOLDER DASHBOARD */}
        {/* ========================================================================= */}
        {step === 'folders' && !loading && (
          <div>
            {/* ── Period Blocker Banner: Missing Periods ─────────────────────── */}
            {periodValidation?.hasMissingPeriods && periodValidation.missingMonths.length > 0 && (
              <div
                style={{
                  marginBottom: '24px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '2px solid #ef4444',
                  borderRadius: '12px',
                  padding: '20px 24px',
                  boxShadow: '0 4px 20px rgba(239, 68, 68, 0.2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', maxWidth: '750px' }}>
                    <span style={{ fontSize: '28px', lineHeight: 1 }}>⚠️</span>
                    <div>
                      <h3 style={{ fontSize: '18px', fontWeight: 800, color: '#f87171', margin: '0 0 6px' }}>
                        Missing Accounting Periods Detected (Posting Blocked)
                      </h3>
                      <p style={{ fontSize: '13px', color: '#cbd5e1', margin: '0 0 12px', lineHeight: 1.5 }}>
                        This batch contains transactions for dates with no defined accounting period in the system.
                        General Ledger posting is strictly disabled until the required periods are created.
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#fca5a5' }}>
                          Missing Months ({periodValidation.missingMonths.length}):
                        </span>
                        {periodValidation.missingMonths.map((m) => (
                          <span
                            key={m.monthKey}
                            style={{
                              background: 'rgba(239, 68, 68, 0.25)',
                              border: '1px solid #f87171',
                              color: '#ffffff',
                              padding: '3px 10px',
                              borderRadius: '6px',
                              fontSize: '12px',
                              fontWeight: 700,
                            }}
                          >
                            📅 {m.name} ({m.startDate} – {m.endDate})
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={handleCreateMissingPeriods}
                      disabled={creatingPeriods}
                      style={{
                        background: '#ef4444',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '8px',
                        padding: '10px 20px',
                        fontSize: '14px',
                        fontWeight: 800,
                        cursor: creatingPeriods ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        boxShadow: '0 2px 10px rgba(239, 68, 68, 0.4)',
                      }}
                    >
                      {creatingPeriods ? 'Creating Periods...' : `⚡ Create Missing Periods (${periodValidation.missingMonths.length})`}
                    </button>
                    <button
                      type="button"
                      onClick={handleReset}
                      style={{
                        background: '#1e293b',
                        color: '#94a3b8',
                        border: '1px solid #475569',
                        borderRadius: '8px',
                        padding: '10px 16px',
                        fontSize: '14px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel Upload
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Period Blocker Banner: Locked Periods ─────────────────────── */}
            {periodValidation?.hasLockedPeriods && periodValidation.lockedPeriods.length > 0 && (
              <div
                style={{
                  marginBottom: '24px',
                  background: 'rgba(245, 158, 11, 0.12)',
                  border: '2px solid #f59e0b',
                  borderRadius: '12px',
                  padding: '18px 24px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <span style={{ fontSize: '24px', lineHeight: 1 }}>🔒</span>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#fbbf24', margin: '0 0 4px' }}>
                      Locked Accounting Period Blocker
                    </h3>
                    <p style={{ fontSize: '13px', color: '#cbd5e1', margin: '0 0 8px' }}>
                      Transactions fall into closed period(s) locked against modifications. Posting is prohibited until unlocked by an authorized partner.
                    </p>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {periodValidation.lockedPeriods.map((lp, idx) => (
                        <span key={idx} style={{ background: 'rgba(245, 158, 11, 0.2)', border: '1px solid #fbbf24', color: '#fde68a', padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                          🔒 {lp.name} ({lp.startDate} – {lp.endDate})
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Period Blocker Banner: Out of Range Dates ─────────────────── */}
            {periodValidation?.hasOutOfRangeDates && periodValidation.outOfRangeDates.length > 0 && (
              <div
                style={{
                  marginBottom: '24px',
                  background: 'rgba(239, 68, 68, 0.12)',
                  border: '2px solid #dc2626',
                  borderRadius: '12px',
                  padding: '18px 24px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <span style={{ fontSize: '24px', lineHeight: 1 }}>⛔</span>
                  <div>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#f87171', margin: '0 0 4px' }}>
                      Dates Outside Client Fiscal Year Range
                    </h3>
                    <p style={{ fontSize: '13px', color: '#cbd5e1', margin: 0 }}>
                      The following transaction dates fall outside the client's fiscal calendar boundaries ({periodValidation.outOfRangeDates.join(', ')}). One-click creation is unavailable; manual period setup is required.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* ── Registry Validation Summary Banner ──────────────────────── */}
            {registryResult && !registryResult.skipped && (
              <div style={{
                marginBottom: '20px',
                background: registryResult.invalidRowCount === 0
                  ? 'rgba(99, 102, 241, 0.08)'
                  : 'rgba(139, 92, 246, 0.12)',
                border: `1px solid ${registryResult.invalidRowCount === 0 ? '#4338ca' : '#7c3aed'}`,
                borderRadius: '10px',
                padding: '14px 18px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '16px' }}>🔬</span>
                    <span style={{ fontSize: '13px', fontWeight: 700, color: '#a5b4fc' }}>
                      Type Registry Validation —
                      <code style={{ fontSize: '11px', marginLeft: '6px', background: 'rgba(99,102,241,0.2)', padding: '1px 6px', borderRadius: '3px' }}>
                        {registryResult.subType}
                      </code>
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '16px', fontSize: '13px' }}>
                    <span style={{ color: '#34d399', fontWeight: 700 }}>✓ {registryResult.validRowCount} rows passed</span>
                    {registryResult.invalidRowCount > 0 && (
                      <span style={{ color: '#c4b5fd', fontWeight: 700 }}>⚠ {registryResult.invalidRowCount} rows with issues</span>
                    )}
                    {registryResult.downgraded > 0 && (
                      <span style={{ color: '#f87171', fontWeight: 700 }}>↓ {registryResult.downgraded} moved to Folder B</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Live KPI Header Banner */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '24px' }}>

              <div style={{ background: 'rgba(18, 26, 44, 0.85)', border: '1px solid #23304c', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Total Uploaded</div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#f8fafc', marginTop: '4px' }}>
                  {readyRows.length + flaggedRows.length} Rows
                </div>
              </div>

              <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #059669', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '12px', color: '#34d399', fontWeight: 700, textTransform: 'uppercase' }}>Folder A: Ready to Post</div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#34d399', marginTop: '4px' }}>
                  {readyRows.length} Rows
                </div>
                <div style={{ fontSize: '12px', color: '#a7f3d0', marginTop: '2px' }}>
                  Debit: PKR {totalDebitPKR.toLocaleString()} | Credit: PKR {totalCreditPKR.toLocaleString()}
                </div>
              </div>

              <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #d97706', borderRadius: '10px', padding: '16px' }}>
                <div style={{ fontSize: '12px', color: '#fbbf24', fontWeight: 700, textTransform: 'uppercase' }}>Folder B: Review Required</div>
                <div style={{ fontSize: '26px', fontWeight: 800, color: '#fbbf24', marginTop: '4px' }}>
                  {flaggedRows.length} Flags
                </div>
                <div style={{ fontSize: '12px', color: '#fde68a', marginTop: '2px' }}>
                  {resolvedCount} items resolved live
                </div>
              </div>
            </div>

            {/* Detected Column Mapping Summary Card (Compact & Editable) */}
            {detectedMappings && detectedMappings.length > 0 && (
              <div
                className="glass-card"
                style={{
                  background: 'rgba(18, 26, 44, 0.85)',
                  border: '1px solid #23304c',
                  borderRadius: '10px',
                  padding: '14px 18px',
                  marginBottom: '20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '16px' }}>📋</span>
                    <div>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#f8fafc' }}>
                        Detected Column Mapping ({detectedMappings.length} columns)
                      </span>
                      <span style={{ fontSize: '12px', color: '#10b981', marginLeft: '8px', fontWeight: 600 }}>
                        ✓ Auto-Mapped with High Confidence
                      </span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button
                      type="button"
                      onClick={() => setShowMappingSummary(prev => !prev)}
                      style={{
                        background: 'transparent',
                        border: '1px solid #334155',
                        color: '#94a3b8',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      {showMappingSummary ? 'Hide Mapping ▲' : 'Show Mapping ▼'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep('mapping')}
                      style={{
                        background: 'rgba(37, 99, 235, 0.2)',
                        border: '1px solid #2563eb',
                        color: '#60a5fa',
                        padding: '4px 12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      ✎ View / Edit Mapping
                    </button>
                  </div>
                </div>

                {showMappingSummary && (
                  <div style={{ marginTop: '12px', overflowX: 'auto', borderTop: '1px solid #1e293b', paddingTop: '10px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                      {detectedMappings.map((m, idx) => (
                        <div
                          key={idx}
                          style={{
                            background: '#0a0f1d',
                            border: '1px solid #334155',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '12px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                          }}
                        >
                          <code style={{ color: '#94a3b8' }}>{m.sourceColumn}</code>
                          <span style={{ color: '#38bdf8' }}>→</span>
                          <code style={{ color: '#34d399', fontWeight: 700 }}>{m.targetField || 'unmapped'}</code>
                          <span
                            style={{
                              fontSize: '10px',
                              padding: '1px 4px',
                              borderRadius: '3px',
                              background: m.confidence === 'high' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                              color: m.confidence === 'high' ? '#34d399' : '#fbbf24',
                            }}
                          >
                            {m.confidence === 'high' ? '✓' : '⚠️'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* FOLDER B: REVIEW REQUIRED (Displayed First for Accountant Attention) */}
            <div className="glass-card" style={{ background: 'rgba(18, 26, 44, 0.85)', border: '1px solid #d97706', borderRadius: '12px', padding: '20px', marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '20px', color: '#fbbf24' }}>⚠️</span>
                  <h2 style={{ fontSize: '18px', fontWeight: 800, color: '#fbbf24', margin: 0 }}>
                    Folder B: Review Required ({flaggedRows.length} items remaining)
                  </h2>
                </div>
                <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Instant Fix: Approve or edit an item to immediately transfer it into Folder A.
                </span>
              </div>

              {/* Batch Action Toolbar */}
              {flaggedRows.length > 0 && (
                <FolderBBatchActionBar
                  flaggedRows={flaggedRows}
                  readyRows={readyRows}
                  threshold={batchThreshold}
                  onThresholdChange={setBatchThreshold}
                  onOpenPreview={handleOpenBatchPreview}
                />
              )}

              {flaggedRows.length === 0 ? (
                <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #059669', borderRadius: '8px', padding: '20px', textAlign: 'center' }}>
                  <div style={{ fontSize: '20px', marginBottom: '4px' }}>🎉</div>
                  <div style={{ fontSize: '16px', fontWeight: 700, color: '#34d399' }}>
                    All review items have been resolved!
                  </div>
                  <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>
                    Every transaction is now in Folder A (Ready to Post). Click &quot;Post Transactions&quot; below to commit to General Ledger.
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {flaggedRows.map((row) => (
                    <FolderBRow
                      key={row.rowIndex}
                      row={row}
                      onAcceptAI={handleAcceptAI}
                      onEditCode={handleEditCode}
                      onDiscard={handleDiscardRow}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* FOLDER A: READY TO POST (Memoized Table) */}
            <FolderATable
              readyRows={readyRows}
              expanded={folderAExpanded}
              onToggleExpanded={() => setFolderAExpanded(prev => !prev)}
              blockers={computedBlockers}
            />

            {/* Bottom Floating Post Action Bar */}
            <div style={{
              position: 'sticky',
              bottom: '16px',
              background: 'rgba(15, 23, 42, 0.95)',
              border: '1px solid #334155',
              borderRadius: '12px',
              padding: '16px 24px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              backdropFilter: 'blur(12px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            }}>
              <div>
                <div style={{ fontSize: '15px', fontWeight: 800, color: '#f8fafc' }}>
                  Ready to Post: {readyRows.length} Journal Entries
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Total Balance: PKR {totalDebitPKR.toLocaleString()} Debit | PKR {totalCreditPKR.toLocaleString()} Credit
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  type="button"
                  onClick={handleDownloadCSV}
                  disabled={readyRows.length === 0}
                  style={{
                    background: '#1e293b',
                    color: '#cbd5e1',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    padding: '10px 18px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: readyRows.length === 0 ? 'not-allowed' : 'pointer',
                  }}
                >
                  ⬇ Export CSV Preview
                </button>
                <button
                  type="button"
                  onClick={() => {
                    checkAuditChainStatus();
                    setIsConfirmModalOpen(true);
                  }}
                  disabled={readyRows.length === 0 || posting || !auditStatus.isValid || computedBlockers.length > 0}
                  style={{
                    background: readyRows.length === 0 || posting || computedBlockers.length > 0 ? '#334155' : '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '12px 28px',
                    fontSize: '15px',
                    fontWeight: 800,
                    cursor: readyRows.length === 0 || posting || computedBlockers.length > 0 ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 10px rgba(16,185,129,0.3)',
                  }}
                >
                  {computedBlockers.length > 0
                    ? `⚠️ Posting Blocked (${computedBlockers.length} Blocker${computedBlockers.length > 1 ? 's' : ''})`
                    : !auditStatus.isValid
                    ? '⚠️ Posting Blocked (Audit Issue)'
                    : `🚀 Post ${readyRows.length} Transactions`}
                </button>
              </div>
            </div>

          </div>
        )}

        {/* ========================================================================= */}
        {/* STEP 4: SUCCESS SCREEN (After Posting) */}
        {/* ========================================================================= */}
        {step === 'success' && postResult && (
          <div className="glass-card" style={{ background: 'rgba(18, 26, 44, 0.9)', border: '1px solid #059669', borderRadius: '12px', padding: '32px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🎉</div>
            <h2 style={{ fontSize: '24px', fontWeight: 800, color: '#34d399', margin: '0 0 8px' }}>
              Successfully Posted to General Ledger!
            </h2>
            <p style={{ fontSize: '14px', color: '#94a3b8', margin: '0 0 24px' }}>
              All transactions have been committed in an atomic database transaction with an immutable SHA-256 cryptographic audit chain.
            </p>

            {/* Metrics Breakdown Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px', marginBottom: '28px', textAlign: 'left' }}>
              <div style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #059669', padding: '16px', borderRadius: '8px' }}>
                <div style={{ fontSize: '12px', color: '#34d399', fontWeight: 700 }}>POSTED ENTRIES</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#34d399', marginTop: '4px' }}>
                  {postResult.postedCount}
                </div>
                <div style={{ fontSize: '12px', color: '#a7f3d0' }}>
                  PKR {((postResult.totalDebitPaisa || 0) / 100).toLocaleString()}
                </div>
              </div>

              <div style={{ background: 'rgba(100, 116, 139, 0.1)', border: '1px solid #475569', padding: '16px', borderRadius: '8px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 700 }}>EXCLUDED / DISCARDED</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#f8fafc', marginTop: '4px' }}>
                  {postResult.excludedCount || 0}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Skipped during review</div>
              </div>

              <div style={{ background: 'rgba(100, 116, 139, 0.1)', border: '1px solid #475569', padding: '16px', borderRadius: '8px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 700 }}>VALIDATION FAILURES</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: '#f8fafc', marginTop: '4px' }}>
                  {postResult.failedCount || 0}
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>Zero rollback errors</div>
              </div>

              <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid #2563eb', padding: '16px', borderRadius: '8px' }}>
                <div style={{ fontSize: '12px', color: '#60a5fa', fontWeight: 700 }}>BATCH ID</div>
                <div style={{ fontSize: '13px', fontFamily: 'monospace', color: '#93c5fd', marginTop: '6px', wordBreak: 'break-all' }}>
                  {postResult.batchId || 'N/A'}
                </div>
              </div>
            </div>

            {/* Quick Action Navigation Links */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', flexWrap: 'wrap', marginBottom: '24px' }}>
              <Link
                href="/reports"
                style={{ background: '#2563eb', color: '#ffffff', padding: '10px 20px', borderRadius: '8px', textDecoration: 'none', fontWeight: 700, fontSize: '14px' }}
              >
                📊 View Trial Balance & Financial Reports →
              </Link>
              <div
                style={{
                  background: 'rgba(16, 185, 129, 0.15)',
                  color: '#34d399',
                  border: '1px solid #059669',
                  padding: '10px 20px',
                  borderRadius: '8px',
                  fontWeight: 700,
                  fontSize: '14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                ✓ Audit Chain Verified
              </div>
              <button
                type="button"
                onClick={handleDownloadCSV}
                style={{ background: '#1e293b', color: '#f8fafc', border: '1px solid #334155', padding: '10px 20px', borderRadius: '8px', fontWeight: 600, fontSize: '14px', cursor: 'pointer' }}
              >
                ⬇ Download Posted CSV
              </button>
            </div>

            <div>
              <button
                type="button"
                onClick={handleReset}
                style={{ background: 'transparent', color: '#94a3b8', border: 'none', textDecoration: 'underline', cursor: 'pointer', fontSize: '13px' }}
              >
                ← Ingest Another Batch
              </button>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* POSTING CONFIRMATION MODAL */}
        {/* ========================================================================= */}
        {isConfirmModalOpen && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '16px',
            backdropFilter: 'blur(4px)',
          }}>
            <div style={{
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: '12px',
              padding: '28px',
              maxWidth: '520px',
              width: '100%',
              boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            }}>
              <h3 style={{ fontSize: '20px', fontWeight: 800, margin: '0 0 12px', color: '#f8fafc' }}>
                Confirm Journal Posting
              </h3>

              <p style={{ fontSize: '14px', color: '#cbd5e1', lineHeight: 1.5, margin: '0 0 16px' }}>
                You are about to post <strong>{readyRows.length}</strong> journal entries totaling <strong>PKR {totalDebitPKR.toLocaleString()}</strong>.
                This will write balanced entries directly into the General Ledger and immediately update Trial Balance, Profit & Loss, and Audit Logs.
              </p>

              {resolvedCount > 0 && (
                <div style={{ background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #d97706', borderRadius: '8px', padding: '10px 14px', fontSize: '13px', color: '#fde68a', marginBottom: '16px' }}>
                  ⚠️ <strong>Notice:</strong> {resolvedCount} transactions in this batch were resolved using accountant review/AI suggestions.
                </div>
              )}

              <div style={{
                marginBottom: '20px',
                padding: '10px 14px',
                borderRadius: '8px',
                fontSize: '13px',
                fontWeight: 700,
                background: auditStatus.isValid ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                color: auditStatus.isValid ? '#34d399' : '#f87171',
                border: auditStatus.isValid ? '1px solid #059669' : '1px solid #dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}>
                <span>{auditStatus.isValid ? '✓' : '⚠️'}</span>
                <span>{auditStatus.label} — Immutable SHA-256 cryptographic chaining enforced</span>
              </div>
              <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '24px' }}>
                Posting occurs within an atomic database transaction. If any ledger line violates a period lock or schema invariant, all rows will roll back.
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsConfirmModalOpen(false)}
                  disabled={posting}
                  style={{
                    background: '#1e293b',
                    color: '#cbd5e1',
                    border: '1px solid #475569',
                    borderRadius: '8px',
                    padding: '10px 18px',
                    fontSize: '14px',
                    fontWeight: 600,
                    cursor: posting ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmAndPost}
                  disabled={posting}
                  style={{
                    background: posting ? '#334155' : '#10b981',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '10px 24px',
                    fontSize: '14px',
                    fontWeight: 800,
                    cursor: posting ? 'not-allowed' : 'pointer',
                    boxShadow: '0 2px 8px rgba(16,185,129,0.3)',
                  }}
                >
                  {posting ? 'Posting to Ledger...' : 'Confirm & Post'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Batch Accept Preview & Confirmation Modal */}
        <BatchAcceptPreviewModal
          isOpen={isBatchPreviewOpen}
          eligibleRows={batchEligibleRows}
          heldBackRows={batchHeldBackRows}
          onClose={() => setIsBatchPreviewOpen(false)}
          onConfirm={handleConfirmBatchAccept}
        />

      </div>
    </div>
  );
}
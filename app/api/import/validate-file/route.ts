import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { processTwoFolderPipeline } from '@/lib/data-cleaning/two-folder-pipeline';
import { parseFileBuffer } from '@/lib/data-cleaning/file-parser';
import { autoMapColumns } from '@/lib/data-cleaning/column-mapper';
import {
  validateDataWithRegistry,
  TypeRegistryError,
  type RegistryValidationResult,
} from '@/lib/ingestion/type-registry';
import { suggestSubtypes } from '@/lib/import-wizard/subtype-suggester';
import { logSubtypeSuggestion } from '@/lib/telemetry/subtype-telemetry';

export async function POST(req: NextRequest) {
  try {
    const session = await verifySession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const clientIdStr = formData.get('clientId') as string | null;
    const dataType = (formData.get('dataType') as string | null)?.trim() || '';
    const subType = (formData.get('subType') as string | null)?.trim() || '';
    const skipTopNRowsStr = (formData.get('skipTopNRows') as string | null)?.trim();
    const skipTopNRows = skipTopNRowsStr !== null && skipTopNRowsStr !== '' && !isNaN(Number(skipTopNRowsStr))
      ? Number(skipTopNRowsStr)
      : undefined;

    if (!file) {
      return NextResponse.json({ error: 'File is required' }, { status: 400 });
    }

    const clientId = Number(clientIdStr);
    if (!clientId || isNaN(clientId)) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    // Validate file size (≤ 10MB)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File size must be less than 10MB' }, { status: 400 });
    }

    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.csv') && !fileName.endsWith('.xlsx')) {
       return NextResponse.json({ error: 'File must be a .csv or .xlsx' }, { status: 400 });
    }

    const buffer = await file.arrayBuffer();
    const parsedFile = await parseFileBuffer(Buffer.from(buffer), file.name, skipTopNRows);

    const columnMappings = autoMapColumns(parsedFile.headers);

    // Unified mapping: produces row objects that both the pipeline AND registry can read.
    // Keys like `date`, `debit`, `credit`, `description` are written alongside
    // `entryDate`, `debitPaisa`, etc. — one mapping call, one shared row object.
    const rawRows = applyColumnMappings(parsedFile.data, columnMappings);

    const result = await processTwoFolderPipeline({
      firmId: session.firmId,
      clientId,
      rows: rawRows,
    });

    // ── Registry Overlay ────────────────────────────────────────────────────
    // Runs AFTER the pipeline, is ADDITIVE ONLY, and never throws to the caller.
    // If registry validation errors or ENABLE_TYPE_REGISTRY=false, the pipeline result is returned unchanged.
    let registryResult: RegistryOverlaySummary | null = null;
    const enableTypeRegistry = process.env.ENABLE_TYPE_REGISTRY !== 'false';

    if (enableTypeRegistry && dataType && subType) {
      try {
        // normalizeRowsForRegistry stamps sourceRowNumber so the overlay can
        // match ValidationIssues back to PipelineProcessedRows by rowIndex.
        const normalizedForRegistry = normalizeRowsForRegistry(rawRows);
        const regValidation = validateDataWithRegistry(dataType, subType, normalizedForRegistry);
        registryResult = applyRegistryOverlay(result, regValidation);
      } catch (registryError: any) {
        // TypeRegistryError (unknown subtype) or any other bug — gracefully skip.
        console.error('[Registry overlay] Non-fatal error — skipping registry validation:', registryError);
        registryResult = {
          skipped: true,
          reason: registryError instanceof TypeRegistryError
            ? registryError.message
            : 'Internal registry error',
        } as any;
      }
    }

    // Phase 4: Compute heuristic subtype suggestions from detected headers (guarded by flag)
    const enableSubtypeSuggestion = process.env.ENABLE_SUBTYPE_SUGGESTION !== 'false';
    const subtypeSuggestions = enableSubtypeSuggestion
      ? suggestSubtypes(parsedFile.headers, {
          dataTypeScope: dataType ? (dataType as any) : undefined,
        })
      : {
          topSuggestions: [],
          isTie: false,
          isLowConfidence: false,
          detectedHeaders: parsedFile.headers,
          normalizedHeaders: parsedFile.headers,
        };

    // Log suggestion telemetry event asynchronously (non-blocking, guarded by flag)
    const enableTelemetry = process.env.ENABLE_SUBTYPE_TELEMETRY !== 'false';
    if (enableTelemetry && subtypeSuggestions.topSuggestions.length > 0) {
      logSubtypeSuggestion({
        clientId: clientId ? parseInt(String(clientId), 10) : null,
        suggestedSubtype: subtypeSuggestions.topSuggestions[0]!.subTypeId,
        confidenceScore: subtypeSuggestions.topSuggestions[0]!.confidence,
        topCandidates: subtypeSuggestions.topSuggestions.map((s: any) => ({
          subTypeId: s.subTypeId,
          label: s.label,
          confidence: s.confidence,
        })),
        userSelectedSubtype: subType || null,
        fileHeaders: parsedFile.headers,
      }).catch((err: any) => console.error('[Telemetry log error]:', err));
    }

    return NextResponse.json({
      ...result,
      columnMappings,
      rawRows: parsedFile.data,
      rawGrid: parsedFile.rawRows,
      suggestedHeaderRow: parsedFile.suggestedHeaderRow,
      headerDetectionConfidence: parsedFile.headerDetectionConfidence,
      skippedPreambleRows: parsedFile.skippedPreambleRows,
      structuralFingerprint: parsedFile.structuralFingerprint,
      exactTextFingerprint: parsedFile.exactTextFingerprint,
      registryResult,
      subtypeSuggestions,
    });
  } catch (error: any) {
    console.error('File validation failed:', error);
    return NextResponse.json({ error: error.message || 'File validation failed' }, { status: 500 });
  }
}

// ── Shared Utilities ────────────────────────────────────────────────────────

/**
 * applyColumnMappings: maps raw source-header keys to canonical field names.
 *
 * Writes BOTH the pipeline-internal aliases (debitPaisa, entryDate, …) AND
 * the short registry keys (debit, credit, date, …) onto the SAME row object,
 * so that both the two-folder pipeline and the registry overlay read the same
 * data without any secondary mapping layer.
 */
export function applyColumnMappings(rows: Record<string, string>[], mappings: any[]): any[] {
  return rows.map((row, i) => {
    // Preserve caller-supplied rowIndex (e.g. from JSON body in paste path).
    // Fall back to 1-based array position only when not provided.
    const originalRowIndex = (row as any).rowIndex;
    const mapped: any = {
      ...row,
      rowIndex: typeof originalRowIndex === 'number' ? originalRowIndex : i + 1,
    };
    for (const m of mappings) {
      if (!m.targetField) continue;
      const val = (row as any)[m.sourceColumn];
      if (val === undefined || val === '' || val === null) continue;
      // Map targetField to RawInputRow property names
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
          if (!mapped.description) mapped.description = val;
          break;
        case 'line_description':
          mapped.lineDescription = val;
          mapped.line_description = val;
          if (!mapped.description) mapped.description = val;
          break;
        case 'memo':
          mapped.memo = val;
          if (!mapped.description) mapped.description = val;
          break;
        case 'transaction_id':
          mapped.transactionId = val;
          mapped.transaction_id = val;
          break;
        case 'entry_date':
          mapped.date = val;       // registry key
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
          mapped.debitPaisa = val;
          mapped.debit_paisa = val;
          // When source column is NOT literally 'debit_paisa', write 'debit' for registry
          if (m.sourceColumn.toLowerCase() !== 'debit_paisa') {
            mapped.debit = val;
          }
          break;
        case 'credit_paisa':
          mapped.creditPaisa = val;
          mapped.credit_paisa = val;
          // When source column is NOT literally 'credit_paisa', write 'credit' for registry
          if (m.sourceColumn.toLowerCase() !== 'credit_paisa') {
            mapped.credit = val;
          }
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

/**
 * normalizeRowsForRegistry: stamps `sourceRowNumber` onto each row so that
 * the registry overlay can match ValidationIssues back to PipelineProcessedRows.
 * `rowIndex` (1-based, set by applyColumnMappings) becomes `sourceRowNumber`.
 */
export function normalizeRowsForRegistry(rows: any[]): Record<string, any>[] {
  return rows.map((r) => ({
    ...r,
    sourceRowNumber: typeof r.rowIndex === 'number' ? r.rowIndex : r.sourceRowNumber ?? 1,
  }));
}

// ── Registry Overlay Types ──────────────────────────────────────────────────

export interface RegistryOverlaySummary {
  dataType: string;
  subType: string;
  totalRows: number;
  validRowCount: number;
  invalidRowCount: number;
  /** Number of rows whose status was downgraded from ready_to_post → review_required by registry. */
  downgraded: number;
  skipped?: boolean;
  reason?: string;
}

/**
 * applyRegistryOverlay: merges ValidationIssues from the registry into the
 * pipeline result's rows. Issues are added as REGISTRY_RULE flags.
 *
 * Rules:
 * 1. Matches by sourceRowNumber === pipelineRow.rowIndex.
 * 2. Deduplicates by `ruleId + canonicalColumn` per row.
 * 3. Any row gaining an error-severity REGISTRY_RULE flag and currently
 *    `ready_to_post` is downgraded to `review_required`.
 */
export function applyRegistryOverlay(
  pipelineResult: any,
  regValidation: RegistryValidationResult
): RegistryOverlaySummary {
  let downgraded = 0;

  // Build a map: sourceRowNumber → ValidationIssue[]
  const issuesByRow = new Map<number, typeof regValidation.issues>();
  for (const issue of regValidation.issues) {
    const existing = issuesByRow.get(issue.sourceRowNumber) ?? [];
    existing.push(issue);
    issuesByRow.set(issue.sourceRowNumber, existing);
  }

  // Merge into readyRows
  for (const row of pipelineResult.readyRows ?? []) {
    const issues = issuesByRow.get(row.rowIndex);
    if (!issues || issues.length === 0) continue;

    const existingKeys = new Set(
      (row.flags ?? [])
        .filter((f: any) => f.type === 'REGISTRY_RULE')
        .map((f: any) => `${f.ruleId}:${f.canonicalColumn ?? ''}`)
    );

    let hasNewError = false;
    for (const issue of issues) {
      const key = `${issue.ruleId}:${issue.canonicalColumn ?? ''}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      row.flags = [...(row.flags ?? []), {
        type: 'REGISTRY_RULE',
        ruleId: issue.ruleId,
        canonicalColumn: issue.canonicalColumn,
        severity: issue.severity,
        message: issue.message,
      }];
      if (issue.severity === 'error') hasNewError = true;
    }

    if (hasNewError) {
      row.status = 'review_required';
      downgraded++;
    }
  }

  // Merge into flaggedRows
  for (const row of pipelineResult.flaggedRows ?? []) {
    const issues = issuesByRow.get(row.rowIndex);
    if (!issues || issues.length === 0) continue;

    const existingKeys = new Set(
      (row.flags ?? [])
        .filter((f: any) => f.type === 'REGISTRY_RULE')
        .map((f: any) => `${f.ruleId}:${f.canonicalColumn ?? ''}`)
    );

    for (const issue of issues) {
      const key = `${issue.ruleId}:${issue.canonicalColumn ?? ''}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      row.flags = [...(row.flags ?? []), {
        type: 'REGISTRY_RULE',
        ruleId: issue.ruleId,
        canonicalColumn: issue.canonicalColumn,
        severity: issue.severity,
        message: issue.message,
      }];
    }
  }

  return {
    dataType: regValidation.dataType,
    subType: regValidation.subType,
    totalRows: regValidation.totalRows,
    validRowCount: regValidation.validRowCount,
    invalidRowCount: regValidation.invalidRowCount,
    downgraded,
  };
}

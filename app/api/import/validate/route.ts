import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { processTwoFolderPipeline } from '@/lib/data-cleaning/two-folder-pipeline';
import { checkRateLimit, getClientIp } from '@/lib/middleware/rate-limit';
import { autoMapColumns } from '@/lib/data-cleaning/column-mapper';
import {
  validateDataWithRegistry,
  TypeRegistryError,
} from '@/lib/ingestion/type-registry';
import {
  applyColumnMappings,
  normalizeRowsForRegistry,
  applyRegistryOverlay,
  type RegistryOverlaySummary,
} from '@/app/api/import/validate-file/route';

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rateLimit = checkRateLimit(`validate-import:${ip}`, 50, 60000); // 50 requests per minute
    if (!rateLimit.allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }

    const session = await verifySession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { clientId, rows, batchType, dataType = '', subType = '' } = body;

    const targetClientId = Number(clientId);
    if (!targetClientId || isNaN(targetClientId)) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 });
    }

    // ── Column normalisation (paste path) ──────────────────────────────────
    // The paste route receives rows whose keys may be raw header strings
    // (e.g. "Dr", "Narration") rather than canonical field names.
    // We run the same autoMapColumns + applyColumnMappings chain as the
    // file-upload route so that both the pipeline AND the registry overlay
    // see the identical canonical keys (date, debit, credit, description …).
    const headerKeys = Object.keys(rows[0] || {}).filter((k) => k !== 'rowIndex');
    let processedRows = rows;

    if (headerKeys.length > 0) {
      const mappings = autoMapColumns(headerKeys);
      const hasAnyMapping = mappings.some((m) => m.targetField !== null);
      if (hasAnyMapping) {
        // Re-apply mapping only when source headers need translation.
        // If keys are already canonical (e.g. called internally with mapped rows)
        // the mapping is a no-op that preserves all fields under the default branch.
        processedRows = applyColumnMappings(rows as any, mappings);
      }
    }

    const result = await processTwoFolderPipeline({
      firmId: session.firmId,
      clientId: targetClientId,
      rows: processedRows,
      batchType,
    });

    const columnMappings = headerKeys.length > 0 ? autoMapColumns(headerKeys) : [];

    // ── Registry Overlay ─────────────────────────────────────────────────
    let registryResult: RegistryOverlaySummary | null = null;

    if (dataType && subType) {
      try {
        const normalizedForRegistry = normalizeRowsForRegistry(processedRows);
        const regValidation = validateDataWithRegistry(dataType, subType, normalizedForRegistry);
        registryResult = applyRegistryOverlay(result, regValidation);
      } catch (registryError: any) {
        console.error('[Registry overlay] Non-fatal error — skipping registry validation:', registryError);
        registryResult = {
          skipped: true,
          reason: registryError instanceof TypeRegistryError
            ? registryError.message
            : 'Internal registry error',
        } as any;
      }
    }

    return NextResponse.json({ ...result, columnMappings, registryResult });
  } catch (error: any) {
    console.error('Import validation failed:', error);
    return NextResponse.json({ error: error.message || 'Validation failed' }, { status: 500 });
  }
}

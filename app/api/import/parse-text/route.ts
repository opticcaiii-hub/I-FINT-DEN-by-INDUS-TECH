import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { parseCSVText } from '@/lib/data-cleaning/file-parser';
import { autoMapColumns } from '@/lib/data-cleaning/column-mapper';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = await verifySession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { text, rawContent, clientId, skipTopNRows } = body;
    const content = text || rawContent;

    if (!content || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'Raw text content is required' }, { status: 400 });
    }

    const trimmed = content.trim();

    // Support JSON array directly if user pasted JSON
    if (trimmed.startsWith('[')) {
      try {
        const parsedJson = JSON.parse(trimmed);
        if (Array.isArray(parsedJson) && parsedJson.length > 0) {
          const headers = Object.keys(parsedJson[0] || {});
          const columnMappings = autoMapColumns(headers);
          const rowsWithIndex = parsedJson.map((r, i) => ({ rowIndex: i + 1, ...r }));
          return NextResponse.json({
            headers,
            rows: rowsWithIndex,
            rowCount: parsedJson.length,
            columnMappings,
          });
        }
      } catch (err: any) {
        return NextResponse.json({ error: `Invalid JSON format: ${err.message}` }, { status: 400 });
      }
    }

    // Server-side robust CSV parsing with optional skipTopNRows
    const skipOffset = typeof skipTopNRows === 'number' && skipTopNRows >= 0 ? skipTopNRows : undefined;
    const parsed = parseCSVText(trimmed, skipOffset);
    const columnMappings = autoMapColumns(parsed.headers);
    const rowsWithIndex = parsed.rows.map((r, i) => ({ rowIndex: i + 1, ...r }));

    return NextResponse.json({
      headers: parsed.headers,
      rows: rowsWithIndex,
      rowCount: parsed.rowCount,
      columnMappings,
      suggestedHeaderRow: parsed.suggestedHeaderRow,
      headerDetectionConfidence: parsed.headerDetectionConfidence,
      skippedPreambleRows: parsed.skippedPreambleRows,
      rawRows: parsed.rawRows,
      structuralFingerprint: parsed.structuralFingerprint,
      exactTextFingerprint: parsed.exactTextFingerprint,
    });
  } catch (error: any) {
    console.error('Parse text error:', error);
    return NextResponse.json({ error: error.message || 'Failed to parse raw text' }, { status: 400 });
  }
}

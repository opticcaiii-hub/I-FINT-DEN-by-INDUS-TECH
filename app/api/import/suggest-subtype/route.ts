/**
 * app/api/import/suggest-subtype/route.ts
 *
 * Endpoint to run Heuristic Subtype Auto-Suggestion on raw or detected column headers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { suggestSubtypes } from '@/lib/import-wizard/subtype-suggester';
import { DataType } from '@/lib/ingestion/type-registry';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const headers: string[] = Array.isArray(body.headers) ? body.headers : [];
    const dataTypeScope: DataType | undefined = body.dataTypeScope;

    if (headers.length === 0) {
      return NextResponse.json(
        { error: 'No column headers provided for suggestion' },
        { status: 400 }
      );
    }

    const enableSubtypeSuggestion = process.env.ENABLE_SUBTYPE_SUGGESTION !== 'false';
    const result = enableSubtypeSuggestion
      ? suggestSubtypes(headers, { dataTypeScope })
      : {
          topSuggestions: [],
          isTie: false,
          isLowConfidence: false,
          detectedHeaders: headers,
          normalizedHeaders: headers,
        };

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: any) {
    console.error('Subtype suggestion failed:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to compute subtype suggestions' },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { requireSession, requireClientAccess } from '@/lib/auth';
import { getCashFlowStatement } from '@/lib/reports/cash-flow';
import { ReportAccessDeniedError } from '@/lib/reports/report-auth';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await context.params;
    const clientId = parseInt(id, 10);
    if (isNaN(clientId)) {
      return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
    }

    // Verify session role has access to this client (firm membership + active check)
    await requireClientAccess(session, clientId);

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    if (!startDate || !endDate) {
      return NextResponse.json({ error: 'startDate and endDate are required (YYYY-MM-DD)' }, { status: 400 });
    }

    // firmId derived from authenticated session — never from browser input
    const report = await getCashFlowStatement(session.firmId, clientId, startDate, endDate);
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof ReportAccessDeniedError) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    if (error instanceof Error && error.message === 'Authentication required') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (error instanceof Error && error.message.includes('access denied')) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }
    const message = error instanceof Error ? error.message : 'Failed to generate cash flow statement';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

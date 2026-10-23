import { NextResponse } from 'next/server';
import { requireSession, requireClientAccess } from '@/lib/auth';
import { getProfitAndLoss } from '@/lib/reports/profit-loss';
import { ReportAccessDeniedError } from '@/lib/reports/report-auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const clientId = parseInt(id, 10);
    if (isNaN(clientId)) {
      return NextResponse.json({ error: 'Invalid client ID' }, { status: 400 });
    }

    // Verify session role has access to this client (firm membership + active check)
    await requireClientAccess(session, clientId);

    const { searchParams } = new URL(request.url);
    const today = new Date();
    const defaultStart = `${today.getFullYear()}-01-01`;
    const defaultEnd = today.toISOString().substring(0, 10);

    const startDate = searchParams.get('startDate') || defaultStart;
    const endDate = searchParams.get('endDate') || defaultEnd;

    // firmId derived from authenticated session — never from browser input
    const report = await getProfitAndLoss(session.firmId, clientId, startDate, endDate);
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
    const message = error instanceof Error ? error.message : 'Failed to generate Profit & Loss report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

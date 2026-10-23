import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { calculateAccuracyMetrics } from '@/lib/data-cleaning/active-learning';
import { verifyAuditChain } from '@/lib/data-cleaning/audit-chain';

export async function GET(req: NextRequest) {
  try {
    const session = await verifySession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const metrics = await calculateAccuracyMetrics(session.firmId);
    const auditStatus = await verifyAuditChain(session.firmId);

    return NextResponse.json({
      metrics,
      auditChainStatus: {
        isValid: auditStatus.isValid,
        totalVerifiedRecords: auditStatus.totalRecordsChecked,
        details: auditStatus.details || 'Cryptographic SHA-256 chain intact.',
      },
    });
  } catch (error: any) {
    console.error('Review query failed:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch review metrics' }, { status: 500 });
  }
}

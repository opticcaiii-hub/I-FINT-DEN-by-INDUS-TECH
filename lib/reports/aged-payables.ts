/**
 * Aged Payables Report
 *
 * Groups outstanding purchase bill balances into ageing buckets:
 *   Current (0-30 days), 31-60 days, 61-90 days, Over 90 days
 *
 * All values in integer paisa (BIGINT).
 *
 * Security: firmId is always derived from the authenticated session —
 * never trusted from the browser. verifyClientBelongsToFirm() confirms
 * the client belongs to the requesting firm before any data is returned.
 */

import { query } from '@/lib/db';
import { verifyClientBelongsToFirm } from './report-auth';

export interface AgedVendorRow {
  vendorId: number;
  vendorName: string;
  currentPaisa: number;
  days31to60Paisa: number;
  days61to90Paisa: number;
  over90Paisa: number;
  totalPaisa: number;
}

export interface AgedPayablesReport {
  clientId: number;
  asOfDate: string;
  rows: AgedVendorRow[];
  totalCurrentPaisa: number;
  totalDays31to60Paisa: number;
  totalDays61to90Paisa: number;
  totalOver90Paisa: number;
  grandTotalPaisa: number;
}

interface BillAgeRow {
  vendor_id: number;
  vendor_name: string;
  total_paisa: string;
  paid_paisa: string;
  due_date: string;
}

export async function getAgedPayables(
  firmId: number,
  clientId: number,
  asOfDate: string
): Promise<AgedPayablesReport> {
  // Security: verify the client belongs to the requesting firm before touching any data
  await verifyClientBelongsToFirm(firmId, clientId);

  const result = await query<BillAgeRow>(`
    SELECT
      v.id as vendor_id,
      v.name as vendor_name,
      pb.total_paisa::text as total_paisa,
      pb.paid_paisa::text as paid_paisa,
      pb.due_date::text as due_date
    FROM purchase_bills pb
    JOIN vendors v ON pb.vendor_id = v.id
    WHERE pb.client_id = $1
      AND pb.status IN ('posted', 'partially_paid', 'partial')
      AND pb.bill_date <= $2
    ORDER BY v.name, pb.due_date
  `, [clientId, asOfDate]);

  const vendorMap = new Map<number, AgedVendorRow>();
  const asOf = new Date(asOfDate + 'T00:00:00Z');

  for (const row of result.rows) {
    const outstanding = (parseInt(row.total_paisa, 10) || 0) - (parseInt(row.paid_paisa, 10) || 0);
    if (outstanding <= 0) continue;

    const due = new Date(row.due_date + 'T00:00:00Z');
    const daysPast = Math.floor((asOf.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));

    let entry = vendorMap.get(row.vendor_id);
    if (!entry) {
      entry = {
        vendorId: row.vendor_id,
        vendorName: row.vendor_name,
        currentPaisa: 0,
        days31to60Paisa: 0,
        days61to90Paisa: 0,
        over90Paisa: 0,
        totalPaisa: 0,
      };
      vendorMap.set(row.vendor_id, entry);
    }

    if (daysPast <= 30) entry.currentPaisa += outstanding;
    else if (daysPast <= 60) entry.days31to60Paisa += outstanding;
    else if (daysPast <= 90) entry.days61to90Paisa += outstanding;
    else entry.over90Paisa += outstanding;

    entry.totalPaisa += outstanding;
  }

  const rows = Array.from(vendorMap.values()).sort((a, b) => a.vendorName.localeCompare(b.vendorName));

  let totalCurrentPaisa = 0;
  let totalDays31to60Paisa = 0;
  let totalDays61to90Paisa = 0;
  let totalOver90Paisa = 0;
  let grandTotalPaisa = 0;

  for (const r of rows) {
    totalCurrentPaisa += r.currentPaisa;
    totalDays31to60Paisa += r.days31to60Paisa;
    totalDays61to90Paisa += r.days61to90Paisa;
    totalOver90Paisa += r.over90Paisa;
    grandTotalPaisa += r.totalPaisa;
  }

  return {
    clientId,
    asOfDate,
    rows,
    totalCurrentPaisa,
    totalDays31to60Paisa,
    totalDays61to90Paisa,
    totalOver90Paisa,
    grandTotalPaisa,
  };
}

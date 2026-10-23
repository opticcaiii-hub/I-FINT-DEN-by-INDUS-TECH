/**
 * Aged Receivables Report
 *
 * Groups outstanding invoice balances into ageing buckets:
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

export interface AgedCustomerRow {
  customerId: number;
  customerName: string;
  currentPaisa: number;
  days31to60Paisa: number;
  days61to90Paisa: number;
  over90Paisa: number;
  totalPaisa: number;
}

export interface AgedReceivablesReport {
  clientId: number;
  asOfDate: string;
  rows: AgedCustomerRow[];
  totalCurrentPaisa: number;
  totalDays31to60Paisa: number;
  totalDays61to90Paisa: number;
  totalOver90Paisa: number;
  grandTotalPaisa: number;
}

interface InvoiceAgeRow {
  customer_id: number;
  customer_name: string;
  total_paisa: string;
  paid_paisa: string;
  due_date: string;
}

export async function getAgedReceivables(
  firmId: number,
  clientId: number,
  asOfDate: string
): Promise<AgedReceivablesReport> {
  // Security: verify the client belongs to the requesting firm before touching any data
  await verifyClientBelongsToFirm(firmId, clientId);

  const result = await query<InvoiceAgeRow>(`
    SELECT
      c.id as customer_id,
      c.name as customer_name,
      i.total_paisa::text as total_paisa,
      i.paid_paisa::text as paid_paisa,
      i.due_date::text as due_date
    FROM invoices i
    JOIN customers c ON i.customer_id = c.id
    WHERE i.client_id = $1
      AND i.status IN ('posted', 'partially_paid', 'partial')
      AND i.invoice_date <= $2
    ORDER BY c.name, i.due_date
  `, [clientId, asOfDate]);

  const customerMap = new Map<number, AgedCustomerRow>();
  const asOf = new Date(asOfDate + 'T00:00:00Z');

  for (const row of result.rows) {
    const outstanding = (parseInt(row.total_paisa, 10) || 0) - (parseInt(row.paid_paisa, 10) || 0);
    if (outstanding <= 0) continue;

    const due = new Date(row.due_date + 'T00:00:00Z');
    const daysPast = Math.floor((asOf.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));

    let entry = customerMap.get(row.customer_id);
    if (!entry) {
      entry = {
        customerId: row.customer_id,
        customerName: row.customer_name,
        currentPaisa: 0,
        days31to60Paisa: 0,
        days61to90Paisa: 0,
        over90Paisa: 0,
        totalPaisa: 0,
      };
      customerMap.set(row.customer_id, entry);
    }

    if (daysPast <= 30) entry.currentPaisa += outstanding;
    else if (daysPast <= 60) entry.days31to60Paisa += outstanding;
    else if (daysPast <= 90) entry.days61to90Paisa += outstanding;
    else entry.over90Paisa += outstanding;

    entry.totalPaisa += outstanding;
  }

  const rows = Array.from(customerMap.values()).sort((a, b) => a.customerName.localeCompare(b.customerName));

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

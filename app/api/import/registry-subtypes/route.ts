import { NextResponse } from 'next/server';
import {
  DATA_TYPES,
  DataType,
  listSubTypes,
  getDefinition,
} from '@/lib/ingestion/type-registry';

export const dynamic = 'force-dynamic';

export interface SubtypeOption {
  id: string;
  label: string;
  description: string;
  requiredColumns: Array<{ key: string; label: string; type: string }>;
  optionalColumns: Array<{ key: string; label: string; type: string }>;
}

export interface CatalogResponse {
  dataTypes: Array<{ id: DataType; label: string }>;
  subtypesByType: Record<string, SubtypeOption[]>;
}

// Human-readable labels for each DataType
const DATA_TYPE_LABELS: Record<DataType, string> = {
  bank_statements: 'Bank Statements',
  sales_invoices: 'Sales Invoices',
  purchase_bills: 'Purchase Bills',
  customers: 'Customers',
  vendors: 'Vendors',
  chart_of_accounts: 'Chart of Accounts',
  journals: 'General Journals',
  payments: 'Payments',
  expenses: 'Expenses',
  fixed_assets: 'Fixed Assets',
  payroll: 'Payroll',
  tax_registers: 'Tax Registers',
  loans: 'Loans',
  inventory: 'Inventory',
  budget: 'Budget',
};

/**
 * GET /api/import/registry-subtypes
 *
 * Returns the full type registry catalog. No authentication required —
 * this is public metadata (no tenant data exposed).
 * Used by the AI Ingestion page to populate the subtype selector.
 */
export async function GET() {
  try {
    const subtypesByType: Record<string, SubtypeOption[]> = {};

    for (const dt of DATA_TYPES) {
      const subtypeIds = listSubTypes(dt);
      subtypesByType[dt] = subtypeIds.map((id: any) => {
        const def = getDefinition(dt, id);
        return {
          id: def.id,
          label: def.label,
          description: def.description,
          requiredColumns: def.requiredColumns.map((c: any) => ({
            key: c.key,
            label: c.label,
            type: c.type,
          })),
          optionalColumns: def.optionalColumns.map((c: any) => ({
            key: c.key,
            label: c.label,
            type: c.type,
          })),
        };
      });
    }

    const catalog: CatalogResponse = {
      dataTypes: DATA_TYPES.map((id: any) => ({ id, label: DATA_TYPE_LABELS[id as keyof typeof DATA_TYPE_LABELS] })),
      subtypesByType,
    };

    return NextResponse.json(catalog, {
      headers: {
        // Cache for 5 minutes client-side — catalog is static between deploys
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error: any) {
    console.error('[registry-subtypes] Error building catalog:', error);
    return NextResponse.json(
      { error: 'Failed to load registry catalog' },
      { status: 500 }
    );
  }
}

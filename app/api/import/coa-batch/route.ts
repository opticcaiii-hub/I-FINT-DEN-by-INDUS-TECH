import { NextRequest, NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { query, transaction } from '@/lib/db';

interface AccountTypeRow {
  id: number;
  code: string;
}

export async function POST(req: NextRequest) {
  try {
    const session = await verifySession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { clientId, accounts } = body;

    const targetClientId = Number(clientId);
    if (!targetClientId || isNaN(targetClientId)) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json({ error: 'accounts must be a non-empty array' }, { status: 400 });
    }

    // Load available account types from DB
    const typeRes = await query<AccountTypeRow>('SELECT id, code FROM account_types');
    const typeMap = new Map<string, number>();
    for (const r of typeRes.rows) {
      typeMap.set(r.code.toLowerCase(), r.id);
    }

    // Default to expense type if unmapped
    const defaultExpenseId = typeMap.get('expense') || typeRes.rows[0]?.id || 1;

    const createdAccounts = await transaction(async (tx) => {
      const results: Array<{ id: number; account_code: string; account_name: string }> = [];

      for (const item of accounts) {
        const code = String(item.code || '').trim();
        const name = String(item.name || item.inferredName || `Account ${code}`).trim();
        const rawType = String(item.type || item.accountType || 'expense').toLowerCase();

        if (!code) continue;

        // Map revenue / sales / income -> income
        let normalizedType = rawType;
        if (normalizedType === 'revenue' || normalizedType === 'sales') {
          normalizedType = 'income';
        }

        const typeId = typeMap.get(normalizedType) || defaultExpenseId;

        const insertRes = await tx.query<{ id: number; account_code: string; account_name: string }>(
          `INSERT INTO chart_of_accounts 
             (client_id, account_code, account_name, account_type_id, is_active, is_system)
           VALUES ($1, $2, $3, $4, true, false)
           ON CONFLICT (client_id, account_code)
           DO UPDATE SET account_name = EXCLUDED.account_name, is_active = true
           RETURNING id, account_code, account_name`,
          [targetClientId, code, name, typeId]
        );

        if (insertRes.rows[0]) {
          results.push(insertRes.rows[0]);
        }
      }

      return results;
    });

    return NextResponse.json({
      success: true,
      createdCount: createdAccounts.length,
      accounts: createdAccounts,
      message: `Successfully created or updated ${createdAccounts.length} Chart of Accounts entries for client ${targetClientId}.`,
    });
  } catch (error: any) {
    console.error('Batch COA creation failed:', error);
    return NextResponse.json({ error: error.message || 'Batch COA creation failed' }, { status: 500 });
  }
}
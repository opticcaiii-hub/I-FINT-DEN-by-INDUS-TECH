import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL is not set in environment or .env.local');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

export async function initDatabase() {
  console.log('🚀 Initializing I-FINT DEN database schema...\n');

  // 1. Firms
  console.log('Creating firms table...');
  await sql`
    CREATE TABLE IF NOT EXISTS firms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      ntn TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // 2. Staff
  console.log('Creating staff table...');
  await sql`
    CREATE TABLE IF NOT EXISTS staff (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL REFERENCES firms(id),
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'partner' CHECK (role IN ('partner', 'manager', 'senior', 'junior')),
      session_version INTEGER NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // 3. Clients
  console.log('Creating clients table...');
  await sql`
    CREATE TABLE IF NOT EXISTS clients (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL REFERENCES firms(id),
      name TEXT NOT NULL,
      ntn TEXT,
      strn TEXT,
      business_type TEXT NOT NULL DEFAULT 'company' CHECK (business_type IN ('sole_prop', 'aop', 'company', 'individual')),
      fiscal_year_start_month INTEGER NOT NULL DEFAULT 7 CHECK (fiscal_year_start_month >= 1 AND fiscal_year_start_month <= 12),
      base_currency TEXT NOT NULL DEFAULT 'PKR',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  // 4. Account Types
  console.log('Creating account_types table...');
  await sql`
    CREATE TABLE IF NOT EXISTS account_types (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL UNIQUE CHECK (code IN ('asset', 'liability', 'equity', 'income', 'expense')),
      normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit'))
    )
  `;

  await sql`
    INSERT INTO account_types (code, normal_balance) VALUES
      ('asset', 'debit'),
      ('liability', 'credit'),
      ('equity', 'credit'),
      ('income', 'credit'),
      ('expense', 'debit')
    ON CONFLICT (code) DO NOTHING
  `;

  // 5. Chart of Accounts
  console.log('Creating chart_of_accounts table...');
  await sql`
    CREATE TABLE IF NOT EXISTS chart_of_accounts (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_type_id INTEGER NOT NULL REFERENCES account_types(id),
      parent_id INTEGER REFERENCES chart_of_accounts(id),
      is_active BOOLEAN NOT NULL DEFAULT true,
      is_system BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(client_id, account_code)
    )
  `;

  // 6. Accounting Periods
  console.log('Creating accounting_periods table...');
  await sql`
    CREATE TABLE IF NOT EXISTS accounting_periods (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      name TEXT,
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      is_locked BOOLEAN NOT NULL DEFAULT false,
      locked_by INTEGER,
      locked_at TIMESTAMPTZ,
      UNIQUE(client_id, start_date, end_date)
    )
  `;

  // 7. Journal Entries (The Ledger)
  console.log('Creating journal_entries table...');
  await sql`
    CREATE TABLE IF NOT EXISTS journal_entries (
      id SERIAL PRIMARY KEY,
      client_id INTEGER NOT NULL REFERENCES clients(id),
      entry_date DATE NOT NULL,
      entry_number TEXT NOT NULL,
      description TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'invoice', 'purchase', 'payroll', 'bank_recon', 'opening_balance', 'pipeline')),
      source_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'posted', 'locked')),
      posted_by INTEGER,
      posted_at TIMESTAMPTZ,
      reversed_by_entry_id INTEGER REFERENCES journal_entries(id),
      created_by INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(client_id, entry_number)
    )
  `;

  // 8. Journal Lines
  console.log('Creating journal_lines table...');
  await sql`
    CREATE TABLE IF NOT EXISTS journal_lines (
      id SERIAL PRIMARY KEY,
      journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id),
      debit_paisa BIGINT NOT NULL DEFAULT 0,
      credit_paisa BIGINT NOT NULL DEFAULT 0,
      memo TEXT,
      line_order INTEGER NOT NULL DEFAULT 0,
      CONSTRAINT valid_line CHECK (
        (debit_paisa > 0 AND credit_paisa = 0) OR
        (credit_paisa > 0 AND debit_paisa = 0)
      )
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(journal_entry_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id)`;

  // 9. AI Feedback Loop
  console.log('Creating ai_feedback table...');
  await sql`
    CREATE TABLE IF NOT EXISTS ai_feedback (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      job_id INTEGER,
      row_index INTEGER,
      raw_input JSONB,
      ai_provider TEXT,
      prompt_version TEXT,
      predicted_account_code TEXT,
      confidence_score NUMERIC,
      is_anomaly BOOLEAN DEFAULT false,
      anomaly_score NUMERIC,
      human_action TEXT,
      human_corrected_account_code TEXT,
      reviewed_by INTEGER,
      reviewed_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // Seed Default Firm and Client
  console.log('Seeding demo Firm and Client...');
  const firmRes = await sql`
    INSERT INTO firms (id, name, ntn)
    VALUES (1, 'Indus Tech Global Firm', '1000000-1')
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
  `;

  await sql`
    INSERT INTO staff (id, firm_id, email, name, password_hash, role)
    VALUES (1, 1, 'admin@industech.com', 'Indus Tech Partner', 'dummy_hash', 'partner')
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO clients (id, firm_id, name, ntn, strn, business_type, fiscal_year_start_month, base_currency)
    VALUES (1, 1, 'Indus Tech Demo Client', '2000000-2', 'STRN-9999', 'company', 7, 'PKR')
    ON CONFLICT (id) DO NOTHING
  `;

  // Seed Chart of Accounts for Client 1
  console.log('Seeding standard Chart of Accounts...');
  const coaData = [
    { code: '1010', name: 'Cash on Hand', type: 'asset' },
    { code: '1020', name: 'Main Operating Bank Account', type: 'asset' },
    { code: '1200', name: 'Accounts Receivable', type: 'asset' },
    { code: '1300', name: 'Merchandise Inventory', type: 'asset' },
    { code: '1500', name: 'Prepaid Expenses', type: 'asset' },
    { code: '2010', name: 'Accounts Payable', type: 'liability' },
    { code: '2100', name: 'Sales Tax Payable', type: 'liability' },
    { code: '2200', name: 'Accrued Expenses', type: 'liability' },
    { code: '3010', name: 'Owner / Shareholder Equity', type: 'equity' },
    { code: '3100', name: 'Retained Earnings', type: 'equity' },
    { code: '4010', name: 'Sales Revenue', type: 'income' },
    { code: '4020', name: 'Service & Consulting Revenue', type: 'income' },
    { code: '4090', name: 'Other Income', type: 'income' },
    { code: '5010', name: 'Cost of Goods Sold (COGS)', type: 'expense' },
    { code: '5020', name: 'Salaries & Wages', type: 'expense' },
    { code: '5030', name: 'Rent Expense', type: 'expense' },
    { code: '5040', name: 'Utilities (Electricity & Internet)', type: 'expense' },
    { code: '5050', name: 'Marketing & Advertising', type: 'expense' },
    { code: '5060', name: 'Office Supplies & Stationeries', type: 'expense' },
    { code: '5070', name: 'Cloud Infrastructure & Software', type: 'expense' },
    { code: '5080', name: 'Bank Charges & Fees', type: 'expense' },
    { code: '5090', name: 'Travel & Entertainment', type: 'expense' },
  ];

  for (const item of coaData) {
    await sql`
      INSERT INTO chart_of_accounts (client_id, account_code, account_name, account_type_id)
      VALUES (
        1,
        ${item.code},
        ${item.name},
        (SELECT id FROM account_types WHERE code = ${item.type})
      )
      ON CONFLICT (client_id, account_code) DO UPDATE
      SET account_name = EXCLUDED.account_name
    `;
  }

  // Seed Accounting Periods (2025 to 2027)
  console.log('Seeding active accounting periods...');
  for (let y = 2025; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      const monthStr = m.toString().padStart(2, '0');
      const lastDay = new Date(y, m, 0).getDate();
      const startDate = `${y}-${monthStr}-01`;
      const endDate = `${y}-${monthStr}-${lastDay.toString().padStart(2, '0')}`;
      const name = `${new Date(y, m - 1, 1).toLocaleString('default', { month: 'long' })} ${y}`;

      await sql`
        INSERT INTO accounting_periods (client_id, name, start_date, end_date, is_locked)
        VALUES (1, ${name}, ${startDate}, ${endDate}, false)
        ON CONFLICT (client_id, start_date, end_date) DO NOTHING
      `;
    }
  }

  console.log('\n✅ Database schema and master seed successfully created!');
}

if (require.main === module) {
  initDatabase().catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
}

import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
const sql = neon(process.env.DATABASE_URL!);

async function patch() {
  console.log('Patching accounting_periods and audit_log...');
  await sql`
    ALTER TABLE accounting_periods 
      ADD COLUMN IF NOT EXISTS period_name TEXT,
      ADD COLUMN IF NOT EXISTS name TEXT,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
  `;
  await sql`
    UPDATE accounting_periods 
    SET period_name = COALESCE(period_name, name, 'Period ' || id::text)
    WHERE period_name IS NULL;
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      firm_id INTEGER NOT NULL,
      client_id INTEGER NOT NULL,
      actor_id INTEGER NOT NULL,
      actor_role TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      job_id INTEGER,
      source_row INTEGER,
      ai_confidence_score NUMERIC,
      ai_suggested_value JSONB,
      applied_value JSONB,
      reason TEXT,
      previous_hash TEXT,
      current_hash TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
  console.log('✅ Patch applied successfully to Neon database!');
}

patch().catch(console.error);

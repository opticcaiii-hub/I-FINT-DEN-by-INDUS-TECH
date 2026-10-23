import { Pool, neon } from '@neondatabase/serverless';

// Types for query results
export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number | null;
  command: string;
}

export interface TransactionClient {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

// Singleton pool — reused across all serverless invocations in the same
// Lambda/Edge container. Neon's serverless driver handles connection
// pooling over WebSockets, so this is safe for Vercel.
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/**
 * Execute a single parameterized SQL query.
 * NEVER interpolate values into the query string — always use $1, $2, etc.
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const p = getPool();
  const result = await p.query(text, params);
  return {
    rows: result.rows as T[],
    rowCount: result.rowCount,
    command: result.command,
  };
}

/**
 * Execute multiple queries inside a single ACID transaction.
 * If any query fails, ALL changes are rolled back.
 * 
 * Usage:
 *   const id = await transaction(async (client) => {
 *     const { rows } = await client.query('INSERT INTO ... RETURNING id', [...]);
 *     await client.query('INSERT INTO ...', [...]);
 *     return rows[0].id;
 *   });
 */
export async function transaction<T>(
  callback: (client: TransactionClient) => Promise<T>
): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  try {
    await client.query('BEGIN');
    const wrappedClient: TransactionClient = {
      async query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<R>> {
        const result = await client.query(text, params);
        return {
          rows: result.rows as R[],
          rowCount: result.rowCount,
          command: result.command,
        };
      },
    };
    const result = await callback(wrappedClient);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

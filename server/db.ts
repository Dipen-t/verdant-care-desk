import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { mkdir,readFile } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { config } from './config.js';
export interface Queryable { query<T = any>(sql: string, params?: any[]): Promise<{ rows: T[]; rowCount?: number | null }> }
export interface Database extends Queryable { transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>; close(): Promise<void> }
export async function createDatabase(url = config.databaseUrl, dir = config.pgliteDir): Promise<Database> {
  if (url) {
    const parsed = new URL(url);
    const supabase = parsed.hostname.endsWith('.pooler.supabase.com') || parsed.hostname.endsWith('.supabase.co');
    let ssl;
    if (supabase) {
      // Explicit SSL settings avoid pg connection-string modes overriding CA verification.
      for (const key of ['sslmode','sslrootcert','sslcert','sslkey']) parsed.searchParams.delete(key);
      ssl = { ca: await readFile(resolve(process.env.DATABASE_CA_CERT_PATH || 'certs/supabase-ca.crt'),'utf8'), rejectUnauthorized: true };
    }
    const pool = new Pool({ connectionString: parsed.toString(), ...(ssl ? { ssl } : {}), max: 8, connectionTimeoutMillis: 10000 });
    return {
      query: async <T = any>(sql: string,params?: any[]) => { const result = await pool.query(sql,params); return { rows: result.rows as T[],rowCount: result.rowCount }; },
      transaction: async fn => { const client = await pool.connect(); try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; } catch(e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); } },
      close: () => pool.end(),
    };
  }
  if (dir !== ':memory:') await mkdir(dirname(resolve(dir)),{ recursive: true });
  const local = new PGlite(dir === ':memory:' ? undefined : resolve(dir));
  await local.waitReady;
  function adapt(client: Pick<PGlite,'query'|'exec'>): Queryable {
    return { query: async <T = any>(sql: string,params?: any[]) => {
      if (params?.length) return client.query<T>(sql,params);
      const results = await client.exec(sql);
      return (results.at(-1) || { rows: [] }) as { rows: T[] };
    } };
  }
  return { ...adapt(local), transaction: fn => local.transaction(tx => fn(adapt(tx))), close: () => local.close() };
}
export async function migrate(db: Database) {
  const sql = await readFile(resolve('server/schema.sql'), 'utf8');
  // A migration lock serializes simultaneous app starts. DDL runs atomically.
  await db.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(7341201)'); await tx.query(sql);
    const realtime = await tx.query(`SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='realtime') AS available`);
    if (realtime.rows[0].available) await tx.query(await readFile(resolve('server/realtime.sql'),'utf8'));
  });
}

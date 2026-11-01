import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Pool } from './db.js';

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../migrations');
const LOCK_ID = 727274; // arbitrary; stops two instances migrating at once

export async function migrate(pool: Pool, log: (m: string) => void = console.log): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const applied = new Set(
      (await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`[migrate] applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
}

// `node dist/migrate.js` runs migrations on their own.
if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const { createPool } = await import('./db.js');
  const { config } = await import('./config.js');
  const pool = createPool(config.databaseUrl);
  await migrate(pool);
  await pool.end();
}

// Applies pending SQL migrations in /migrations, in order, each inside its own transaction.
// Runs as the Vercel build step. If DATABASE_URL is missing (e.g. a preview without a DB branch)
// it skips instead of failing, and the API reports "database not configured".
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(connectionString, log = console.log) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    // One migrator at a time (two deployments building at once).
    await client.query('SELECT pg_advisory_lock(727001)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version));
    const files = (await readdir(dir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    let applied = 0;
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(path.join(dir, f), 'utf8');
      log(`applying migration ${f}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [f]);
        await client.query('COMMIT');
        applied++;
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${f} failed: ${e.message}`);
      }
    }
    log(applied ? `${applied} migration(s) applied` : 'database schema is up to date');
    return { applied, total: files.length };
  } finally {
    try { await client.query('SELECT pg_advisory_unlock(727001)'); } catch { /* ignore */ }
    await client.end();
  }
}

export async function latestMigration() {
  return (await readdir(dir)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort().pop();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.warn('DATABASE_URL not set — skipping migrations (API will report database not configured).');
    process.exit(0);
  }
  console.log(`migrating database (VERCEL_ENV=${process.env.VERCEL_ENV || 'local'})`);
  migrate(url).then(() => process.exit(0), (e) => { console.error(e.message); process.exit(1); });
}

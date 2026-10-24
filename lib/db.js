import pg from 'pg';
import { HttpError } from './errors.js';

// DATE -> 'YYYY-MM-DD' string (never a JS Date, avoids timezone shifts).
pg.types.setTypeParser(1082, (v) => v);
// BIGINT ids/counts -> Number (ids stay far below 2^53).
pg.types.setTypeParser(20, (v) => Number(v));
// NUMERIC stays a string so money is never touched by floating point on the server.

let pool = null;

export function dbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new HttpError(503, 'ડેટાબેઝ જોડાયેલ નથી (સર્વર સેટિંગ બાકી છે).');
  }
  if (!pool) {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 3),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
    });
    // An idle client error must never crash the function.
    pool.on('error', (err) => console.error('pg pool error', err.code || err.message));
  }
  return pool;
}

export async function q(text, params = []) {
  return getPool().query(text, params);
}

/** Run fn(client) inside a transaction. */
export async function tx(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) { const p = pool; pool = null; await p.end(); }
}

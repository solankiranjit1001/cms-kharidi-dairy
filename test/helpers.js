// Test harness: fresh local Postgres database per test file, real HTTP server, cookie-aware client.
import pg from 'pg';
import { createServer } from '../scripts/dev-server.js';
import { migrate } from '../scripts/migrate.js';
import { closePool } from '../lib/db.js';

const ADMIN = process.env.TEST_PG_ADMIN || 'postgres://postgres@/postgres?host=/tmp&port=5433';

export async function startApp(name) {
  const dbName = `cms_t_${name}_${process.pid}`;
  const admin = new pg.Client({ connectionString: ADMIN });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = ADMIN.replace('/postgres?', `/${dbName}?`);
  process.env.DATABASE_URL = url;
  process.env.SETUP_CODE = 'test-setup-code-123';
  process.env.PG_POOL_MAX = '10';
  await migrate(url, () => {});
  const server = createServer();
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  return {
    base, url,
    async stop() {
      await new Promise((r) => server.close(r));
      await closePool();
      const a = new pg.Client({ connectionString: ADMIN }); await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`); await a.end();
    },
  };
}

export function client(base) {
  let cookie = '';
  async function call(method, path, body, extraHeaders = {}) {
    const res = await fetch(base + '/api' + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-CMS': '1', ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { status: res.status, data };
  }
  return {
    get: (p) => call('GET', p), post: (p, b, h) => call('POST', p, b, h), patch: (p, b) => call('PATCH', p, b),
    put: (p, b) => call('PUT', p, b), del: (p, b) => call('DELETE', p, b), raw: call,
    get cookie() { return cookie; },
  };
}

export async function ownerClient(base) {
  const c = client(base);
  const r = await c.post('/auth/setup', { setupCode: 'test-setup-code-123', name: 'પપ્પા', mobile: '9876543210', pin: '2580' });
  if (r.status !== 200) throw new Error('setup failed ' + JSON.stringify(r.data));
  return c;
}

export const uuid = () => crypto.randomUUID();

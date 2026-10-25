// Single entry point for all /api/* requests (keeps Vercel Hobby under the function limit).
import { toResponse, HttpError, bad, notFound } from './errors.js';
import { dbConfigured, q } from './db.js';
import * as auth from './auth.js';
import * as master from './master.js';
import * as rec from './records.js';
import * as rep from './reports.js';
import { runImport } from './importer.js';
import { available } from './stock.js';
import { getPool } from './db.js';
import { anyDate, id as vId, todayIST } from './validate.js';
import { latestMigration } from '../scripts/migrate.js';

const MAX_BODY = 6 * 1024 * 1024; // import files can be a few MB

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  let raw = '';
  if (typeof req.body === 'string') raw = req.body;
  else if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
  else {
    raw = await new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'ડેટા બહુ મોટો છે.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw bad('માહિતી વાંચી શકાઈ નહીં.'); }
}

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function isSecure(req) {
  return req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1' || process.env.FORCE_SECURE_COOKIE === '1';
}

/** CSRF defence: state-changing requests must carry our custom header and (if present) a same-origin Origin. */
function checkCsrf(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  if (req.headers['x-cms'] !== '1') throw new HttpError(403, 'અમાન્ય વિનંતી.');
  const origin = req.headers.origin;
  if (origin) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    let ok = false;
    try { ok = new URL(origin).host === host; } catch { ok = false; }
    if (!ok) throw new HttpError(403, 'અમાન્ય વિનંતી.');
  }
}

export async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    let path = url.searchParams.get('__path');
    if (path === null) path = url.pathname.replace(/^\/api\/?/, '');
    url.searchParams.delete('__path');
    path = '/' + path.replace(/^\/+|\/+$/g, '');
    const query = Object.fromEntries(url.searchParams.entries());
    const m = req.method;
    const seg = path.split('/').filter(Boolean);

    if (path === '/health' && m === 'GET') {
      if (!dbConfigured()) return send(res, 503, { ok: false, db: 'not_configured' });
      const t0 = Date.now();
      const { rows: [r] } = await q(`SELECT now() AS now, (SELECT max(version) FROM schema_migrations) AS schema`).catch((e) => { throw e; });
      const want = await latestMigration();
      return send(res, 200, { ok: r.schema === want, db: 'connected', latency_ms: Date.now() - t0, schema: r.schema, expected_schema: want,
        env: process.env.VERCEL_ENV || 'local', today: todayIST() });
    }

    checkCsrf(req);
    const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(m) ? await readBody(req) : {};

    // ---- auth (no session needed) ----
    if (path === '/auth/status' && m === 'GET') {
      const user = await auth.currentUser(req);
      return send(res, 200, { user, needsSetup: user ? false : await auth.needsSetup(), setupEnabled: (process.env.SETUP_CODE || '').length >= 8 });
    }
    if (path === '/auth/login' && m === 'POST') {
      const r = await auth.login(req, body);
      return send(res, 200, { user: r.user }, { 'Set-Cookie': auth.sessionCookie(r.token, 30 * 86400, isSecure(req)) });
    }
    if (path === '/auth/setup' && m === 'POST') {
      const r = await auth.setup(req, body);
      return send(res, 200, { user: r.user }, { 'Set-Cookie': auth.sessionCookie(r.token, 30 * 86400, isSecure(req)) });
    }

    const user = auth.requireUser(await auth.currentUser(req));
    if (!['GET', 'HEAD'].includes(m) && user.role === 'viewer' && !(path === '/auth/logout' || path === '/auth/pin')) {
      throw new HttpError(403, 'તમારી પાસે માત્ર જોવાની પરવાનગી છે.');
    }

    if (path === '/auth/logout' && m === 'POST') {
      await auth.logout(user);
      return send(res, 200, { ok: true }, { 'Set-Cookie': auth.sessionCookie('', 0, isSecure(req)) });
    }
    if (path === '/auth/pin' && m === 'POST') return send(res, 200, await auth.changeOwnPin(user, body));

    // ---- users ----
    if (seg[0] === 'users') {
      auth.requireRole(user, 'owner');
      if (seg.length === 1 && m === 'GET') return send(res, 200, await auth.listUsers());
      if (seg.length === 1 && m === 'POST') return send(res, 201, await auth.createUser(user, body));
      if (seg.length === 2 && m === 'PATCH') return send(res, 200, await auth.updateUser(user, seg[1], body));
    }

    // ---- master data ----
    if (path === '/meta' && m === 'GET') return send(res, 200, { ...(await master.meta()), user });
    if (seg[0] === 'vegetables') {
      if (seg.length === 1 && m === 'POST') return send(res, 201, await master.createVegetable(user, body));
      if (seg.length === 2 && m === 'PATCH') { auth.requireRole(user, 'owner'); return send(res, 200, await master.updateVegetable(user, seg[1], body)); }
    }
    if (seg[0] === 'traders') {
      if (seg.length === 1 && m === 'GET') return send(res, 200, await rep.traderBalances(query.asOf));
      if (seg.length === 1 && m === 'POST') return send(res, 201, await master.createTrader(user, body));
      if (seg.length === 2 && m === 'PATCH') return send(res, 200, await master.updateTrader(user, seg[1], body));
      if (seg.length === 3 && seg[2] === 'statement' && m === 'GET') return send(res, 200, await rep.traderStatement(seg[1], query));
    }

    // ---- records ----
    if (seg[0] === 'records' && seg[1]) {
      const type = seg[1];
      if (!rec.RECORD_TYPES.includes(type)) throw notFound('અજાણ્યો રેકોર્ડ પ્રકાર.');
      if (seg.length === 2 && m === 'GET') return send(res, 200, await rec.listRecords(type, query));
      if (seg.length === 2 && m === 'POST') {
        const r = await rec.createRecord(user, type, body);
        return send(res, r.duplicate ? 200 : 201, r);
      }
      if (seg.length === 3 && m === 'GET') return send(res, 200, await rec.getRecord(type, seg[2]));
      if (seg.length === 3 && m === 'PATCH') return send(res, 200, await rec.updateRecord(user, type, seg[2], body));
      if (seg.length === 3 && m === 'DELETE') return send(res, 200, await rec.voidRecord(user, type, seg[2], body));
      if (seg.length === 4 && seg[3] === 'audit' && m === 'GET') return send(res, 200, await rec.recordAudit(type, seg[2]));
    }

    // ---- stock & closing ----
    if (path === '/stock' && m === 'GET') return send(res, 200, await rep.stockReport(query.date));
    if (path === '/stock/available' && m === 'GET') {
      const c = await getPool().connect();
      try { return send(res, 200, await available(c, vId(query.vegetable_id), anyDate(query.date))); } finally { c.release(); }
    }
    if (path === '/stock/counts' && m === 'POST') return send(res, 200, await rec.saveStockCounts(user, body));
    if (seg[0] === 'closing' && seg.length === 2 && m === 'PUT') return send(res, 200, await rec.saveClosing(user, seg[1], body));
    if (seg[0] === 'daysale' && seg.length === 2 && m === 'PUT') return send(res, 200, await rec.saveDaySale(user, seg[1], body));

    // ---- reports ----
    if (path === '/dashboard' && m === 'GET') return send(res, 200, await rep.dashboard(query.date));
    if (path === '/reports/summary' && m === 'GET') return send(res, 200, await rep.rangeSummary(query));
    if (path === '/market/analysis' && m === 'GET') return send(res, 200, await rep.marketAnalysis(query));
    if (path === '/history' && m === 'GET') return send(res, 200, await rep.history(query));
    if (path === '/export' && m === 'GET') {
      auth.requireRole(user, 'owner');
      return send(res, 200, await rep.exportAll(), { 'Content-Disposition': `attachment; filename="cms-kharidi-backup-${todayIST()}.json"` });
    }
    if (path === '/import' && m === 'POST') return send(res, 200, await runImport(user, body));
    if (path === '/audit' && m === 'GET') {
      auth.requireRole(user, 'owner');
      const { rows } = await q(`SELECT a.id, a.at, a.action, a.entity, a.entity_id, a.reason, u.name AS user_name
        FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 300`);
      return send(res, 200, rows);
    }

    throw notFound('આ સરનામું અસ્તિત્વમાં નથી.');
  } catch (e) {
    const { status, body } = toResponse(e);
    send(res, status, body);
  }
}

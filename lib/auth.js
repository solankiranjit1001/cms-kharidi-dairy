import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { q, tx } from './db.js';
import { HttpError, bad, forbidden } from './errors.js';
import { mobile as vMobile, pin as vPin, text, oneOf, ROLES, id as vId } from './validate.js';
import { audit } from './audit.js';

const scrypt = promisify(crypto.scrypt);
const N = 16384, R = 8, P = 1, KEYLEN = 32;
export const COOKIE = 'cms_sess';
const SESSION_DAYS = 30;
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const IP_MAX_FAILS = 30;

export async function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pin, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPin(pin, stored) {
  const [alg, n, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(pin, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return crypto.timingSafeEqual(key, expected);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, maxAgeSec, secure) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`;
}

async function createSession(userId, userAgent) {
  const token = crypto.randomBytes(32).toString('base64url');
  await q(
    `INSERT INTO sessions(user_id, token_hash, expires_at, user_agent) VALUES ($1,$2, now() + interval '${SESSION_DAYS} days', $3)`,
    [userId, sha256(token), String(userAgent || '').slice(0, 200)]
  );
  return token;
}

/** Returns the logged-in user or null. Slides the expiry once a day. */
export async function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || token.length > 100) return null;
  const { rows } = await q(
    `SELECT s.id AS session_id, s.last_seen_at, u.id, u.name, u.mobile, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.active`,
    [sha256(token)]
  );
  const u = rows[0];
  if (!u) return null;
  if (Date.now() - new Date(u.last_seen_at).getTime() > 86_400_000) {
    await q(`UPDATE sessions SET last_seen_at = now(), expires_at = now() + interval '${SESSION_DAYS} days' WHERE id = $1`, [u.session_id]);
  }
  return { id: u.id, name: u.name, mobile: u.mobile, role: u.role, sessionId: u.session_id };
}

export function requireUser(user) {
  if (!user) throw new HttpError(401, 'કૃપા કરીને લોગિન કરો.');
  return user;
}
export function requireRole(user, ...roles) {
  requireUser(user);
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}
export const canWrite = (u) => u && (u.role === 'owner' || u.role === 'entry');

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim().slice(0, 64);
}

const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const LOGIN_FAIL = 'મોબાઇલ નંબર અથવા PIN ખોટો છે.';

export async function login(req, body) {
  const ip = clientIp(req);
  const { rows: [{ c }] } = await q(`SELECT count(*)::int AS c FROM auth_failures WHERE ip = $1 AND at > now() - interval '15 minutes'`, [ip]);
  if (c >= IP_MAX_FAILS) throw new HttpError(429, 'ઘણા ખોટા પ્રયાસ થયા. 15 મિનિટ પછી ફરી પ્રયાસ કરો.');
  let m, p;
  try { m = vMobile(body.mobile); p = String(body.pin ?? ''); } catch { throw bad(LOGIN_FAIL); }
  if (!/^\d{4,6}$/.test(p.replace(/[૦-૯]/g, (x) => '૦૧૨૩૪૫૬૭૮૯'.indexOf(x)))) throw bad(LOGIN_FAIL);
  p = p.replace(/[૦-૯]/g, (x) => '૦૧૨૩૪૫૬૭૮૯'.indexOf(x));
  const { rows } = await q('SELECT id, name, role, pin_hash, active, failed_attempts, locked_until FROM users WHERE mobile = $1', [m]);
  const u = rows[0];
  if (u && u.locked_until && new Date(u.locked_until) > new Date()) {
    throw new HttpError(429, 'ઘણા ખોટા PIN પ્રયાસ થયા. 15 મિનિટ પછી ફરી પ્રયાસ કરો અથવા માલિકને PIN રીસેટ કરવા કહો.');
  }
  const ok = await verifyPin(p, u ? u.pin_hash : DUMMY_HASH).catch(() => false);
  if (!u || !u.active || !ok) {
    await q('INSERT INTO auth_failures(ip) VALUES ($1)', [ip]);
    if (u) {
      await q(
        `UPDATE users SET failed_attempts = failed_attempts + 1,
           locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + interval '${LOCK_MINUTES} minutes' ELSE locked_until END
         WHERE id = $1`, [u.id, MAX_FAILS]);
    }
    throw new HttpError(401, LOGIN_FAIL);
  }
  await q('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [u.id]);
  const token = await createSession(u.id, req.headers['user-agent']);
  return { token, user: { id: u.id, name: u.name, role: u.role } };
}

export async function logout(user) {
  if (user?.sessionId) await q('DELETE FROM sessions WHERE id = $1', [user.sessionId]);
}

export async function needsSetup() {
  const { rows: [{ c }] } = await q('SELECT count(*)::int AS c FROM users');
  return c === 0;
}

/** First owner. Allowed only while there are no users AND the request knows SETUP_CODE (server env var). */
export async function setup(req, body) {
  const code = process.env.SETUP_CODE || '';
  if (code.length < 8) throw new HttpError(503, 'પ્રથમ સેટઅપ કોડ સર્વર પર સેટ કરેલ નથી (SETUP_CODE).');
  const given = Buffer.from(String(body.setupCode || ''));
  const want = Buffer.from(code);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
    await q('INSERT INTO auth_failures(ip) VALUES ($1)', [clientIp(req)]);
    throw new HttpError(401, 'સેટઅપ કોડ ખોટો છે.');
  }
  const name = text(body.name, { label: 'નામ', max: 60, required: true });
  const m = vMobile(body.mobile);
  const p = vPin(body.pin);
  const hash = await hashPin(p);
  const userId = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(727002)');
    const { rows: [{ n }] } = await c.query('SELECT count(*)::int AS n FROM users');
    if (n > 0) throw new HttpError(409, 'સેટઅપ પહેલેથી પૂર્ણ થયું છે. લોગિન કરો.');
    const { rows: [u] } = await c.query(
      `INSERT INTO users(name, mobile, pin_hash, role) VALUES ($1,$2,$3,'owner') RETURNING id`, [name, m, hash]);
    await audit(c, u.id, 'create', 'users', u.id, null, { name, mobile: m, role: 'owner' }, 'પ્રથમ સેટઅપ');
    return u.id;
  });
  const token = await createSession(userId, req.headers['user-agent']);
  return { token, user: { id: userId, name, role: 'owner' } };
}

export async function changeOwnPin(user, body) {
  const { rows: [u] } = await q('SELECT pin_hash FROM users WHERE id = $1', [user.id]);
  if (!(await verifyPin(String(body.oldPin || ''), u.pin_hash).catch(() => false))) throw bad('જૂનો PIN ખોટો છે.');
  const hash = await hashPin(vPin(body.newPin));
  await tx(async (c) => {
    await c.query('UPDATE users SET pin_hash = $2, updated_at = now() WHERE id = $1', [user.id, hash]);
    // Sign out other devices.
    await c.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [user.id, user.sessionId]);
    await audit(c, user.id, 'pin_change', 'users', user.id, null, null, 'પોતાનો PIN બદલ્યો');
  });
  return { ok: true };
}

// ---- user management (owner only) ----
export async function listUsers() {
  const { rows } = await q(`SELECT id, name, mobile, role, active, (locked_until > now()) AS locked, created_at FROM users ORDER BY id`);
  return rows;
}

export async function createUser(owner, body) {
  const name = text(body.name, { label: 'નામ', max: 60, required: true });
  const m = vMobile(body.mobile);
  const role = oneOf(body.role, ROLES, 'ભૂમિકા');
  const hash = await hashPin(vPin(body.pin));
  return tx(async (c) => {
    const { rows: ex } = await c.query('SELECT id FROM users WHERE mobile = $1', [m]);
    if (ex.length) throw new HttpError(409, 'આ મોબાઇલ નંબરનો વપરાશકર્તા પહેલેથી છે.');
    const { rows: [u] } = await c.query(
      'INSERT INTO users(name, mobile, pin_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, mobile, role, active', [name, m, hash, role]);
    await audit(c, owner.id, 'create', 'users', u.id, null, { name, mobile: m, role }, null);
    return u;
  });
}

export async function updateUser(owner, userId, body) {
  userId = vId(userId);
  return tx(async (c) => {
    const { rows: [before] } = await c.query('SELECT id, name, mobile, role, active FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!before) throw new HttpError(404, 'વપરાશકર્તા મળ્યો નથી.');
    const next = { ...before };
    if (body.name !== undefined) next.name = text(body.name, { label: 'નામ', max: 60, required: true });
    if (body.role !== undefined) next.role = oneOf(body.role, ROLES, 'ભૂમિકા');
    if (body.active !== undefined) next.active = Boolean(body.active);
    if (userId === owner.id && (next.role !== 'owner' || !next.active)) throw bad('તમે પોતાની માલિક ભૂમિકા દૂર કરી શકતા નથી.');
    if (before.role === 'owner' && (next.role !== 'owner' || !next.active)) {
      const { rows: [{ n }] } = await c.query(`SELECT count(*)::int AS n FROM users WHERE role='owner' AND active AND id <> $1`, [userId]);
      if (n === 0) throw bad('ઓછામાં ઓછો એક સક્રિય માલિક હોવો જોઈએ.');
    }
    let pinReset = false;
    if (body.pin) {
      const hash = await hashPin(vPin(body.pin));
      await c.query('UPDATE users SET pin_hash = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1', [userId, hash]);
      pinReset = true;
    }
    if (body.unlock) await c.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [userId]);
    await c.query('UPDATE users SET name=$2, role=$3, active=$4, updated_at=now() WHERE id=$1', [userId, next.name, next.role, next.active]);
    if (!next.active || pinReset || next.role !== before.role) await c.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await audit(c, owner.id, 'update', 'users', userId, before, { ...next, pinReset }, null);
    return { id: userId, name: next.name, role: next.role, active: next.active };
  });
}

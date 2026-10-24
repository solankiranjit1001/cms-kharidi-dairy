import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client, ownerClient } from './helpers.js';

let app;
test.before(async () => { app = await startApp('auth'); });
test.after(async () => { await app.stop(); });

test('first-owner setup needs the server setup code and only works once', async () => {
  const anon = client(app.base);
  let r = await anon.get('/auth/status');
  assert.equal(r.data.needsSetup, true);
  r = await anon.post('/auth/setup', { setupCode: 'wrong-code-xx', name: 'x', mobile: '9876543210', pin: '2580' });
  assert.equal(r.status, 401);
  const owner = await ownerClient(app.base);
  r = await owner.get('/auth/status');
  assert.equal(r.data.user.role, 'owner');
  r = await client(app.base).post('/auth/setup', { setupCode: 'test-setup-code-123', name: 'y', mobile: '9876543211', pin: '2580' });
  assert.equal(r.status, 409);
});

test('financial data is not accessible without login; CSRF header required', async () => {
  const anon = client(app.base);
  for (const p of ['/dashboard', '/records/purchases', '/traders', '/meta', '/export', '/history']) {
    const r = await anon.get(p);
    assert.equal(r.status, 401, p);
  }
  const res = await fetch(app.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  const res2 = await fetch(app.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CMS': '1', Origin: 'https://evil.example' }, body: '{}' });
  assert.equal(res2.status, 403);
});

test('login, wrong PIN lockout, logout', async () => {
  const c = client(app.base);
  let r = await c.post('/auth/login', { mobile: '9876543210', pin: '9999' });
  assert.equal(r.status, 401);
  r = await c.post('/auth/login', { mobile: '9876543210', pin: '2580' });
  assert.equal(r.status, 200);
  assert.ok(c.cookie.startsWith('cms_sess='));
  r = await c.get('/meta'); assert.equal(r.status, 200);
  r = await c.post('/auth/logout', {}); assert.equal(r.status, 200);
  r = await c.get('/meta'); assert.equal(r.status, 401);
  // 5 wrong → locked even with the right PIN
  for (let i = 0; i < 5; i++) await c.post('/auth/login', { mobile: '9876543210', pin: '1357' });
  r = await c.post('/auth/login', { mobile: '9876543210', pin: '2580' });
  assert.equal(r.status, 429);
});

test('roles: owner manages users, viewer read-only, entry cannot void', async () => {
  const pool = (await import('../lib/db.js'));
  await pool.q('UPDATE users SET failed_attempts=0, locked_until=NULL');
  const owner = client(app.base);
  assert.equal((await owner.post('/auth/login', { mobile: '9876543210', pin: '2580' })).status, 200);
  let r = await owner.post('/users', { name: 'ભાઈ', mobile: '9000000001', pin: '4826', role: 'entry' });
  assert.equal(r.status, 201);
  r = await owner.post('/users', { name: 'બા', mobile: '9000000002', pin: '7391', role: 'viewer' });
  assert.equal(r.status, 201);
  r = await owner.post('/users', { name: 'ડુપ', mobile: '9000000002', pin: '7391', role: 'viewer' });
  assert.equal(r.status, 409);

  const entry = client(app.base); await entry.post('/auth/login', { mobile: '9000000001', pin: '4826' });
  const viewer = client(app.base); await viewer.post('/auth/login', { mobile: '9000000002', pin: '7391' });
  assert.equal((await viewer.get('/dashboard')).status, 200);
  r = await viewer.post('/records/expenses', { entry_date: '2026-10-01', category: 'અન્ય', amount: 10 });
  assert.equal(r.status, 403);
  assert.equal((await entry.get('/users')).status, 403);
  r = await entry.post('/records/expenses', { entry_date: '2026-10-01', category: 'અન્ય', amount: 10 });
  assert.equal(r.status, 201);
  const id = r.data.id;
  assert.equal((await entry.del(`/records/expenses/${id}`, { reason: 'ભૂલ' })).status, 403);
  assert.equal((await owner.del(`/records/expenses/${id}`, { reason: 'ભૂલ' })).status, 200);
  // deactivated user is logged out immediately
  const users = (await owner.get('/users')).data;
  const v = users.find((u) => u.mobile === '9000000002');
  assert.equal((await owner.patch(`/users/${v.id}`, { active: false })).status, 200);
  assert.equal((await viewer.get('/dashboard')).status, 401);
  // owner cannot demote self
  const me = users.find((u) => u.role === 'owner');
  assert.equal((await owner.patch(`/users/${me.id}`, { role: 'entry' })).status, 400);
});

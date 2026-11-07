import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ownerClient, uuid } from './helpers.js';

// v10: ઘર ખર્ચ — home income & expenses (separate book).
let app, o;
test.before(async () => { app = await startApp('v10'); o = await ownerClient(app.base); });
test.after(async () => { await app.stop(); });

test('ઘર ખર્ચ: add, totals, opening balance, by head, edit, delete', async () => {
  let r = await o.post('/homebook', { client_id: uuid(), kind: 'income', entry_date: '2026-10-30', amount: '50000', head: 'ધંધામાંથી', mode: 'ઓનલાઇન' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await o.post('/homebook', { client_id: uuid(), kind: 'expense', entry_date: '2026-11-02', amount: '1200', head: 'કરિયાણું' });
  const eid = r.data.id;
  await o.post('/homebook', { client_id: uuid(), kind: 'expense', entry_date: '2026-11-05', amount: '800', head: 'વીજળી બિલ', mode: 'ઓનલાઇન' });
  await o.post('/homebook', { client_id: uuid(), kind: 'income', entry_date: '2026-11-06', amount: '5000', head: 'ભાડું' });

  let b = (await o.get('/homebook?from=2026-11-01&to=2026-11-07')).data;
  assert.equal(b.income, '5000.00');
  assert.equal(b.expense, '2000.00');
  assert.equal(b.net, '3000.00');
  assert.equal(b.opening, '50000.00');
  assert.equal(b.closing, '53000.00');
  assert.equal(b.entries[0].entry_date, '2026-11-06'); // newest first
  assert.ok(b.heads.expense.includes('કરિયાણું'));
  assert.equal(b.by_head.find((h) => h.head === 'કરિયાણું').amount, '1200.00');

  r = await o.post('/homebook', { client_id: uuid(), kind: 'expense', entry_date: '2026-11-06', amount: '10', head: 'x', mode: 'UPI' });
  assert.equal(r.status, 400); // only રોકડ / ઓનલાઇન
  r = await o.post('/homebook', { client_id: uuid(), kind: 'expense', entry_date: '2026-11-06', amount: '10', head: '' });
  assert.equal(r.status, 400); // head required

  r = await o.patch(`/homebook/${eid}`, { entry_date: '2026-11-02', amount: '1500', head: 'કરિયાણું', mode: 'રોકડ' });
  assert.equal(r.data.amount, '1500.00');
  r = await o.del(`/homebook/${eid}`);
  assert.equal(r.status, 200);
  b = (await o.get('/homebook?from=2026-11-01&to=2026-11-07')).data;
  assert.equal(b.expense, '800.00');

  // separate book: business home screen is not affected
  const d = (await o.get('/dashboard?date=2026-11-06')).data;
  assert.equal(d.diary.expenses, '0.00');
});

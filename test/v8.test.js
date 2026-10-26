import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ownerClient, uuid } from './helpers.js';

// v8: edits without reason, "રોકડ ચૂકવેલ" tick, ઉધાર (customer credit) book.
let app, o;
test.before(async () => { app = await startApp('v8'); o = await ownerClient(app.base); });
test.after(async () => { await app.stop(); });

test('રોકડ ચૂકવેલ tick pays the whole bill; edits need no reason', async () => {
  const v = (await o.get('/meta')).data.vegetables[0];
  const r = await o.post('/records/purchases', { client_id: uuid(), entry_date: '2026-10-26', trader: 'JK', createTrader: true,
    lines: [{ vegetable_id: v.id, qty: '10', rate: '33.3', commission: 'excl7' }], paid_full: true });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.total_amount, '356.00'); // 333 + 7% (23.31 → 23)
  assert.equal(r.data.status, 'ચૂકવેલ');
  assert.equal((await o.get('/records/purchases?unpaid=1')).data.length, 0);
  const e = await o.patch(`/records/purchases/${r.data.id}`, { entry_date: '2026-10-26', trader_id: r.data.trader_id,
    lines: [{ vegetable_id: v.id, qty: '12', rate: '33.3', commission: 'excl7' }] });
  assert.equal(e.status, 200, JSON.stringify(e.data));
});

test('ઉધાર: items, total, receipt, delete; paid-up customers are hidden', async () => {
  let r = await o.post('/credit', { client_id: uuid(), entry_date: '2026-10-25', customer: 'રમેશ', kind: 'credit',
    lines: [{ item: 'ડુંગળી', qty: '5', rate: '22.5' }, { item: 'લસણ', qty: '2', rate: '120' }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.amount, '353.00'); // 112.5 → 113 + 240
  const cust = r.data.customer_id;
  r = await o.post('/credit', { client_id: uuid(), entry_date: '2026-10-26', customer: 'રમેશ', kind: 'credit', lines: [{ item: 'G4', qty: '1', rate: '47' }] });
  assert.equal(r.data.customer_id, cust); // same customer by name
  const del = r.data.id;
  await o.post('/credit', { client_id: uuid(), entry_date: '2026-10-26', customer_id: cust, kind: 'receipt', amount: '100' });

  let s = (await o.get('/credit')).data;
  assert.equal(s.total, '300.00'); // 353 + 47 − 100
  let c = (await o.get(`/credit/customers/${cust}`)).data;
  assert.equal(c.entries.length, 3);
  assert.equal(c.entries[0].lines.length, 2);
  assert.equal(c.entries.at(-1).balance, '300.00');

  assert.equal((await o.del(`/credit/${del}`)).status, 200);
  s = (await o.get('/credit')).data;
  assert.equal(s.total, '253.00');
  assert.equal((await o.get('/dashboard?date=2026-10-26')).data.credit_total, '253.00');

  // fully paid → not shown in the list
  await o.post('/credit', { client_id: uuid(), entry_date: '2026-10-26', customer_id: cust, kind: 'receipt', amount: '253' });
  s = (await o.get('/credit')).data;
  assert.equal(s.customers.length, 0);
  assert.equal(s.total, '0.00');
  // credit is not part of the day result
  assert.equal((await o.get('/dashboard?date=2026-10-25')).data.diary.result, '0.00');
});

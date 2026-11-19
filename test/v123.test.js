import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ownerClient, uuid } from './helpers.js';

// v12.3: a payment to a vepari can be edited directly — amount and date — with no correction entry.
let app, o;
test.before(async () => { app = await startApp('v123'); o = await ownerClient(app.base); });
test.after(async () => { await app.stop(); });

test('edit vepari payment: amount and date change the khatu directly', async () => {
  let r = await o.post('/records/purchases', { client_id: uuid(), entry_date: '2026-11-10', trader: 'સુધારો વેપારી', createTrader: true,
    lines: [{ vegetable: 'બટાટા', createVegetable: true, qty: '100', rate: '10' }] }); // 1000
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const tid = r.data.trader_id, bill = r.data.id;
  // papa paid ₹700 against the bill but typed it on the next day
  r = await o.post('/records/payments', { client_id: uuid(), entry_date: '2026-11-11', trader_id: tid, purchase_id: bill, amount: '700', method: 'રોકડ' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const pid = r.data.id;

  // fix: right date (10th) and right amount (₹600)
  r = await o.patch(`/records/payments/${pid}`, { entry_date: '2026-11-10', trader_id: tid, purchase_id: bill, amount: '600', method: 'રોકડ' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.entry_date, '2026-11-10');
  assert.equal(r.data.amount, '600.00');

  const st = (await o.get(`/traders/${tid}/statement`)).data;
  assert.equal(st.closing, '400.00');
  assert.equal(st.rows.filter((x) => x.type === 'payments').length, 1); // no extra correction row
  assert.deepEqual(st.rows.map((x) => x.d), ['2026-11-10', '2026-11-10']);
  const d11 = (await o.get('/dashboard?date=2026-11-11')).data;
  assert.equal(Number(d11.diary.payments), 0); // nothing left on the wrong day

  // its own old amount counts as free: ₹1000 on the same bill is allowed, ₹1001 is not
  r = await o.patch(`/records/payments/${pid}`, { entry_date: '2026-11-10', trader_id: tid, purchase_id: bill, amount: '1000', method: 'રોકડ' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await o.patch(`/records/payments/${pid}`, { entry_date: '2026-11-10', trader_id: tid, purchase_id: bill, amount: '1001', method: 'રોકડ' });
  assert.equal(r.status, 400);

  // latest payments list (home page) works without a date
  const last = (await o.get('/records/payments?limit=10')).data;
  assert.equal(last[0].id, pid);
});

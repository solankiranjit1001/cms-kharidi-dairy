import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ownerClient, uuid } from './helpers.js';

// v12: newest entries at the top (vepari list, vepari khatu, ઉધાર khatu, ભાગ E).
let app, o;
test.before(async () => { app = await startApp('v12'); o = await ownerClient(app.base); });
test.after(async () => { await app.stop(); });

test('newest first: vepari list, khatu, ઉધાર khatu, day ઉધાર', async () => {
  const buy = (d, trader, qty) => o.post('/records/purchases', { client_id: uuid(), entry_date: d, trader, createTrader: true,
    lines: [{ vegetable: 'ડુંગળી', createVegetable: true, qty, rate: '10' }] });
  let r = await buy('2026-11-10', 'જૂનો વેપારી', '10'); // 100
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const old = r.data.trader_id;
  r = await buy('2026-11-12', 'નવો વેપારી', '5');
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await buy('2026-11-11', 'જૂનો વેપારી', '20'); // 200
  r = await o.post('/records/payments', { client_id: uuid(), entry_date: '2026-11-13', trader_id: old, amount: '50', method: 'રોકડ' });
  assert.equal(r.status, 201, JSON.stringify(r.data));

  const list = (await o.get('/traders?asOf=2026-11-14')).data.map((t) => t.name);
  assert.ok(list.indexOf('જૂનો વેપારી') < list.indexOf('નવો વેપારી')); // payment on 13th is the latest activity

  const st = (await o.get(`/traders/${old}/statement`)).data;
  assert.deepEqual(st.rows.map((x) => x.d), ['2026-11-13', '2026-11-11', '2026-11-10']);
  assert.equal(st.rows[0].balance, '250.00'); // top row = current બાકી
  assert.equal(st.rows.at(-1).balance, '100.00');
  assert.equal(st.closing, '250.00');

  r = await o.post('/credit', { client_id: uuid(), entry_date: '2026-11-12', customer: 'કાનજી', kind: 'credit', lines: [{ item: 'G4', qty: '1', rate: '40' }] });
  const cust = r.data.customer_id;
  await o.post('/credit', { client_id: uuid(), entry_date: '2026-11-13', customer_id: cust, kind: 'credit', lines: [{ item: 'લસણ', qty: '1', rate: '100' }] });
  await o.post('/credit', { client_id: uuid(), entry_date: '2026-11-13', customer_id: cust, kind: 'receipt', amount: '30' });
  const l = (await o.get(`/credit/customers/${cust}`)).data;
  assert.deepEqual(l.entries.map((e) => e.kind), ['receipt', 'credit', 'credit']);
  assert.equal(l.entries[0].balance, '110.00');
  const day = (await o.get('/credit/day?date=2026-11-13')).data;
  assert.equal(day.entries[0].kind, 'receipt'); // last entered on the day is on top
});

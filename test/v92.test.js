import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ownerClient, uuid } from './helpers.js';

// v9.2: ઉધાર — edit entries, rename / delete customers, newest first, day list (ભાગ E); rate in trader khatu.
let app, o;
test.before(async () => { app = await startApp('v92'); o = await ownerClient(app.base); });
test.after(async () => { await app.stop(); });

test('ઉધાર: edit entry, rename and delete customer, newest first, day list', async () => {
  let r = await o.post('/credit', { client_id: uuid(), entry_date: '2026-10-20', customer: 'જૂનો', kind: 'credit', lines: [{ item: 'લસણ', qty: '1', rate: '150' }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await o.post('/credit', { client_id: uuid(), entry_date: '2026-11-05', customer: 'નવો', kind: 'credit', lines: [{ item: 'G4', qty: '2', rate: '40' }] });
  const nid = r.data.customer_id, eid = r.data.id;

  let s = (await o.get('/credit')).data;
  assert.deepEqual(s.customers.map((c) => c.name), ['નવો', 'જૂનો']); // newest ઉધાર first

  r = await o.patch(`/credit/${eid}`, { entry_date: '2026-11-06', lines: [{ item: 'G4', qty: '3', rate: '40' }, { item: 'લીંબુ', qty: '1', rate: '60' }], note: 'સુધાર્યું' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.amount, '180.00');
  let l = (await o.get(`/credit/customers/${nid}`)).data;
  assert.equal(l.entries[0].entry_date, '2026-11-06');
  assert.equal(l.entries[0].lines.length, 2);
  assert.equal(l.customer.balance, '180.00');

  r = await o.post('/credit', { client_id: uuid(), entry_date: '2026-11-06', customer_id: nid, kind: 'receipt', amount: '50' });
  r = await o.patch(`/credit/${r.data.id}`, { entry_date: '2026-11-06', amount: '80' });
  assert.equal(r.data.amount, '80.00');
  assert.equal((await o.get(`/credit/customers/${nid}`)).data.customer.balance, '100.00');

  const day = (await o.get('/credit/day?date=2026-11-06')).data;
  assert.equal(day.credit, '180.00');
  assert.equal(day.received, '80.00');
  assert.equal(day.entries[0].customer, 'નવો');

  r = await o.patch(`/credit/customers/${nid}`, { name: 'જૂનો' });
  assert.equal(r.status, 400); // name already used
  r = await o.patch(`/credit/customers/${nid}`, { name: 'નવો ભાઈ' });
  assert.equal(r.status, 200);

  r = await o.del(`/credit/customers/${nid}`);
  assert.equal(r.status, 200);
  s = (await o.get('/credit')).data;
  assert.deepEqual(s.customers.map((c) => c.name), ['જૂનો']);
  assert.equal(s.total, '150.00');
  assert.ok(!s.names.some((n) => n.name === 'નવો ભાઈ'));

  // same name again → the customer comes back, with only the new entry
  r = await o.post('/credit', { client_id: uuid(), entry_date: '2026-11-07', customer: 'નવો ભાઈ', kind: 'credit', lines: [{ item: 'G4', qty: '1', rate: '10' }] });
  assert.equal(r.data.customer_id, nid);
  assert.equal((await o.get(`/credit/customers/${nid}`)).data.customer.balance, '10.00');
});

test('trader khatu shows the purchase rate', async () => {
  const r = await o.post('/records/purchases', { client_id: uuid(), entry_date: '2026-11-05', trader: 'Ashapura', createTrader: true,
    lines: [{ vegetable: 'ટીંડોરા', createVegetable: true, qty: '21', rate: '25' }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const st = (await o.get(`/traders/${r.data.trader_id}/statement`)).data;
  assert.match(st.rows[0].detail, /ટીંડોરા 21kg × ₹25/);
});

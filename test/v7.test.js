import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ownerClient, uuid } from './helpers.js';

// v7: fixed vegetable list, 7% commission, payments against a bill, general payments clear oldest bills first.
let app, o;
test.before(async () => { app = await startApp('v7'); o = await ownerClient(app.base); });
test.after(async () => { await app.stop(); });

const veg = async (name) => (await o.get('/meta')).data.vegetables.find((v) => v.name === name);

test('fixed vegetable list is present after the fresh start', async () => {
  const names = (await o.get('/meta')).data.vegetables.map((v) => v.name);
  for (const n of ['ડુંગળી', 'લસણ', 'શેડિયા', 'ભોલર', 'G4', 'સૂરણ', 'વાલોળ', 'ટીંડોરા']) assert.ok(names.includes(n), n);
  assert.equal((await o.get('/meta')).data.traders.length, 0);
});

test('commission: included, +6% and +7%', async () => {
  const [a, b, c] = [await veg('ડુંગળી'), await veg('લસણ'), await veg('G4')];
  const r = await o.post('/records/purchases', { client_id: uuid(), entry_date: '2026-10-26', trader: 'JK', createTrader: true,
    lines: [{ vegetable_id: a.id, qty: '100', rate: '10', commission: 'incl' },   // 1000
            { vegetable_id: b.id, qty: '100', rate: '10', commission: 'excl6' },  // 1000 + 60
            { vegetable_id: c.id, qty: '100', rate: '10', commission: 'excl7' }] }); // 1000 + 70
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.total_amount, '3130.00');
  assert.deepEqual(r.data.lines.map((l) => l.commission_pct), [0, 6, 7]);
  const bad = await o.post('/records/purchases', { client_id: uuid(), entry_date: '2026-10-26', trader_id: r.data.trader_id,
    lines: [{ vegetable_id: a.id, qty: '1', rate: '1', commission: 'excl9' }] });
  assert.equal(bad.status, 400);
});

test('new vegetable typed once is saved permanently', async () => {
  const r = await o.post('/records/purchases', { client_id: uuid(), entry_date: '2026-10-26', trader: 'JK',
    lines: [{ vegetable: 'મરચાં', unit: 'kg', createVegetable: true, qty: '10', rate: '50' }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.ok(await veg('મરચાં'));
});

test('ચુકવો against a bill shows in that bill; general payment clears oldest bill first', async () => {
  const v = await veg('સૂરણ');
  const buy = (date, amount) => o.post('/records/purchases', { client_id: uuid(), entry_date: date, trader: 'Pareshbhai', createTrader: true,
    lines: [{ vegetable_id: v.id, qty: '1', rate: amount }] });
  const b1 = (await buy('2026-10-24', '1000')).data, b2 = (await buy('2026-10-25', '2000')).data;
  const tid = b1.trader_id;

  // pay against bill 2 directly
  let p = await o.post('/records/payments', { client_id: uuid(), entry_date: '2026-10-26', trader_id: tid, purchase_id: b2.id, amount: '500' });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  let g2 = (await o.get(`/records/purchases/${b2.id}`)).data;
  assert.equal(g2.paid_amount, '500.00');
  assert.equal(g2.due_amount, '1500.00');
  assert.equal(g2.status, 'આંશિક');

  // more than the bill's due is refused
  p = await o.post('/records/payments', { client_id: uuid(), entry_date: '2026-10-26', trader_id: tid, purchase_id: b2.id, amount: '1501' });
  assert.equal(p.status, 400);

  // general payment of 1200: bill 1 (oldest) fully paid, 200 goes to bill 2
  p = await o.post('/records/payments', { client_id: uuid(), entry_date: '2026-10-26', trader_id: tid, amount: '1200' });
  assert.equal(p.status, 201);
  const g1 = (await o.get(`/records/purchases/${b1.id}`)).data;
  g2 = (await o.get(`/records/purchases/${b2.id}`)).data;
  assert.equal(g1.status, 'ચૂકવેલ');
  assert.equal(g2.due_amount, '1300.00');

  // carry forward: bill 2 is still in the unpaid list on a later date
  const unpaid = (await o.get('/records/purchases?unpaid=1&to=2026-10-27')).data.map((x) => x.id);
  assert.ok(unpaid.includes(b2.id));
  assert.ok(!unpaid.includes(b1.id));
  const d = (await o.get('/dashboard?date=2026-10-25')).data;
  assert.equal(d.diary.today_bills_due, '1300.00');
});

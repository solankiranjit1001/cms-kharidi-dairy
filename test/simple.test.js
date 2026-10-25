import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ownerClient, uuid } from './helpers.js';

// v6 simple daily accounting: buy → pay part → type one sales total → result = sales − buying − expenses.
let app, o;
const D = '2026-10-20';
test.before(async () => { app = await startApp('simple'); o = await ownerClient(app.base); });
test.after(async () => { await app.stop(); });

test('day result, partial payment due, and one sales total per day', async () => {
  let r = await o.post('/records/purchases', { client_id: uuid(), entry_date: D, trader: 'મહેશભાઈ', createTrader: true,
    lines: [{ vegetable: 'મરચાં', createVegetable: true, qty: '50', rate: '60' }, { vegetable: 'ડુંગળી', createVegetable: true, qty: '200', rate: '10' }],
    paid_amount: '4000', transport_amount: '200' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.total_amount, '5000.00');
  assert.equal(r.data.due_amount, '1000.00');
  assert.equal(r.data.status, 'આંશિક');

  let d = (await o.get(`/dashboard?date=${D}`)).data;
  assert.equal(d.diary.net_purchases, '5000.00');
  assert.equal(d.diary.payments, '4000.00');
  assert.equal(d.diary.today_bills_due, '1000.00');
  assert.equal(d.payable, '1000.00');
  assert.equal(d.diary.sales_entered, false);
  assert.ok(d.warnings.some((w) => w.kind === 'day_sale'));
  assert.equal(d.diary.result, '-5200.00');

  r = await o.put(`/daysale/${D}`, { amount: '6100' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  d = (await o.get(`/dashboard?date=${D}`)).data;
  assert.equal(d.diary.sales, '6100.00');
  assert.equal(d.diary.result, '900.00'); // 6100 − 5000 − 200
  assert.equal(d.warnings.length, 0);

  // changing a saved total needs a reason, and is audited
  r = await o.put(`/daysale/${D}`, { amount: '6000' });
  assert.equal(r.status, 400);
  r = await o.put(`/daysale/${D}`, { amount: '6000', reason: 'ગણતરી ભૂલ' });
  assert.equal(r.status, 200);

  // pay the remaining 1000 later
  const tid = (await o.get('/traders')).data.find((t) => t.name === 'મહેશભાઈ').id;
  r = await o.post('/records/payments', { client_id: uuid(), entry_date: '2026-10-21', trader_id: tid, amount: '1000', method: 'UPI' });
  assert.equal(r.status, 201);
  d = (await o.get('/dashboard?date=2026-10-21')).data;
  assert.equal(d.payable, '0.00');

  const s = (await o.get(`/reports/summary?from=${D}&to=2026-10-21`)).data;
  assert.equal(s.totals.sales, '6000.00');
  assert.equal(s.totals.result, '800.00');
  assert.equal(s.totals.payments, '5000.00');
  const h = (await o.get(`/history?type=day_sales`)).data;
  assert.equal(h.length, 1);
});

test('purchase lines: mudda count and 6% commission ભેગું (incl) / અલગ (excl)', async () => {
  const r = await o.post('/records/purchases', { client_id: uuid(), entry_date: '2026-10-22', trader: 'મહેશભાઈ',
    lines: [{ vegetable: 'મરચાં', qty: '50', rate: '60', mudda: '5', commission: 'incl' },
            { vegetable: 'ડુંગળી', qty: '200', rate: '10.25', mudda: '4', commission: 'excl' }] });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const [a, b] = r.data.lines;
  assert.equal(Number(a.amount), 3000); assert.equal(Number(a.commission_amount), 0); assert.equal(a.mudda, 5);
  assert.equal(Number(b.base_amount), 2050); assert.equal(Number(b.commission_amount), 123); assert.equal(Number(b.amount), 2173);
  assert.equal(r.data.total_amount, '5173.00');
  assert.equal(r.data.total_mudda, 9);
  // bad mudda refused
  const bad = await o.post('/records/purchases', { client_id: uuid(), entry_date: '2026-10-22', trader: 'મહેશભાઈ',
    lines: [{ vegetable: 'મરચાં', qty: '1', rate: '1', mudda: '2.5' }] });
  assert.equal(bad.status, 400);
  // edit: switch to incl removes the commission; reason required
  const e = await o.patch(`/records/purchases/${r.data.id}`, { entry_date: '2026-10-22', trader_id: r.data.trader_id, reason: 'કમિશન ભેગું હતું',
    lines: [{ vegetable_id: a.vegetable_id, qty: '50', rate: '60', mudda: 5 }, { vegetable_id: b.vegetable_id, qty: '200', rate: '10.25', mudda: 4, commission: 'incl' }] });
  assert.equal(e.status, 200, JSON.stringify(e.data));
  assert.equal(e.data.total_amount, '5050.00');
});

test('round off: every entry is rounded to whole rupees (₹0.50 and above goes up)', async () => {
  const r = await o.post('/records/purchases', { client_id: uuid(), entry_date: '2026-10-23', trader: 'મહેશભાઈ',
    lines: [{ vegetable: 'મરચાં', qty: '12.5', rate: '41.30' },                       // 516.25 → 516
            { vegetable: 'ડુંગળી', qty: '33', rate: '10.25', commission: 'excl' }],   // 338.25 → 338; 6% = 20.28 → 20 → 358
    paid_amount: '300.60', transport_amount: '49.50' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(Number(r.data.lines[0].amount), 516);
  assert.equal(Number(r.data.lines[1].base_amount), 338);
  assert.equal(Number(r.data.lines[1].commission_amount), 20);
  assert.equal(r.data.total_amount, '874.00');
  assert.equal(r.data.paid_amount, '301.00');
  const ex = (await o.get('/records/expenses?date=2026-10-23')).data;
  assert.equal(ex[0].amount, '50.00');
  const tid = r.data.trader_id;
  const p = await o.post('/records/payments', { client_id: uuid(), entry_date: '2026-10-23', trader_id: tid, amount: '99.49', method: 'રોકડ' });
  assert.equal(p.data.amount, '99.00');
  const s = await o.put('/daysale/2026-10-23', { amount: '1234.5' });
  assert.equal(s.data.amount, '1235.00');
});

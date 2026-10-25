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

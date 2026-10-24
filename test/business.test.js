import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client, ownerClient, uuid } from './helpers.js';

let app, o;
const D1 = '2026-10-01', D2 = '2026-10-02', D3 = '2026-10-03';
test.before(async () => { app = await startApp('biz'); o = await ownerClient(app.base); });
test.after(async () => { await app.stop(); });

const buy = (body) => o.post('/records/purchases', { client_id: uuid(), createTrader: true, ...body });

test('purchase: several vegetables in one bill, server-side amounts, partial payment status, transport as expense', async () => {
  let r = await buy({ entry_date: D1, trader: 'રમેશભાઈ', bill_no: '11', lines: [
    { vegetable: 'ટામેટાં', createVegetable: true, qty: '100', rate: '12.50' },
    { vegetable: 'મરચાં', createVegetable: true, qty: '20.5', rate: '40' }],
    paid_amount: '1000', paid_method: 'UPI', transport_amount: '150' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.total_amount, '2070.00'); // 1250 + 820
  assert.equal(r.data.paid_amount, '1000.00');
  assert.equal(r.data.due_amount, '1070.00');
  assert.equal(r.data.status, 'આંશિક');
  assert.equal(r.data.lines.length, 2);
  const ex = (await o.get(`/records/expenses?date=${D1}`)).data;
  assert.equal(ex.length, 1); assert.equal(ex[0].amount, '150.00');
  // unknown vegetable without confirmation is refused
  r = await buy({ entry_date: D1, trader: 'રમેશભાઈ', lines: [{ vegetable: 'ટમેટા', qty: 1, rate: 1 }] });
  assert.equal(r.status, 400); assert.ok(r.data.details.unknownVegetable);
  // same trader name with different spacing/case is the same trader (no duplicates)
  r = await buy({ entry_date: D1, trader: '  રમેશભાઈ ', lines: [{ vegetable: 'ટામેટાં', qty: 10, rate: 12 }] });
  const traders = (await o.get('/traders')).data;
  assert.equal(traders.filter((t) => t.name.includes('રમેશ')).length, 1);
  // paid more than bill is refused
  r = await buy({ entry_date: D1, trader: 'રમેશભાઈ', lines: [{ vegetable: 'ટામેટાં', qty: 1, rate: 10 }], paid_amount: 50 });
  assert.equal(r.status, 400);
});

test('duplicate submission with the same client_id saves once', async () => {
  const cid = uuid();
  const body = { client_id: cid, entry_date: D1, category: 'ચા/નાસ્તો', amount: '40' };
  const [a, b] = await Promise.all([o.post('/records/expenses', body), o.post('/records/expenses', body)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(a.data.id, b.data.id);
  const list = (await o.get(`/records/expenses?date=${D1}`)).data.filter((e) => e.category === 'ચા/નાસ્તો');
  assert.equal(list.length, 1);
});

test('sales cannot exceed stock (also for backdated entries); waste reduces stock but is not revenue', async () => {
  const meta = (await o.get('/meta')).data;
  const tom = meta.vegetables.find((v) => v.name === 'ટામેટાં').id;
  // stock of ટામેટાં on D1 = 100 + 10 = 110 (the over-paid bill was refused)
  let r = await o.post('/records/sales', { client_id: uuid(), entry_date: D2, vegetable_id: tom, qty: '80', rate: '20', discount: '10', payment_mode: 'UPI' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.gross, '1600.00'); assert.equal(r.data.amount, '1590.00');
  r = await o.post('/records/sales', { client_id: uuid(), entry_date: D2, vegetable_id: tom, qty: '40', rate: '20' });
  assert.equal(r.status, 400); assert.match(r.data.error, /પૂરતો સ્ટોક નથી/);
  r = await o.post('/records/waste', { client_id: uuid(), entry_date: D2, vegetable_id: tom, qty: '6', reason: 'બગડેલ' });
  assert.equal(r.status, 201);
  assert.equal(r.data.est_rate, '12.45'); // weighted average (1250+120)/110
  // backdated sale on D1 that would make D2 negative: D1 has 110; D2 uses 86 → max takeable on D1 = 24
  r = await o.post('/records/sales', { client_id: uuid(), entry_date: D1, vegetable_id: tom, qty: '30', rate: '20' });
  assert.equal(r.status, 400);
  const av = (await o.get(`/stock/available?vegetable_id=${tom}&date=${D1}`)).data;
  assert.equal(Number(av.canTake), 24);
  const dash = (await o.get(`/dashboard?date=${D2}`)).data;
  assert.equal(dash.totals.sales, '1590.00'); // waste not counted as sales
  const st = dash.stock.find((s) => s.name === 'ટામેટાં');
  assert.equal(Number(st.opening), 110); assert.equal(Number(st.sold), 80); assert.equal(Number(st.wasted), 6); assert.equal(Number(st.closing), 24);
});

test('edit and void recalculate stock; edits need a reason and are audited; cannot void a purchase whose stock was sold', async () => {
  const sales = (await o.get(`/records/sales?date=${D2}`)).data;
  const s = sales[0];
  let r = await o.patch(`/records/sales/${s.id}`, { entry_date: D2, vegetable_id: s.vegetable_id, qty: '70', rate: '20', payment_mode: 'UPI' });
  assert.equal(r.status, 400); // no reason
  r = await o.patch(`/records/sales/${s.id}`, { entry_date: D2, vegetable_id: s.vegetable_id, qty: '70', rate: '20', payment_mode: 'UPI', reason: 'જથ્થો ખોટો લખ્યો' });
  assert.equal(r.status, 200); assert.equal(r.data.amount, '1400.00');
  let st = (await o.get(`/stock?date=${D2}`)).data.rows.find((x) => x.name === 'ટામેટાં');
  assert.equal(Number(st.closing), 34);
  const audit = (await o.get(`/records/sales/${s.id}/audit`)).data;
  assert.equal(audit.length, 2); assert.equal(audit[1].reason, 'જથ્થો ખોટો લખ્યો'); assert.equal(audit[1].before.qty, '80.000');
  const big = (await o.get(`/records/purchases?date=${D1}`)).data.find((p) => p.bill_no === '11');
  r = await o.del(`/records/purchases/${big.id}`, { reason: 'ટેસ્ટ' });
  assert.equal(r.status, 400); assert.match(r.data.error, /પૂરતો સ્ટોક નથી/);
  r = await o.del(`/records/sales/${s.id}`, { reason: 'ડુપ્લિકેટ' });
  assert.equal(r.status, 200); assert.ok(r.data.voided_at);
  st = (await o.get(`/stock?date=${D2}`)).data.rows.find((x) => x.name === 'ટામેટાં');
  assert.equal(Number(st.closing), 104);
  const list = (await o.get(`/records/sales?date=${D2}`)).data; assert.equal(list.length, 0);
  const withVoid = (await o.get(`/records/sales?date=${D2}&includeVoided=1`)).data; assert.equal(withVoid.length, 1);
});

test('trader ledger: opening, purchases, returns, payments, adjustments', async () => {
  let r = await o.post('/traders', { name: 'મહેશ ટ્રેડર્સ', phone: '9825012345', opening_balance: '500' });
  assert.equal(r.status, 201);
  const tid = r.data.id;
  r = await o.post('/traders', { name: 'મહેશ  ટ્રેડર્સ' }); assert.equal(r.status, 409);
  await buy({ entry_date: D1, trader_id: tid, lines: [{ vegetable: 'બટાકા', createVegetable: true, qty: '50', rate: '20' }] }); // 1000
  r = await o.post('/records/returns', { client_id: uuid(), entry_date: D2, trader_id: tid, vegetable: 'બટાકા', qty: '5', rate: '20' }); // -100
  assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await o.post('/records/payments', { client_id: uuid(), entry_date: D2, trader_id: tid, amount: '600', method: 'બેંક', reference: 'NEFT123' });
  assert.equal(r.status, 201);
  r = await o.post('/records/trader_adjustments', { client_id: uuid(), entry_date: D2, trader_id: tid, amount: '-50', reason: 'ભાવ ફરક' });
  assert.equal(r.status, 201);
  const st = (await o.get(`/traders/${tid}/statement`)).data;
  assert.equal(st.closing, '750.00'); // 500 + 1000 − 100 − 600 − 50
  assert.equal(st.rows.length, 4);
  const bal = (await o.get('/traders')).data.find((t) => t.id === tid);
  assert.equal(bal.balance, '750.00');
  // returning more than in stock is refused
  r = await o.post('/records/returns', { client_id: uuid(), entry_date: D2, trader_id: tid, vegetable: 'બટાકા', qty: '500', rate: '20' });
  assert.equal(r.status, 400);
});

test('daily diary formulas: closing value is typed; waste and payments are not double-counted', async () => {
  // Day D3: clean scenario on a new vegetable
  await o.put(`/closing/${D2}`, { closing_stock_value: '3000' });
  await buy({ entry_date: D3, trader: 'સુરેશ', lines: [{ vegetable: 'ડુંગળી', createVegetable: true, qty: '100', rate: '10' }], paid_amount: '1000' });
  const onion = (await o.get('/meta')).data.vegetables.find((v) => v.name === 'ડુંગળી').id;
  await o.post('/records/sales', { client_id: uuid(), entry_date: D3, vegetable_id: onion, qty: '60', rate: '15' }); // 900
  await o.post('/records/waste', { client_id: uuid(), entry_date: D3, vegetable_id: onion, qty: '5', reason: 'સડેલ' });
  await o.post('/records/expenses', { client_id: uuid(), entry_date: D3, category: 'હમાલી/મજૂરી', amount: '100' });
  let d = (await o.get(`/dashboard?date=${D3}`)).data;
  assert.equal(d.diary.gross_profit, null);
  assert.ok(d.warnings.some((w) => w.kind === 'closing'));
  const stock = (await o.get(`/stock?date=${D3}`)).data;
  assert.ok(Number(stock.suggested_value) > 0);
  let r = await o.put(`/closing/${D3}`, { closing_stock_value: '3350' });
  assert.equal(r.status, 200);
  d = (await o.get(`/dashboard?date=${D3}`)).data;
  // COGS = 3000 + 1000 − 3350 = 650 ; gross = 900 − 650 = 250 ; operating = 250 − 100 = 150
  assert.equal(d.diary.opening_stock_value, '3000.00');
  assert.equal(d.diary.cogs, '650.00');
  assert.equal(d.diary.gross_profit, '250.00');
  assert.equal(d.diary.operating_result, '150.00');
  assert.equal(d.diary.net_cash, '-200.00'); // 900 in − 1000 paid − 100 expense; cash ≠ profit
  // changing a saved closing needs a reason
  r = await o.put(`/closing/${D3}`, { closing_stock_value: '3300' }); assert.equal(r.status, 400);
  r = await o.put(`/closing/${D3}`, { closing_stock_value: '3300', reason: 'ફરી ગણ્યું' }); assert.equal(r.status, 200);
  const sum = (await o.get(`/reports/summary?from=${D1}&to=${D3}`)).data;
  assert.equal(sum.days.length, 3);
  assert.equal(sum.totals.closing_stock_value, '3300.00');
});

test('physical stock count records the difference without overwriting the ledger', async () => {
  const onion = (await o.get('/meta')).data.vegetables.find((v) => v.name === 'ડુંગળી').id;
  let r = await o.post('/stock/counts', { count_date: D3, items: [{ vegetable_id: onion, physical_qty: '33' }] });
  assert.equal(r.status, 200);
  const d = (await o.get(`/dashboard?date=${D3}`)).data;
  const row = d.stock.find((s) => s.name === 'ડુંગળી');
  assert.equal(Number(row.closing), 35); assert.equal(Number(row.diff), -2);
  assert.ok(d.warnings.some((w) => w.kind === 'count_diff'));
  r = await o.post('/records/adjustments', { client_id: uuid(), entry_date: D3, vegetable_id: onion, qty: '-2' });
  assert.equal(r.status, 400); // reason mandatory
  r = await o.post('/records/adjustments', { client_id: uuid(), entry_date: D3, vegetable_id: onion, qty: '-2', reason: 'સુકાઈને વજન ઘટ્યું' });
  assert.equal(r.status, 201); assert.ok(r.data.created_by_name);
});

test('concurrent sales on two devices cannot oversell', async () => {
  await o.post('/users', { name: 'ભાઈ', mobile: '9000000011', pin: '4826', role: 'entry' });
  const other = client(app.base); await other.post('/auth/login', { mobile: '9000000011', pin: '4826' });
  await buy({ entry_date: D3, trader: 'સુરેશ', lines: [{ vegetable: 'લીંબુ', createVegetable: true, qty: '10', rate: '50' }] });
  const lemon = (await o.get('/meta')).data.vegetables.find((v) => v.name === 'લીંબુ').id;
  const attempts = [];
  for (let i = 0; i < 8; i++) {
    const who = i % 2 ? o : other;
    attempts.push(who.post('/records/sales', { client_id: uuid(), entry_date: D3, vegetable_id: lemon, qty: '3', rate: '60' }));
  }
  const res = await Promise.all(attempts);
  assert.equal(res.filter((r) => r.status === 201).length, 3); // 3 × 3 = 9 ≤ 10, 4th would be 12
  const st = (await o.get(`/stock?date=${D3}`)).data.rows.find((x) => x.name === 'લીંબુ');
  assert.equal(Number(st.closing), 1);
  // the other device sees the same shared records
  const seen = (await other.get(`/records/sales?date=${D3}&vegetable_id=${lemon}`)).data;
  assert.equal(seen.length, 3);
});

test('history search and market analysis use only saved observations', async () => {
  const meta = (await o.get('/meta')).data;
  const tom = meta.vegetables.find((v) => v.name === 'ટામેટાં').id;
  for (const [m, p] of [['ભાવનગર', 20], ['ભાવનગર', 22], ['રાજકોટ', 18]]) {
    const r = await o.post('/records/market', { client_id: uuid(), obs_date: D2, market: m, vegetable_id: tom, price: p, source: 'ફોન' });
    assert.equal(r.status, 201, JSON.stringify(r.data));
  }
  const a = (await o.get(`/market/analysis?vegetable_id=${tom}`)).data;
  const bv = a.byMarket.find((x) => x.market === 'ભાવનગર');
  assert.equal(bv.n, 2); assert.equal(bv.avg, '21.00'); assert.equal(bv.confidence, 'ઓછો ડેટા');
  const h = (await o.get('/history?q=રમેશ')).data;
  assert.ok(h.length >= 1 && h.every((x) => x.detail.includes('રમેશ')));
  const exp = await o.get('/export');
  assert.equal(exp.status, 200); assert.ok(Array.isArray(exp.data.purchases)); assert.ok(!JSON.stringify(exp.data.users).includes('scrypt'));
});

test('future dates and invalid numbers are rejected on the server', async () => {
  let r = await o.post('/records/expenses', { client_id: uuid(), entry_date: '2099-01-01', category: 'અન્ય', amount: '5' });
  assert.equal(r.status, 400);
  r = await o.post('/records/expenses', { client_id: uuid(), entry_date: D1, category: 'અન્ય', amount: '5.555' });
  assert.equal(r.status, 400);
  r = await o.post('/records/expenses', { client_id: 'not-a-uuid', entry_date: D1, category: 'અન્ય', amount: '5' });
  assert.equal(r.status, 400);
  r = await o.post('/records/sales', { client_id: uuid(), entry_date: D1, vegetable_id: 999999, qty: '1', rate: '1' });
  assert.equal(r.status, 400);
});

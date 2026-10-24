import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, client, ownerClient, uuid } from './helpers.js';

let app, o;
test.before(async () => { app = await startApp('imp'); o = await ownerClient(app.base); });
test.after(async () => { await app.stop(); });

const V4 = {
  traders: [{ id: 't1', name: 'રમેશ', phone: '9825011111', opening: 500 }],
  purchases: [{ id: 'p1', date: '2026-09-01', veg: 'ટામેટાં', qty: 50, rate: 10, amount: 500, trader: 'રમેશ', note: '' },
              { id: 'p2', date: '2026-09-01', veg: 'મરચાં', qty: 10, rate: 30, amount: 300, trader: 'અન્ય' }],
  sales: [{ id: 's1', date: '2026-09-01', veg: 'ટામેટાં', qty: 40, rate: 15, amount: 600 },
          { id: 's2', date: '2026-09-02', veg: 'મરચાં', qty: 20, rate: 40, amount: 800 }], // more than bought → negative stock warning
  waste: [{ id: 'w1', date: '2026-09-01', veg: 'ટામેટાં', qty: 2, rate: 10, reason: 'બગડેલ' }],
  payments: [{ id: 'pay1', date: '2026-09-02', trader: 'રમેશ', amount: 300, method: 'UPI', reference: 'abc' }],
  surveys: [{ id: 'm1', date: '2026-09-01', market: 'સુરત', veg: 'ટામેટાં', rate: 14 }],
  plans: [], recons: [{ date: '2026-09-01', veg: 'ટામેટાં', actual: 8, calculated: 8 }],
  adjustments: [], expenses: [{ id: 'e1', date: '2026-09-01', category: 'ટ્રાન્સપોર્ટ', amount: 120 }], settings: {},
};

test('only the owner can import', async () => {
  await o.post('/users', { name: 'ભાઈ', mobile: '9000000021', pin: '4826', role: 'entry' });
  const e = client(app.base); await e.post('/auth/login', { mobile: '9000000021', pin: '4826' });
  assert.equal((await e.post('/import', { data: V4 })).status, 403);
});

test('dry run changes nothing; commit imports; second import adds no duplicates', async () => {
  let r = await o.post('/import', { data: V4, dryRun: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.dryRun, true);
  assert.equal(r.data.new.purchase, 2); assert.equal(r.data.new.sale, 2);
  assert.equal((await o.get('/records/purchases')).data.length, 0);

  r = await o.post('/import', { data: V4, dryRun: false, fileName: 'backup.json' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.inserted.purchase, 2); assert.equal(r.data.inserted.sale, 2); assert.equal(r.data.inserted.count, 1);
  assert.equal(r.data.negative_stock.length, 1); assert.equal(r.data.negative_stock[0].name, 'મરચાં');
  const tr = (await o.get('/traders')).data.find((t) => t.name === 'રમેશ');
  assert.equal(tr.balance, '700.00'); // 500 + 500 − 300
  assert.ok((await o.get('/traders')).data.some((t) => t.name === 'અન્ય (નામ વગર)'));
  // dates preserved
  const ps = (await o.get('/records/purchases')).data; assert.ok(ps.every((p) => p.entry_date === '2026-09-01'));

  r = await o.post('/import', { data: V4, dryRun: false });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.inserted, {});
  assert.equal(r.data.already_imported.purchase, 2);
  assert.equal((await o.get('/records/purchases')).data.length, 2);
  // dashboard warns about the negative stock until it is fixed
  const d = (await o.get('/dashboard?date=2026-09-02')).data;
  assert.ok(d.warnings.some((w) => w.kind === 'negative'));
});

test('V1 records array import, and possible duplicates of hand-typed entries are flagged', async () => {
  // hand-typed entry in the new app
  await o.post('/records/purchases', { client_id: uuid(), entry_date: '2026-09-05', trader: 'રમેશ', lines: [{ vegetable: 'ટામેટાં', qty: 5, rate: 9 }] });
  const v1 = [
    { id: 'a', type: 'ખરીદી', date: '2026-09-05', veg: 'ટામેટાં', qty: 5, rate: 9, amount: 45, party: 'રમેશ', extra: 0 },
    { id: 'b', type: 'બજાર માહિતી', date: '2026-09-05', veg: 'ટામેટાં', rate: 11, market: 'ગોંડલ' },
    { id: 'c', type: 'સ્ટોક/ખર્ચ', date: '2026-09-05', veg: 'ટામેટાં', waste: 1, expense: 25, closing: 0 },
  ];
  const r = await o.post('/import', { data: v1, dryRun: true });
  assert.equal(r.data.source, 'v1');
  assert.equal(r.data.possible_duplicate_count, 1);
  const c = await o.post('/import', { data: v1, dryRun: false });
  assert.equal(c.data.inserted.market, 1); assert.equal(c.data.inserted.expense, 1); assert.equal(c.data.inserted.waste, 1);
});

test('rejects unknown file format', async () => {
  const r = await o.post('/import', { data: { hello: 1 }, dryRun: true });
  assert.equal(r.status, 400);
});

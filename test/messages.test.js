import test from 'node:test';
import assert from 'node:assert/strict';
import { startApp, ownerClient, client, uuid } from './helpers.js';

// v9: trader people, message settings, and the message text for purchases / payments.
let app, o;
const D = '2026-11-05';
test.before(async () => { app = await startApp('messages'); o = await ownerClient(app.base); });
test.after(async () => { await app.stop(); });

test('new trader mobile becomes first person; people list can be replaced', async () => {
  let r = await o.post('/traders', { name: 'રમણભાઈ', phone: '+91 98765 11111' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const tid = r.data.id;
  r = await o.get(`/traders/${tid}/contacts`);
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].mobile, '9876511111');
  assert.equal(r.data[0].auto_send, true);

  r = await o.put(`/traders/${tid}/contacts`, { contacts: [
    { id: r.data[0].id, name: 'રમણભાઈ', mobile: '9876511111', auto_send: false },
    { name: 'સુરેશ (મુનીમ)', mobile: '9876522222', note: 'પૈસા લેવા આવે', auto_send: true },
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.length, 2);

  // duplicate mobile and bad mobile are refused
  r = await o.put(`/traders/${tid}/contacts`, { contacts: [{ name: 'a', mobile: '9876522222' }, { name: 'b', mobile: '9876522222' }] });
  assert.equal(r.status, 400);
  r = await o.put(`/traders/${tid}/contacts`, { contacts: [{ name: 'a', mobile: '12345' }] });
  assert.equal(r.status, 400);

  // removing a person keeps the other; trader phone follows the first person
  const list = (await o.get(`/traders/${tid}/contacts`)).data;
  r = await o.put(`/traders/${tid}/contacts`, { contacts: [list[1]] });
  assert.equal(r.data.length, 1);
  const bal = (await o.get('/traders')).data.find((t) => t.id === tid);
  assert.equal(bal.phone, '9876522222');
});

test('message text for purchase, payment and trader account', async () => {
  let r = await o.post('/records/purchases', { client_id: uuid(), entry_date: D, trader: 'મહેશભાઈ', createTrader: true,
    lines: [{ vegetable: 'મરચાં', createVegetable: true, qty: '50', rate: '60' }, { vegetable: 'ડુંગળી', createVegetable: true, qty: '200', rate: '10' }],
    paid_amount: '4000' });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const bill = r.data;
  r = await o.get(`/messages/purchases/${bill.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.trader.name, 'મહેશભાઈ');
  assert.deepEqual(r.data.contacts, []);
  assert.ok(r.data.text.includes('તારીખ - 05-11-2026'));
  assert.ok(r.data.text.includes('કુલ બિલ: ₹5,000\nચૂકવ્યા: ₹4,000\nઆ બિલની બાકી: ₹1,000\nતમારી કુલ બાકી: ₹1,000'));
  assert.ok(r.data.text.endsWith('\nCMS'));

  r = await o.post('/records/payments', { client_id: uuid(), entry_date: D, trader_id: bill.trader_id, amount: '1000', method: 'UPI', purchase_id: bill.id });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  r = await o.get(`/messages/payments/${r.data.id}`);
  assert.ok(r.data.text.includes('તારીખ - 05-11-2026\nચૂકવ્યા: ₹1,000 (UPI)'));
  assert.ok(r.data.text.includes('હિસાબ પૂરો'));

  r = await o.get(`/messages/traders/${bill.trader_id}`);
  assert.ok(r.data.text.includes('હિસાબ પૂરો'));

  r = await o.post('/messages/log', { type: 'purchases', id: bill.id, channel: 'sms', to: ['9876511111'] });
  assert.equal(r.status, 200);
  const audit = (await o.get('/audit')).data;
  assert.ok(audit.some((a) => a.action === 'message' && a.entity === 'purchases'));
});

test('settings: owner only, shown in /meta', async () => {
  let r = await o.get('/meta');
  assert.equal(r.data.messages.auto, false);
  r = await o.put('/messages/settings', { auto: true, on_payment: false, signature: 'CMS શાક' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { auto: true, on_purchase: true, on_payment: false, signature: 'CMS શાક' });
  assert.equal((await o.get('/meta')).data.messages.signature, 'CMS શાક');

  await o.post('/users', { name: 'ભાઈ', mobile: '9876500001', pin: '4826', role: 'entry' });
  const e = client(app.base);
  await e.post('/auth/login', { mobile: '9876500001', pin: '4826' });
  r = await e.put('/messages/settings', { auto: false });
  assert.equal(r.status, 403);
});

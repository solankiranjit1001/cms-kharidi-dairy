// v9: trader people (contacts) + messages to traders after a purchase / payment.
// The app never sends anything itself: it prepares the Gujarati text and the phone opens WhatsApp or its own SMS app
// with that text typed in (no paid SMS package). Settings decide whether that window opens automatically after saving.
import { q, tx } from './db.js';
import { bad, forbidden, notFound } from './errors.js';
import { text, mobile as vMobile, id as vId, todayIST, bool } from './validate.js';
import { audit } from './audit.js';
import { getRecord } from './records.js';
import { purchaseText, paymentText, balanceText } from './msgtext.js';

const canWrite = (user) => { if (!(user.role === 'owner' || user.role === 'entry')) throw forbidden(); };
const DEFAULTS = { auto: false, on_purchase: true, on_payment: true, signature: 'CMS' };
const MAX_CONTACTS = 15;

// ---------- settings ----------
export async function getSettings() {
  const { rows: [r] } = await q(`SELECT value FROM app_settings WHERE key = 'messages'`);
  return { ...DEFAULTS, ...(r?.value || {}) };
}

export async function saveSettings(user, body) {
  if (user.role !== 'owner') throw forbidden('મેસેજ સેટિંગ માત્ર માલિક બદલી શકે.');
  const before = await getSettings();
  const next = {
    auto: body.auto === undefined ? before.auto : bool(body.auto),
    on_purchase: body.on_purchase === undefined ? before.on_purchase : bool(body.on_purchase),
    on_payment: body.on_payment === undefined ? before.on_payment : bool(body.on_payment),
    signature: body.signature === undefined ? before.signature : (text(body.signature, { label: 'મેસેજમાં નામ', max: 40 }) || ''),
  };
  await tx(async (c) => {
    await c.query(`INSERT INTO app_settings(key, value, updated_by) VALUES ('messages', $1, $2)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`, [JSON.stringify(next), user.id]);
    await audit(c, user.id, 'update', 'app_settings', 'messages', before, next, null);
  });
  return next;
}

// ---------- trader people ----------
export async function listContacts(traderId) {
  traderId = vId(traderId, 'વેપારી');
  const { rows } = await q(`SELECT id, trader_id, name, mobile, note, auto_send FROM trader_contacts
    WHERE trader_id = $1 AND active ORDER BY id`, [traderId]);
  return rows;
}

/** Replace the trader's list of people. body.contacts = [{ id?, name, mobile, note, auto_send }]. Removed people are kept as inactive. */
export async function saveContacts(user, traderId, body) {
  canWrite(user);
  traderId = vId(traderId, 'વેપારી');
  if (!Array.isArray(body.contacts)) throw bad('માણસોની યાદી માન્ય નથી.');
  if (body.contacts.length > MAX_CONTACTS) throw bad(`એક વેપારીના વધુમાં વધુ ${MAX_CONTACTS} માણસ.`);
  const list = body.contacts.map((x, i) => {
    let m;
    try { m = vMobile(x.mobile); } catch { throw bad(`માણસ ${i + 1}: મોબાઇલ નંબર 10 અંકનો હોવો જોઈએ.`); }
    return {
      id: x.id ? vId(x.id) : null,
      name: text(x.name, { label: `માણસ ${i + 1}: નામ`, max: 60, required: true }),
      mobile: m,
      note: text(x.note, { label: `માણસ ${i + 1}: નોંધ`, max: 80 }),
      auto_send: x.auto_send === undefined ? true : bool(x.auto_send),
    };
  });
  const seen = new Set();
  for (const x of list) { if (seen.has(x.mobile)) throw bad(`મોબાઇલ ${x.mobile} બે વાર લખ્યો છે.`); seen.add(x.mobile); }

  return tx(async (c) => {
    const { rows: [t] } = await c.query('SELECT id, name FROM traders WHERE id = $1 FOR UPDATE', [traderId]);
    if (!t) throw notFound('વેપારી મળ્યો નથી.');
    const { rows: before } = await c.query('SELECT id, name, mobile, note, auto_send FROM trader_contacts WHERE trader_id = $1 AND active ORDER BY id', [traderId]);
    const keep = new Set(list.filter((x) => x.id).map((x) => x.id));
    // 1) people removed from the list → inactive (frees their mobile for re-use)
    for (const b of before) {
      if (!keep.has(b.id)) await c.query('UPDATE trader_contacts SET active = FALSE, updated_at = now(), updated_by = $2 WHERE id = $1', [b.id, user.id]);
    }
    // 2) update kept people, then add new ones
    for (const x of list.filter((y) => y.id)) {
      if (!before.some((b) => b.id === x.id)) throw bad('માણસ મળ્યો નથી — પાનું ફરી ખોલો.');
      await c.query(`UPDATE trader_contacts SET name=$2, mobile=$3, note=$4, auto_send=$5, updated_at=now(), updated_by=$6 WHERE id=$1`,
        [x.id, x.name, x.mobile, x.note, x.auto_send, user.id]);
    }
    for (const x of list.filter((y) => !y.id)) {
      await c.query(`INSERT INTO trader_contacts(trader_id, name, mobile, note, auto_send, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [traderId, x.name, x.mobile, x.note, x.auto_send, user.id]);
    }
    // 3) keep the trader's single "phone" (shown in lists) = first person's mobile
    const { rows: after } = await c.query('SELECT id, name, mobile, note, auto_send FROM trader_contacts WHERE trader_id = $1 AND active ORDER BY id', [traderId]);
    await c.query('UPDATE traders SET phone = $2, updated_at = now(), updated_by = $3 WHERE id = $1', [traderId, after[0]?.mobile || null, user.id]);
    await audit(c, user.id, 'update', 'trader_contacts', traderId, before, after, null);
    return after;
  });
}

// ---------- message text ----------
async function traderBalance(traderId) {
  const { rows: [r] } = await q(
    `SELECT t.opening_balance
       + coalesce((SELECT sum(total_amount) FROM purchases WHERE trader_id = t.id AND voided_at IS NULL), 0)
       - coalesce((SELECT sum(amount) FROM purchase_returns WHERE trader_id = t.id AND voided_at IS NULL), 0)
       - coalesce((SELECT sum(amount) FROM payments WHERE trader_id = t.id AND voided_at IS NULL), 0)
       + coalesce((SELECT sum(amount) FROM trader_adjustments WHERE trader_id = t.id AND voided_at IS NULL), 0) AS balance
     FROM traders t WHERE t.id = $1`, [traderId]);
  return r ? r.balance : '0';
}

/** What to send: { type, id, trader, text, contacts, settings }. type = purchases | payments | traders */
export async function compose(type, recId) {
  const settings = await getSettings();
  let trader, msg;
  if (type === 'purchases' || type === 'payments') {
    const rec = await getRecord(type, recId);
    if (rec.voided_at) throw bad('રદ કરેલ એન્ટ્રીનો મેસેજ ન મોકલાય.');
    trader = { id: rec.trader_id, name: rec.trader_name };
    const bal = await traderBalance(rec.trader_id);
    msg = type === 'purchases' ? purchaseText(rec, bal, settings.signature) : paymentText(rec, bal, settings.signature);
  } else if (type === 'traders') {
    const { rows: [t] } = await q('SELECT id, name FROM traders WHERE id = $1', [vId(recId, 'વેપારી')]);
    if (!t) throw notFound('વેપારી મળ્યો નથી.');
    trader = t;
    msg = balanceText(t, await traderBalance(t.id), todayIST(), settings.signature);
  } else throw notFound();
  return { type, id: Number(recId), trader, text: msg, contacts: await listContacts(trader.id), settings };
}

/** Remember that a message window was opened (the phone does the actual sending). */
export async function logMessage(user, body) {
  canWrite(user);
  const type = ['purchases', 'payments', 'traders'].includes(body.type) ? body.type : null;
  if (!type) throw bad('મેસેજ પ્રકાર માન્ય નથી.');
  const channel = body.channel === 'sms' ? 'SMS' : 'WhatsApp';
  const to = Array.isArray(body.to) ? body.to.slice(0, MAX_CONTACTS).map((m) => String(m).replace(/\D/g, '').slice(-10)) : [];
  await tx((c) => audit(c, user.id, 'message', type, vId(body.id), null, { channel, to, auto: bool(body.auto) }, `${channel} મેસેજ: ${to.join(', ')}`));
  return { ok: true };
}

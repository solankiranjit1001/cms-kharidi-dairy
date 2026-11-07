// v10: ઘર ખર્ચ — home income & expenses (Khatabook-style cash book). Separate from all business figures.
import { q, tx } from './db.js';
import { bad, forbidden, notFound } from './errors.js';
import { txDate, anyDate, text, oneOf, clientId, id as vId, todayIST } from './validate.js';
import { paise, rupees, rupeeAmt } from './money.js';
import { audit } from './audit.js';

export const HOME_MODES = ['રોકડ', 'ઓનલાઇન'];
// Suggestions only — any other head can be typed.
export const EXPENSE_HEADS = ['કરિયાણું', 'શાકભાજી', 'દૂધ', 'વીજળી બિલ', 'ગેસ', 'મોબાઇલ રિચાર્જ', 'પેટ્રોલ', 'દવા / દવાખાનું',
  'શાળા / ફી', 'ઘર ભાડું', 'લોન હપ્તો', 'વીમો', 'કપડાં', 'પ્રસંગ / વ્યવહાર', 'મરામત', 'અન્ય'];
export const INCOME_HEADS = ['ધંધામાંથી', 'પગાર', 'ભાડું', 'વ્યાજ', 'ખેતી', 'અન્ય'];

const canWrite = (user) => { if (!(user.role === 'owner' || user.role === 'entry')) throw forbidden(); };

function parse(body) {
  const kind = body.kind === 'income' ? 'income' : 'expense';
  const amount = rupeeAmt(body.amount, 'રકમ');
  if (amount <= 0n) throw bad('રકમ 0 થી વધુ હોવી જોઈએ.');
  return {
    kind,
    date: txDate(body.entry_date),
    amount,
    head: text(body.head, { label: kind === 'income' ? 'આવક ક્યાંથી' : 'ખર્ચ શેના પર', max: 60, required: true }),
    mode: oneOf(body.mode || 'રોકડ', HOME_MODES, 'રોકડ / ઓનલાઇન'),
    note: text(body.note, { label: 'નોંધ', max: 200 }),
  };
}

/** Entries between two dates (newest first) + totals, totals by head, and the balance carried from before. */
export async function homeBook(query = {}) {
  const today = todayIST();
  const to = query.to ? anyDate(query.to) : today;
  const from = query.from ? anyDate(query.from) : `${to.slice(0, 8)}01`;
  if (from > to) throw bad('શરૂઆતની તારીખ પછીની તારીખ કરતાં મોટી છે.');
  const { rows } = await q(
    `SELECT e.id, e.entry_date, e.kind, e.amount, e.head, e.mode, e.note, u.name AS created_by_name
       FROM home_entries e LEFT JOIN users u ON u.id = e.created_by
      WHERE e.voided_at IS NULL AND e.entry_date BETWEEN $1 AND $2 ORDER BY e.entry_date DESC, e.id DESC`, [from, to]);
  const { rows: [b] } = await q(
    `SELECT coalesce(sum(CASE WHEN kind = 'income' THEN amount ELSE -amount END), 0) AS before
       FROM home_entries WHERE voided_at IS NULL AND entry_date < $1`, [from]);
  let income = 0n, expense = 0n;
  const heads = new Map();
  for (const r of rows) {
    const a = paise(r.amount, 'રકમ');
    if (r.kind === 'income') income += a; else expense += a;
    const k = `${r.kind}|${r.head}`;
    heads.set(k, (heads.get(k) || 0n) + a);
  }
  const byHead = [...heads].map(([k, a]) => ({ kind: k.split('|')[0], head: k.split('|').slice(1).join('|'), amount: rupees(a) }))
    .sort((x, y) => (x.kind === y.kind ? Number(paise(y.amount) - paise(x.amount)) : x.kind === 'income' ? -1 : 1));
  const before = paise(b.before, 'બાકી', { allowNegative: true });
  const { rows: used } = await q(`SELECT kind, head, count(*) AS n FROM home_entries WHERE voided_at IS NULL GROUP BY kind, head ORDER BY n DESC LIMIT 60`);
  return {
    from, to, entries: rows,
    income: rupees(income), expense: rupees(expense), net: rupees(income - expense),
    opening: rupees(before), closing: rupees(before + income - expense),
    by_head: byHead,
    heads: {
      income: [...new Set([...used.filter((u) => u.kind === 'income').map((u) => u.head), ...INCOME_HEADS])],
      expense: [...new Set([...used.filter((u) => u.kind === 'expense').map((u) => u.head), ...EXPENSE_HEADS])],
    },
  };
}

export async function createHome(user, body) {
  canWrite(user);
  const cid = clientId(body.client_id);
  const e = parse(body);
  return tx(async (c) => {
    if (cid) {
      const { rows: [ex] } = await c.query('SELECT id FROM home_entries WHERE client_id = $1', [cid]);
      if (ex) return { id: ex.id, duplicate: true };
    }
    const { rows: [r] } = await c.query(
      `INSERT INTO home_entries(entry_date, kind, amount, head, mode, note, client_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [e.date, e.kind, rupees(e.amount), e.head, e.mode, e.note, cid, user.id]);
    await audit(c, user.id, 'create', 'home_entries', r.id, null, { ...e, amount: rupees(e.amount) }, null);
    return { id: r.id, kind: e.kind, amount: rupees(e.amount) };
  });
}

export async function updateHome(user, entryId, body) {
  canWrite(user);
  entryId = vId(entryId);
  return tx(async (c) => {
    const { rows: [before] } = await c.query('SELECT * FROM home_entries WHERE id = $1 FOR UPDATE', [entryId]);
    if (!before || before.voided_at) throw notFound('એન્ટ્રી મળી નથી.');
    const e = parse({ ...body, kind: body.kind || before.kind });
    await c.query(`UPDATE home_entries SET entry_date=$2, kind=$3, amount=$4, head=$5, mode=$6, note=$7, updated_at=now(), updated_by=$8 WHERE id=$1`,
      [entryId, e.date, e.kind, rupees(e.amount), e.head, e.mode, e.note, user.id]);
    await audit(c, user.id, 'update', 'home_entries', entryId, before, { ...e, amount: rupees(e.amount) }, null);
    return { id: entryId, kind: e.kind, amount: rupees(e.amount) };
  });
}

/** Removed entries stay in the database (marked removed), like everywhere else in the app. */
export async function deleteHome(user, entryId) {
  canWrite(user);
  entryId = vId(entryId);
  return tx(async (c) => {
    const { rows: [e] } = await c.query('SELECT * FROM home_entries WHERE id = $1 FOR UPDATE', [entryId]);
    if (!e || e.voided_at) throw notFound('એન્ટ્રી મળી નથી.');
    await c.query('UPDATE home_entries SET voided_at = now(), voided_by = $2 WHERE id = $1', [entryId, user.id]);
    await audit(c, user.id, 'void', 'home_entries', entryId, { kind: e.kind, amount: e.amount, head: e.head }, null, null);
    return { ok: true };
  });
}

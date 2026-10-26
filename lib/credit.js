// ઉધાર — credit given to our customers. A separate book, not linked to any other report or to the day result.
//   Customer balance = credit entries − money received (voided entries ignored).
// Amounts follow the app rule: each line (kg × rate) is rounded off to whole rupees.
import { q, tx } from './db.js';
import { bad, forbidden, notFound } from './errors.js';
import { txDate, text, nameKey, clientId, id as vId } from './validate.js';
import { milli, paise, rupees, qtyStr, lineAmount, roundRupee, rupeeAmt } from './money.js';
import { audit } from './audit.js';

const canWrite = (user) => { if (!(user.role === 'owner' || user.role === 'entry')) throw forbidden(); };

const BALANCES = `SELECT c.id, c.name, c.phone,
    coalesce(sum(e.amount) FILTER (WHERE e.kind = 'credit'), 0) AS credit,
    coalesce(sum(e.amount) FILTER (WHERE e.kind = 'receipt'), 0) AS received,
    coalesce(sum(CASE WHEN e.kind = 'credit' THEN e.amount ELSE -e.amount END), 0) AS balance,
    max(e.entry_date) FILTER (WHERE e.kind = 'credit') AS last_credit
  FROM customers c LEFT JOIN credit_entries e ON e.customer_id = c.id AND e.voided_at IS NULL
  GROUP BY c.id`;

/** Customers who still owe money (customers with nothing due are not shown), plus the grand total. */
export async function creditSummary() {
  const { rows } = await q(`SELECT * FROM (${BALANCES}) b WHERE balance <> 0 ORDER BY name`);
  const { rows: all } = await q('SELECT id, name FROM customers ORDER BY name');
  const total = rows.reduce((a, r) => a + paise(r.balance, 'બાકી', { allowNegative: true }), 0n);
  return { customers: rows, total: rupees(total), names: all };
}

export async function creditTotal() {
  const { rows: [r] } = await q(`SELECT coalesce(sum(CASE WHEN kind = 'credit' THEN amount ELSE -amount END), 0) AS total
    FROM credit_entries WHERE voided_at IS NULL`);
  return r.total;
}

/** One customer's date-wise entries with items, and the running balance. */
export async function customerCredit(customerId) {
  customerId = vId(customerId, 'ગ્રાહક');
  const { rows: [c] } = await q(`SELECT * FROM (${BALANCES}) b WHERE id = $1`, [customerId]);
  if (!c) throw notFound('ગ્રાહક મળ્યો નથી.');
  const { rows } = await q(
    `SELECT e.id, e.entry_date, e.kind, e.amount, e.note, e.created_at, u.name AS created_by_name,
       (SELECT coalesce(json_agg(json_build_object('item', l.item, 'qty', l.qty, 'rate', l.rate, 'amount', l.amount) ORDER BY l.line_no), '[]')
          FROM credit_lines l WHERE l.entry_id = e.id) AS lines
     FROM credit_entries e LEFT JOIN users u ON u.id = e.created_by
     WHERE e.customer_id = $1 AND e.voided_at IS NULL ORDER BY e.entry_date, e.id`, [customerId]);
  let bal = 0n;
  const entries = rows.map((r) => {
    bal += (r.kind === 'credit' ? 1n : -1n) * paise(r.amount, 'રકમ');
    return { ...r, balance: rupees(bal) };
  });
  return { customer: c, entries };
}

async function resolveCustomer(c, b, userId) {
  if (b.customer_id) {
    const { rows: [x] } = await c.query('SELECT id, name FROM customers WHERE id = $1', [vId(b.customer_id, 'ગ્રાહક')]);
    if (!x) throw bad('ગ્રાહક મળ્યો નથી.');
    return x;
  }
  const name = text(b.customer, { label: 'ગ્રાહકનું નામ', max: 80, required: true });
  const key = nameKey(name);
  const { rows: [ex] } = await c.query('SELECT id, name FROM customers WHERE name_key = $1', [key]);
  if (ex) return ex;
  const { rows: [x] } = await c.query(
    `INSERT INTO customers(name, name_key, created_by) VALUES ($1,$2,$3)
     ON CONFLICT (name_key) DO UPDATE SET name_key = EXCLUDED.name_key RETURNING id, name`, [name, key, userId]);
  return x;
}

/** body: { customer | customer_id, entry_date, kind: 'credit' | 'receipt', lines: [{item, qty, rate}] (credit), amount (receipt), note } */
export async function createCreditEntry(user, body) {
  canWrite(user);
  const kind = body.kind === 'receipt' ? 'receipt' : 'credit';
  const cid = clientId(body.client_id);
  const date = txDate(body.entry_date);
  const note = text(body.note, { label: 'નોંધ', max: 200 });
  let lines = [], amount = 0n;
  if (kind === 'credit') {
    if (!Array.isArray(body.lines) || !body.lines.length) throw bad('ઓછામાં ઓછી એક વસ્તુ ઉમેરો.');
    if (body.lines.length > 40) throw bad('એક એન્ટ્રીમાં વધુમાં વધુ 40 વસ્તુ.');
    lines = body.lines.map((l, i) => {
      const item = text(l.item, { label: `પંક્તિ ${i + 1}: વસ્તુ`, max: 60, required: true });
      const qty = milli(l.qty, `પંક્તિ ${i + 1}: kg`); if (qty <= 0n) throw bad(`પંક્તિ ${i + 1}: kg 0 થી વધુ હોવા જોઈએ.`);
      const rate = paise(l.rate, `પંક્તિ ${i + 1}: દર`);
      const amt = roundRupee(lineAmount(qty, rate));
      amount += amt;
      return { line_no: i + 1, item, qty: qtyStr(qty), rate: rupees(rate), amount: rupees(amt) };
    });
    if (amount <= 0n) throw bad('કુલ રકમ 0 થી વધુ હોવી જોઈએ.');
  } else {
    amount = rupeeAmt(body.amount, 'મળેલ રકમ'); if (amount <= 0n) throw bad('રકમ 0 થી વધુ હોવી જોઈએ.');
  }
  const out = await tx(async (c) => {
    if (cid) {
      const { rows: [ex] } = await c.query('SELECT id, customer_id FROM credit_entries WHERE client_id = $1', [cid]);
      if (ex) return { id: ex.id, customer_id: ex.customer_id, duplicate: true };
    }
    const cust = await resolveCustomer(c, body, user.id);
    const { rows: [e] } = await c.query(
      `INSERT INTO credit_entries(entry_date, customer_id, kind, amount, note, client_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [date, cust.id, kind, rupees(amount), note, cid, user.id]);
    for (const l of lines) {
      await c.query('INSERT INTO credit_lines(entry_id, line_no, item, qty, rate, amount) VALUES ($1,$2,$3,$4,$5,$6)',
        [e.id, l.line_no, l.item, l.qty, l.rate, l.amount]);
    }
    await audit(c, user.id, 'create', 'credit_entries', e.id, null, { entry_date: date, customer: cust.name, kind, amount: rupees(amount), lines, note }, null);
    return { id: e.id, customer_id: cust.id };
  });
  return { ...out, amount: rupees(amount), kind };
}

/** Delete an entry (kept in the database as removed, so nothing is lost by mistake). */
export async function deleteCreditEntry(user, entryId) {
  canWrite(user);
  entryId = vId(entryId);
  return tx(async (c) => {
    const { rows: [e] } = await c.query('SELECT * FROM credit_entries WHERE id = $1 FOR UPDATE', [entryId]);
    if (!e || e.voided_at) throw notFound('એન્ટ્રી મળી નથી.');
    await c.query('UPDATE credit_entries SET voided_at = now(), voided_by = $2 WHERE id = $1', [entryId, user.id]);
    await audit(c, user.id, 'void', 'credit_entries', entryId, { amount: e.amount, kind: e.kind }, null, null);
    return { ok: true, customer_id: e.customer_id };
  });
}

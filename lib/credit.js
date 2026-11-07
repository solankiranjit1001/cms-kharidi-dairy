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
    max(e.entry_date) FILTER (WHERE e.kind = 'credit') AS last_credit,
    max(e.entry_date) AS last_date
  FROM customers c LEFT JOIN credit_entries e ON e.customer_id = c.id AND e.voided_at IS NULL
  WHERE c.deleted_at IS NULL
  GROUP BY c.id`;

/** Customers who still owe money (customers with nothing due are not shown), plus the grand total. */
export async function creditSummary() {
  // v9.2: newest ઉધાર first (owner's request)
  const { rows } = await q(`SELECT * FROM (${BALANCES}) b WHERE balance <> 0
    ORDER BY last_credit DESC NULLS LAST, last_date DESC NULLS LAST, name`);
  const { rows: all } = await q('SELECT id, name FROM customers WHERE deleted_at IS NULL ORDER BY name');
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
    const { rows: [x] } = await c.query('SELECT id, name FROM customers WHERE id = $1 AND deleted_at IS NULL', [vId(b.customer_id, 'ગ્રાહક')]);
    if (!x) throw bad('ગ્રાહક મળ્યો નથી.');
    return x;
  }
  const name = text(b.customer, { label: 'ગ્રાહકનું નામ', max: 80, required: true });
  const key = nameKey(name);
  const { rows: [ex] } = await c.query('SELECT id, name, deleted_at FROM customers WHERE name_key = $1', [key]);
  if (ex && ex.deleted_at) {
    // a deleted customer with the same name comes back (his old removed entries stay removed)
    await c.query('UPDATE customers SET deleted_at = NULL, deleted_by = NULL, name = $2, updated_at = now(), updated_by = $3 WHERE id = $1', [ex.id, name, userId]);
    return { id: ex.id, name };
  }
  if (ex) return { id: ex.id, name: ex.name };
  const { rows: [x] } = await c.query(
    `INSERT INTO customers(name, name_key, created_by) VALUES ($1,$2,$3)
     ON CONFLICT (name_key) DO UPDATE SET name_key = EXCLUDED.name_key RETURNING id, name`, [name, key, userId]);
  return x;
}

/** body: { customer | customer_id, entry_date, kind: 'credit' | 'receipt', lines: [{item, qty, rate}] (credit), amount (receipt), note } */
function parseEntry(kind, body) {
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
  return { date, note, lines, amount };
}

export async function createCreditEntry(user, body) {
  canWrite(user);
  const kind = body.kind === 'receipt' ? 'receipt' : 'credit';
  const cid = clientId(body.client_id);
  const { date, note, lines, amount } = parseEntry(kind, body);
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

/** v9.2: edit an entry — date, items (credit) or amount (receipt), note. The customer and kind stay the same. */
export async function updateCreditEntry(user, entryId, body) {
  canWrite(user);
  entryId = vId(entryId);
  return tx(async (c) => {
    const { rows: [e] } = await c.query('SELECT * FROM credit_entries WHERE id = $1 FOR UPDATE', [entryId]);
    if (!e || e.voided_at) throw notFound('એન્ટ્રી મળી નથી.');
    const { date, note, lines, amount } = parseEntry(e.kind, body);
    const { rows: before } = await c.query('SELECT line_no, item, qty, rate, amount FROM credit_lines WHERE entry_id = $1 ORDER BY line_no', [entryId]);
    await c.query('UPDATE credit_entries SET entry_date = $2, amount = $3, note = $4, updated_at = now(), updated_by = $5 WHERE id = $1',
      [entryId, date, rupees(amount), note, user.id]);
    await c.query('DELETE FROM credit_lines WHERE entry_id = $1', [entryId]);
    for (const l of lines) {
      await c.query('INSERT INTO credit_lines(entry_id, line_no, item, qty, rate, amount) VALUES ($1,$2,$3,$4,$5,$6)',
        [entryId, l.line_no, l.item, l.qty, l.rate, l.amount]);
    }
    await audit(c, user.id, 'update', 'credit_entries', entryId,
      { entry_date: e.entry_date, amount: e.amount, note: e.note, lines: before }, { entry_date: date, amount: rupees(amount), note, lines }, null);
    return { id: entryId, customer_id: e.customer_id, amount: rupees(amount), kind: e.kind };
  });
}

/** v9.2: rename a customer. */
export async function renameCustomer(user, customerId, body) {
  canWrite(user);
  customerId = vId(customerId, 'ગ્રાહક');
  const name = text(body.name, { label: 'ગ્રાહકનું નામ', max: 80, required: true });
  const key = nameKey(name);
  return tx(async (c) => {
    const { rows: [x] } = await c.query('SELECT id, name FROM customers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [customerId]);
    if (!x) throw notFound('ગ્રાહક મળ્યો નથી.');
    const { rows: [dup] } = await c.query('SELECT id, deleted_at FROM customers WHERE name_key = $1 AND id <> $2', [key, customerId]);
    if (dup && !dup.deleted_at) throw bad(`"${name}" નામનો ગ્રાહક પહેલેથી છે.`);
    if (dup) await c.query("UPDATE customers SET name_key = name_key || '#' || id WHERE id = $1", [dup.id]); // free the name from a deleted customer
    await c.query('UPDATE customers SET name = $2, name_key = $3, updated_at = now(), updated_by = $4 WHERE id = $1', [customerId, name, key, user.id]);
    await audit(c, user.id, 'update', 'customers', customerId, { name: x.name }, { name }, null);
    return { id: customerId, name };
  });
}

/** v9.2: delete a customer — hidden from the list and all his entries marked removed (kept in the database). */
export async function deleteCustomer(user, customerId) {
  canWrite(user);
  customerId = vId(customerId, 'ગ્રાહક');
  return tx(async (c) => {
    const { rows: [x] } = await c.query('SELECT id, name FROM customers WHERE id = $1 AND deleted_at IS NULL FOR UPDATE', [customerId]);
    if (!x) throw notFound('ગ્રાહક મળ્યો નથી.');
    const { rowCount } = await c.query('UPDATE credit_entries SET voided_at = now(), voided_by = $2 WHERE customer_id = $1 AND voided_at IS NULL', [customerId, user.id]);
    await c.query('UPDATE customers SET deleted_at = now(), deleted_by = $2 WHERE id = $1', [customerId, user.id]);
    await audit(c, user.id, 'void', 'customers', customerId, { name: x.name, entries: rowCount }, null, null);
    return { ok: true, entries: rowCount };
  });
}

/** v9.2: one day's ઉધાર for the daily report (ભાગ E). */
export async function creditDay(date) {
  date = txDate(date);
  const { rows } = await q(
    `SELECT e.id, e.kind, e.amount, e.note, c.name AS customer,
       (SELECT coalesce(json_agg(json_build_object('item', l.item, 'qty', l.qty, 'rate', l.rate, 'amount', l.amount) ORDER BY l.line_no), '[]')
          FROM credit_lines l WHERE l.entry_id = e.id) AS lines
     FROM credit_entries e JOIN customers c ON c.id = e.customer_id
     WHERE e.entry_date = $1 AND e.voided_at IS NULL ORDER BY e.id`, [date]);
  const sum = (k) => rupees(rows.filter((r) => r.kind === k).reduce((a, r) => a + paise(r.amount, 'રકમ'), 0n));
  return { date, entries: rows, credit: sum('credit'), received: sum('receipt') };
}

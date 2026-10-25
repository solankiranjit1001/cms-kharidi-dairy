// Create / list / get / update / void for every financial & stock record type.
// Rules: server computes all amounts; edits need a reason; deletes are "void" (owner only) with a reason;
// every change is audited in the same transaction; stock can never go negative on any later date.
import { q, tx } from './db.js';
import { bad, conflict, forbidden, notFound } from './errors.js';
import { txDate, anyDate, text, oneOf, id as vId, optId, clientId, todayIST, isDate,
  PAYMENT_METHODS, SALE_MODES } from './validate.js';
import { paise, milli, rupees, qtyStr, lineAmount, roundRupee, rupeeAmt } from './money.js';
import { resolveVegetable, resolveTrader } from './master.js';
import { lockVegetables, assertStock } from './stock.js';
import { audit } from './audit.js';

export const COMMISSION_PCT = 6n; // commission on purchases marked "અલગ" (excl)
const optMoney = (v, label) => (v === undefined || v === null || v === '' ? null : paise(v, label));

async function avgRate(c, vegId, date) {
  const { rows: [r] } = await c.query(
    `SELECT round(sum(pl.amount) / nullif(sum(pl.qty),0), 2) AS r FROM purchase_lines pl JOIN purchases p ON p.id = pl.purchase_id
      WHERE p.voided_at IS NULL AND pl.vegetable_id = $1 AND p.entry_date <= $2`, [vegId, date]);
  return r.r || '0.00';
}

// ---------- simple single-table record types ----------
const SPECS = {
  sales: {
    table: 'sales', label: 'વેચાણ', dateCol: 'entry_date', stock: true,
    cols: ['entry_date', 'vegetable_id', 'qty', 'rate', 'gross', 'discount', 'amount', 'payment_mode', 'customer', 'note'],
    async parse(c, b, user) {
      const v = await resolveVegetable(c, b, user.id);
      const qty = milli(b.qty, 'જથ્થો'); if (qty <= 0n) throw bad('જથ્થો 0 થી વધુ હોવો જોઈએ.');
      const rate = paise(b.rate, 'દર');
      const gross = roundRupee(lineAmount(qty, rate));
      const discount = roundRupee(optMoney(b.discount, 'છૂટ/બાદ') ?? 0n);
      if (discount > gross) throw bad('છૂટ કુલ રકમથી વધુ ન હોઈ શકે.');
      return { entry_date: txDate(b.entry_date), vegetable_id: v.id, qty: qtyStr(qty), rate: rupees(rate), gross: rupees(gross),
        discount: rupees(discount), amount: rupees(gross - discount),
        payment_mode: oneOf(b.payment_mode || 'રોકડ', SALE_MODES, 'ચુકવણી પ્રકાર'),
        customer: text(b.customer, { label: 'ગ્રાહક', max: 80 }), note: text(b.note, { label: 'નોંધ', max: 300 }) };
    },
    vegs: (r) => [r.vegetable_id],
  },
  waste: {
    table: 'waste', label: 'બગડેલ માલ', dateCol: 'entry_date', stock: true,
    cols: ['entry_date', 'vegetable_id', 'qty', 'est_rate', 'reason'],
    async parse(c, b, user) {
      const v = await resolveVegetable(c, b, user.id);
      const qty = milli(b.qty, 'જથ્થો'); if (qty <= 0n) throw bad('જથ્થો 0 થી વધુ હોવો જોઈએ.');
      const d = txDate(b.entry_date);
      const est = optMoney(b.est_rate, 'અંદાજિત દર');
      return { entry_date: d, vegetable_id: v.id, qty: qtyStr(qty), est_rate: est === null ? await avgRate(c, v.id, d) : rupees(est),
        reason: text(b.reason, { label: 'કારણ', max: 200, required: true }) };
    },
    vegs: (r) => [r.vegetable_id],
  },
  returns: {
    table: 'purchase_returns', label: 'વેપારીને પરત', dateCol: 'entry_date', stock: true,
    cols: ['entry_date', 'trader_id', 'vegetable_id', 'qty', 'rate', 'amount', 'note'],
    async parse(c, b, user) {
      const t = await resolveTrader(c, b, user.id);
      const v = await resolveVegetable(c, b, user.id);
      const qty = milli(b.qty, 'જથ્થો'); if (qty <= 0n) throw bad('જથ્થો 0 થી વધુ હોવો જોઈએ.');
      const rate = paise(b.rate, 'દર');
      return { entry_date: txDate(b.entry_date), trader_id: t.id, vegetable_id: v.id, qty: qtyStr(qty), rate: rupees(rate),
        amount: rupees(roundRupee(lineAmount(qty, rate))), note: text(b.note, { label: 'નોંધ', max: 300 }) };
    },
    vegs: (r) => [r.vegetable_id],
  },
  adjustments: {
    table: 'stock_adjustments', label: 'સ્ટોક સુધારો', dateCol: 'entry_date', stock: true,
    cols: ['entry_date', 'vegetable_id', 'qty', 'reason'],
    async parse(c, b, user) {
      const v = await resolveVegetable(c, b, user.id);
      const qty = milli(b.qty, 'જથ્થો', { allowNegative: true }); if (qty === 0n) throw bad('જથ્થો 0 ન હોઈ શકે.');
      return { entry_date: txDate(b.entry_date), vegetable_id: v.id, qty: qtyStr(qty),
        reason: text(b.reason, { label: 'કારણ', max: 200, required: true, min: 2 }) };
    },
    vegs: (r) => [r.vegetable_id],
  },
  payments: {
    table: 'payments', label: 'વેપારી ચુકવણી', dateCol: 'entry_date',
    cols: ['entry_date', 'trader_id', 'amount', 'method', 'reference', 'note', 'purchase_id'],
    async parse(c, b, user) {
      const t = await resolveTrader(c, b, user.id);
      const amt = rupeeAmt(b.amount, 'રકમ'); if (amt <= 0n) throw bad('રકમ 0 થી વધુ હોવી જોઈએ.');
      const pid = optId(b.purchase_id, 'બિલ');
      if (pid) {
        const { rows: [p] } = await c.query('SELECT trader_id, voided_at FROM purchases WHERE id = $1', [pid]);
        if (!p || p.voided_at) throw bad('પસંદ કરેલ ખરીદી બિલ મળ્યું નથી.');
        if (p.trader_id !== t.id) throw bad('પસંદ કરેલ બિલ આ વેપારીનું નથી.');
      }
      return { entry_date: txDate(b.entry_date), trader_id: t.id, amount: rupees(amt),
        method: oneOf(b.method || 'રોકડ', PAYMENT_METHODS, 'ચુકવણી માધ્યમ'),
        reference: text(b.reference, { label: 'રેફરન્સ', max: 80 }), note: text(b.note, { label: 'નોંધ', max: 300 }), purchase_id: pid };
    },
  },
  trader_adjustments: {
    table: 'trader_adjustments', label: 'વેપારી ખાતા સુધારો', dateCol: 'entry_date', ownerOnly: true,
    cols: ['entry_date', 'trader_id', 'amount', 'reason'],
    async parse(c, b, user) {
      const t = await resolveTrader(c, b, user.id);
      const amt = rupeeAmt(b.amount, 'રકમ', { allowNegative: true }); if (amt === 0n) throw bad('રકમ 0 ન હોઈ શકે.');
      return { entry_date: txDate(b.entry_date), trader_id: t.id, amount: rupees(amt),
        reason: text(b.reason, { label: 'કારણ', max: 200, required: true, min: 2 }) };
    },
  },
  expenses: {
    table: 'expenses', label: 'ખર્ચ', dateCol: 'entry_date',
    cols: ['entry_date', 'category', 'amount', 'note'],
    async parse(c, b) {
      const amt = rupeeAmt(b.amount, 'રકમ'); if (amt <= 0n) throw bad('રકમ 0 થી વધુ હોવી જોઈએ.');
      return { entry_date: txDate(b.entry_date), category: text(b.category, { label: 'ખર્ચ પ્રકાર', max: 40, required: true }),
        amount: rupees(amt), note: text(b.note, { label: 'નોંધ', max: 300 }) };
    },
  },
  market: {
    table: 'market_prices', label: 'બજાર ભાવ', dateCol: 'obs_date',
    cols: ['obs_date', 'market', 'vegetable_id', 'unit', 'price', 'grade', 'source'],
    async parse(c, b, user) {
      const v = await resolveVegetable(c, b, user.id);
      return { obs_date: txDate(b.obs_date ?? b.entry_date), market: text(b.market, { label: 'બજાર', max: 40, required: true }),
        vegetable_id: v.id, unit: text(b.unit, { label: 'એકમ', max: 20 }) || v.unit, price: rupees(paise(b.price, 'ભાવ')),
        grade: text(b.grade, { label: 'ગ્રેડ', max: 60 }), source: text(b.source, { label: 'સ્રોત', max: 200 }) };
    },
  },
  plans: {
    table: 'plans', label: 'આયોજન', dateCol: 'plan_date',
    cols: ['plan_date', 'vegetable_id', 'qty', 'rate', 'note'],
    async parse(c, b, user) {
      const v = await resolveVegetable(c, b, user.id);
      return { plan_date: anyDate(b.plan_date ?? b.entry_date), vegetable_id: v.id,
        qty: b.qty === '' || b.qty == null ? null : qtyStr(milli(b.qty, 'જથ્થો')),
        rate: b.rate === '' || b.rate == null ? null : rupees(paise(b.rate, 'દર')), note: text(b.note, { label: 'નોંધ', max: 300 }) };
    },
  },
};

export const RECORD_TYPES = ['purchases', ...Object.keys(SPECS)];

function spec(type) {
  const s = SPECS[type];
  if (!s) throw notFound('અજાણ્યો રેકોર્ડ પ્રકાર.');
  return s;
}

function assertCanCreate(user, s) {
  if (!(user.role === 'owner' || user.role === 'entry')) throw forbidden();
  if (s.ownerOnly && user.role !== 'owner') throw forbidden('આ એન્ટ્રી માત્ર માલિક કરી શકે.');
}

async function existingByClientId(c, table, cid) {
  if (!cid) return null;
  const { rows: [r] } = await c.query(`SELECT id FROM ${table} WHERE client_id = $1`, [cid]);
  return r ? r.id : null;
}

/** Wraps a create so a duplicate submission (same client_id) returns the original record instead of failing. */
async function idempotent(type, table, cid, fn) {
  try {
    return await tx(fn);
  } catch (e) {
    if (e.code === '23505' && cid && String(e.constraint || '').includes('client_id')) {
      const { rows: [r] } = await q(`SELECT id FROM ${table} WHERE client_id = $1`, [cid]);
      if (r) return { ...(await getRecord(type, r.id)), duplicate: true };
    }
    throw e;
  }
}

export async function createRecord(user, type, body) {
  if (type === 'purchases') return createPurchase(user, body);
  const s = spec(type);
  assertCanCreate(user, s);
  const cid = clientId(body.client_id);
  const newId = await idempotent(type, s.table, cid, async (c) => {
    const ex = await existingByClientId(c, s.table, cid);
    if (ex) return { existing: ex };
    const row = await s.parse(c, body, user);
    if (s.stock) await lockVegetables(c, s.vegs(row));
    const cols = [...s.cols, 'client_id', 'created_by', 'updated_by'];
    const vals = [...s.cols.map((k) => row[k]), cid, user.id, user.id];
    const { rows: [r] } = await c.query(
      `INSERT INTO ${s.table}(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, vals);
    if (s.stock) await assertStock(c, s.vegs(row), row[s.dateCol]);
    await audit(c, user.id, 'create', s.table, r.id, null, row, null);
    return { id: r.id };
  });
  if (newId.duplicate) return newId;
  if (newId.existing) return { ...(await getRecord(type, newId.existing)), duplicate: true };
  return getRecord(type, newId.id);
}

export async function updateRecord(user, type, recId, body) {
  if (!(user.role === 'owner' || user.role === 'entry')) throw forbidden();
  recId = vId(recId);
  const reason = text(body.reason, { label: 'ફેરફારનું કારણ', max: 200, required: true, min: 2 });
  if (type === 'purchases') return updatePurchase(user, recId, body, reason);
  const s = spec(type);
  if (s.ownerOnly && user.role !== 'owner') throw forbidden();
  await tx(async (c) => {
    const { rows: [before] } = await c.query(`SELECT * FROM ${s.table} WHERE id = $1 FOR UPDATE`, [recId]);
    if (!before) throw notFound();
    if (before.voided_at) throw conflict('રદ કરેલ એન્ટ્રીમાં ફેરફાર ન થઈ શકે.');
    const row = await s.parse(c, { ...body, client_id: undefined }, user);
    if (s.stock) await lockVegetables(c, [...s.vegs(before), ...s.vegs(row)]);
    await c.query(`UPDATE ${s.table} SET ${s.cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now(), updated_by = $${s.cols.length + 2} WHERE id = $1`,
      [recId, ...s.cols.map((k) => row[k]), user.id]);
    if (s.stock) {
      const from = before[s.dateCol] < row[s.dateCol] ? before[s.dateCol] : row[s.dateCol];
      await assertStock(c, [...s.vegs(before), ...s.vegs(row)], from);
    }
    await audit(c, user.id, 'update', s.table, recId, pick(before, s.cols), row, reason);
  });
  return getRecord(type, recId);
}

export async function voidRecord(user, type, recId, body) {
  if (user.role !== 'owner') throw forbidden('એન્ટ્રી રદ કરવાની પરવાનગી માત્ર માલિકને છે.');
  recId = vId(recId);
  const reason = text(body.reason, { label: 'રદ કરવાનું કારણ', max: 200, required: true, min: 2 });
  const table = type === 'purchases' ? 'purchases' : spec(type).table;
  await tx(async (c) => {
    const { rows: [before] } = await c.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [recId]);
    if (!before) throw notFound();
    if (before.voided_at) throw conflict('આ એન્ટ્રી પહેલેથી રદ છે.');
    let vegs = [];
    let from = null;
    if (type === 'purchases') {
      const { rows } = await c.query('SELECT vegetable_id FROM purchase_lines WHERE purchase_id = $1', [recId]);
      vegs = rows.map((r) => r.vegetable_id); from = before.entry_date;
    } else if (SPECS[type].stock) { vegs = SPECS[type].vegs(before); from = before[SPECS[type].dateCol]; }
    await lockVegetables(c, vegs);
    await c.query(`UPDATE ${table} SET voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`, [recId, user.id, reason]);
    if (vegs.length) await assertStock(c, vegs, from);
    await audit(c, user.id, 'void', table, recId, null, null, reason);
  });
  return getRecord(type, recId);
}

function pick(o, keys) { const r = {}; for (const k of keys) r[k] = o[k]; return r; }

// ---------- purchases (bill with several vegetable lines) ----------
async function parsePurchase(c, b, user) {
  const t = await resolveTrader(c, b, user.id);
  if (!Array.isArray(b.lines) || b.lines.length === 0) throw bad('ઓછામાં ઓછું એક શાક ઉમેરો.');
  if (b.lines.length > 40) throw bad('એક બિલમાં વધુમાં વધુ 40 શાક.');
  const lines = [];
  let total = 0n;
  for (const [i, l] of b.lines.entries()) {
    const v = await resolveVegetable(c, l, user.id);
    const qty = milli(l.qty, `પંક્તિ ${i + 1}: જથ્થો`); if (qty <= 0n) throw bad(`પંક્તિ ${i + 1}: જથ્થો 0 થી વધુ હોવો જોઈએ.`);
    const rate = paise(l.rate, `પંક્તિ ${i + 1}: દર`);
    // Every amount is rounded off to whole rupees (owner's rule): line amount first, then the 6% commission on it.
    const base = roundRupee(lineAmount(qty, rate));
    // 6% commission: "ભેગું" (incl, default) = already in the rate; "અલગ" (excl) = added on top.
    const excl = l.commission === 'excl' || l.commission_excl === true;
    const commission = excl ? roundRupee((base * COMMISSION_PCT + 50n) / 100n) : 0n;
    const amount = base + commission;
    let mudda = null;
    if (l.mudda !== undefined && l.mudda !== null && String(l.mudda).trim() !== '') {
      mudda = Number(String(l.mudda).trim());
      if (!Number.isInteger(mudda) || mudda < 0 || mudda > 99999) throw bad(`પંક્તિ ${i + 1}: મુદ્દા (પાર્સલ) સંખ્યા પૂર્ણ અંકમાં લખો.`);
    }
    total += amount;
    lines.push({ line_no: i + 1, vegetable_id: v.id, qty: qtyStr(qty), rate: rupees(rate), amount: rupees(amount),
      mudda, commission_excl: excl, commission_amount: rupees(commission) });
  }
  return { entry_date: txDate(b.entry_date), trader_id: t.id, bill_no: text(b.bill_no, { label: 'બિલ નંબર', max: 40 }),
    note: text(b.note, { label: 'નોંધ', max: 300 }), total_amount: rupees(total), lines };
}

async function insertLines(c, purchaseId, lines) {
  for (const l of lines) {
    await c.query(`INSERT INTO purchase_lines(purchase_id, line_no, vegetable_id, qty, rate, amount, mudda, commission_excl, commission_amount)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [purchaseId, l.line_no, l.vegetable_id, l.qty, l.rate, l.amount, l.mudda, l.commission_excl, l.commission_amount]);
  }
}

async function createPurchase(user, body) {
  assertCanCreate(user, {});
  const cid = clientId(body.client_id);
  const out = await idempotent('purchases', 'purchases', cid, async (c) => {
    const ex = await existingByClientId(c, 'purchases', cid);
    if (ex) return { existing: ex };
    const p = await parsePurchase(c, body, user);
    // Optional: amount paid now, and a transport/hamali expense (recorded as a separate expense, per owner's decision).
    let paid = null;
    if (body.paid_amount !== undefined && body.paid_amount !== null && body.paid_amount !== '' && rupeeAmt(body.paid_amount, 'ચૂકવેલ રકમ') > 0n) {
      const amt = rupeeAmt(body.paid_amount, 'ચૂકવેલ રકમ');
      if (amt > paise(p.total_amount, 'કુલ')) throw bad('ચૂકવેલ રકમ બિલની કુલ રકમથી વધુ છે. વધારાની રકમ અલગ ચુકવણી/એડવાન્સ તરીકે નોંધો.');
      paid = { amount: rupees(amt), method: oneOf(body.paid_method || 'રોકડ', PAYMENT_METHODS, 'ચુકવણી માધ્યમ'),
        reference: text(body.paid_reference, { label: 'રેફરન્સ', max: 80 }) };
    }
    let transport = null;
    if (body.transport_amount !== undefined && body.transport_amount !== null && body.transport_amount !== '' && rupeeAmt(body.transport_amount, 'ટ્રાન્સપોર્ટ ખર્ચ') > 0n) {
      transport = { amount: rupees(rupeeAmt(body.transport_amount, 'ટ્રાન્સપોર્ટ ખર્ચ')),
        category: text(body.transport_category || 'ટ્રાન્સપોર્ટ', { label: 'ખર્ચ પ્રકાર', max: 40, required: true }) };
    }
    const { rows: [r] } = await c.query(
      `INSERT INTO purchases(entry_date, trader_id, bill_no, note, total_amount, client_id, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`, [p.entry_date, p.trader_id, p.bill_no, p.note, p.total_amount, cid, user.id]);
    await insertLines(c, r.id, p.lines);
    if (paid) {
      const { rows: [pay] } = await c.query(
        `INSERT INTO payments(entry_date, trader_id, amount, method, reference, note, purchase_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,'ખરીદી સમયે ચુકવણી',$6,$7,$7) RETURNING id`,
        [p.entry_date, p.trader_id, paid.amount, paid.method, paid.reference, r.id, user.id]);
      await audit(c, user.id, 'create', 'payments', pay.id, null, { ...paid, purchase_id: r.id }, null);
    }
    if (transport) {
      const { rows: [ex2] } = await c.query(
        `INSERT INTO expenses(entry_date, category, amount, note, purchase_id, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`, [p.entry_date, transport.category, transport.amount, `ખરીદી બિલ #${r.id}`, r.id, user.id]);
      await audit(c, user.id, 'create', 'expenses', ex2.id, null, { ...transport, purchase_id: r.id }, null);
    }
    await audit(c, user.id, 'create', 'purchases', r.id, null, p, null);
    return { id: r.id };
  });
  if (out.duplicate) return out;
  if (out.existing) return { ...(await getRecord('purchases', out.existing)), duplicate: true };
  return getRecord('purchases', out.id);
}

async function updatePurchase(user, recId, body, reason) {
  await tx(async (c) => {
    const { rows: [before] } = await c.query('SELECT * FROM purchases WHERE id = $1 FOR UPDATE', [recId]);
    if (!before) throw notFound();
    if (before.voided_at) throw conflict('રદ કરેલ એન્ટ્રીમાં ફેરફાર ન થઈ શકે.');
    const { rows: oldLines } = await c.query('SELECT line_no, vegetable_id, qty, rate, amount, mudda, commission_excl, commission_amount FROM purchase_lines WHERE purchase_id = $1 ORDER BY line_no', [recId]);
    const p = await parsePurchase(c, body, user);
    const { rows: [{ paid }] } = await c.query('SELECT coalesce(sum(amount),0) AS paid FROM payments WHERE purchase_id = $1 AND voided_at IS NULL', [recId]);
    if (paise(paid, 'ચૂકવેલ') > paise(p.total_amount, 'કુલ')) throw bad(`આ બિલ સામે ₹${paid} ચૂકવાયા છે; કુલ રકમ તેનાથી ઓછી ન થઈ શકે.`);
    const { rows: [{ n }] } = await c.query('SELECT count(*)::int AS n FROM payments WHERE purchase_id = $1 AND voided_at IS NULL AND trader_id <> $2', [recId, p.trader_id]);
    if (n > 0) throw bad('આ બિલ સામે જૂના વેપારીને ચુકવણી થઈ છે; વેપારી બદલતા પહેલાં તે ચુકવણી સુધારો.');
    await lockVegetables(c, [...oldLines.map((l) => l.vegetable_id), ...p.lines.map((l) => l.vegetable_id)]);
    await c.query(`UPDATE purchases SET entry_date=$2, trader_id=$3, bill_no=$4, note=$5, total_amount=$6, updated_at=now(), updated_by=$7 WHERE id=$1`,
      [recId, p.entry_date, p.trader_id, p.bill_no, p.note, p.total_amount, user.id]);
    await c.query('DELETE FROM purchase_lines WHERE purchase_id = $1', [recId]);
    await insertLines(c, recId, p.lines);
    // Linked payment/expense rows keep their own date; they are edited separately.
    const from = before.entry_date < p.entry_date ? before.entry_date : p.entry_date;
    await assertStock(c, [...oldLines.map((l) => l.vegetable_id), ...p.lines.map((l) => l.vegetable_id)], from);
    await audit(c, user.id, 'update', 'purchases', recId,
      { ...pick(before, ['entry_date', 'trader_id', 'bill_no', 'note', 'total_amount']), lines: oldLines }, p, reason);
  });
  return getRecord('purchases', recId);
}

// ---------- reading ----------
const USER_COLS = `cu.name AS created_by_name, uu.name AS updated_by_name, vu.name AS voided_by_name`;
const USER_JOINS = (a) => `LEFT JOIN users cu ON cu.id = ${a}.created_by LEFT JOIN users uu ON uu.id = ${a}.updated_by LEFT JOIN users vu ON vu.id = ${a}.voided_by`;

function listSql(type) {
  switch (type) {
    case 'purchases':
      return `SELECT x.*, t.name AS trader_name, ${USER_COLS},
          (SELECT json_agg(json_build_object('line_no', l.line_no, 'vegetable_id', l.vegetable_id, 'vegetable', v.name, 'unit', v.unit,
                   'qty', l.qty, 'rate', l.rate, 'amount', l.amount, 'mudda', l.mudda, 'commission_excl', l.commission_excl,
                   'commission_amount', l.commission_amount, 'base_amount', l.amount - l.commission_amount) ORDER BY l.line_no)
             FROM purchase_lines l JOIN vegetables v ON v.id = l.vegetable_id WHERE l.purchase_id = x.id) AS lines,
          (SELECT sum(mudda)::int FROM purchase_lines WHERE purchase_id = x.id) AS total_mudda,
          (SELECT coalesce(sum(commission_amount),0) FROM purchase_lines WHERE purchase_id = x.id) AS total_commission,
          (SELECT coalesce(sum(amount),0) FROM payments WHERE purchase_id = x.id AND voided_at IS NULL) AS paid_amount
        FROM purchases x JOIN traders t ON t.id = x.trader_id ${USER_JOINS('x')}`;
    case 'sales': case 'waste': case 'adjustments': case 'plans': case 'market':
      return `SELECT x.*, v.name AS vegetable, v.unit AS veg_unit, ${USER_COLS}
        FROM ${SPECS[type].table} x JOIN vegetables v ON v.id = x.vegetable_id ${USER_JOINS('x')}`;
    case 'returns':
      return `SELECT x.*, v.name AS vegetable, v.unit AS veg_unit, t.name AS trader_name, ${USER_COLS}
        FROM purchase_returns x JOIN vegetables v ON v.id = x.vegetable_id JOIN traders t ON t.id = x.trader_id ${USER_JOINS('x')}`;
    case 'payments': case 'trader_adjustments':
      return `SELECT x.*, t.name AS trader_name, ${USER_COLS}
        FROM ${SPECS[type].table} x JOIN traders t ON t.id = x.trader_id ${USER_JOINS('x')}`;
    case 'expenses':
      return `SELECT x.*, ${USER_COLS} FROM expenses x ${USER_JOINS('x')}`;
    default: throw notFound('અજાણ્યો રેકોર્ડ પ્રકાર.');
  }
}

function decorate(type, r) {
  if (!r) return r;
  delete r.client_id;
  if (type === 'purchases') {
    const total = paise(r.total_amount, 'કુલ'), paid = paise(r.paid_amount, 'ચૂકવેલ');
    r.due_amount = rupees(total - paid);
    r.status = paid >= total ? 'ચૂકવેલ' : paid > 0n ? 'આંશિક' : 'બાકી';
    r.lines = r.lines || [];
  }
  if (type === 'waste') r.est_value = rupees(lineAmount(milli(r.qty, 'q'), paise(r.est_rate, 'r')));
  r.type = type;
  return r;
}

export async function getRecord(type, recId) {
  const dateCol = type === 'purchases' ? 'entry_date' : spec(type).dateCol; void dateCol;
  const { rows: [r] } = await q(`${listSql(type)} WHERE x.id = $1`, [vId(recId)]);
  if (!r) throw notFound();
  return decorate(type, r);
}

export async function listRecords(type, query) {
  const dateCol = type === 'purchases' ? 'entry_date' : spec(type).dateCol;
  const where = [];
  const params = [];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (query.date) add(`x.${dateCol} = ?`, anyDate(query.date));
  if (query.from) add(`x.${dateCol} >= ?`, anyDate(query.from));
  if (query.to) add(`x.${dateCol} <= ?`, anyDate(query.to));
  if (query.trader_id && ['purchases', 'returns', 'payments', 'trader_adjustments'].includes(type)) add('x.trader_id = ?', vId(query.trader_id));
  if (query.vegetable_id && !['purchases', 'payments', 'trader_adjustments', 'expenses'].includes(type)) add('x.vegetable_id = ?', vId(query.vegetable_id));
  if (query.vegetable_id && type === 'purchases') add('EXISTS (SELECT 1 FROM purchase_lines l WHERE l.purchase_id = x.id AND l.vegetable_id = ?)', vId(query.vegetable_id));
  if (query.unpaid && type === 'purchases') where.push('x.total_amount > (SELECT coalesce(sum(amount),0) FROM payments WHERE purchase_id = x.id AND voided_at IS NULL)');
  if (!(query.includeVoided === '1' || query.includeVoided === 'true')) where.push('x.voided_at IS NULL');
  const limit = Math.min(Number(query.limit) || 300, 1000);
  const sql = `${listSql(type)} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY x.${dateCol} DESC, x.id DESC LIMIT ${limit}`;
  const { rows } = await q(sql, params);
  return rows.map((r) => decorate(type, r));
}

export async function recordAudit(type, recId) {
  const table = type === 'purchases' ? 'purchases' : spec(type).table;
  const { rows } = await q(
    `SELECT a.at, a.action, a.before, a.after, a.reason, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.entity = $1 AND a.entity_id = $2 ORDER BY a.at, a.id`, [table, String(vId(recId))]);
  return rows;
}

// ---------- stock counts & day closing ----------
export async function saveStockCounts(user, body) {
  if (!(user.role === 'owner' || user.role === 'entry')) throw forbidden();
  const d = txDate(body.count_date);
  if (!Array.isArray(body.items) || !body.items.length) throw bad('ઓછામાં ઓછું એક શાક ગણો.');
  return tx(async (c) => {
    const saved = [];
    for (const it of body.items) {
      const vid = vId(it.vegetable_id, 'શાક');
      const phys = milli(it.physical_qty, 'વાસ્તવિક જથ્થો');
      const { rows: [{ calc }] } = await c.query('SELECT coalesce(sum(qty),0) AS calc FROM stock_moves WHERE vegetable_id = $1 AND d <= $2', [vid, d]);
      const { rows: [before] } = await c.query('SELECT physical_qty, calculated_qty, note FROM stock_counts WHERE count_date=$1 AND vegetable_id=$2', [d, vid]);
      const note = text(it.note, { label: 'નોંધ', max: 200 });
      await c.query(
        `INSERT INTO stock_counts(count_date, vegetable_id, calculated_qty, physical_qty, note, created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$6)
         ON CONFLICT (count_date, vegetable_id) DO UPDATE SET calculated_qty=EXCLUDED.calculated_qty, physical_qty=EXCLUDED.physical_qty,
           note=EXCLUDED.note, updated_at=now(), updated_by=EXCLUDED.updated_by`, [d, vid, calc, qtyStr(phys), note, user.id]);
      const after = { count_date: d, vegetable_id: vid, calculated_qty: calc, physical_qty: qtyStr(phys), note };
      await audit(c, user.id, before ? 'update' : 'create', 'stock_counts', `${d}:${vid}`, before || null, after, null);
      saved.push(after);
    }
    return saved;
  });
}

export async function saveClosing(user, date, body) {
  if (!(user.role === 'owner' || user.role === 'entry')) throw forbidden();
  const d = txDate(date);
  const value = rupees(rupeeAmt(body.closing_stock_value, 'વધેલા માલનું મૂલ્ય'));
  const note = text(body.note, { label: 'નોંધ', max: 200 });
  return tx(async (c) => {
    const { rows: [before] } = await c.query('SELECT closing_stock_value, note FROM day_closings WHERE close_date = $1 FOR UPDATE', [d]);
    const reason = text(body.reason, { label: 'ફેરફારનું કારણ', max: 200 });
    if (before && before.closing_stock_value !== value && !reason) throw bad('પહેલેથી સાચવેલ મૂલ્ય બદલવાનું કારણ લખો.');
    await c.query(
      `INSERT INTO day_closings(close_date, closing_stock_value, note, created_by, updated_by) VALUES ($1,$2,$3,$4,$4)
       ON CONFLICT (close_date) DO UPDATE SET closing_stock_value=EXCLUDED.closing_stock_value, note=EXCLUDED.note, updated_at=now(), updated_by=EXCLUDED.updated_by`,
      [d, value, note, user.id]);
    await audit(c, user.id, before ? 'update' : 'create', 'day_closings', d, before || null, { closing_stock_value: value, note }, reason);
    return { close_date: d, closing_stock_value: value, note };
  });
}

/** One total "amount received from customers" per day (v6 simple accounting). */
export async function saveDaySale(user, date, body) {
  if (!(user.role === 'owner' || user.role === 'entry')) throw forbidden();
  const d = txDate(date);
  const value = rupees(rupeeAmt(body.amount, 'વેચાણની રકમ'));
  const note = text(body.note, { label: 'નોંધ', max: 200 });
  return tx(async (c) => {
    const { rows: [before] } = await c.query('SELECT amount, note FROM day_sales WHERE sale_date = $1 FOR UPDATE', [d]);
    const reason = text(body.reason, { label: 'ફેરફારનું કારણ', max: 200 });
    if (before && before.amount !== value && !reason) throw bad('પહેલેથી સાચવેલ વેચાણ બદલવાનું કારણ લખો.');
    await c.query(
      `INSERT INTO day_sales(sale_date, amount, note, created_by, updated_by) VALUES ($1,$2,$3,$4,$4)
       ON CONFLICT (sale_date) DO UPDATE SET amount=EXCLUDED.amount, note=EXCLUDED.note, updated_at=now(), updated_by=EXCLUDED.updated_by`,
      [d, value, note, user.id]);
    await audit(c, user.id, before ? 'update' : 'create', 'day_sales', d, before || null, { amount: value, note }, reason);
    return { sale_date: d, amount: value, note };
  });
}

export { todayIST, isDate };

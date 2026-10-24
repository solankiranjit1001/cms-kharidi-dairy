// Import of the old browser-only data (V1/V2 "records" array, V4 "db" object).
// Safe by design: dry-run preview first; every imported row carries a unique import_key so the same
// backup can be imported twice without duplicates; nothing existing is ever overwritten.
import crypto from 'node:crypto';
import { q, tx } from './db.js';
import { bad, forbidden } from './errors.js';
import { isDate, nameKey, PAYMENT_METHODS, SALE_MODES, todayIST } from './validate.js';
import { rupees, qtyStr, lineAmount } from './money.js';
import { audit } from './audit.js';

const OTHER_TRADER = 'અન્ય (નામ વગર)';
const MAX_ITEMS = 50_000;

function hashOf(v) { return crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex'); }

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[૦-૯]/g, (c) => '૦૧૨૩૪૫૬૭૮૯'.indexOf(c)).replace(/,/g, ''));
  return Number.isFinite(n) ? n : NaN;
}
const toMilli = (n) => BigInt(Math.round(n * 1000));
const toPaise = (n) => BigInt(Math.round(n * 100));
const str = (v, max = 200) => (v === null || v === undefined ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max) || null);

export function detectSource(data) {
  if (Array.isArray(data)) return 'v1';
  if (data && typeof data === 'object' && Array.isArray(data.purchases) && Array.isArray(data.sales)) return 'v4';
  if (data && typeof data === 'object' && Array.isArray(data.records)) return 'v1';
  return null;
}

/** Turn old data into a flat list of normalized items. Pure function (unit-testable). */
export function normalize(data, source) {
  const items = [];
  const errors = [];
  const push = (item) => items.push(item);
  const keyFor = (type, r) => `${source}:${type}:${r && r.id != null ? String(r.id) : hashOf(r).slice(0, 24)}`;

  if (source === 'v4') {
    for (const t of data.traders || []) push({ type: 'trader', key: keyFor('trader', t), name: str(t.name, 80), phone: str(t.phone, 16), opening: num(t.opening) || 0 });
    for (const r of data.purchases || []) push({ type: 'purchase', key: keyFor('purchase', r), date: r.date, trader: str(r.trader, 80), veg: str(r.veg, 60), qty: num(r.qty), rate: num(r.rate), note: str(r.note, 300) });
    for (const r of data.sales || []) push({ type: 'sale', key: keyFor('sale', r), date: r.date, veg: str(r.veg, 60), qty: num(r.qty), rate: num(r.rate), note: str(r.note, 300) });
    for (const r of data.waste || []) push({ type: 'waste', key: keyFor('waste', r), date: r.date, veg: str(r.veg, 60), qty: num(r.qty), est_rate: num(r.rate) || 0, reason: str(r.reason) || 'બગડેલ' });
    for (const r of data.payments || []) push({ type: 'payment', key: keyFor('payment', r), date: r.date, trader: str(r.trader, 80), amount: num(r.amount), method: r.method, reference: str(r.reference, 80), note: str(r.note, 300) });
    for (const r of data.expenses || []) push({ type: 'expense', key: keyFor('expense', r), date: r.date, category: str(r.category, 40) || 'અન્ય', amount: num(r.amount), note: str(r.note, 300) });
    for (const r of data.surveys || []) push({ type: 'market', key: keyFor('market', r), date: r.date, market: str(r.market, 40) || 'અજાણ્યું', veg: str(r.veg, 60), price: num(r.rate), grade: str(r.grade, 60), source: str(r.note) });
    for (const r of data.plans || []) push({ type: 'plan', key: keyFor('plan', r), date: r.date, veg: str(r.veg, 60), qty: num(r.qty), rate: num(r.rate), note: str(r.note, 300) });
    for (const r of data.adjustments || []) push({ type: 'adjustment', key: keyFor('adjustment', r), date: r.date, veg: str(r.veg, 60), qty: num(r.qty), reason: str(r.reason) || 'જૂના ડેટામાંથી સુધારો' });
    for (const r of data.recons || []) push({ type: 'count', key: `${source}:count:${r.date}:${r.veg}`, date: r.date, veg: str(r.veg, 60), physical: num(r.actual), calculated: num(r.calculated) });
  } else if (source === 'v1') {
    const list = Array.isArray(data) ? data : data.records;
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const t = String(r.type || '');
      const note = str([r.notes, r.note, r.source].filter(Boolean).join(' • '), 300);
      if (t === 'ખરીદી' || t === 'purchase') {
        push({ type: 'purchase', key: keyFor('purchase', r), date: r.date, trader: str(r.party, 80), veg: str(r.veg, 60), qty: num(r.qty), rate: num(r.rate), note });
        if (num(r.extra) > 0) push({ type: 'expense', key: keyFor('purchase-extra', r), date: r.date, category: 'ટ્રાન્સપોર્ટ', amount: num(r.extra), note: `જૂની ખરીદીનો વધારાનો ખર્ચ${r.veg ? ' • ' + r.veg : ''}` });
      } else if (t === 'વેચાણ' || t === 'sale') {
        push({ type: 'sale', key: keyFor('sale', r), date: r.date, veg: str(r.veg, 60), qty: num(r.qty), rate: num(r.rate), note: str([r.party, note].filter(Boolean).join(' • '), 300) });
        if (num(r.extra) > 0) push({ type: 'expense', key: keyFor('sale-extra', r), date: r.date, category: 'અન્ય', amount: num(r.extra), note: `જૂના વેચાણનો વધારાનો ખર્ચ${r.veg ? ' • ' + r.veg : ''}` });
      } else if (t === 'સ્ટોક/ખર્ચ') {
        if (num(r.waste) > 0) push({ type: 'waste', key: keyFor('waste', r), date: r.date, veg: str(r.veg, 60), qty: num(r.waste), est_rate: 0, reason: note || 'બગડેલ' });
        if (num(r.expense) > 0) push({ type: 'expense', key: keyFor('expense', r), date: r.date, category: 'અન્ય', amount: num(r.expense), note: str(`જૂની નોંધ${r.veg ? ' • ' + r.veg : ''}${note ? ' • ' + note : ''}`, 300) });
        if (r.closing !== undefined && r.closing !== null && r.closing !== '' && r.veg) push({ type: 'count', key: `v1:count:${r.date}:${r.veg}`, date: r.date, veg: str(r.veg, 60), physical: num(r.closing), calculated: null });
      } else if (t === 'બજાર માહિતી' || t === 'બજાર સરખામણી' || t === 'survey' || t === 'market') {
        push({ type: 'market', key: keyFor('market', r), date: r.date, market: str(r.market || r.place, 40) || 'ભાવનગર', veg: str(r.veg, 60), price: num(r.rate), grade: str(r.grade || r.quality, 60), source: note });
      } else if (t === 'plan' || t === 'આયોજન') {
        push({ type: 'plan', key: keyFor('plan', r), date: r.date, veg: str(r.veg, 60), qty: num(r.qty), rate: num(r.rate), note });
      } else {
        errors.push({ key: keyFor('unknown', r), reason: `અજાણ્યો પ્રકાર "${t}" — છોડી દીધું` });
      }
    }
  } else {
    throw bad('ફાઇલનો પ્રકાર ઓળખાયો નહીં. જૂની એપનો JSON બેકઅપ પસંદ કરો.');
  }
  // validation
  const valid = [];
  for (const it of items) {
    const err = check(it);
    if (err) errors.push({ key: it.key, type: it.type, date: it.date, reason: err }); else valid.push(it);
  }
  return { items: valid, errors };
}

function check(it) {
  if (it.type === 'trader') return it.name ? null : 'વેપારીનું નામ ખાલી';
  if (!isDate(it.date) || it.date < '2000-01-01') return 'તારીખ માન્ય નથી';
  if (it.type !== 'plan' && it.date > todayIST()) return 'ભવિષ્યની તારીખ';
  if (['purchase', 'sale', 'waste', 'market', 'plan', 'adjustment', 'count'].includes(it.type) && !it.veg) return 'શાકનું નામ ખાલી';
  const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const nonneg = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  switch (it.type) {
    case 'purchase': case 'sale': return !pos(it.qty) ? 'જથ્થો માન્ય નથી' : !nonneg(it.rate) ? 'દર માન્ય નથી' : null;
    case 'waste': return !pos(it.qty) ? 'જથ્થો માન્ય નથી' : null;
    case 'payment': return !it.trader ? 'વેપારી ખાલી' : !pos(it.amount) ? 'રકમ માન્ય નથી' : null;
    case 'expense': return !pos(it.amount) ? 'રકમ માન્ય નથી' : null;
    case 'market': return !nonneg(it.price) ? 'ભાવ માન્ય નથી' : null;
    case 'adjustment': return typeof it.qty !== 'number' || !Number.isFinite(it.qty) || it.qty === 0 ? 'જથ્થો માન્ય નથી' : null;
    case 'count': return !nonneg(it.physical) ? 'વાસ્તવિક જથ્થો માન્ય નથી' : null;
    case 'plan': return null;
    default: return 'અજાણ્યો પ્રકાર';
  }
}

const TABLE_OF = { purchase: 'purchases', sale: 'sales', waste: 'waste', payment: 'payments', expense: 'expenses', market: 'market_prices',
  plan: 'plans', adjustment: 'stock_adjustments', count: 'stock_counts' };

export async function runImport(user, body) {
  if (user.role !== 'owner') throw forbidden('જૂનો ડેટા ઇમ્પોર્ટ માત્ર માલિક કરી શકે.');
  const data = body.data;
  const source = body.source || detectSource(data);
  if (!source) throw bad('ફાઇલનો પ્રકાર ઓળખાયો નહીં. જૂની એપનો JSON બેકઅપ પસંદ કરો.');
  const { items, errors } = normalize(data, source);
  if (items.length > MAX_ITEMS) throw bad('ફાઇલ બહુ મોટી છે.');
  const fileHash = hashOf(data);

  // Already imported?
  const keysByTable = {};
  for (const it of items) if (TABLE_OF[it.type]) (keysByTable[TABLE_OF[it.type]] ||= []).push(it.key);
  const existing = new Set();
  for (const [table, keys] of Object.entries(keysByTable)) {
    const { rows } = await q(`SELECT import_key FROM ${table} WHERE import_key = ANY($1::text[])`, [keys]);
    rows.forEach((r) => existing.add(r.import_key));
  }
  const fresh = items.filter((it) => it.type === 'trader' || !existing.has(it.key));

  // Possible duplicates of entries typed directly into the new app (same date, vegetable, qty, rate).
  const possibleDup = [];
  for (const it of fresh.filter((x) => x.type === 'purchase' || x.type === 'sale').slice(0, 5000)) {
    const sql = it.type === 'purchase'
      ? `SELECT 1 FROM purchase_lines l JOIN purchases p ON p.id=l.purchase_id JOIN vegetables v ON v.id=l.vegetable_id
          WHERE p.voided_at IS NULL AND p.import_key IS NULL AND p.entry_date=$1 AND v.name_key=$2 AND l.qty=$3 AND l.rate=$4 LIMIT 1`
      : `SELECT 1 FROM sales s JOIN vegetables v ON v.id=s.vegetable_id
          WHERE s.voided_at IS NULL AND s.import_key IS NULL AND s.entry_date=$1 AND v.name_key=$2 AND s.qty=$3 AND s.rate=$4 LIMIT 1`;
    const { rows } = await q(sql, [it.date, nameKey(it.veg), qtyStr(toMilli(it.qty)), rupees(toPaise(it.rate))]);
    if (rows.length) possibleDup.push({ type: it.type, date: it.date, veg: it.veg, qty: it.qty, rate: it.rate });
  }

  const count = (list) => list.reduce((a, it) => ((a[it.type] = (a[it.type] || 0) + 1), a), {});
  const summary = {
    source, file_hash: fileHash, total: count(items), new: count(fresh.filter((i) => i.type !== 'trader')),
    already_imported: count(items.filter((it) => it.type !== 'trader' && existing.has(it.key))),
    errors: errors.slice(0, 200), error_count: errors.length,
    possible_duplicates: possibleDup.slice(0, 100), possible_duplicate_count: possibleDup.length,
    date_range: items.filter((i) => i.date).reduce((a, i) => ({ from: !a.from || i.date < a.from ? i.date : a.from, to: !a.to || i.date > a.to ? i.date : a.to }), {}),
  };
  if (body.dryRun !== false) return { dryRun: true, ...summary };

  const result = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(727003)');
    const vegCache = new Map(), traderCache = new Map();
    const warnings = [];
    const veg = async (name) => {
      const k = nameKey(name);
      if (vegCache.has(k)) return vegCache.get(k);
      const { rows: [v] } = await c.query(
        `INSERT INTO vegetables(name, name_key, unit, created_by) VALUES ($1,$2,'kg',$3)
         ON CONFLICT (name_key) DO UPDATE SET name_key=EXCLUDED.name_key RETURNING id`, [name, k, user.id]);
      vegCache.set(k, v.id); return v.id;
    };
    const trader = async (name, opening = null, phone = null) => {
      const nm = !name || name === 'અન્ય' ? OTHER_TRADER : name;
      const k = nameKey(nm);
      if (traderCache.has(k) && opening === null) return traderCache.get(k);
      const { rows: [ex] } = await c.query('SELECT id, opening_balance FROM traders WHERE name_key=$1', [k]);
      if (ex) {
        if (opening !== null && toPaise(opening) !== 0n && ex.opening_balance !== rupees(toPaise(opening))) {
          warnings.push(`${nm}: શરૂઆતની બાકી પહેલેથી ₹${ex.opening_balance} છે; જૂના ડેટાની ₹${opening} બદલી નથી.`);
        }
        traderCache.set(k, ex.id); return ex.id;
      }
      const { rows: [t] } = await c.query(
        `INSERT INTO traders(name, name_key, phone, opening_balance, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$5) RETURNING id`,
        [nm, k, phone && /^[0-9+ -]{6,16}$/.test(phone) ? phone : null, rupees(toPaise(opening || 0)), user.id]);
      traderCache.set(k, t.id); return t.id;
    };
    const inserted = {};
    const bump = (t) => { inserted[t] = (inserted[t] || 0) + 1; };
    // traders first (opening balances), then everything in date order
    for (const it of fresh.filter((i) => i.type === 'trader')) { await trader(it.name, it.opening, it.phone); }
    const rows = fresh.filter((i) => i.type !== 'trader').sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const it of rows) {
      const ins = async (sql, params) => {
        const r = await c.query(sql + ' ON CONFLICT (import_key) DO NOTHING RETURNING id', params);
        if (r.rows.length) bump(it.type);
        return r.rows[0];
      };
      switch (it.type) {
        case 'purchase': {
          const qm = toMilli(it.qty), rp = toPaise(it.rate), amt = rupees(lineAmount(qm, rp));
          const p = await ins(`INSERT INTO purchases(entry_date, trader_id, note, total_amount, import_key, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
            [it.date, await trader(it.trader), it.note, amt, it.key, user.id]);
          if (p) await c.query('INSERT INTO purchase_lines(purchase_id, line_no, vegetable_id, qty, rate, amount) VALUES ($1,1,$2,$3,$4,$5)', [p.id, await veg(it.veg), qtyStr(qm), rupees(rp), amt]);
          break;
        }
        case 'sale': {
          const qm = toMilli(it.qty), rp = toPaise(it.rate), amt = rupees(lineAmount(qm, rp));
          await ins(`INSERT INTO sales(entry_date, vegetable_id, qty, rate, gross, discount, amount, payment_mode, note, import_key, created_by, updated_by)
                     VALUES ($1,$2,$3,$4,$5,0,$5,$6,$7,$8,$9,$9)`, [it.date, await veg(it.veg), qtyStr(qm), rupees(rp), amt, SALE_MODES[0], it.note, it.key, user.id]);
          break;
        }
        case 'waste':
          await ins(`INSERT INTO waste(entry_date, vegetable_id, qty, est_rate, reason, import_key, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
            [it.date, await veg(it.veg), qtyStr(toMilli(it.qty)), rupees(toPaise(it.est_rate || 0)), it.reason, it.key, user.id]);
          break;
        case 'payment':
          await ins(`INSERT INTO payments(entry_date, trader_id, amount, method, reference, note, import_key, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)`,
            [it.date, await trader(it.trader), rupees(toPaise(it.amount)), PAYMENT_METHODS.includes(it.method) ? it.method : 'અન્ય', it.reference, it.note, it.key, user.id]);
          break;
        case 'expense':
          await ins(`INSERT INTO expenses(entry_date, category, amount, note, import_key, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
            [it.date, it.category, rupees(toPaise(it.amount)), it.note, it.key, user.id]);
          break;
        case 'market':
          await ins(`INSERT INTO market_prices(obs_date, market, vegetable_id, unit, price, grade, source, import_key, created_by, updated_by) VALUES ($1,$2,$3,'kg',$4,$5,$6,$7,$8,$8)`,
            [it.date, it.market, await veg(it.veg), rupees(toPaise(it.price)), it.grade, it.source, it.key, user.id]);
          break;
        case 'plan':
          await ins(`INSERT INTO plans(plan_date, vegetable_id, qty, rate, note, import_key, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
            [it.date, await veg(it.veg), it.qty > 0 ? qtyStr(toMilli(it.qty)) : null, it.rate >= 0 && it.rate !== null ? rupees(toPaise(it.rate)) : null, it.note, it.key, user.id]);
          break;
        case 'adjustment':
          await ins(`INSERT INTO stock_adjustments(entry_date, vegetable_id, qty, reason, import_key, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
            [it.date, await veg(it.veg), qtyStr(toMilli(it.qty)), it.reason, it.key, user.id]);
          break;
        case 'count': {
          const r = await c.query(
            `INSERT INTO stock_counts(count_date, vegetable_id, calculated_qty, physical_qty, note, import_key, created_by, updated_by)
             VALUES ($1,$2,$3,$4,'જૂના ડેટામાંથી',$5,$6,$6) ON CONFLICT DO NOTHING RETURNING id`,
            [it.date, await veg(it.veg), it.calculated === null || Number.isNaN(it.calculated) ? null : qtyStr(toMilli(it.calculated)), qtyStr(toMilli(it.physical)), it.key, user.id]);
          if (r.rows.length) bump('count'); else warnings.push(`${it.date} ${it.veg}: સ્ટોક ગણતરી પહેલેથી છે, બદલી નથી.`);
          break;
        }
        default: break;
      }
    }
    const { rows: [batch] } = await c.query('INSERT INTO import_batches(created_by, source, file_hash, summary) VALUES ($1,$2,$3,$4) RETURNING id',
      [user.id, source, fileHash, JSON.stringify({ inserted, warnings, fileName: str(body.fileName, 120) })]);
    await audit(c, user.id, 'import', 'import_batches', batch.id, null, { source, inserted, fileName: str(body.fileName, 120) }, 'જૂનો ડેટા ઇમ્પોર્ટ');
    return { batch_id: batch.id, inserted, warnings };
  });

  const { rows: negative } = await q(
    `WITH m AS (SELECT vegetable_id, d, sum(qty) q FROM stock_moves GROUP BY 1,2),
          r AS (SELECT vegetable_id, d, sum(q) OVER (PARTITION BY vegetable_id ORDER BY d) bal FROM m)
     SELECT DISTINCT ON (r.vegetable_id) v.name, r.d, r.bal FROM r JOIN vegetables v ON v.id=r.vegetable_id WHERE r.bal < 0 ORDER BY r.vegetable_id, r.d`);
  return { dryRun: false, ...summary, ...result, negative_stock: negative };
}

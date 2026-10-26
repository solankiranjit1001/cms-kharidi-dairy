// Daily diary, dashboard, trader ledger, range reports, market analysis, history search.
//
// ACCOUNTING FORMULAS v6 — simple daily cash accounting (documented in docs/ACCOUNTING_GU.md).
// Selling is not tracked item by item and stock is not counted any more (owner's decision, Oct 2026).
//   Net purchases   = purchases − purchase returns
//   Sales           = total typed for the day (day_sales) + any old per-item sales rows on that day
//   Result (+/−)    = sales − net purchases − expenses
//   Paid to traders = payments made that day (does NOT change the result; purchases are already counted)
//   Trader balance  = opening balance + purchases − returns − payments ± approved adjustments
import { q } from './db.js';
import { anyDate, id as vId, text, todayIST } from './validate.js';
import { paise, rupees, sumStr } from './money.js';
import { dayStock } from './stock.js';
import { getPool } from './db.js';
import { bad, notFound } from './errors.js';

const P = (v) => paise(v ?? '0', 'રકમ', { allowNegative: true });

async function dayTotals(date) {
  const { rows: [t] } = await q(
    `SELECT
      (SELECT coalesce(sum(total_amount),0) FROM purchases WHERE entry_date=$1 AND voided_at IS NULL) AS purchases,
      (SELECT count(*)::int FROM purchases WHERE entry_date=$1 AND voided_at IS NULL) AS purchase_count,
      (SELECT coalesce(sum(amount),0) FROM purchase_returns WHERE entry_date=$1 AND voided_at IS NULL) AS returns,
      (SELECT coalesce(sum(amount),0) FROM sales WHERE entry_date=$1 AND voided_at IS NULL) AS sales,
      (SELECT coalesce(sum(discount),0) FROM sales WHERE entry_date=$1 AND voided_at IS NULL) AS discounts,
      (SELECT count(*)::int FROM sales WHERE entry_date=$1 AND voided_at IS NULL) AS sale_count,
      (SELECT row_to_json(z) FROM (SELECT sale_date, amount, note FROM day_sales WHERE sale_date=$1) z) AS day_sale,
      (SELECT coalesce(sum(x.total_amount - coalesce(pp.paid,0)),0)
         FROM purchases x LEFT JOIN purchase_paid pp ON pp.purchase_id=x.id WHERE x.entry_date=$1 AND x.voided_at IS NULL) AS today_bills_due,
      (SELECT coalesce(sum(x.total_amount - coalesce(pp.paid,0)),0)
         FROM purchases x LEFT JOIN purchase_paid pp ON pp.purchase_id=x.id WHERE x.entry_date<=$1 AND x.voided_at IS NULL) AS all_bills_due,
      (SELECT coalesce(json_object_agg(payment_mode, s),'{}') FROM (SELECT payment_mode, sum(amount) s FROM sales WHERE entry_date=$1 AND voided_at IS NULL GROUP BY 1) z) AS sales_by_mode,
      (SELECT coalesce(sum(round(qty*est_rate,2)),0) FROM waste WHERE entry_date=$1 AND voided_at IS NULL) AS waste_value,
      (SELECT count(*)::int FROM waste WHERE entry_date=$1 AND voided_at IS NULL) AS waste_count,
      (SELECT coalesce(sum(amount),0) FROM expenses WHERE entry_date=$1 AND voided_at IS NULL) AS expenses,
      (SELECT coalesce(json_object_agg(category, s),'{}') FROM (SELECT category, sum(amount) s FROM expenses WHERE entry_date=$1 AND voided_at IS NULL GROUP BY 1) z) AS expenses_by_category,
      (SELECT coalesce(sum(amount),0) FROM payments WHERE entry_date=$1 AND voided_at IS NULL) AS payments,
      (SELECT coalesce(json_object_agg(method, s),'{}') FROM (SELECT method, sum(amount) s FROM payments WHERE entry_date=$1 AND voided_at IS NULL GROUP BY 1) z) AS payments_by_method,
      (SELECT count(*)::int FROM market_prices WHERE obs_date=$1 AND voided_at IS NULL) AS market_count,
      (SELECT row_to_json(z) FROM (SELECT close_date, closing_stock_value, note FROM day_closings WHERE close_date=$1) z) AS closing,
      (SELECT row_to_json(z) FROM (SELECT close_date, closing_stock_value FROM day_closings WHERE close_date < $1 ORDER BY close_date DESC LIMIT 1) z) AS prev_closing`,
    [date]);
  return t;
}

export async function traderBalances(asOf = null) {
  const d = asOf ? anyDate(asOf) : '2100-12-31';
  const { rows } = await q(
    `SELECT t.id, t.name, t.phone, t.note, t.active, t.opening_balance,
       coalesce(p.s,0) AS purchases, coalesce(r.s,0) AS returns, coalesce(pay.s,0) AS payments, coalesce(a.s,0) AS adjustments,
       t.opening_balance + coalesce(p.s,0) - coalesce(r.s,0) - coalesce(pay.s,0) + coalesce(a.s,0) AS balance,
       greatest(p.last, pay.last) AS last_activity
     FROM traders t
     LEFT JOIN (SELECT trader_id, sum(total_amount) s, max(entry_date) last FROM purchases WHERE voided_at IS NULL AND entry_date <= $1 GROUP BY 1) p ON p.trader_id=t.id
     LEFT JOIN (SELECT trader_id, sum(amount) s FROM purchase_returns WHERE voided_at IS NULL AND entry_date <= $1 GROUP BY 1) r ON r.trader_id=t.id
     LEFT JOIN (SELECT trader_id, sum(amount) s, max(entry_date) last FROM payments WHERE voided_at IS NULL AND entry_date <= $1 GROUP BY 1) pay ON pay.trader_id=t.id
     LEFT JOIN (SELECT trader_id, sum(amount) s FROM trader_adjustments WHERE voided_at IS NULL AND entry_date <= $1 GROUP BY 1) a ON a.trader_id=t.id
     ORDER BY t.active DESC, t.name`, [d]);
  return rows;
}

export async function traderStatement(traderId, query = {}) {
  traderId = vId(traderId);
  const { rows: [t] } = await q('SELECT id, name, phone, opening_balance, note FROM traders WHERE id=$1', [traderId]);
  if (!t) throw notFound('વેપારી મળ્યો નથી.');
  const from = query.from ? anyDate(query.from) : '2000-01-01';
  const to = query.to ? anyDate(query.to) : '2100-12-31';
  const { rows } = await q(
    `SELECT * FROM (
       SELECT entry_date AS d, 1 AS o, id, 'purchases' AS type, 'ખરીદી' AS kind,
              '#' || id || ' • ' || (SELECT string_agg(v.name || ' ' || trim(trailing '.' from trim(trailing '0' from l.qty::text)) || v.unit, ', ' ORDER BY l.line_no)
                FROM purchase_lines l JOIN vegetables v ON v.id=l.vegetable_id WHERE l.purchase_id=purchases.id) AS detail,
              total_amount AS debit, 0::numeric AS credit FROM purchases WHERE trader_id=$1 AND voided_at IS NULL
       UNION ALL
       SELECT r.entry_date, 2, r.id, 'returns', 'પરત', v.name || ' ' || r.qty || v.unit || coalesce(' • ' || r.note, ''), 0, r.amount
         FROM purchase_returns r JOIN vegetables v ON v.id=r.vegetable_id WHERE r.trader_id=$1 AND r.voided_at IS NULL
       UNION ALL
       SELECT entry_date, 3, id, 'payments', 'ચુકવણી', coalesce('બિલ #' || purchase_id || ' • ', '') || coalesce(note, ''), 0, amount
         FROM payments WHERE trader_id=$1 AND voided_at IS NULL
       UNION ALL
       SELECT entry_date, 4, id, 'trader_adjustments', 'સુધારો', reason, greatest(amount,0), greatest(-amount,0)
         FROM trader_adjustments WHERE trader_id=$1 AND voided_at IS NULL
     ) z WHERE d <= $2 ORDER BY d, o, id`, [traderId, to]);
  let bal = P(t.opening_balance);
  const out = [];
  for (const r of rows) {
    bal += P(r.debit) - P(r.credit);
    if (r.d >= from) out.push({ ...r, balance: rupees(bal) });
  }
  const openingForPeriod = rupees(P(t.opening_balance) + rows.filter((r) => r.d < from).reduce((a, r) => a + P(r.debit) - P(r.credit), 0n));
  return { trader: t, from, to, opening: openingForPeriod, rows: out, closing: rupees(bal) };
}

function diaryCalc(t) {
  const purchases = P(t.purchases), returns = P(t.returns), expenses = P(t.expenses), payments = P(t.payments);
  const daySale = t.day_sale ? P(t.day_sale.amount) : null;
  const oldSales = P(t.sales);
  const sales = (daySale ?? 0n) + oldSales;
  const netPurchases = purchases - returns;
  const out = {
    purchases: rupees(purchases), returns: rupees(returns), net_purchases: rupees(netPurchases),
    day_sale: daySale === null ? null : rupees(daySale), day_sale_note: t.day_sale?.note || null, old_sales: rupees(oldSales),
    sales: rupees(sales), expenses: rupees(expenses), payments: rupees(payments),
    today_bills_due: rupees(P(t.today_bills_due)),
    all_bills_due: rupees(P(t.all_bills_due)),
    result: rupees(sales - netPurchases - expenses),
    sales_entered: daySale !== null || oldSales !== 0n,
  };
  return out;
}

export async function dashboard(date) {
  date = anyDate(date || todayIST());
  const [t, balances] = await Promise.all([dayTotals(date), traderBalances(date)]);
  const diary = diaryCalc(t);
  const payable = balances.reduce((a, b) => a + (P(b.balance) > 0n ? P(b.balance) : 0n), 0n);
  const advances = balances.reduce((a, b) => a + (P(b.balance) < 0n ? -P(b.balance) : 0n), 0n);
  const warnings = [];
  if (!diary.sales_entered && (t.purchase_count > 0 || P(t.expenses) > 0n)) warnings.push({ kind: 'day_sale', text: 'આજનું વેચાણ (ગ્રાહકો પાસેથી મળેલ કુલ રકમ) હજુ દાખલ થયું નથી.' });
  return {
    date, totals: t, diary,
    payable: rupees(payable), advances: rupees(advances),
    traders_due: balances.filter((b) => P(b.balance) !== 0n).map((b) => ({ id: b.id, name: b.name, balance: b.balance })),
    warnings,
  };
}

async function dayStockSafe(date) {
  const c = await getPool().connect();
  try { return await dayStock(c, date); } finally { c.release(); }
}

export async function stockReport(date) {
  date = anyDate(date || todayIST());
  const rows = await dayStockSafe(date);
  const { rows: [cl] } = await q('SELECT closing_stock_value, note FROM day_closings WHERE close_date=$1', [date]);
  // Suggested value (only a hint for the person typing the closing value): qty × weighted average purchase rate.
  let hint = 0n;
  for (const r of rows) {
    const qtyStr = r.physical_qty !== null ? r.physical_qty : r.closing;
    if (Number(qtyStr) <= 0) continue;
    const [i, f = ''] = String(qtyStr).split('.');
    const milli = BigInt(i + f.padEnd(3, '0').slice(0, 3));
    const rate = P(r.avg_rate);
    hint += (milli * rate + 500n) / 1000n;
  }
  return { date, rows, closing: cl || null, suggested_value: rupees(hint) };
}

export async function rangeSummary(query) {
  const to = anyDate(query.to);
  let from;
  if (query.from === 'start' || !query.from) {
    // "શરૂઆતથી": from the first day that has any entry
    const { rows: [m] } = await q(`SELECT least(
        (SELECT min(entry_date) FROM purchases WHERE voided_at IS NULL), (SELECT min(sale_date) FROM day_sales),
        (SELECT min(entry_date) FROM expenses WHERE voided_at IS NULL), (SELECT min(entry_date) FROM sales WHERE voided_at IS NULL),
        (SELECT min(entry_date) FROM payments WHERE voided_at IS NULL))::text AS d`);
    from = m.d && m.d < to ? m.d : to;
  } else from = anyDate(query.from);
  if (from > to) throw bad('શરૂઆતની તારીખ અંતિમ તારીખ પછીની છે.');
  if ((new Date(to) - new Date(from)) / 86400000 > 3700) throw bad('વધુમાં વધુ 10 વર્ષનો રિપોર્ટ.');
  const { rows } = await q(
    `WITH days AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS d)
     SELECT d::text AS d,
      (SELECT coalesce(sum(total_amount),0) FROM purchases WHERE entry_date=d AND voided_at IS NULL) AS purchases,
      (SELECT coalesce(sum(amount),0) FROM purchase_returns WHERE entry_date=d AND voided_at IS NULL) AS returns,
      (SELECT coalesce(sum(amount),0) FROM sales WHERE entry_date=d AND voided_at IS NULL)
        + coalesce((SELECT amount FROM day_sales WHERE sale_date=d),0) AS sales,
      (SELECT amount FROM day_sales WHERE sale_date=d) AS day_sale,
      (SELECT coalesce(sum(amount),0) FROM expenses WHERE entry_date=d AND voided_at IS NULL) AS expenses,
      (SELECT coalesce(sum(amount),0) FROM payments WHERE entry_date=d AND voided_at IS NULL) AS payments
     FROM days ORDER BY d`, [from, to]);
  const days = rows.filter((r) => r.day_sale !== null || [r.purchases, r.returns, r.sales, r.expenses, r.payments].some((v) => P(v) !== 0n))
    .map((r) => ({ ...r, result: rupees(P(r.sales) - P(r.purchases) + P(r.returns) - P(r.expenses)) }));
  const tot = (k) => sumStr(rows.map((r) => r[k]));
  const totals = { purchases: tot('purchases'), returns: tot('returns'), sales: tot('sales'), expenses: tot('expenses'), payments: tot('payments') };
  totals.net_purchases = rupees(P(totals.purchases) - P(totals.returns));
  totals.result = rupees(P(totals.sales) - P(totals.net_purchases) - P(totals.expenses));
  const { rows: veg } = await q(
    `SELECT v.name, v.unit, sum(l.qty) AS qty, sum(l.amount) AS amount, round(sum(l.amount)/nullif(sum(l.qty),0),2) AS avg_rate
       FROM purchase_lines l JOIN purchases p ON p.id=l.purchase_id JOIN vegetables v ON v.id=l.vegetable_id
      WHERE p.voided_at IS NULL AND p.entry_date BETWEEN $1 AND $2 GROUP BY v.name, v.unit ORDER BY sum(l.amount) DESC`, [from, to]);
  return { from, to, days, totals, vegetables: veg };
}

// ---------- market survey analysis (only from saved observations; never invents data) ----------
export async function marketAnalysis(query) {
  const vegId = vId(query.vegetable_id, 'શાક');
  const from = query.from ? anyDate(query.from) : '2000-01-01';
  const to = query.to ? anyDate(query.to) : '2100-12-31';
  const base = `FROM market_prices WHERE voided_at IS NULL AND vegetable_id=$1`;
  const [byMarket, monthly, seasonal, recent] = await Promise.all([
    q(`SELECT market, unit, count(*)::int n, round(avg(price),2) avg, min(price) min, max(price) max, max(obs_date) last_date,
         (array_agg(price ORDER BY obs_date DESC, id DESC))[1] last_price
       ${base} AND obs_date BETWEEN $2 AND $3 GROUP BY market, unit ORDER BY avg`, [vegId, from, to]),
    q(`SELECT to_char(obs_date,'YYYY-MM') AS month, market, count(*)::int n, round(avg(price),2) avg
       ${base} AND obs_date BETWEEN $2 AND $3 GROUP BY 1,2 ORDER BY 1,2`, [vegId, from, to]),
    q(`SELECT extract(month FROM obs_date)::int AS month, count(*)::int n, count(DISTINCT extract(year FROM obs_date))::int years,
         round(avg(price),2) avg, min(price) min, max(price) max ${base} GROUP BY 1 ORDER BY 1`, [vegId]),
    q(`SELECT m.obs_date, m.market, m.price, m.unit, m.grade, m.source ${base.replace('FROM market_prices', 'FROM market_prices m')} ORDER BY obs_date DESC, id DESC LIMIT 30`, [vegId]),
  ]);
  return {
    vegetable_id: vegId, from, to,
    byMarket: byMarket.rows.map((r) => ({ ...r, confidence: r.n < 3 ? 'ઓછો ડેટા' : r.n < 10 ? 'મધ્યમ ડેટા' : 'પૂરતો ડેટા' })),
    monthly: monthly.rows,
    seasonal: seasonal.rows.map((r) => ({ ...r, confidence: r.years < 2 || r.n < 5 ? 'ઓછો ડેટા' : 'સરખામણી શક્ય' })),
    recent: recent.rows,
    note: 'આ સરેરાશ ફક્ત તમે સાચવેલા ભાવ પરથી છે; ભવિષ્યની આગાહી નથી.',
  };
}

// ---------- cross-type history search ----------
export async function history(query) {
  const from = query.from ? anyDate(query.from) : '2000-01-01';
  const to = query.to ? anyDate(query.to) : '2100-12-31';
  const term = text(query.q, { label: 'શોધ', max: 60 });
  const like = term ? `%${term.replace(/[\\%_]/g, (c) => '\\' + c)}%` : null;
  const voided = query.includeVoided === '1' || query.includeVoided === 'true';
  const vf = (a) => (voided ? 'true' : `${a}.voided_at IS NULL`);
  const parts = {
    purchases: `SELECT 'purchases' type, x.id, x.entry_date d, t.name || coalesce(' • બિલ ' || x.bill_no,'') || ' • ' || coalesce((SELECT string_agg(v.name, ', ') FROM purchase_lines l JOIN vegetables v ON v.id=l.vegetable_id WHERE l.purchase_id=x.id),'') || coalesce(' • ' || x.note,'') AS detail, x.total_amount amount, NULL::numeric qty, x.voided_at FROM purchases x JOIN traders t ON t.id=x.trader_id WHERE ${vf('x')}`,
    sales: `SELECT 'sales', x.id, x.entry_date, v.name || ' • ' || x.payment_mode || coalesce(' • ' || x.customer,'') || coalesce(' • ' || x.note,''), x.amount, x.qty, x.voided_at FROM sales x JOIN vegetables v ON v.id=x.vegetable_id WHERE ${vf('x')}`,
    waste: `SELECT 'waste', x.id, x.entry_date, v.name || ' • ' || x.reason, round(x.qty*x.est_rate,2), x.qty, x.voided_at FROM waste x JOIN vegetables v ON v.id=x.vegetable_id WHERE ${vf('x')}`,
    returns: `SELECT 'returns', x.id, x.entry_date, t.name || ' • ' || v.name || coalesce(' • ' || x.note,''), x.amount, x.qty, x.voided_at FROM purchase_returns x JOIN vegetables v ON v.id=x.vegetable_id JOIN traders t ON t.id=x.trader_id WHERE ${vf('x')}`,
    adjustments: `SELECT 'adjustments', x.id, x.entry_date, v.name || ' • ' || x.reason, NULL::numeric, x.qty, x.voided_at FROM stock_adjustments x JOIN vegetables v ON v.id=x.vegetable_id WHERE ${vf('x')}`,
    payments: `SELECT 'payments', x.id, x.entry_date, t.name || ' • ' || x.method || coalesce(' • ' || x.reference,'') || coalesce(' • ' || x.note,''), x.amount, NULL::numeric, x.voided_at FROM payments x JOIN traders t ON t.id=x.trader_id WHERE ${vf('x')}`,
    trader_adjustments: `SELECT 'trader_adjustments', x.id, x.entry_date, t.name || ' • ' || x.reason, x.amount, NULL::numeric, x.voided_at FROM trader_adjustments x JOIN traders t ON t.id=x.trader_id WHERE ${vf('x')}`,
    expenses: `SELECT 'expenses', x.id, x.entry_date, x.category || coalesce(' • ' || x.note,''), x.amount, NULL::numeric, x.voided_at FROM expenses x WHERE ${vf('x')}`,
    day_sales: `SELECT 'day_sales', NULL::bigint, x.sale_date, 'દિવસનું કુલ વેચાણ' || coalesce(' • ' || x.note,''), x.amount, NULL::numeric, NULL::timestamptz FROM day_sales x WHERE true`,
    market: `SELECT 'market', x.id, x.obs_date, x.market || ' • ' || v.name || coalesce(' • ' || x.grade,''), x.price, NULL::numeric, x.voided_at FROM market_prices x JOIN vegetables v ON v.id=x.vegetable_id WHERE ${vf('x')}`,
  };
  const types = query.type && parts[query.type] ? [query.type] : Object.keys(parts);
  const sql = `SELECT * FROM (${types.map((t) => parts[t]).join(' UNION ALL ')}) z(type,id,d,detail,amount,qty,voided_at)
     WHERE d BETWEEN $1 AND $2 ${like ? `AND detail ILIKE $3` : ''} ORDER BY d DESC, id DESC LIMIT 400`;
  const { rows } = await q(sql, like ? [from, to, like] : [from, to]);
  return rows;
}

export async function exportAll() {
  const tables = ['vegetables', 'traders', 'purchases', 'purchase_lines', 'sales', 'waste', 'purchase_returns', 'stock_adjustments',
    'stock_counts', 'day_closings', 'day_sales', 'payments', 'trader_adjustments', 'expenses', 'market_prices', 'plans', 'audit_log', 'import_batches'];
  const out = { exported_at: new Date().toISOString(), app: 'cms-kharidi-diary', version: 6 };
  for (const t of tables) out[t] = (await q(`SELECT * FROM ${t} ORDER BY 1`)).rows;
  out.users = (await q('SELECT id, name, mobile, role, active, created_at FROM users ORDER BY id')).rows;
  return out;
}

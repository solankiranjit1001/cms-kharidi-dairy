// Daily diary, dashboard, trader ledger, range reports, market analysis, history search.
//
// ACCOUNTING FORMULAS (documented in docs/ACCOUNTING_GU.md):
//   Net purchases      = purchases − purchase returns
//   Opening stock ₹    = closing stock value typed on the most recent earlier day
//   Closing stock ₹    = value typed for this day (owner's decision: entered manually)
//   Cost of goods sold = opening stock ₹ + net purchases − closing stock ₹      (waste is already inside this)
//   Gross profit       = net sales − cost of goods sold
//   Operating result   = gross profit − operating expenses
//   Cash movement      = sales received − trader payments − expenses           (NOT profit)
//   Trader balance     = opening balance + purchases − returns − payments ± approved adjustments
import { q, getPool } from './db.js';
import { anyDate, addDays, id as vId, text, todayIST } from './validate.js';
import { paise, rupees, sumStr } from './money.js';
import { dayStock } from './stock.js';
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
              coalesce('બિલ ' || bill_no || ' • ', '') || (SELECT string_agg(v.name || ' ' || trim(trailing '.' from trim(trailing '0' from l.qty::text)) || v.unit, ', ' ORDER BY l.line_no)
                FROM purchase_lines l JOIN vegetables v ON v.id=l.vegetable_id WHERE l.purchase_id=purchases.id) AS detail,
              total_amount AS debit, 0::numeric AS credit FROM purchases WHERE trader_id=$1 AND voided_at IS NULL
       UNION ALL
       SELECT r.entry_date, 2, r.id, 'returns', 'પરત', v.name || ' ' || r.qty || v.unit || coalesce(' • ' || r.note, ''), 0, r.amount
         FROM purchase_returns r JOIN vegetables v ON v.id=r.vegetable_id WHERE r.trader_id=$1 AND r.voided_at IS NULL
       UNION ALL
       SELECT entry_date, 3, id, 'payments', 'ચુકવણી', method || coalesce(' • ' || reference, '') || coalesce(' • ' || note, ''), 0, amount
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
  const purchases = P(t.purchases), returns = P(t.returns), sales = P(t.sales), expenses = P(t.expenses);
  const netPurchases = purchases - returns;
  const closing = t.closing ? P(t.closing.closing_stock_value) : null;
  const opening = t.prev_closing ? P(t.prev_closing.closing_stock_value) : null;
  const out = {
    purchases: rupees(purchases), returns: rupees(returns), net_purchases: rupees(netPurchases),
    sales: rupees(sales), discounts: t.discounts, expenses: rupees(expenses), waste_value: t.waste_value,
    payments: t.payments,
    opening_stock_value: opening === null ? null : rupees(opening), opening_from_date: t.prev_closing?.close_date || null,
    closing_stock_value: closing === null ? null : rupees(closing),
    cogs: null, gross_profit: null, operating_result: null, pending: [],
    cash_in: rupees(sales), cash_out: rupees(P(t.payments) + expenses), net_cash: rupees(sales - P(t.payments) - expenses),
  };
  if (closing === null) out.pending.push('આજના વધેલા માલનું ₹ મૂલ્ય દાખલ કરો — તે વગર નફો ગણાતો નથી.');
  const openingVal = opening ?? 0n;
  if (opening === null && closing !== null) out.pending.push('પહેલાનું કોઈ ક્લોઝિંગ મૂલ્ય નથી; શરૂઆતનો સ્ટોક ₹0 ગણ્યો છે.');
  if (closing !== null) {
    const cogs = openingVal + netPurchases - closing;
    out.cogs = rupees(cogs);
    out.gross_profit = rupees(sales - cogs);
    out.operating_result = rupees(sales - cogs - expenses);
  }
  return out;
}

export async function dashboard(date) {
  date = anyDate(date || todayIST());
  const [t, balances, gaps, neg] = await Promise.all([
    dayTotals(date),
    traderBalances(date),
    q(`WITH act AS (
         SELECT entry_date d FROM purchases WHERE voided_at IS NULL UNION SELECT entry_date FROM sales WHERE voided_at IS NULL
         UNION SELECT entry_date FROM waste WHERE voided_at IS NULL UNION SELECT entry_date FROM purchase_returns WHERE voided_at IS NULL)
       SELECT d FROM act WHERE d < $1 AND d >= $1::date - 30 AND d NOT IN (SELECT close_date FROM day_closings) ORDER BY d DESC`, [date]),
    q(`WITH m AS (SELECT vegetable_id, d, sum(qty) q FROM stock_moves GROUP BY 1,2),
            r AS (SELECT vegetable_id, d, sum(q) OVER (PARTITION BY vegetable_id ORDER BY d) bal FROM m)
       SELECT DISTINCT ON (r.vegetable_id) v.name, r.d, r.bal FROM r JOIN vegetables v ON v.id=r.vegetable_id WHERE r.bal < 0 ORDER BY r.vegetable_id, r.d`),
  ]);
  const stockRows = await dayStockSafe(date);
  const diary = diaryCalc(t);
  const payable = balances.reduce((a, b) => a + (P(b.balance) > 0n ? P(b.balance) : 0n), 0n);
  const advances = balances.reduce((a, b) => a + (P(b.balance) < 0n ? -P(b.balance) : 0n), 0n);
  const warnings = [];
  const hasActivity = t.purchase_count + t.sale_count + t.waste_count > 0;
  if (!t.closing && (hasActivity || stockRows.some((s) => Number(s.closing) !== 0))) warnings.push({ kind: 'closing', text: 'આજનું વધેલા માલનું ₹ મૂલ્ય હજુ દાખલ થયું નથી.' });
  if (gaps.rows.length) warnings.push({ kind: 'closing_gaps', text: `છેલ્લા 30 દિવસમાં ${gaps.rows.length} દિવસનું ક્લોઝિંગ મૂલ્ય બાકી છે (${gaps.rows.slice(0, 5).map((r) => r.d).join(', ')}${gaps.rows.length > 5 ? '…' : ''}).`, dates: gaps.rows.map((r) => r.d) });
  if (t.prev_closing && t.prev_closing.close_date !== addDays(date, -1) && gaps.rows.some((g) => g.d > t.prev_closing.close_date)) {
    warnings.push({ kind: 'carry', text: `શરૂઆતનો સ્ટોક ${t.prev_closing.close_date} ના ક્લોઝિંગ પરથી લીધો છે; વચ્ચેના દિવસોનું ક્લોઝિંગ બાકી છે.` });
  }
  const diffs = stockRows.filter((s) => s.diff !== null && Math.abs(Number(s.diff)) > 0.0005);
  if (diffs.length) warnings.push({ kind: 'count_diff', text: `${diffs.length} શાકમાં ગણતરી અને વાસ્તવિક સ્ટોક વચ્ચે તફાવત છે: ${diffs.map((d) => `${d.name} (${Number(d.diff) > 0 ? '+' : ''}${Number(d.diff)} ${d.unit})`).join(', ')}.` });
  const uncounted = stockRows.filter((s) => s.physical_qty === null && Number(s.closing) > 0);
  if (uncounted.length && hasActivity) warnings.push({ kind: 'count_missing', text: `${uncounted.length} શાકનો વાસ્તવિક સ્ટોક હજુ ગણ્યો નથી.` });
  if (neg.rows.length) warnings.push({ kind: 'negative', text: `ઋણ (માઇનસ) સ્ટોક: ${neg.rows.map((r) => `${r.name} (${r.d})`).join(', ')} — સ્ટોક સુધારો કારણ સાથે કરો.` });
  return {
    date, totals: t, diary, stock: stockRows,
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
  const from = anyDate(query.from), to = anyDate(query.to);
  if (from > to) throw bad('શરૂઆતની તારીખ અંતિમ તારીખ પછીની છે.');
  if ((new Date(to) - new Date(from)) / 86400000 > 400) throw bad('વધુમાં વધુ 400 દિવસનો રિપોર્ટ.');
  const { rows } = await q(
    `WITH days AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS d)
     SELECT d::text AS d,
      (SELECT coalesce(sum(total_amount),0) FROM purchases WHERE entry_date=d AND voided_at IS NULL) AS purchases,
      (SELECT coalesce(sum(amount),0) FROM purchase_returns WHERE entry_date=d AND voided_at IS NULL) AS returns,
      (SELECT coalesce(sum(amount),0) FROM sales WHERE entry_date=d AND voided_at IS NULL) AS sales,
      (SELECT coalesce(sum(amount),0) FROM expenses WHERE entry_date=d AND voided_at IS NULL) AS expenses,
      (SELECT coalesce(sum(round(qty*est_rate,2)),0) FROM waste WHERE entry_date=d AND voided_at IS NULL) AS waste_value,
      (SELECT coalesce(sum(amount),0) FROM payments WHERE entry_date=d AND voided_at IS NULL) AS payments,
      (SELECT closing_stock_value FROM day_closings WHERE close_date=d) AS closing,
      (SELECT closing_stock_value FROM day_closings WHERE close_date<d ORDER BY close_date DESC LIMIT 1) AS opening
     FROM days ORDER BY d`, [from, to]);
  const days = rows.filter((r) => r.closing !== null || [r.purchases, r.returns, r.sales, r.expenses, r.payments, r.waste_value].some((v) => P(v) !== 0n))
    .map((r) => {
      const out = { ...r, cogs: null, gross_profit: null, operating_result: null };
      if (r.closing !== null) {
        const cogs = P(r.opening) + P(r.purchases) - P(r.returns) - P(r.closing);
        out.cogs = rupees(cogs); out.gross_profit = rupees(P(r.sales) - cogs); out.operating_result = rupees(P(r.sales) - cogs - P(r.expenses));
      }
      return out;
    });
  const tot = (k) => sumStr(rows.map((r) => r[k]));
  const { rows: [{ open }] } = await q('SELECT (SELECT closing_stock_value FROM day_closings WHERE close_date < $1 ORDER BY close_date DESC LIMIT 1) AS open', [from]);
  const { rows: [{ close }] } = await q('SELECT (SELECT closing_stock_value FROM day_closings WHERE close_date = $1) AS close', [to]);
  const totals = { purchases: tot('purchases'), returns: tot('returns'), sales: tot('sales'), expenses: tot('expenses'),
    waste_value: tot('waste_value'), payments: tot('payments'), opening_stock_value: open, closing_stock_value: close,
    cogs: null, gross_profit: null, operating_result: null };
  if (close !== null) {
    const cogs = P(open) + P(totals.purchases) - P(totals.returns) - P(close);
    totals.cogs = rupees(cogs); totals.gross_profit = rupees(P(totals.sales) - cogs);
    totals.operating_result = rupees(P(totals.sales) - cogs - P(totals.expenses));
  }
  const { rows: veg } = await q(
    `SELECT v.name, v.unit,
       coalesce(sum(qty) FILTER (WHERE kind='purchase'),0) AS purchased, coalesce(-sum(qty) FILTER (WHERE kind='sale'),0) AS sold,
       coalesce(-sum(qty) FILTER (WHERE kind='waste'),0) AS wasted, coalesce(-sum(qty) FILTER (WHERE kind='return'),0) AS returned,
       coalesce(sum(qty) FILTER (WHERE kind='adjust'),0) AS adjusted
     FROM stock_moves m JOIN vegetables v ON v.id=m.vegetable_id WHERE d BETWEEN $1 AND $2 GROUP BY v.name, v.unit ORDER BY v.name`, [from, to]);
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
    'stock_counts', 'day_closings', 'payments', 'trader_adjustments', 'expenses', 'market_prices', 'plans', 'audit_log', 'import_batches'];
  const out = { exported_at: new Date().toISOString(), app: 'cms-kharidi-diary', version: 5 };
  for (const t of tables) out[t] = (await q(`SELECT * FROM ${t} ORDER BY 1`)).rows;
  out.users = (await q('SELECT id, name, mobile, role, active, created_at FROM users ORDER BY id')).rows;
  return out;
}

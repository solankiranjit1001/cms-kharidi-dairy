// v11: 🔮 વિશ્લેષણ — learn from our own purchase history to plan next year's buying.
// Everything here is read-only and comes ONLY from saved purchases (never invented):
//   • rate per month (effective rate = bill amount incl. commission ÷ kg) and the cheapest / costliest months
//   • quantity per month and on the same dates in earlier years → how much to buy
//   • forecast for the coming months = same month in earlier years, scaled by our recent growth
//   • "buy ahead" tips: cheapest month before the costly season (only useful for items that can be stored)
//   • which trader gave the best rate, which weekday we buy the most
// Numbers here are for planning only, so plain JS numbers (rounded) are fine — no money is saved from this file.
import { q } from './db.js';
import { todayIST, addDays } from './validate.js';

export const MONTHS = ['', 'જાન્યુઆરી', 'ફેબ્રુઆરી', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટેમ્બર', 'ઑક્ટોબર', 'નવેમ્બર', 'ડિસેમ્બર'];
// Items that keep for weeks/months — buying ahead only makes sense for these.
export const STORABLE = ['ડુંગળી', 'લસણ', 'બટાકા', 'બટાટા', 'સૂરણ', 'આદુ', 'શક્કરિયા', 'રતાળુ'];
export const isStorable = (name) => STORABLE.some((s) => String(name || '').includes(s));

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
function addYears(d, n) {
  const [y, m, day] = d.split('-').map(Number);
  const dd = m === 2 && day === 29 ? 28 : day; // 29 Feb → 28 Feb in other years
  return `${y + n}-${String(m).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}
/** month offset: (2026, 11) + 2 → (2027, 1) */
function shiftMonth(y, m, n) { const t = y * 12 + (m - 1) + n; return [Math.floor(t / 12), (t % 12) + 1]; }
function confidence(years) {
  if (years >= 3) return { level: 3, label: 'સારો ભરોસો' };
  if (years === 2) return { level: 2, label: 'મધ્યમ ભરોસો' };
  if (years === 1) return { level: 1, label: 'ઓછો ભરોસો (1 વર્ષ)' };
  return { level: 0, label: 'ડેટા નથી' };
}

/**
 * Pure calculation (no database) so it is easy to test.
 * rows.monthly : [{ vegetable_id, name, unit, y, m, qty, amount, min_rate, max_rate, bills, days }]
 * rows.returns : [{ vegetable_id, y, m, qty }]
 * rows.window  : [{ vegetable_id, years_back, d, qty, amount }]   (same 30 days as "next 30 days", in earlier years)
 * rows.traders : [{ vegetable_id, trader, qty, amount, bills }]   (last 12 months)
 * rows.weekday : [{ vegetable_id, dow, qty, days }]               (last 12 months, dow 1 = Monday)
 */
export function buildAnalysis(rows, today) {
  const [ty, tm] = today.split('-').map(Number);
  const curYm = ym(ty, tm);
  const ret = new Map(rows.returns.map((r) => [`${r.vegetable_id}|${ym(r.y, r.m)}`, Number(r.qty)]));
  const vegs = new Map();
  for (const r of rows.monthly) {
    if (!vegs.has(r.vegetable_id)) vegs.set(r.vegetable_id, { id: r.vegetable_id, name: r.name, unit: r.unit, storable: isStorable(r.name), months: [] });
    const qty = Number(r.qty), amount = Number(r.amount);
    const back = ret.get(`${r.vegetable_id}|${ym(r.y, r.m)}`) || 0;
    vegs.get(r.vegetable_id).months.push({
      ym: ym(r.y, r.m), y: Number(r.y), m: Number(r.m), qty: r3(qty), returned: r3(back), net_qty: r3(qty - back), amount: r2(amount),
      rate: qty > 0 ? r2(amount / qty) : 0, min_rate: Number(r.min_rate), max_rate: Number(r.max_rate), bills: Number(r.bills), days: Number(r.days),
    });
  }

  const out = { today, current_month: tm, months_with_data: 0, first_month: null, has_last_year: false, vegetables: [], forecast: [], buy_ahead: [], next30: [], calendar: [] };
  const allYm = new Set();

  for (const v of vegs.values()) {
    v.months.sort((a, b) => a.ym.localeCompare(b.ym));
    v.months.forEach((x) => allYm.add(x.ym));
    const totQty = v.months.reduce((a, x) => a + x.net_qty, 0), totAmt = v.months.reduce((a, x) => a + x.amount, 0);
    const last12 = v.months.filter((x) => x.ym > ym(...shiftMonth(ty, tm, -12)));

    // ---- month of the year (all years together) ----
    const moy = [];
    for (let m = 1; m <= 12; m++) {
      const list = v.months.filter((x) => x.m === m && x.ym !== curYm); // the running month is not complete yet
      if (!list.length) { moy.push({ m, years: 0 }); continue; }
      const q = list.reduce((a, x) => a + x.qty, 0), nq = list.reduce((a, x) => a + x.net_qty, 0), amt = list.reduce((a, x) => a + x.amount, 0);
      moy.push({ m, years: list.length, avg_qty: r3(nq / list.length), rate: r2(amt / q),
        low_rate: Math.min(...list.map((x) => x.rate)), high_rate: Math.max(...list.map((x) => x.rate)),
        min_bill_rate: Math.min(...list.map((x) => x.min_rate)), max_bill_rate: Math.max(...list.map((x) => x.max_rate)) });
    }
    const withRate = moy.filter((x) => x.years > 0);
    const cheapest = withRate.length ? withRate.reduce((a, b) => (b.rate < a.rate ? b : a)) : null;
    const costliest = withRate.length ? withRate.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;

    // ---- growth: last 6 complete months vs the same 6 months a year before ----
    let growth = null;
    {
      let now = 0, before = 0, comparable = 0;
      for (let k = 1; k <= 6; k++) {
        const [y, m] = shiftMonth(ty, tm, -k);
        const a = v.months.find((x) => x.ym === ym(y, m)), b = v.months.find((x) => x.ym === ym(y - 1, m));
        if (a && b) { now += a.net_qty; before += b.net_qty; comparable++; }
      }
      if (comparable >= 2 && before > 0) growth = { ratio: r2(Math.min(2, Math.max(0.5, now / before))), months: comparable };
    }
    // rate change: same month last year vs this month (so far)
    const thisM = v.months.find((x) => x.ym === curYm), lastYM = v.months.find((x) => x.ym === ym(ty - 1, tm));
    const yoy = thisM && lastYM && lastYM.rate > 0 ? { now: thisM.rate, last_year: lastYM.rate, pct: r2(((thisM.rate - lastYM.rate) / lastYM.rate) * 100) } : null;

    // ---- forecast: this month + next 3 months ----
    for (let k = 0; k <= 3; k++) {
      const [y, m] = shiftMonth(ty, tm, k);
      const s = moy[m - 1];
      if (!s.years) continue;
      const g = growth ? growth.ratio : 1;
      const doneQty = k === 0 && thisM ? thisM.net_qty : 0;
      out.forecast.push({ vegetable_id: v.id, name: v.name, unit: v.unit, y, m, month: MONTHS[m], years: s.years, ...confidence(s.years),
        past_avg_qty: s.avg_qty, growth: growth ? growth.ratio : null, plan_qty: Math.round(s.avg_qty * g), bought_so_far: k === 0 ? r3(doneQty) : null,
        rate: s.rate, low_rate: s.low_rate, high_rate: s.high_rate, est_amount: Math.round(s.avg_qty * g * s.rate),
        season: cheapest && costliest && withRate.length >= 3 ? (m === cheapest.m ? 'cheap' : m === costliest.m ? 'costly' : null) : null });
    }

    // ---- buy ahead: cheapest month before the costliest month (up to 6 months back for items that keep, 2 for others) ----
    if (withRate.length >= 3 && costliest && costliest.rate > 0) {
      let best = null;
      for (let k = 1; k <= (v.storable ? 6 : 2); k++) {
        const pm = ((costliest.m - k - 1 + 12) % 12) + 1;
        const s = moy[pm - 1];
        if (s.years && (!best || s.rate < best.rate)) best = { ...s, before: k };
      }
      const buy = best && best.rate < costliest.rate ? best : null;
      const saving = buy ? costliest.rate - buy.rate : 0;
      if (buy && saving / costliest.rate >= 0.1) {
        // when does the costly month come next?
        const monthsToPeak = (costliest.m - tm + 12) % 12;
        const monthsToBuy = (buy.m - tm + 12) % 12;
        out.buy_ahead.push({ vegetable_id: v.id, name: v.name, unit: v.unit, storable: v.storable,
          buy_month: buy.m, buy_month_name: MONTHS[buy.m], buy_rate: buy.rate,
          peak_month: costliest.m, peak_month_name: MONTHS[costliest.m], peak_rate: costliest.rate,
          saving_per_unit: r2(saving), saving_pct: Math.round((saving / costliest.rate) * 100),
          peak_qty: costliest.avg_qty, est_saving: v.storable ? Math.round(saving * costliest.avg_qty) : null,
          cheapest_month_name: MONTHS[cheapest.m], cheapest_rate: cheapest.rate,
          months_to_buy: monthsToBuy, months_to_peak: monthsToPeak, buy_now: monthsToBuy === 0, buy_soon: monthsToBuy === 1,
          years: Math.min(buy.years, costliest.years), ...confidence(Math.min(buy.years, costliest.years)) });
      }
    }

    // ---- trader comparison & weekday (last 12 months) ----
    const traders = rows.traders.filter((t) => t.vegetable_id === v.id).map((t) => ({ trader: t.trader, qty: r3(Number(t.qty)), bills: Number(t.bills),
      rate: Number(t.qty) > 0 ? r2(Number(t.amount) / Number(t.qty)) : 0 })).sort((a, b) => a.rate - b.rate);
    const wd = rows.weekday.filter((w) => w.vegetable_id === v.id).map((w) => ({ dow: Number(w.dow), qty: r3(Number(w.qty)), days: Number(w.days),
      avg_qty: Number(w.days) ? r3(Number(w.qty) / Number(w.days)) : 0 }));

    out.vegetables.push({ id: v.id, name: v.name, unit: v.unit, storable: v.storable, total_qty: r3(totQty), total_amount: r2(totAmt),
      avg_rate: totQty > 0 ? r2(totAmt / v.months.reduce((a, x) => a + x.qty, 0)) : 0,
      last12_qty: r3(last12.reduce((a, x) => a + x.net_qty, 0)), last12_amount: r2(last12.reduce((a, x) => a + x.amount, 0)),
      cheapest: cheapest && withRate.length >= 3 ? { m: cheapest.m, name: MONTHS[cheapest.m], rate: cheapest.rate } : null,
      costliest: costliest && withRate.length >= 3 ? { m: costliest.m, name: MONTHS[costliest.m], rate: costliest.rate } : null,
      growth, yoy, months: v.months.slice().reverse(), month_of_year: moy, traders, weekday: wd });
  }

  // ---- same dates in earlier years (next 30 days) ----
  const byVeg = new Map();
  for (const w of rows.window) {
    const v = vegs.get(w.vegetable_id);
    if (!v) continue;
    if (!byVeg.has(w.vegetable_id)) byVeg.set(w.vegetable_id, { vegetable_id: w.vegetable_id, name: v.name, unit: v.unit, years: new Set(), qty: 0, amount: 0, days: [] });
    const g = byVeg.get(w.vegetable_id);
    g.years.add(Number(w.years_back)); g.qty += Number(w.qty); g.amount += Number(w.amount);
    g.days.push({ d: w.d, years_back: Number(w.years_back), qty: r3(Number(w.qty)), rate: Number(w.qty) > 0 ? r2(Number(w.amount) / Number(w.qty)) : 0 });
  }
  out.next30 = [...byVeg.values()].map((g) => ({ vegetable_id: g.vegetable_id, name: g.name, unit: g.unit, years: g.years.size,
    avg_qty: r3(g.qty / g.years.size), rate: g.qty > 0 ? r2(g.amount / g.qty) : 0, buy_days: g.days.length,
    days: g.days.sort((a, b) => a.d.localeCompare(b.d)) })).sort((a, b) => b.avg_qty * b.rate - a.avg_qty * a.rate);

  // ---- 12-month calendar: what we usually buy in each month ----
  for (let m = 1; m <= 12; m++) {
    const items = out.vegetables.map((v) => ({ name: v.name, unit: v.unit, ...v.month_of_year[m - 1] })).filter((x) => x.years > 0)
      .sort((a, b) => b.avg_qty * b.rate - a.avg_qty * a.rate);
    out.calendar.push({ m, month: MONTHS[m], items, est_amount: Math.round(items.reduce((a, x) => a + x.avg_qty * x.rate, 0)) });
  }

  out.vegetables.sort((a, b) => b.last12_amount - a.last12_amount || b.total_amount - a.total_amount);
  out.forecast.sort((a, b) => a.y - b.y || a.m - b.m || b.est_amount - a.est_amount);
  out.buy_ahead.sort((a, b) => Number(b.storable) - Number(a.storable) || (b.est_saving || 0) - (a.est_saving || 0) || b.saving_pct - a.saving_pct);
  const sorted = [...allYm].sort();
  out.months_with_data = sorted.length;
  out.first_month = sorted[0] || null;
  out.has_last_year = sorted.some((x) => x <= ym(ty - 1, tm));
  out.forecast_ready = out.forecast.length > 0;
  out.note = 'આ અંદાજ ફક્ત આપણી સાચવેલી ખરીદી પરથી છે. ભાવ = કમિશન સહિત બિલની રકમ ÷ જથ્થો. વરસાદ, બજાર કે માંગ બદલાય તો ભાવ બદલાઈ શકે — આ ગેરંટી નથી.';
  return out;
}

const BASE = `FROM purchase_lines l JOIN purchases p ON p.id = l.purchase_id AND p.voided_at IS NULL`;

export async function analysis() {
  const today = todayIST();
  const yearAgo = addYears(today, -1);
  // same 30 days (tomorrow … +30) in each of the last 5 years
  const wins = [];
  const params = [];
  for (let k = 1; k <= 5; k++) {
    params.push(addYears(addDays(today, 1), -k), addYears(addDays(today, 30), -k));
    wins.push(`SELECT ${k} AS years_back, $${params.length - 1}::date AS f, $${params.length}::date AS t`);
  }
  const [monthly, returns, window, traders, weekday] = await Promise.all([
    q(`SELECT l.vegetable_id, v.name, v.unit, extract(year FROM p.entry_date)::int AS y, extract(month FROM p.entry_date)::int AS m,
          sum(l.qty) AS qty, sum(l.amount) AS amount, min(l.rate) AS min_rate, max(l.rate) AS max_rate,
          count(DISTINCT p.id)::int AS bills, count(DISTINCT p.entry_date)::int AS days
        ${BASE} JOIN vegetables v ON v.id = l.vegetable_id GROUP BY 1, 2, 3, 4, 5`),
    q(`SELECT vegetable_id, extract(year FROM entry_date)::int AS y, extract(month FROM entry_date)::int AS m, sum(qty) AS qty
         FROM purchase_returns WHERE voided_at IS NULL GROUP BY 1, 2, 3`),
    q(`WITH w(years_back, f, t) AS (${wins.join(' UNION ALL ')})
       SELECT l.vegetable_id, w.years_back, p.entry_date AS d, sum(l.qty) AS qty, sum(l.amount) AS amount
         ${BASE} JOIN w ON p.entry_date BETWEEN w.f AND w.t GROUP BY 1, 2, 3`, params),
    q(`SELECT l.vegetable_id, t.name AS trader, sum(l.qty) AS qty, sum(l.amount) AS amount, count(DISTINCT p.id)::int AS bills
         ${BASE} JOIN traders t ON t.id = p.trader_id WHERE p.entry_date > $1 GROUP BY 1, 2`, [yearAgo]),
    q(`SELECT l.vegetable_id, extract(isodow FROM p.entry_date)::int AS dow, sum(l.qty) AS qty, count(DISTINCT p.entry_date)::int AS days
         ${BASE} WHERE p.entry_date > $1 GROUP BY 1, 2`, [yearAgo]),
  ]);
  return buildAnalysis({ monthly: monthly.rows, returns: returns.rows, window: window.rows, traders: traders.rows, weekday: weekday.rows }, today);
}

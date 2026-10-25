// Gujarati reports and the A4-landscape printable daily diary.
import { $, esc, money, num, qty, gDate, weekday, table, field, selectField } from './ui.js';
import { get, qs } from './api.js';
import { state } from './state.js';
import { diaryTable } from './pages.js';

const REPORTS = [
  { value: 'diary', label: 'દૈનિક ડાયરી (A4 આડું પ્રિન્ટ)' },
  { value: 'summary', label: 'નફો-નુકસાન / સમયગાળાનો સારાંશ' },
  { value: 'purchases', label: 'ખરીદી રિપોર્ટ' },
  { value: 'expenses', label: 'ખર્ચ રિપોર્ટ' },
  { value: 'traders', label: 'વેપારી બાકી રિપોર્ટ' },
];

export async function reports(root) {
  const monthStart = state.date.slice(0, 8) + '01';
  root.innerHTML = `<div class="pagehead noprint"><div><h2>રિપોર્ટ અને પ્રિન્ટ</h2><div class="sub">બધા રિપોર્ટ સાચવેલી એન્ટ્રી પરથી</div></div></div>
  <div class="card noprint"><div class="formgrid">${selectField('રિપોર્ટ', 'rtype', REPORTS, sessionStorageGet('rtype') || 'diary')}
    ${field('તારીખથી', 'rfrom', { type: 'date', value: monthStart })}${field('તારીખ સુધી', 'rto', { type: 'date', value: state.date })}</div>
    <div class="actions"><button class="btn primary" data-action="report-show">રિપોર્ટ બતાવો</button><button class="btn light" data-action="print">🖨️ પ્રિન્ટ</button></div>
    <p class="note">પ્રિન્ટ કરતી વખતે: કાગળ A4, દિશા "Landscape / આડું", સ્કેલ 100%, "Background graphics" ચાલુ. દૈનિક ડાયરી ઉપરની તારીખ (હેડરમાં) માટે બને છે.</p></div>
  <div id="reportOut"></div>`;
  const sel = $('#f_rtype');
  const sync = () => {
    const v = sel.value;
    $('#f_rfrom').closest('.field').hidden = ['diary', 'stock', 'traders'].includes(v);
    $('#f_rto').closest('.field').hidden = ['diary', 'stock'].includes(v);
  };
  sel.addEventListener('change', () => { sessionStorageSet('rtype', sel.value); sync(); showReport(); });
  sync();
  await showReport();
}

function sessionStorageGet(k) { try { return sessionStorage.getItem('cms_' + k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem('cms_' + k, v); } catch { /* ignore */ } }

export async function showReport() {
  const type = $('#f_rtype').value, from = $('#f_rfrom').value, to = $('#f_rto').value;
  const out = $('#reportOut');
  out.innerHTML = '<div class="empty">લોડ થઈ રહ્યું છે…</div>';
  const title = (t, sub) => `<div class="reporthead"><h2>CMS ખરીદી ડાયરી — ${t}</h2><div>${sub}</div></div>`;
  const range = `${gDate(from)} થી ${gDate(to)}`;
  if (type === 'diary') { out.innerHTML = await diarySheet(state.date); return; }
  if (type === 'summary') {
    const s = await get(`/reports/summary${qs({ from, to })}`);
    const T = s.totals;
    const cls = (v) => (Number(v) < 0 ? 'red' : 'green');
    out.innerHTML = `<div class="card report">${title('નફો-નુકસાન સારાંશ', range)}
      ${table(['વિગત', 'રકમ'], [
        ['કુલ વેચાણ (ગ્રાહકો પાસેથી મળેલ)', money(T.sales)], ['− કુલ ખરીદી (પરત બાદ)', money(T.net_purchases)], ['− ખર્ચ', money(T.expenses)],
        ['<b>= ચોખ્ખું પરિણામ</b>', `<b class="${cls(T.result)}">${money(T.result)}</b>`], ['(માહિતી) વેપારીને ચૂકવેલ', money(T.payments)],
      ].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`), { cls: 'diary' })}
      <h3>દિવસ પ્રમાણે</h3>${table(['તારીખ', 'વેચાણ', 'ખરીદી', 'પરત', 'ખર્ચ', 'પરિણામ', 'વેપારીને ચૂકવેલ'],
        s.days.map((d) => `<tr><td>${gDate(d.d)}</td><td>${d.day_sale === null && Number(d.sales) === 0 ? '<span class="amber">બાકી</span>' : money(d.sales)}</td><td>${money(d.purchases)}</td><td>${Number(d.returns) ? money(d.returns) : ''}</td><td>${money(d.expenses)}</td><td class="${cls(d.result)}"><b>${money(d.result)}</b></td><td>${money(d.payments)}</td></tr>`))}
      <h3>શાક પ્રમાણે ખરીદી</h3>${table(['શાક', 'જથ્થો', 'રકમ', 'સરેરાશ દર'], s.vegetables.map((v) => `<tr><td>${esc(v.name)}</td><td>${qty(v.qty, v.unit)}</td><td>${money(v.amount)}</td><td>${money(v.avg_rate)}</td></tr>`))}
      <p class="note">પરિણામ = વેચાણ − ખરીદી − ખર્ચ. વેપારીને ચુકવણી પરિણામમાંથી ફરી બાદ થતી નથી.</p></div>`;
    return;
  }
  if (type === 'stock') {
    const s = await get(`/stock${qs({ date: state.date })}`);
    out.innerHTML = `<div class="card report">${title('સ્ટોક રિપોર્ટ', `${gDate(state.date)} • ${weekday(state.date)}`)}${table(['શાક', 'શરૂઆત', 'ખરીદી', 'વેચાણ', 'બગાડ', 'પરત', 'સુધારો', 'ગણતરી', 'વાસ્તવિક', 'તફાવત', 'સરેરાશ દર'],
      s.rows.map((r) => `<tr><td>${esc(r.name)} (${esc(r.unit)})</td><td>${num(r.opening)}</td><td>${num(r.purchased)}</td><td>${num(r.sold)}</td><td>${num(r.wasted)}</td><td>${num(r.returned)}</td><td>${num(r.adjusted)}</td><td><b>${num(r.closing)}</b></td><td>${r.physical_qty === null ? '—' : num(r.physical_qty)}</td><td>${r.diff === null ? '—' : num(r.diff)}</td><td>${money(r.avg_rate)}</td></tr>`))}
      <p>ક્લોઝિંગ સ્ટોક ₹: <b>${s.closing ? money(s.closing.closing_stock_value) : 'બાકી'}</b></p></div>`;
    return;
  }
  if (type === 'traders') {
    const b = await get(`/traders${qs({ asOf: to })}`);
    out.innerHTML = `<div class="card report">${title('વેપારી બાકી', `${gDate(to)} સુધી`)}${table(['વેપારી', 'ફોન', 'શરૂઆત', 'ખરીદી', 'પરત', 'ચુકવણી', 'સુધારો', 'બાકી'],
      b.filter((t) => Number(t.balance) !== 0 || Number(t.purchases) !== 0).map((t) => `<tr><td>${esc(t.name)}</td><td>${esc(t.phone || '')}</td><td>${money(t.opening_balance)}</td><td>${money(t.purchases)}</td><td>${money(t.returns)}</td><td>${money(t.payments)}</td><td>${money(t.adjustments)}</td><td><b>${money(t.balance)}</b></td></tr>`))}
      <p class="balance">કુલ બાકી: ${money(b.reduce((a, t) => a + Math.max(0, Number(t.balance)), 0))}</p></div>`;
    return;
  }
  const list = await get(`/records/${type}${qs({ from, to, limit: 1000 })}`);
  const sum = (k) => list.reduce((a, x) => a + Number(x[k] || 0), 0);
  let body = '';
  if (type === 'purchases') {
    body = table(['તારીખ', 'વેપારી', 'શાક', 'જથ્થો', 'દર', 'રકમ', 'બિલ કુલ', 'સ્થિતિ'], list.flatMap((p) => p.lines.map((l, i) => `<tr><td>${i ? '' : gDate(p.entry_date)}</td><td>${i ? '' : esc(p.trader_name)}</td><td>${esc(l.vegetable)}</td><td>${qty(l.qty, l.unit)}</td><td>${money(l.rate)}</td><td>${money(l.amount)}</td><td>${i ? '' : `<b>${money(p.total_amount)}</b>`}</td><td>${i ? '' : esc(p.status)}</td></tr>`)))
      + `<p class="balance">કુલ ખરીદી: ${money(sum('total_amount'))} • બાકી: ${money(sum('due_amount'))}</p>`;
  } else if (type === 'sales') {
    body = table(['તારીખ', 'શાક', 'જથ્થો', 'દર', 'છૂટ', 'રકમ', 'ચુકવણી'], list.map((x) => `<tr><td>${gDate(x.entry_date)}</td><td>${esc(x.vegetable)}</td><td>${qty(x.qty, x.veg_unit)}</td><td>${money(x.rate)}</td><td>${Number(x.discount) ? money(x.discount) : ''}</td><td>${money(x.amount)}</td><td>${esc(x.payment_mode)}</td></tr>`))
      + `<p class="balance">કુલ વેચાણ: ${money(sum('amount'))}</p>`;
  } else if (type === 'waste') {
    body = table(['તારીખ', 'શાક', 'જથ્થો', 'અંદાજિત ₹', 'કારણ'], list.map((x) => `<tr><td>${gDate(x.entry_date)}</td><td>${esc(x.vegetable)}</td><td>${qty(x.qty, x.veg_unit)}</td><td>${money(x.est_value)}</td><td>${esc(x.reason)}</td></tr>`))
      + `<p class="balance">કુલ બગાડ (અંદાજિત): ${money(sum('est_value'))}</p>`;
  } else if (type === 'expenses') {
    body = table(['તારીખ', 'પ્રકાર', 'રકમ', 'નોંધ'], list.map((x) => `<tr><td>${gDate(x.entry_date)}</td><td>${esc(x.category)}</td><td>${money(x.amount)}</td><td>${esc(x.note || '')}</td></tr>`))
      + `<p class="balance">કુલ ખર્ચ: ${money(sum('amount'))}</p>`;
  }
  out.innerHTML = `<div class="card report">${title(REPORTS.find((r) => r.value === type).label, range)}${body}${list.length >= 1000 ? '<p class="amber">પહેલી 1000 એન્ટ્રી — સમયગાળો નાનો કરો.</p>' : ''}</div>`;
}

/** Printable daily diary: A4 landscape — purchases, day's sales total, expenses, market survey and the day's result. */
export async function diarySheet(date) {
  const d = encodeURIComponent(date);
  const [dash, pur, exp, mkt, pays] = await Promise.all([
    get(`/dashboard?date=${d}`), get(`/records/purchases?date=${d}`), get(`/records/expenses?date=${d}`),
    get(`/records/market?date=${d}`), get(`/records/payments?date=${d}`)]);
  const y = dash.diary;
  const blank = (n, cols) => Array.from({ length: Math.max(0, n) }, () => `<tr class="blankrow">${'<td>&nbsp;</td>'.repeat(cols)}</tr>`).join('');
  const purRows = pur.flatMap((p) => p.lines.map((l) => `<tr><td>${esc(l.vegetable)}</td><td>${esc(p.trader_name)}</td><td>${num(l.qty)} ${esc(l.unit)}</td><td>${money(l.rate)}</td><td>${money(l.amount)}</td></tr>`));
  const payRows = pays.map((x) => `<tr><td>${esc(x.trader_name)}</td><td>${esc(x.method)}</td><td>${money(x.amount)}</td></tr>`);
  const mkRows = mkt.slice(0, 10).map((x) => `<tr><td>${esc(x.market)}</td><td>${esc(x.vegetable)}</td><td>${money(x.price)}/${esc(x.unit)}</td><td>${esc(x.grade || '')}</td></tr>`);
  return `<div class="diarysheet">
    <div class="ds-head"><div><b>CMS દૈનિક શાકભાજી ખરીદી ડાયરી — ભાવનગર</b></div><div>તારીખ: <b>${gDate(date)}</b> • ${weekday(date)}</div></div>
    <div class="ds-cols">
      <section class="ds-part"><h4>ભાગ A — ખરીદી</h4>
        <table><thead><tr><th>શાક</th><th>વેપારી</th><th>જથ્થો</th><th>દર</th><th>રકમ</th></tr></thead><tbody>${purRows.join('')}${blank(10 - purRows.length, 5)}</tbody>
        <tfoot><tr><td colspan="4">કુલ ખરીદી</td><td><b>${money(y.purchases)}</b></td></tr></tfoot></table>
        <h4>ભાગ B — વેચાણ</h4>
        <table><tbody><tr><td>ગ્રાહકો પાસેથી મળેલ કુલ રકમ</td><td><b>${y.sales_entered ? money(y.sales) : '&nbsp;'}</b></td></tr></tbody></table>
      </section>
      <section class="ds-part"><h4>ભાગ C — વેપારીને ચુકવણી</h4>
        <table><thead><tr><th>વેપારી</th><th>માધ્યમ</th><th>રકમ</th></tr></thead><tbody>${payRows.join('')}${blank(4 - payRows.length, 3)}</tbody>
        <tfoot><tr><td colspan="2">આજે ચૂકવેલ • આજના બિલમાંથી બાકી ${money(y.today_bills_due)}</td><td><b>${money(y.payments)}</b></td></tr></tfoot></table>
        <h4>ભાગ E — ખર્ચ</h4>
        <table><thead><tr><th>વિગત</th><th>નોંધ</th><th>રકમ</th></tr></thead><tbody>
          ${exp.map((x) => `<tr><td>${esc(x.category)}</td><td>${esc(x.note || '')}</td><td>${money(x.amount)}</td></tr>`).join('')}
          ${blank(3, 3)}</tbody></table>
        <h4>ભાગ D — બજાર સર્વે (10 પંક્તિ)</h4>
        <table><thead><tr><th>બજાર</th><th>શાક</th><th>ભાવ</th><th>ગ્રેડ</th></tr></thead><tbody>${mkRows.join('')}${blank(10 - mkRows.length, 4)}</tbody></table>
      </section>
      <section class="ds-part"><h4>આજનો હિસાબ</h4>${diaryTable(y)}
        <h4>સમીક્ષા (5 પંક્તિ)</h4>
        <table class="review"><tbody>${blank(5, 1)}</tbody></table>
        <div class="signs"><span>લખનાર: ____________</span><span>ચકાસનાર: ____________</span></div>
      </section>
    </div></div>`;
}

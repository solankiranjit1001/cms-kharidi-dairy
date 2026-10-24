// Gujarati reports and the A4-landscape printable daily diary.
import { $, esc, money, num, qty, gDate, weekday, table, field, selectField } from './ui.js';
import { get, qs } from './api.js';
import { state } from './state.js';
import { diaryTable } from './pages.js';

const REPORTS = [
  { value: 'diary', label: 'દૈનિક ડાયરી (A4 આડું પ્રિન્ટ)' },
  { value: 'summary', label: 'નફો-નુકસાન / સમયગાળાનો સારાંશ' },
  { value: 'purchases', label: 'ખરીદી રિપોર્ટ' },
  { value: 'sales', label: 'વેચાણ રિપોર્ટ' },
  { value: 'waste', label: 'બગડેલ માલ રિપોર્ટ' },
  { value: 'stock', label: 'સ્ટોક રિપોર્ટ (એક દિવસ)' },
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
    out.innerHTML = `<div class="card report">${title('નફો-નુકસાન સારાંશ', range)}
      ${table(['વિગત', 'રકમ'], [
        ['શરૂઆતનો સ્ટોક ₹ (આગલા ક્લોઝિંગ પરથી)', money(T.opening_stock_value)], ['+ ખરીદી', money(T.purchases)], ['− પરત', money(T.returns)],
        ['− અંતિમ દિવસનો ક્લોઝિંગ સ્ટોક ₹', T.closing_stock_value === null ? '<span class="amber">અંતિમ દિવસનું મૂલ્ય બાકી</span>' : money(T.closing_stock_value)],
        ['= વેચાયેલ માલની પડતર', money(T.cogs)], ['વેચાણ', money(T.sales)], ['કુલ નફો', money(T.gross_profit)], ['− ખર્ચ', money(T.expenses)],
        ['<b>ચોખ્ખું પરિણામ</b>', `<b>${money(T.operating_result)}</b>`], ['(માહિતી) બગડેલ માલ અંદાજિત ₹', money(T.waste_value)], ['(માહિતી) વેપારીને ચુકવણી', money(T.payments)],
      ].map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`), { cls: 'diary' })}
      <h3>દિવસ પ્રમાણે</h3>${table(['તારીખ', 'ખરીદી', 'પરત', 'વેચાણ', 'ખર્ચ', 'બગાડ ₹', 'ક્લોઝિંગ ₹', 'પડતર', 'પરિણામ'],
        s.days.map((d) => `<tr><td>${gDate(d.d)}</td><td>${money(d.purchases)}</td><td>${Number(d.returns) ? money(d.returns) : ''}</td><td>${money(d.sales)}</td><td>${money(d.expenses)}</td><td>${money(d.waste_value)}</td><td>${d.closing === null ? '<span class="amber">બાકી</span>' : money(d.closing)}</td><td>${money(d.cogs)}</td><td class="${Number(d.operating_result) < 0 ? 'red' : ''}">${money(d.operating_result)}</td></tr>`))}
      <h3>શાક પ્રમાણે જથ્થો</h3>${table(['શાક', 'ખરીદી', 'વેચાણ', 'બગાડ', 'પરત', 'સુધારો'], s.vegetables.map((v) => `<tr><td>${esc(v.name)}</td><td>${qty(v.purchased, v.unit)}</td><td>${qty(v.sold, v.unit)}</td><td>${qty(v.wasted, v.unit)}</td><td>${qty(v.returned, v.unit)}</td><td>${num(v.adjusted)}</td></tr>`))}
      <p class="note">પડતર = શરૂઆતનો સ્ટોક + ખરીદી − પરત − ક્લોઝિંગ સ્ટોક. બગડેલ માલ પડતરમાં આવી જાય છે. વેપારીને ચુકવણી રોકડ હિલચાલ છે, ખર્ચ નથી.</p></div>`;
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

/** Printable daily diary: two-part A4 landscape sheet with 10 market-survey rows and 5 review rows. */
export async function diarySheet(date) {
  const d = encodeURIComponent(date);
  const [dash, pur, sal, wst, exp, mkt] = await Promise.all([
    get(`/dashboard?date=${d}`), get(`/records/purchases?date=${d}`), get(`/records/sales?date=${d}`),
    get(`/records/waste?date=${d}`), get(`/records/expenses?date=${d}`), get(`/records/market?date=${d}`)]);
  const blank = (n, cols) => Array.from({ length: Math.max(0, n) }, () => `<tr class="blankrow">${'<td>&nbsp;</td>'.repeat(cols)}</tr>`).join('');
  const purRows = pur.flatMap((p) => p.lines.map((l) => `<tr><td>${esc(l.vegetable)}</td><td>${esc(p.trader_name)}</td><td>${num(l.qty)} ${esc(l.unit)}</td><td>${money(l.rate)}</td><td>${money(l.amount)}</td></tr>`));
  const salRows = sal.map((x) => `<tr><td>${esc(x.vegetable)}</td><td>${num(x.qty)} ${esc(x.veg_unit)}</td><td>${money(x.rate)}</td><td>${money(x.amount)}</td><td>${esc(x.payment_mode)}</td></tr>`);
  const mkRows = mkt.slice(0, 10).map((x) => `<tr><td>${esc(x.market)}</td><td>${esc(x.vegetable)}</td><td>${money(x.price)}/${esc(x.unit)}</td><td>${esc(x.grade || '')}</td></tr>`);
  return `<div class="diarysheet">
    <div class="ds-head"><div><b>CMS દૈનિક શાકભાજી ખરીદી ડાયરી — ભાવનગર</b></div><div>તારીખ: <b>${gDate(date)}</b> • ${weekday(date)}</div></div>
    <div class="ds-cols">
      <section class="ds-part"><h4>ભાગ A — ખરીદી</h4>
        <table><thead><tr><th>શાક</th><th>વેપારી</th><th>જથ્થો</th><th>દર</th><th>રકમ</th></tr></thead><tbody>${purRows.join('')}${blank(6 - purRows.length, 5)}</tbody>
        <tfoot><tr><td colspan="4">કુલ ખરીદી</td><td><b>${money(dash.totals.purchases)}</b></td></tr></tfoot></table>
        <h4>ભાગ B — વેચાણ</h4>
        <table><thead><tr><th>શાક</th><th>જથ્થો</th><th>દર</th><th>રકમ</th><th>ચુકવણી</th></tr></thead><tbody>${salRows.join('')}${blank(6 - salRows.length, 5)}</tbody>
        <tfoot><tr><td colspan="3">કુલ વેચાણ</td><td colspan="2"><b>${money(dash.totals.sales)}</b></td></tr></tfoot></table>
      </section>
      <section class="ds-part"><h4>ભાગ C — સ્ટોક</h4>
        <table><thead><tr><th>શાક</th><th>શરૂઆત</th><th>આવક</th><th>વેચાણ</th><th>બગાડ</th><th>બાકી</th><th>વાસ્તવિક</th></tr></thead>
        <tbody>${dash.stock.map((s) => `<tr><td>${esc(s.name)}</td><td>${num(s.opening)}</td><td>${num(s.purchased)}</td><td>${num(s.sold)}</td><td>${num(s.wasted)}</td><td><b>${num(s.closing)}</b></td><td>${s.physical_qty === null ? '' : num(s.physical_qty)}</td></tr>`).join('')}${blank(5 - dash.stock.length, 7)}</tbody></table>
        <h4>ભાગ E — ખર્ચ / બગડેલ માલ</h4>
        <table><thead><tr><th>વિગત</th><th>નોંધ</th><th>રકમ</th></tr></thead><tbody>
          ${exp.map((x) => `<tr><td>${esc(x.category)}</td><td>${esc(x.note || '')}</td><td>${money(x.amount)}</td></tr>`).join('')}
          ${wst.map((x) => `<tr><td>બગાડ: ${esc(x.vegetable)}</td><td>${num(x.qty)} ${esc(x.veg_unit)} • ${esc(x.reason)}</td><td>${money(x.est_value)}</td></tr>`).join('')}
          ${blank(3, 3)}</tbody></table>
        <h4>ભાગ D — બજાર સર્વે (10 પંક્તિ)</h4>
        <table><thead><tr><th>બજાર</th><th>શાક</th><th>ભાવ</th><th>ગ્રેડ</th></tr></thead><tbody>${mkRows.join('')}${blank(10 - mkRows.length, 4)}</tbody></table>
      </section>
      <section class="ds-part"><h4>આજનો હિસાબ</h4>${diaryTable(dash.diary)}
        <h4>સમીક્ષા (5 પંક્તિ)</h4>
        <table class="review"><tbody>${blank(5, 1)}</tbody></table>
        <div class="signs"><span>લખનાર: ____________</span><span>ચકાસનાર: ____________</span></div>
      </section>
    </div></div>`;
}

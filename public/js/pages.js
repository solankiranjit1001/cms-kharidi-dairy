// Screens. Every number shown comes from the server's saved records.
import { $, esc, money, num, qty, gDate, weekday, addDays, table, metric, dateTime, field, numField, openModal, toast, selectField } from './ui.js';
import { get, put, post, patch, qs } from './api.js';
import { state, canWrite, isOwner } from './state.js';
import { TYPE_LABEL } from './forms.js';
import { famousMarkets, allReference, AGMARKNET_URL } from './market-ref.js';

export function recActions(type, r) {
  if (!r) return '';
  if (type === 'day_sales') return '';
  const b = [];
  if (!r.voided_at && canWrite() && (type !== 'trader_adjustments' || isOwner())) b.push(`<button class="btn light small" data-action="edit" data-type="${type}" data-id="${r.id}">✏️ ફેરફાર</button>`);
  if (!r.voided_at && isOwner()) b.push(`<button class="btn danger small" data-action="void" data-type="${type}" data-id="${r.id}">🗑️ રદ</button>`);
  return b.length ? `<div class="rowactions noprint">${b.join('')}</div>` : '';
}
const voidCls = (r) => (r.voided_at ? ' class="voided"' : '');
const voidPill = (r) => (r.voided_at ? ` <span class="pill red">રદ: ${esc(r.void_reason || '')}</span>` : '');
const by = (r) => `<small class="muted">${esc(r.created_by_name || '')}${r.updated_by_name && r.updated_at !== r.created_at && r.updated_by_name !== r.created_by_name ? ` • ફેરફાર: ${esc(r.updated_by_name)}` : ''}</small>`;
const btn = (label, action, cls = 'primary', extra = '') => (canWrite() ? `<button class="btn ${cls}" data-action="${action}" ${extra}>${label}</button>` : '');

function head(title, sub = '') {
  return `<div class="pagehead"><div><h2>${title}</h2><div class="sub">${gDate(state.date)} • ${weekday(state.date)}${sub ? ' • ' + sub : ''}</div></div>
    <div class="actions noprint"><button class="btn light" data-action="print">🖨️ પ્રિન્ટ</button></div></div>`;
}

// ================= HOME =================
// v6 simple accounting: no item-wise selling, no stock counting. Papa types one sales total per day.
export async function home(root) {
  const [d, dayBills, allBills] = await Promise.all([get(`/dashboard${qs({ date: state.date })}`),
    get(`/records/purchases${qs({ unpaid: 1, date: state.date, limit: 300 })}`), get(`/records/purchases${qs({ unpaid: 1, to: state.date, limit: 1000 })}`)]);
  const t = d.totals, y = d.diary;
  const res = Number(y.result);
  root.innerHTML = `${head('આજની ડાયરી')}
  ${d.warnings.length ? `<div class="alert"><b>⚠️ ધ્યાન આપો</b><ul>${d.warnings.map((w) => `<li>${esc(w.text)}</li>`).join('')}</ul>
    <div class="actions">${btn('💰 આજનું વેચાણ લખો', 'daysale', 'small primary')}</div></div>` : ''}
  <div class="card resultcard ${res < 0 ? 'neg' : 'pos'}"><div class="metric">આજનું પરિણામ (વેચાણ − ખરીદી − ખર્ચ)</div>
    <div class="amount ${res < 0 ? 'red' : 'green'}">${res > 0 ? '+ ' : res < 0 ? '− ' : ''}${money(Math.abs(res))}</div>
    <div class="sub">${res > 0 ? 'નફો' : res < 0 ? 'નુકસાન' : 'સરભર'}${y.sales_entered ? '' : ' • વેચાણ હજુ લખ્યું નથી'}</div></div>
  <div class="card periodcard"><h3 class="sectiontitle">કુલ નફો-નુકસાન (સમયગાળો)</h3>
    <div class="periodbtns noprint">${PERIODS.map((x) => `<button class="btn ${x.key === periodSel ? 'primary' : 'light'} small" data-action="period" data-p="${x.key}">${x.label}</button>`).join('')}</div>
    <div class="periodrange noprint" ${periodSel === 'custom' ? '' : 'hidden'}>${field('તારીખથી', 'pfrom', { type: 'date', value: periodCustom.from || state.date.slice(0, 8) + '01', attrs: `max="${state.meta.today}"` })}
      ${field('તારીખ સુધી', 'pto', { type: 'date', value: periodCustom.to || state.date, attrs: `max="${state.meta.today}"` })}
      <button class="btn primary small" data-action="period" data-p="custom" data-go="1">બતાવો</button></div>
    <div id="periodOut"><div class="empty">લોડ થઈ રહ્યું છે…</div></div></div>
  <div class="grid">
    ${metric('આજની કુલ ખરીદી', money(y.net_purchases), 'green', `${t.purchase_count} બિલ${Number(y.returns) ? ` • પરત ${money(y.returns)} બાદ` : ''}`)}
    ${metric('આજનું કુલ વેચાણ (ગ્રાહકો પાસેથી મળેલ)', y.sales_entered ? money(y.sales) : '<span class="muted small">હજુ લખ્યું નથી</span>', 'blue',
      canWrite() ? `<button class="btn light small" data-action="daysale">${y.day_sale === null ? '＋ લખો' : '✏️ બદલો'}</button>` : '')}
    ${metric('આજે વેપારીને ચૂકવેલ', money(y.payments), 'amber')}
    ${metric('આજના બિલમાંથી ચૂકવવાના બાકી', money(y.today_bills_due), 'red', `બધા વેપારીની કુલ બાકી: <b>${money(d.payable)}</b>${Number(d.advances) ? ` • એડવાન્સ ${money(d.advances)}` : ''}`)}
    ${metric('આજનો ખર્ચ', money(y.expenses), 'red', 'ટ્રાન્સપોર્ટ / હમાલી વગેરે')}
  </div>
  ${canWrite() ? `<div class="card noprint"><h3 class="sectiontitle">ઝડપી એન્ટ્રી</h3><div class="quick">
    <button data-action="new" data-type="purchases">🧺<br>ખરીદી</button><button data-action="daysale">💰<br>આજનું વેચાણ</button>
    <button data-action="new" data-type="payments">💳<br>વેપારી ચુકવણી</button><button data-action="new" data-type="expenses">💸<br>ખર્ચ</button>
    <button data-action="new" data-type="market">📊<br>બજાર ભાવ</button></div></div>` : ''}
  <div class="grid two">
    <div class="card"><h3 class="sectiontitle">આજનો હિસાબ</h3>${diaryTable(y)}</div>
    <div class="card"><h3 class="sectiontitle">વેપારી બાકી (ચૂકવવાના)</h3>${table(['વેપારી', 'બાકી', ''],
      d.traders_due.map((x) => `<tr><td>${esc(x.name)}</td><td class="${Number(x.balance) > 0 ? 'amber' : 'green'}"><b>${money(x.balance)}</b>${Number(x.balance) < 0 ? ' <small>(એડવાન્સ)</small>' : ''}</td><td>${Number(x.balance) > 0 ? btn('💳 ચુકવો', 'pay', 'secondary small', `data-trader="${x.id}"`) : ''}</td></tr>`),
      { empty: 'કોઈ વેપારીને ચૂકવવાનું બાકી નથી' })}
      <p class="balance">કુલ બાકી: ${money(d.payable)}</p></div>
  </div>
  <div class="card"><h3 class="sectiontitle">બાકી બિલ — ${gDate(state.date)}</h3>${billTable(dayBills, { empty: 'આ દિવસનું કોઈ બિલ બાકી નથી', date: false })}</div>
  <div class="card"><h3 class="sectiontitle">કુલ બાકી બિલ (${gDate(state.date)} સુધી, આ દિવસ સહિત)</h3>${billTable(allBills, { empty: 'કોઈ બિલ બાકી નથી' })}</div>`;
  await periodResult();
}

// ---- period result: this week / this month / from the start / chosen dates (all up to the work date) ----
const PERIODS = [
  { key: 'week', label: 'આ અઠવાડિયું' }, { key: 'month', label: 'આ મહિનો' },
  { key: 'all', label: 'શરૂઆતથી આજ સુધી' }, { key: 'custom', label: '📅 તારીખ પસંદ કરો' },
];
let periodSel = 'month';
const periodCustom = { from: '', to: '' };

function periodRange() {
  const d = state.date;
  if (periodSel === 'week') { // Monday to the work date
    const wd = new Date(d + 'T00:00:00Z').getUTCDay();
    return { from: addDays(d, -((wd + 6) % 7)), to: d, label: 'આ અઠવાડિયું (સોમવારથી)' };
  }
  if (periodSel === 'month') return { from: d.slice(0, 8) + '01', to: d, label: 'આ મહિનો' };
  if (periodSel === 'all') return { from: 'start', to: d, label: 'શરૂઆતથી' };
  return { from: periodCustom.from || d.slice(0, 8) + '01', to: periodCustom.to || d, label: 'પસંદ કરેલ સમયગાળો' };
}

export async function periodResult(el = null) {
  if (el) {
    periodSel = el.dataset.p;
    if (periodSel === 'custom' && el.dataset.go) { periodCustom.from = $('#f_pfrom').value; periodCustom.to = $('#f_pto').value; }
    document.querySelectorAll('[data-action=period]:not([data-go])').forEach((b) => { b.classList.toggle('primary', b.dataset.p === periodSel); b.classList.toggle('light', b.dataset.p !== periodSel); });
    $('.periodrange').hidden = periodSel !== 'custom';
    if (periodSel === 'custom' && !el.dataset.go) return;
  }
  const out = $('#periodOut');
  if (!out) return;
  const r = periodRange();
  try {
    const s = await get(`/reports/summary${qs({ from: r.from, to: r.to })}`);
    const T = s.totals, res = Number(T.result);
    const missing = s.days.filter((x) => x.day_sale === null && Number(x.sales) === 0).length;
    out.innerHTML = `<div class="periodres ${res < 0 ? 'neg' : 'pos'}"><div class="metric">${r.label}: ${gDate(s.from)} થી ${gDate(s.to)}</div>
      <div class="amount ${res < 0 ? 'red' : 'green'}">${res > 0 ? '+ ' : res < 0 ? '− ' : ''}${money(Math.abs(res))}</div>
      <div class="sub">${res > 0 ? 'નફો' : res < 0 ? 'નુકસાન' : 'સરભર'}</div></div>
      ${table(['વિગત', 'રકમ'], [
        ['કુલ વેચાણ', money(T.sales)], ['− કુલ ખરીદી (પરત બાદ)', money(T.net_purchases)], ['− ખર્ચ', money(T.expenses)],
        ['<b>= પરિણામ</b>', `<b class="${res < 0 ? 'red' : 'green'}">${money(T.result)}</b>`],
      ].map((x) => `<tr><td>${x[0]}</td><td>${x[1]}</td></tr>`), { cls: 'diary' })}
      ${missing ? `<p class="note amber">⚠️ ${missing} દિવસનું વેચાણ હજુ લખ્યું નથી — તે દિવસોની ખરીદી બાદ થઈ છે, વેચાણ નહીં.</p>` : ''}`;
  } catch (e) { out.innerHTML = `<div class="alert">${esc(e.message)}</div>`; }
}

/** Unpaid / part-paid bills with a "ચુકવો" button that pays against that exact bill. */
export function billTable(bills, { empty = 'કોઈ બિલ બાકી નથી', date = true } = {}) {
  const sum = (k) => bills.reduce((a, p) => a + Number(p[k]), 0);
  return table([...(date ? ['તારીખ'] : []), 'વેપારી', 'બિલ', 'કુલ', 'ચૂકવેલ', 'બાકી', ''],
    bills.map((p) => `<tr>${date ? `<td>${gDate(p.entry_date)}</td>` : ''}<td>${esc(p.trader_name)}</td><td>#${p.id}</td><td>${money(p.total_amount)}</td><td>${money(p.paid_amount)}</td><td class="amber"><b>${money(p.due_amount)}</b></td><td>${btn('ચુકવો', 'pay', 'secondary small', `data-trader="${p.trader_id}" data-bill="${p.id}"`)}</td></tr>`),
    { empty }) + (bills.length ? `<p class="balance">${bills.length} બિલ • કુલ ${money(sum('total_amount'))} • ચૂકવેલ ${money(sum('paid_amount'))} • બાકી <span class="amber">${money(sum('due_amount'))}</span></p>` : '');
}

export function diaryTable(y) {
  const res = Number(y.result);
  const rows = [
    [`કુલ વેચાણ (ગ્રાહકો પાસેથી મળેલ)${y.day_sale_note ? ` <small class="muted">${esc(y.day_sale_note)}</small>` : ''}`, y.sales_entered ? money(y.sales) : '<span class="amber">બાકી</span>'],
    ['− કુલ ખરીદી' + (Number(y.returns) ? ` <small class="muted">(${money(y.purchases)} − પરત ${money(y.returns)})</small>` : ''), money(y.net_purchases)],
    ['− ખર્ચ', money(y.expenses)],
    ['<b>= આજનું પરિણામ</b>', `<b class="${res < 0 ? 'red' : 'green'}">${money(y.result)}</b>`],
  ];
  return `${table(['વિગત', 'રકમ'], rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`), { cls: 'diary' })}
    <div class="cashbox"><b>વેપારી ચુકવણી:</b> આજે ચૂકવેલ ${money(y.payments)} • આજના બિલમાંથી બાકી <b>${money(y.today_bills_due)}</b></div>
    <p class="note">વેપારીને ચુકવણી પરિણામમાંથી ફરી બાદ થતી નથી — ખરીદી પહેલેથી બાદ થઈ ગઈ છે. ચુકવણીથી માત્ર વેપારીની બાકી ઘટે છે.</p>`;
}

export async function daySaleDialog() {
  const d = await get(`/dashboard${qs({ date: state.date })}`);
  const y = d.diary;
  const has = y.day_sale !== null;
  return openModal({
    title: `💰 વેચાણ — ${gDate(state.date)}`,
    body: `<p class="note">દિવસના અંતે ગ્રાહકો પાસેથી મળેલ <b>કુલ રકમ</b> લખો (રોકડ + UPI બધું મળીને). શાક પ્રમાણે અલગ લખવાની જરૂર નથી.</p>
      <div class="formgrid one">${numField('આજનું કુલ વેચાણ ₹', 'amount', has ? Number(y.day_sale) : '')}
      ${field('નોંધ (વૈકલ્પિક)', 'note', { value: y.day_sale_note || '', attrs: 'maxlength="200"' })}
      ${has ? field('ફેરફારનું કારણ (રકમ બદલો તો ફરજિયાત)', 'reason', { attrs: 'maxlength="200"' }) : ''}</div>
      <div class="billtotal">ખરીદી ${money(y.net_purchases)} • ખર્ચ ${money(y.expenses)} → પરિણામ: <b data-res>—</b></div>`,
    onOpen(form) {
      const calc = () => {
        const s = Math.round(Number(String(form.amount.value).replace(/,/g, '')) || 0);
        const r = Math.round((s - Number(y.net_purchases) - Number(y.expenses)) * 100) / 100;
        const el = $('[data-res]', form); el.textContent = money(r); el.className = r < 0 ? 'red' : 'green';
      };
      form.addEventListener('input', calc); calc();
    },
    async onSubmit(form) {
      await put(`/daysale/${state.date}`, { amount: form.amount.value, note: form.note.value, reason: form.reason?.value });
      toast('આજનું વેચાણ સેવ થયું');
      return true;
    },
  });
}

// ================= PURCHASE =================
export async function purchase(root) {
  const [list, unpaid] = await Promise.all([get(`/records/purchases${qs({ date: state.date })}`), get(`/records/purchases${qs({ unpaid: 1, date: state.date, limit: 300 })}`)]);
  const total = list.reduce((a, p) => a + Number(p.total_amount), 0);
  root.innerHTML = `${head('શાકભાજી ખરીદી')}
  <div class="card noprint"><div class="actions">${btn('＋ નવી ખરીદી', 'new', 'primary', 'data-type="purchases"')}${btn('↩️ વેપારીને પરત', 'new', 'light', 'data-type="returns"')}</div>
  <p class="note">એક બિલમાં અનેક શાક ઉમેરી શકાય. રકમ = kg × દર (+ અલગ કમિશન 6% કે 7%). બિલની ચુકવણી નીચે "ચુકવો" થી કરો — બધા દિવસનાં બાકી બિલ હોમ પેજ પર દેખાય છે.</p></div>
  <div class="grid">${metric('આજની ખરીદી', money(total), 'green')}${metric('બિલ', list.length)}${metric('આજનાં બાકી બિલ', unpaid.length, 'amber')}${metric('આજનાં બાકી બિલની રકમ', money(unpaid.reduce((a, p) => a + Number(p.due_amount), 0)), 'amber')}</div>
  <div class="card"><h3 class="sectiontitle">આજનાં ખરીદી બિલ</h3>${list.length ? list.map(purchaseCard).join('') : '<div class="empty">આજે હજુ ખરીદી નથી</div>'}</div>
  <div class="card"><h3 class="sectiontitle">બાકી બિલ — ${gDate(state.date)}</h3>${billTable(unpaid, { empty: 'આ દિવસનું કોઈ બિલ બાકી નથી', date: false })}</div>`;
}
export function purchaseCard(p) {
  const pill = p.status === 'ચૂકવેલ' ? 'green' : p.status === 'આંશિક' ? 'amber' : 'red';
  return `<div class="record${p.voided_at ? ' voided' : ''}"><div class="recmain"><strong>${esc(p.trader_name)} <span class="muted">#${p.id}</span>${voidPill(p)}</strong>
    <div class="lines">${p.lines.map((l) => `<span>${esc(l.vegetable)} ${qty(l.qty, l.unit)}${l.mudda !== null && l.mudda !== undefined ? ` (${l.mudda} મુદ્દા)` : ''} × ${money(l.rate)}${l.commission_excl ? ` + ${l.commission_pct || 6}% ${money(l.commission_amount)}` : ' <small class="muted">કમિશન ભેગું</small>'} = <b>${money(l.amount)}</b></span>`).join('')}</div>
    ${p.total_mudda ? `<small>કુલ મુદ્દા: <b>${p.total_mudda}</b></small>` : ''}
    ${p.note ? `<small>${esc(p.note)}</small>` : ''} ${by(p)}</div>
    <div class="recside"><div class="balance">${money(p.total_amount)}</div><span class="pill ${pill}">${p.status}${p.status !== 'ચૂકવેલ' ? ' • બાકી ' + money(p.due_amount) : ''}</span>${recActions('purchases', p)}</div></div>`;
}

// ================= SALES & WASTE =================
export async function sales(root) {
  const [s, w, st] = await Promise.all([get(`/records/sales${qs({ date: state.date })}`), get(`/records/waste${qs({ date: state.date })}`), get(`/stock${qs({ date: state.date })}`)]);
  const tot = s.reduce((a, x) => a + Number(x.amount), 0), wv = w.reduce((a, x) => a + Number(x.est_value), 0);
  root.innerHTML = `${head('વેચાણ અને બગડેલ માલ')}
  <div class="card noprint"><div class="actions">${btn('＋ વેચાણ ઉમેરો', 'new', 'primary', 'data-type="sales"')}${btn('♻️ બગડેલ માલ નોંધો', 'new', 'secondary', 'data-type="waste"')}</div>
  <p class="note">ઉપલબ્ધ સ્ટોકથી વધુ વેચાણ સર્વર સ્વીકારતું નથી (પાછલી તારીખની એન્ટ્રી માટે પણ). બગડેલ માલ સ્ટોક ઘટાડે છે, વેચાણ/આવકમાં ગણાતો નથી.</p></div>
  <div class="grid">${metric('આજનું વેચાણ', money(tot), 'blue')}${metric('વેચાણ એન્ટ્રી', s.length)}${metric('બગડેલ માલ (અંદાજિત ₹)', money(wv), 'red')}${metric('બગડેલ એન્ટ્રી', w.length)}</div>
  <div class="card"><h3 class="sectiontitle">વેચાણ</h3>${table(['શાક', 'જથ્થો', 'દર', 'કુલ', 'છૂટ', 'ચોખ્ખું', 'ચુકવણી', 'નોંધ', ''],
    s.map((x) => `<tr${voidCls(x)}><td>${esc(x.vegetable)}${voidPill(x)}</td><td>${qty(x.qty, x.veg_unit)}</td><td>${money(x.rate)}</td><td>${money(x.gross)}</td><td>${Number(x.discount) ? money(x.discount) : '—'}</td><td><b>${money(x.amount)}</b></td><td>${esc(x.payment_mode)}</td><td>${esc([x.customer, x.note].filter(Boolean).join(' • '))} ${by(x)}</td><td>${recActions('sales', x)}</td></tr>`))}</div>
  <div class="card"><h3 class="sectiontitle">બગડેલ માલ / વેસ્ટેજ</h3>${table(['શાક', 'જથ્થો', 'અંદાજિત દર', 'અંદાજિત મૂલ્ય', 'કારણ', ''],
    w.map((x) => `<tr${voidCls(x)}><td>${esc(x.vegetable)}${voidPill(x)}</td><td>${qty(x.qty, x.veg_unit)}</td><td>${money(x.est_rate)}</td><td>${money(x.est_value)}</td><td>${esc(x.reason)} ${by(x)}</td><td>${recActions('waste', x)}</td></tr>`))}</div>
  <div class="card"><h3 class="sectiontitle">વેચાણ માટે ઉપલબ્ધ સ્ટોક (દિવસના અંતે)</h3>${table(['શાક', 'ઉપલબ્ધ'], st.rows.filter((r) => Number(r.closing) > 0).map((r) => `<tr><td>${esc(r.name)}</td><td><b>${qty(r.closing, r.unit)}</b></td></tr>`), { empty: 'સ્ટોક નથી' })}</div>`;
}

// ================= STOCK =================
export async function stock(root) {
  const [st, adj] = await Promise.all([get(`/stock${qs({ date: state.date })}`), get(`/records/adjustments${qs({ date: state.date, includeVoided: 1 })}`)]);
  root.innerHTML = `${head('દૈનિક સ્ટોક મેળવણી')}
  <div class="card noprint"><div class="actions">${btn('📦 વાસ્તવિક સ્ટોક ગણો', 'count')}${btn('± કારણ સાથે સ્ટોક સુધારો', 'new', 'light', 'data-type="adjustments"')}</div>
  <p class="note">ગણતરી સ્ટોક = શરૂઆત + ખરીદી − વેચાણ − બગાડ − પરત ± સુધારો. વાસ્તવિક ગણતરી ફક્ત તફાવત બતાવે છે; ખાતાવહી બદલતી નથી. તફાવત સુધારવા "સ્ટોક સુધારો" કારણ સાથે કરો.</p></div>
  <div class="card"><h3 class="sectiontitle">શાક પ્રમાણે સ્ટોક</h3>${table(['શાક', 'શરૂઆત', 'ખરીદી', 'વેચાણ', 'બગાડ', 'પરત', 'સુધારો', 'ગણતરી સ્ટોક', 'વાસ્તવિક', 'તફાવત'],
    st.rows.map((s) => `<tr><td><b>${esc(s.name)}</b> <small class="muted">${esc(s.unit)}</small></td><td>${num(s.opening)}</td><td>${num(s.purchased)}</td><td>${num(s.sold)}</td><td>${num(s.wasted)}</td><td>${num(s.returned)}</td><td>${num(s.adjusted)}</td><td><b>${num(s.closing)}</b></td><td>${s.physical_qty === null ? '—' : num(s.physical_qty)}</td><td class="${s.diff !== null && Number(s.diff) !== 0 ? 'red' : 'green'}">${s.diff === null ? '—' : num(s.diff)}</td></tr>`),
    { empty: 'હજુ સ્ટોક નથી' })}</div>
  <div class="card" id="closingCard"><h3 class="sectiontitle">₹ આજના વધેલા માલનું મૂલ્ય (ક્લોઝિંગ સ્ટોક)</h3>
    <p class="big">${st.closing ? `સાચવેલ: <b class="green">${money(st.closing.closing_stock_value)}</b>${st.closing.note ? ` <small>(${esc(st.closing.note)})</small>` : ''}` : '<span class="amber">હજુ દાખલ નથી — તે વગર નફો ગણાતો નથી.</span>'}</p>
    <p class="note">સૂચન (માત્ર મદદ માટે): જથ્થો × સરેરાશ ખરીદી દર = <b>${money(st.suggested_value)}</b>. ચોક્કસ મૂલ્ય તમે જાતે નક્કી કરીને લખો.</p>
    ${btn(st.closing ? '✏️ મૂલ્ય બદલો' : '₹ મૂલ્ય દાખલ કરો', 'closing')}</div>
  <div class="card"><h3 class="sectiontitle">આજના સ્ટોક સુધારા</h3>${table(['શાક', 'જથ્થો +/-', 'કારણ', 'કોણે', ''],
    adj.map((x) => `<tr${voidCls(x)}><td>${esc(x.vegetable)}${voidPill(x)}</td><td>${Number(x.qty) > 0 ? '+' : ''}${num(x.qty)} ${esc(x.veg_unit)}</td><td>${esc(x.reason)}</td><td>${by(x)} <small>${dateTime(x.created_at)}</small></td><td>${recActions('adjustments', x)}</td></tr>`))}</div>`;
}

export async function countDialog() {
  const st = await get(`/stock${qs({ date: state.date })}`);
  const rows = st.rows.filter((r) => Number(r.closing) !== 0 || r.physical_qty !== null);
  if (!rows.length) return toast('ગણવા માટે સ્ટોક નથી.', 'warn');
  return openModal({
    title: `📦 વાસ્તવિક સ્ટોક ગણતરી — ${gDate(state.date)}`, wide: true,
    body: `<p class="note">દરેક શાકનો ખરેખર હાજર જથ્થો લખો. ખાલી રાખેલ શાક સેવ થશે નહીં.</p><div class="formgrid">${rows.map((r) =>
      numField(`${esc(r.name)} • ગણતરી ${num(r.closing)} ${esc(r.unit)}`, `c_${r.vegetable_id}`, r.physical_qty === null ? '' : Number(r.physical_qty), { step: '0.001', required: false })).join('')}</div>`,
    async onSubmit(form) {
      const items = rows.map((r) => ({ vegetable_id: r.vegetable_id, physical_qty: form[`c_${r.vegetable_id}`].value })).filter((i) => i.physical_qty !== '');
      if (!items.length) throw new Error('ઓછામાં ઓછું એક શાક ગણો.');
      await post('/stock/counts', { count_date: state.date, items });
      toast('સ્ટોક ગણતરી સેવ થઈ');
    },
  });
}

export async function closingDialog() {
  const st = await get(`/stock${qs({ date: state.date })}`);
  const has = Boolean(st.closing);
  return openModal({
    title: `₹ વધેલા માલનું મૂલ્ય — ${gDate(state.date)}`,
    body: `<p class="note">દિવસના અંતે બચેલા માલનું કુલ ₹ મૂલ્ય. સૂચન: <b>${money(st.suggested_value)}</b> (જથ્થો × સરેરાશ ખરીદી દર) <button type="button" class="btn light small" data-use-hint>સૂચન વાપરો</button></p>
      <div class="formgrid one">${numField('ક્લોઝિંગ સ્ટોક મૂલ્ય ₹', 'closing_stock_value', has ? Number(st.closing.closing_stock_value) : '')}
      ${field('નોંધ', 'note', { value: st.closing?.note || '', attrs: 'maxlength="200"' })}
      ${has ? field('ફેરફારનું કારણ (મૂલ્ય બદલો તો ફરજિયાત)', 'reason', { attrs: 'maxlength="200"' }) : ''}</div>`,
    onOpen(form) { $('[data-use-hint]', form).addEventListener('click', () => { form.closing_stock_value.value = Number(st.suggested_value); }); },
    async onSubmit(form) {
      await put(`/closing/${state.date}`, { closing_stock_value: form.closing_stock_value.value, note: form.note.value, reason: form.reason?.value });
      toast('ક્લોઝિંગ મૂલ્ય સેવ થયું');
    },
  });
}

// ================= TRADERS =================
export async function traders(root) {
  const [bal, pays] = await Promise.all([get(`/traders${qs({ asOf: state.date })}`), get(`/records/payments${qs({ date: state.date })}`)]);
  const due = bal.reduce((a, b) => a + Math.max(0, Number(b.balance)), 0);
  root.innerHTML = `${head('વેપારી હિસાબ', 'તારીખ સુધીની બાકી')}
  <div class="card noprint"><div class="actions">${btn('＋ વેપારી ઉમેરો', 'trader-new')}${btn('💳 ચુકવણી', 'new', 'secondary', 'data-type="payments"')}${btn('↩️ માલ પરત', 'new', 'light', 'data-type="returns"')}${isOwner() ? btn('⚖️ ખાતા સુધારો', 'new', 'light', 'data-type="trader_adjustments"') : ''}</div>
  <p class="note">બાકી = શરૂઆતની બાકી + ખરીદી − પરત − ચુકવણી ± માલિકે મંજૂર કરેલ સુધારો. માઇનસ બાકી = વેપારીને આપેલ એડવાન્સ.</p></div>
  <div class="grid">${metric('કુલ બાકી', money(due), 'amber')}${metric('વેપારીઓ', bal.filter((b) => b.active).length)}${metric('આજની ચુકવણી', money(pays.reduce((a, p) => a + Number(p.amount), 0)), 'blue')}${metric('એડવાન્સ', money(bal.reduce((a, b) => a + Math.max(0, -Number(b.balance)), 0)), 'green')}</div>
  <div class="card"><h3 class="sectiontitle">વેપારી મુજબ ખાતું</h3>${table(['વેપારી', 'ફોન', 'શરૂઆત', 'ખરીદી', 'પરત', 'ચુકવણી', 'સુધારો', 'બાકી', ''],
    bal.map((t) => `<tr${t.active ? '' : ' class="voided"'}><td><b>${esc(t.name)}</b>${t.active ? '' : ' <span class="pill">બંધ</span>'}</td><td>${t.phone ? `<a href="tel:${esc(t.phone)}">${esc(t.phone)}</a>` : '—'}</td><td>${money(t.opening_balance)}</td><td>${money(t.purchases)}</td><td>${money(t.returns)}</td><td>${money(t.payments)}</td><td>${money(t.adjustments)}</td><td class="${Number(t.balance) > 0 ? 'amber' : 'green'}"><b>${money(t.balance)}</b></td>
      <td><div class="rowactions"><button class="btn light small" data-action="statement" data-id="${t.id}">📒 ખાતું</button>${btn('💳', 'pay', 'secondary small', `data-trader="${t.id}" title="ચુકવણી"`)}${canWrite() ? `<button class="btn ghost small" data-action="trader-edit" data-id="${t.id}">✏️</button>` : ''}</div></td></tr>`), { empty: 'હજુ કોઈ વેપારી નથી' })}</div>
  <div class="card"><h3 class="sectiontitle">આજની ચુકવણીઓ</h3>${table(['વેપારી', 'રકમ', 'બિલ', 'નોંધ', ''],
    pays.map((x) => `<tr${voidCls(x)}><td>${esc(x.trader_name)}${voidPill(x)}</td><td><b>${money(x.amount)}</b></td><td>${x.purchase_id ? '#' + x.purchase_id : '—'}</td><td>${esc(x.note || '')} ${by(x)}</td><td>${recActions('payments', x)}</td></tr>`))}</div>`;
}

export async function statementDialog(id) {
  const s = await get(`/traders/${id}/statement`);
  const body = `<div class="printable"><p>${s.trader.phone ? 'ફોન: ' + esc(s.trader.phone) + ' • ' : ''}શરૂઆતની બાકી: <b>${money(s.trader.opening_balance)}</b></p>
    ${table(['તારીખ', 'વિગત', '', 'ઉધાર (ખરીદી)', 'જમા (ચુકવણી/પરત)', 'બાકી'],
      s.rows.map((r) => `<tr><td>${gDate(r.d)}</td><td>${esc(r.kind)}</td><td><small>${esc(r.detail || '')}</small></td><td>${Number(r.debit) ? money(r.debit) : ''}</td><td>${Number(r.credit) ? money(r.credit) : ''}</td><td><b>${money(r.balance)}</b></td></tr>`))}
    <p class="balance">હાલની બાકી: ${money(s.closing)}</p></div>
    <div class="actions noprint"><button type="button" class="btn light" data-print-statement>🖨️ ખાતું પ્રિન્ટ કરો</button></div>`;
  const p = openModal({ title: `📒 ${esc(s.trader.name)} — ખાતાવહી`, body, readOnly: true, wide: true,
    onOpen(form) { $('[data-print-statement]', form).addEventListener('click', () => { document.body.classList.add('print-modal'); window.print(); document.body.classList.remove('print-modal'); }); } });
  return p;
}

export async function traderDialog(t = null) {
  return openModal({
    title: t ? `વેપારી સુધારો — ${esc(t.name)}` : '＋ નવો વેપારી',
    body: `<div class="formgrid">${field('વેપારીનું નામ', 'name', { value: t?.name || '', attrs: 'required maxlength="80" autocomplete="off"' })}
      ${field('ફોન (વૈકલ્પિક)', 'phone', { type: 'tel', value: t?.phone || '', attrs: 'maxlength="16"' })}
      ${isOwner() ? numField('શરૂઆતની બાકી ₹ (માઇનસ = એડવાન્સ)', 'opening_balance', t ? Number(t.opening_balance) : '', { required: false, min: null }) : ''}
      ${field('નોંધ', 'note', { value: t?.note || '', attrs: 'maxlength="200"' })}
      ${t && isOwner() ? selectField('સ્થિતિ', 'active', [{ value: 'true', label: 'ચાલુ' }, { value: 'false', label: 'બંધ (યાદીમાં નહીં દેખાય)' }], String(t.active)) : ''}
      ${t && isOwner() ? field('કારણ (શરૂઆતની બાકી બદલો તો ફરજિયાત)', 'reason', { attrs: 'maxlength="200"' }) : ''}</div>`,
    async onSubmit(form) {
      const d = Object.fromEntries([...form.elements].filter((e) => e.name).map((e) => [e.name, e.value.trim()]));
      const body = { name: d.name, phone: d.phone, note: d.note };
      if ('opening_balance' in d) body.opening_balance = d.opening_balance || '0';
      if ('active' in d) body.active = d.active === 'true';
      if (d.reason) body.reason = d.reason;
      const out = t ? await patch(`/traders/${t.id}`, body) : await post('/traders', body);
      toast('વેપારી સેવ થયો');
      return out;
    },
  });
}

// ================= EXPENSES =================
export async function expenses(root) {
  const list = await get(`/records/expenses${qs({ date: state.date, includeVoided: 1 })}`);
  const active = list.filter((x) => !x.voided_at);
  const byCat = {};
  for (const x of active) byCat[x.category] = (byCat[x.category] || 0) + Number(x.amount);
  root.innerHTML = `${head('દૈનિક ખર્ચ')}
  <div class="card noprint">${btn('＋ ખર્ચ ઉમેરો', 'new', 'primary', 'data-type="expenses"')}<p class="note">વેપારીને ચુકવણી અહીં નહીં — તે "વેપારી" ખાતામાં નોંધો. ખરીદી સાથેનો ટ્રાન્સપોર્ટ ખર્ચ અહીં આપમેળે દેખાય છે.</p></div>
  <div class="grid">${metric('આજનો કુલ ખર્ચ', money(active.reduce((a, x) => a + Number(x.amount), 0)), 'red')}${Object.entries(byCat).slice(0, 3).map(([k, v]) => metric(esc(k), money(v))).join('')}</div>
  <div class="card">${table(['પ્રકાર', 'રકમ', 'નોંધ', 'કોણે', ''], list.map((x) => `<tr${voidCls(x)}><td>${esc(x.category)}${voidPill(x)}</td><td><b>${money(x.amount)}</b></td><td>${esc(x.note || '')}${x.purchase_id ? ` <span class="pill">ખરીદી #${x.purchase_id}</span>` : ''}</td><td>${by(x)}</td><td>${recActions('expenses', x)}</td></tr>`))}</div>`;
}

// ================= MARKET =================
export async function market(root) {
  const list = await get(`/records/market${qs({ date: state.date })}`);
  const vegs = state.meta.vegetables;
  root.innerHTML = `${head('ગુજરાત બજાર ભાવ')}
  <div class="card noprint">${btn('＋ બજાર ભાવ ઉમેરો', 'new', 'primary', 'data-type="market"')}<p class="note">ભાવનગર, નડિયાદ, અમદાવાદ, ગોંડલ, મહુવા, રાજકોટ, સુરત અથવા અન્ય બજાર. સરખામણી ફક્ત તમે સાચવેલા ભાવ પરથી થાય છે; આગાહી નથી.</p></div>
  <div class="card"><h3 class="sectiontitle">⭐ મુખ્ય શાક માટે જાણીતાં મોટાં બજારો</h3>
    ${table(['શાક', 'ગુજરાત', 'ભારત'], allReference().map((r) => `<tr><td><b>${esc(r.names[0])}</b></td><td>${r.gujarat.map(esc).join(', ')}</td><td>${r.india.map(esc).join(', ')}</td></tr>`))}
    <p class="note">આ માત્ર બજારોની સંદર્ભ યાદી છે, ભાવ નથી. આજનો સરકારી ભાવ જોવા: <a href="${AGMARKNET_URL}" target="_blank" rel="noopener">Agmarknet (ભારત સરકાર) ↗</a> — ત્યાં જોયેલો ભાવ અહીં "બજાર ભાવ ઉમેરો" થી સ્રોત "Agmarknet" લખીને નોંધો.</p></div>
  <div class="card"><h3 class="sectiontitle">આજે નોંધેલા ભાવ</h3>${table(['બજાર', 'શાક', 'ભાવ', 'ગ્રેડ', 'સ્રોત', ''], list.map((x) => `<tr><td>${esc(x.market)}</td><td>${esc(x.vegetable)}</td><td><b>${money(x.price)}</b>/${esc(x.unit)}</td><td>${esc(x.grade || '')}</td><td>${esc(x.source || '')} ${by(x)}</td><td>${recActions('market', x)}</td></tr>`))}</div>
  <div class="card"><h3 class="sectiontitle">એક શાકની બજાર સરખામણી અને ઋતુ પ્રમાણે ભાવ</h3>
    <div class="formgrid noprint">${selectField('શાક', 'mveg', [{ value: '', label: '— પસંદ કરો —' }, ...vegs.map((v) => ({ value: v.id, label: v.name }))], '')}
      ${field('તારીખથી', 'mfrom', { type: 'date' })}${field('તારીખ સુધી', 'mto', { type: 'date' })}</div>
    <button class="btn secondary noprint" data-action="market-analyse">સરખામણી બતાવો</button><div id="marketOut"></div></div>`;
}

export async function marketAnalyse() {
  const v = $('#f_mveg').value;
  if (!v) return toast('શાક પસંદ કરો', 'warn');
  const a = await get(`/market/analysis${qs({ vegetable_id: v, from: $('#f_mfrom').value, to: $('#f_mto').value })}`);
  const months = ['', 'જાન્યુ', 'ફેબ્રુ', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટે', 'ઑક્ટો', 'નવે', 'ડિસે'];
  const vname = state.meta.vegetables.find((x) => String(x.id) === String(v))?.name;
  const fm = famousMarkets(vname);
  $('#marketOut').innerHTML = `${fm ? `<div class="alert success">⭐ ${esc(vname)} માટે મોટાં બજારો — ગુજરાત: <b>${fm.gujarat.map(esc).join(', ')}</b> • ભારત: <b>${fm.india.map(esc).join(', ')}</b></div>` : ''}<h4>બજાર પ્રમાણે (સૌથી સસ્તું ઉપર)</h4>${table(['બજાર', 'સરેરાશ', 'ઓછામાં ઓછો', 'વધુમાં વધુ', 'છેલ્લો ભાવ', 'નોંધ સંખ્યા'],
      a.byMarket.map((r) => `<tr><td>${esc(r.market)}</td><td><b>${money(r.avg)}</b>/${esc(r.unit)}</td><td>${money(r.min)}</td><td>${money(r.max)}</td><td>${money(r.last_price)} <small>(${gDate(r.last_date)})</small></td><td>${r.n} <span class="pill ${r.n < 3 ? 'amber' : ''}">${esc(r.confidence)}</span></td></tr>`), { empty: 'આ શાકના ભાવ હજુ નોંધાયા નથી' })}
    <h4>મહિના પ્રમાણે વલણ</h4>${table(['મહિનો', 'બજાર', 'સરેરાશ', 'નોંધ'], a.monthly.map((r) => `<tr><td>${esc(r.month)}</td><td>${esc(r.market)}</td><td>${money(r.avg)}</td><td>${r.n}</td></tr>`), { empty: '—' })}
    <h4>ઋતુ પ્રમાણે (બધાં વર્ષ)</h4>${table(['મહિનો', 'સરેરાશ', 'ઓછામાં ઓછો', 'વધુમાં વધુ', 'નોંધ', 'વર્ષ', ''], a.seasonal.map((r) => `<tr><td>${months[r.month]}</td><td>${money(r.avg)}</td><td>${money(r.min)}</td><td>${money(r.max)}</td><td>${r.n}</td><td>${r.years}</td><td><span class="pill ${r.confidence === 'ઓછો ડેટા' ? 'amber' : 'green'}">${esc(r.confidence)}</span></td></tr>`), { empty: '—' })}
    <p class="note">${esc(a.note)}</p>`;
}

// ================= PLAN =================
export async function plan(root) {
  const list = await get(`/records/plans${qs({ from: state.date })}`);
  root.innerHTML = `${head('આવતીકાલનું આયોજન')}
  <div class="card noprint">${btn('＋ આયોજન ઉમેરો', 'new', 'primary', 'data-type="plans"')}<p class="note">આવતીકાલે શું, કેટલું અને કયા ભાવે ખરીદવું — તેની નોંધ. આ હિસાબમાં ગણાતું નથી.</p></div>
  <div class="card">${table(['તારીખ', 'શાક', 'લક્ષ્ય જથ્થો', 'લક્ષ્ય ભાવ', 'નોંધ', ''], list.slice().reverse().map((x) => `<tr><td>${gDate(x.plan_date)}</td><td>${esc(x.vegetable)}</td><td>${x.qty ? qty(x.qty, x.veg_unit) : '—'}</td><td>${x.rate ? money(x.rate) : '—'}</td><td>${esc(x.note || '')}</td><td>${recActions('plans', x)}</td></tr>`), { empty: 'આગળનું કોઈ આયોજન નથી' })}</div>`;
}

export async function auditDialog(type, id) {
  const rows = await get(`/records/${type}/${id}/audit`);
  const LABEL = { create: 'બનાવ્યું', update: 'ફેરફાર', void: 'રદ', import: 'ઇમ્પોર્ટ' };
  const diff = (b, a) => {
    if (!b || !a) return '';
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]));
    return keys.map((k) => `<div><code>${esc(k)}</code>: <s>${esc(typeof b[k] === 'object' ? JSON.stringify(b[k]) : b[k])}</s> → <b>${esc(typeof a[k] === 'object' ? JSON.stringify(a[k]) : a[k])}</b></div>`).join('');
  };
  return showAudit(`🕘 ${esc(TYPE_LABEL[type] || type)} #${id} — ફેરફારનો ઇતિહાસ`,
    table(['સમય', 'કોણે', 'શું', 'કારણ', 'ફેરફાર'], rows.map((r) => `<tr><td>${dateTime(r.at)}</td><td>${esc(r.user_name || '')}</td><td>${LABEL[r.action] || esc(r.action)}</td><td>${esc(r.reason || '')}</td><td class="small">${diff(r.before, r.after)}</td></tr>`)));
}
function showAudit(title, body) { return openModal({ title, body, readOnly: true, wide: true }); }

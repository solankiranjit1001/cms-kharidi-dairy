// v11: 🔮 વિશ્લેષણ — rates & quantities by month from our own purchases, next months' plan and "buy ahead" tips.
import { $, esc, money, num, gDate, metric, table } from './ui.js';
import { get } from './api.js';

const TABS = [
  { key: 'plan', label: '📅 આવતા મહિના' },
  { key: 'ahead', label: '💡 અગાઉથી ખરીદી' },
  { key: 'days', label: '🗓️ આવતા 30 દિવસ' },
  { key: 'veg', label: '🥬 શાક પ્રમાણે' },
  { key: 'cal', label: '📆 12 મહિના' },
];
const DOW = ['', 'સોમ', 'મંગળ', 'બુધ', 'ગુરુ', 'શુક્ર', 'શનિ', 'રવિ'];
const MONTHS = ['', 'જાન્યુઆરી', 'ફેબ્રુઆરી', 'માર્ચ', 'એપ્રિલ', 'મે', 'જૂન', 'જુલાઈ', 'ઑગસ્ટ', 'સપ્ટેમ્બર', 'ઑક્ટોબર', 'નવેમ્બર', 'ડિસેમ્બર'];
let tab = 'plan';
let vegId = null;
let data = null;

const u = (unit) => esc(unit || 'kg');
const rate = (r, unit) => `${money(r)}<small>/${u(unit)}</small>`;
const ymLabel = (s) => { const [y, m] = s.split('-'); return `${MONTHS[Number(m)]} ${y}`; };
const trust = (x) => `<span class="pill ${x.level >= 3 ? 'green' : x.level === 2 ? '' : 'amber'}">${esc(x.label)}</span>`;
const bar = (v, max, cls = '') => `<div class="anbar ${cls}"><span style="width:${max > 0 ? Math.max(2, Math.round((v / max) * 100)) : 0}%"></span></div>`;

export async function analysisPage(root) {
  data = await get('/analysis');
  draw(root);
}

/** Draw from the data already loaded (switching tab or vegetable needs no server trip). */
function draw(root) {
  const d = data;
  if (!vegId || !d.vegetables.some((v) => v.id === vegId)) vegId = d.vegetables[0]?.id || null;
  const intro = !d.vegetables.length
    ? '<div class="alert">હજુ કોઈ ખરીદી નોંધાઈ નથી. ખરીદી નોંધશો તેમ અહીં ભાવ અને જથ્થાનું વિશ્લેષણ દેખાશે.</div>'
    : !d.has_last_year
      ? `<div class="alert">ℹ️ ખરીદીનો ડેટા <b>${ymLabel(d.first_month)}</b> થી છે (${d.months_with_data} મહિના). આવતા વર્ષની સાચી આગાહી માટે ગયા વર્ષના એ જ મહિનાનો ડેટા જોઈએ —
         જેમ જેમ ખરીદી નોંધાશે તેમ આ પાનું આપોઆપ વધુ સચોટ બનશે. ત્યાં સુધી "🥬 શાક પ્રમાણે" માં મહિના પ્રમાણે ભાવ અને જથ્થો જુઓ.</div>`
      : '';
  root.innerHTML = `<div class="pagehead"><div><h2>🔮 વિશ્લેષણ — આગળનું આયોજન</h2>
      <div class="sub">આપણી પોતાની ખરીદી પરથી: કયા મહિને ભાવ ઓછો/વધુ, કેટલો માલ જોઈશે, ક્યારે અગાઉથી ખરીદવું</div></div>
    <div class="actions noprint"><button class="btn light" data-action="print">🖨️ પ્રિન્ટ</button></div></div>
  ${intro}
  <div class="card noprint"><div class="periodbtns">${TABS.map((t) => `<button class="btn ${t.key === tab ? 'primary' : 'light'} small" data-action="an-tab" data-tab="${t.key}">${t.label}</button>`).join('')}</div></div>
  ${d.vegetables.length ? SECTIONS[tab](d) : ''}
  <p class="note">${esc(d.note)}</p>`;
}

// ---------- 📅 coming months ----------
function planTab(d) {
  const groups = [];
  for (const f of d.forecast) {
    let g = groups[groups.length - 1];
    if (!g || g.m !== f.m || g.y !== f.y) { g = { y: f.y, m: f.m, month: f.month, list: [] }; groups.push(g); }
    g.list.push(f);
  }
  if (!groups.length) {
    return `<div class="card"><h3 class="sectiontitle">📅 આવતા મહિનાનું આયોજન</h3><div class="empty">આ મહિના અને આવતા 3 મહિના માટે અગાઉના વર્ષોનો ડેટા હજુ નથી.
      ગયા વર્ષના આ મહિનાઓની ખરીદી નોંધાયેલી હોય તો જ અંદાજ બને છે.</div></div>`;
  }
  return groups.map((g) => {
    const total = g.list.reduce((a, x) => a + x.est_amount, 0);
    return `<div class="card"><h3 class="sectiontitle">📅 ${esc(g.month)} ${g.y} — કેટલું ખરીદવું <small class="muted">અંદાજિત ખર્ચ ${money(total)}</small></h3>
    ${table(['શાક', 'ખરીદવાનો અંદાજ', 'અગાઉના વર્ષે', 'ભાવ (અગાઉ)', 'ઋતુ', 'ભરોસો'], g.list.map((f) => `<tr>
      <td><b>${esc(f.name)}</b></td>
      <td><b>${num(f.plan_qty)} ${u(f.unit)}</b>${f.bought_so_far !== null ? `<br><small class="muted">આ મહિને અત્યાર સુધી ${num(f.bought_so_far)} ${u(f.unit)}</small>` : ''}</td>
      <td>${num(f.past_avg_qty)} ${u(f.unit)}${f.growth !== null && f.growth !== 1 ? `<br><small class="${f.growth > 1 ? 'green' : 'red'}">ધંધો ${f.growth > 1 ? '↑' : '↓'} ${Math.round(Math.abs(f.growth - 1) * 100)}%</small>` : ''}</td>
      <td>${rate(f.rate, f.unit)}${f.low_rate !== f.high_rate ? `<br><small class="muted">${money(f.low_rate)} – ${money(f.high_rate)}</small>` : ''}</td>
      <td>${f.season === 'cheap' ? '<span class="pill green">સૌથી સસ્તો મહિનો</span>' : f.season === 'costly' ? '<span class="pill red">સૌથી મોંઘો મહિનો</span>' : '—'}</td>
      <td>${trust(f)}</td></tr>`))}</div>`;
  }).join('') + `<p class="note">"ખરીદવાનો અંદાજ" = અગાઉના વર્ષોમાં આ મહિને ખરીદેલ સરેરાશ જથ્થો × છેલ્લા 6 મહિનામાં ધંધો કેટલો વધ્યો/ઘટ્યો (ગયા વર્ષની સરખામણીમાં).</p>`;
}

// ---------- 💡 buy ahead ----------
function aheadTab(d) {
  if (!d.buy_ahead.length) {
    return `<div class="card"><h3 class="sectiontitle">💡 અગાઉથી ખરીદી</h3><div class="empty">હજુ કોઈ શાકમાં મોટો ભાવ ફરક દેખાયો નથી.
      ઓછામાં ઓછા 3 અલગ મહિનાનો ડેટા અને સસ્તા-મોંઘા મહિના વચ્ચે 10% થી વધુ ફરક હોય ત્યારે અહીં સલાહ આવશે.</div></div>`;
  }
  return `<div class="card"><h3 class="sectiontitle">💡 મોંઘી ઋતુ પહેલાં ક્યારે ખરીદવું</h3>
    ${d.buy_ahead.map((b) => `<div class="antip ${b.buy_now ? 'now' : ''}">
      <div><b>${esc(b.name)}</b> ${b.storable ? '<span class="pill green">સંગ્રહ થઈ શકે</span>' : '<span class="pill amber">જલ્દી બગડે</span>'} ${trust(b)}
        ${b.buy_now ? '<span class="pill red">⏰ ખરીદીનો સમય હમણાં</span>' : b.buy_soon ? '<span class="pill amber">આવતા મહિને ખરીદી</span>' : ''}</div>
      <div>🔴 <b>${esc(b.peak_month_name)}</b> માં ભાવ સૌથી વધુ: ${rate(b.peak_rate, b.unit)} • 🟢 તેના પહેલાં <b>${esc(b.buy_month_name)}</b> માં: ${rate(b.buy_rate, b.unit)}</div>
      <div>${b.storable ? 'બચત' : 'ભાવ ફરક'}: <b class="green">${money(b.saving_per_unit)}/${u(b.unit)} (${b.saving_pct}%)</b>${b.storable && b.peak_qty ? ` • ${esc(b.peak_month_name)} માં સામાન્ય રીતે ${num(b.peak_qty)} ${u(b.unit)} લઈએ છીએ → અંદાજિત બચત <b class="green">${money(b.est_saving)}</b>` : ''}</div>
      <div class="muted small">${b.storable
        ? `સલાહ: ${esc(b.buy_month_name)} માં ${esc(b.peak_month_name)} ની જરૂર જેટલો માલ વધારે ખરીદી સંગ્રહ કરો. સંગ્રહમાં ઘટ/બગાડ અને ભાડું ગણીને નક્કી કરો.`
        : `આ શાક લાંબું ટકતું નથી — ${esc(b.peak_month_name)} માં જરૂર પૂરતું જ ખરીદો અથવા વેપારી સાથે અગાઉથી ભાવ નક્કી કરો.`}
        ${b.cheapest_month_name !== b.buy_month_name ? ` આખા વર્ષમાં સૌથી સસ્તું: ${esc(b.cheapest_month_name)} (${money(b.cheapest_rate)}).` : ''}</div>
    </div>`).join('')}</div>`;
}

// ---------- 🗓️ same dates in earlier years ----------
function daysTab(d) {
  const from = gDate(addDaysLocal(d.today, 1)), to = gDate(addDaysLocal(d.today, 30));
  if (!d.next30.length) {
    return `<div class="card"><h3 class="sectiontitle">🗓️ આવતા 30 દિવસ (${from} – ${to})</h3><div class="empty">અગાઉના વર્ષોમાં આ જ તારીખોમાં કોઈ ખરીદી નોંધાયેલી નથી.</div></div>`;
  }
  return `<div class="card"><h3 class="sectiontitle">🗓️ આવતા 30 દિવસ (${from} – ${to}) — અગાઉના વર્ષે આ જ દિવસોમાં</h3>
    ${table(['શાક', 'કુલ જથ્થો (સરેરાશ/વર્ષ)', 'ભાવ', 'કઈ તારીખે કેટલું'], d.next30.map((x) => `<tr><td><b>${esc(x.name)}</b><br><small class="muted">${x.years} વર્ષનો ડેટા</small></td>
      <td><b>${num(x.avg_qty)} ${u(x.unit)}</b><br><small class="muted">${x.buy_days} વાર ખરીદી</small></td><td>${rate(x.rate, x.unit)}</td>
      <td class="small">${x.days.map((y) => `${gDate(y.d)}: ${num(y.qty)} @ ${money(y.rate)}`).join('<br>')}</td></tr>`))}</div>`;
}
function addDaysLocal(d, n) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

// ---------- 🥬 one vegetable ----------
function vegTab(d) {
  const v = d.vegetables.find((x) => x.id === vegId) || d.vegetables[0];
  const moy = v.month_of_year;
  const maxRate = Math.max(0, ...moy.filter((x) => x.years).map((x) => x.rate));
  const maxQty = Math.max(0, ...moy.filter((x) => x.years).map((x) => x.avg_qty));
  const maxWd = Math.max(0, ...v.weekday.map((x) => x.qty));
  return `<div class="card noprint"><div class="field"><label for="anVeg">શાક પસંદ કરો</label>
    <select id="anVeg" data-an-veg>${d.vegetables.map((x) => `<option value="${x.id}" ${x.id === v.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div></div>
  <div class="grid">
    ${metric('છેલ્લા 12 મહિનાની ખરીદી', `${num(v.last12_qty)} ${u(v.unit)}`, 'blue', money(v.last12_amount))}
    ${metric('સરેરાશ ભાવ (બધો સમય)', money(v.avg_rate), '', `પ્રતિ ${u(v.unit)}, કમિશન સહિત`)}
    ${metric('સૌથી સસ્તો મહિનો', v.cheapest ? esc(v.cheapest.name) : '—', 'green', v.cheapest ? `${money(v.cheapest.rate)}/${u(v.unit)}` : '3 મહિનાનો ડેટા જોઈએ')}
    ${metric('સૌથી મોંઘો મહિનો', v.costliest ? esc(v.costliest.name) : '—', 'red', v.costliest ? `${money(v.costliest.rate)}/${u(v.unit)}` : '3 મહિનાનો ડેટા જોઈએ')}
  </div>
  ${v.yoy || (v.growth && v.growth.ratio !== 1) ? `<div class="card">${v.yoy ? `<div>આ મહિને ભાવ ${rate(v.yoy.now, v.unit)} — ગયા વર્ષે આ મહિને ${rate(v.yoy.last_year, v.unit)} → <b class="${v.yoy.pct > 0 ? 'red' : 'green'}">${v.yoy.pct > 0 ? '+' : ''}${v.yoy.pct}%</b></div>` : ''}
    ${v.growth && v.growth.ratio !== 1 ? `<div>છેલ્લા ${v.growth.months} મહિનામાં ખરીદી ગયા વર્ષ કરતાં <b class="${v.growth.ratio >= 1 ? 'green' : 'red'}">${v.growth.ratio >= 1 ? '↑' : '↓'} ${Math.round(Math.abs(v.growth.ratio - 1) * 100)}%</b></div>` : ''}</div>` : ''}
  <div class="card"><h3 class="sectiontitle">વર્ષના મહિના પ્રમાણે — ભાવ અને જથ્થો (બધાં વર્ષ ભેગાં)</h3>
    ${table(['મહિનો', 'સરેરાશ ભાવ', '', 'જથ્થો / વર્ષ', '', 'બિલમાં ભાવ', 'વર્ષ'], moy.filter((x) => x.years).map((x) => `<tr>
      <td><b>${MONTHS[x.m]}</b></td><td>${rate(x.rate, v.unit)}</td><td class="anbarcell">${bar(x.rate, maxRate, v.cheapest?.m === x.m ? 'green' : v.costliest?.m === x.m ? 'red' : '')}</td>
      <td>${num(x.avg_qty)} ${u(v.unit)}</td><td class="anbarcell">${bar(x.avg_qty, maxQty, 'blue')}</td>
      <td class="small">${money(x.min_bill_rate)} – ${money(x.max_bill_rate)}</td><td>${x.years}</td></tr>`), { empty: 'હજુ પૂરો થયેલ કોઈ મહિનો નથી' })}
    <p class="note">ચાલુ મહિનો અધૂરો હોવાથી આ સરખામણીમાં ગણાતો નથી. "બિલમાં ભાવ" = કમિશન વગરનો ઓછામાં ઓછો – વધુમાં વધુ દર.</p></div>
  <div class="card"><h3 class="sectiontitle">મહિના પ્રમાણે ઇતિહાસ</h3>
    ${table(['મહિનો', 'ખરીદી', 'પરત', 'ભાવ', 'બિલમાં દર', 'રકમ', 'બિલ / દિવસ'], v.months.map((x) => `<tr><td>${ymLabel(x.ym)}</td><td><b>${num(x.qty)} ${u(v.unit)}</b></td>
      <td>${x.returned ? num(x.returned) : '—'}</td><td>${rate(x.rate, v.unit)}</td><td class="small">${money(x.min_rate)} – ${money(x.max_rate)}</td><td>${money(x.amount)}</td><td>${x.bills} / ${x.days}</td></tr>`))}</div>
  <div class="grid two">
    <div class="card"><h3 class="sectiontitle">વેપારી પ્રમાણે ભાવ (છેલ્લા 12 મહિના, સસ્તો ઉપર)</h3>
      ${table(['વેપારી', 'ભાવ', 'જથ્થો', 'બિલ'], v.traders.map((t, i) => `<tr><td>${i === 0 && v.traders.length > 1 ? '⭐ ' : ''}${esc(t.trader)}</td><td><b>${rate(t.rate, v.unit)}</b></td><td>${num(t.qty)}</td><td>${t.bills}</td></tr>`), { empty: 'છેલ્લા 12 મહિનામાં ખરીદી નથી' })}
      <p class="note">ભાવ સાથે માલની ગુણવત્તા પણ જુઓ — સૌથી સસ્તો હંમેશાં સૌથી સારો નથી.</p></div>
    <div class="card"><h3 class="sectiontitle">વાર પ્રમાણે ખરીદી (છેલ્લા 12 મહિના)</h3>
      ${table(['વાર', 'કુલ જથ્થો', '', 'એક દિવસે સરેરાશ'], v.weekday.sort((a, b) => a.dow - b.dow).map((w) => `<tr><td>${DOW[w.dow]}</td><td>${num(w.qty)}</td><td class="anbarcell">${bar(w.qty, maxWd, 'blue')}</td><td>${num(w.avg_qty)} ${u(v.unit)}</td></tr>`), { empty: '—' })}</div>
  </div>`;
}

// ---------- 📆 12-month calendar ----------
function calTab(d) {
  const cur = d.current_month;
  const order = [...Array(12)].map((_, i) => ((cur - 1 + i) % 12) + 1); // start from this month
  return `<div class="card"><h3 class="sectiontitle">📆 વર્ષનું ખરીદી કેલેન્ડર (આ મહિનાથી શરૂ)</h3>
    ${order.map((m) => d.calendar[m - 1]).map((c) => `<div class="ancal"><div class="ancalhead"><b>${esc(c.month)}</b>${c.items.length ? `<span class="muted">અંદાજ ${money(c.est_amount)}</span>` : ''}</div>
      ${c.items.length ? `<div class="small">${c.items.map((x) => `${esc(x.name)} <b>${num(x.avg_qty)} ${u(x.unit)}</b> @ ${money(x.rate)}`).join(' • ')}</div>` : '<div class="muted small">ડેટા નથી</div>'}</div>`).join('')}
    <p class="note">દરેક મહિને સામાન્ય રીતે કેટલો માલ અને કયા ભાવે ખરીદ્યો (અગાઉનાં બધાં વર્ષની સરેરાશ).</p></div>`;
}

const SECTIONS = { plan: planTab, ahead: aheadTab, days: daysTab, veg: vegTab, cal: calTab };

export const analysisActions = {
  'an-tab': (el) => { tab = el.dataset.tab; if (data) draw($('#app')); },
};

// vegetable dropdown (a change, not a click)
document.addEventListener('change', (e) => {
  if (!e.target.matches('[data-an-veg]') || !data) return;
  vegId = Number(e.target.value);
  const y = window.scrollY;
  draw($('#app'));
  window.scrollTo(0, y);
});

// App shell: login, navigation, shared work date, and click-action routing.
import { $, $$, esc, field, toast, askReason, addDays, gDate } from './ui.js';
import { get, post, del, ApiError } from './api.js';
import { state, reloadMeta, ROLE_LABEL } from './state.js';
import { FORMS } from './forms.js';
import * as P from './pages.js';
import { reports, showReport } from './reports.js';
import * as S from './settings.js';

const PAGES = {
  home: { label: '🏠 હોમ', render: P.home },
  purchase: { label: '🧺 ખરીદી', render: P.purchase },
  traders: { label: '📒 વેપારી', render: P.traders },
  expenses: { label: '💸 ખર્ચ', render: P.expenses },
  reports: { label: '🖨️ રિપોર્ટ', render: reports },
  market: { label: '📊 બજાર', render: P.market },
  plan: { label: '🌅 આવતીકાલ', render: P.plan },
  settings: { label: '⚙️ સેટિંગ્સ', render: S.settings },
};

// ---------- rendering ----------
async function render() {
  const root = $('#app');
  const page = PAGES[state.page] ? state.page : 'home';
  $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  try {
    await PAGES[page].render(root);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return;
    root.innerHTML = `<div class="alert">⚠️ ${esc(e.message || 'માહિતી લાવી શકાઈ નહીં.')}<br><button class="btn light small" data-action="reload">ફરી પ્રયાસ કરો</button></div>`;
  }
}

function go(page) {
  state.page = PAGES[page] ? page : 'home';
  if (location.hash !== '#' + state.page) history.replaceState(null, '', '#' + state.page);
  render();
  window.scrollTo(0, 0);
}

function shell(show) {
  for (const el of $$('.needauth')) el.hidden = !show;
}

function renderNav() {
  $('#nav').innerHTML = Object.entries(PAGES).map(([k, p]) => `<button data-page="${k}">${p.label}</button>`).join('');
  $('#userChip').textContent = `${state.user.name} • ${ROLE_LABEL[state.user.role]}`;
}

// ---------- login / first setup ----------
async function showLogin() {
  shell(false);
  let status = { needsSetup: false, setupEnabled: false };
  try { status = await get('/auth/status'); } catch (e) { $('#app').innerHTML = `<div class="alert">${esc(e.message)}</div>`; return; }
  if (status.user) return start();
  const setup = status.needsSetup;
  $('#app').innerHTML = `<div class="logincard card">
    <h2>${setup ? 'પ્રથમ સેટઅપ — માલિકનું ખાતું' : '🔐 લોગિન'}</h2>
    ${setup && !status.setupEnabled ? '<div class="alert">સર્વર પર સેટઅપ કોડ (SETUP_CODE) સેટ કરેલ નથી. ડેવલપરનો સંપર્ક કરો.</div>' : ''}
    <form id="loginForm" class="formgrid one" novalidate>
      ${setup ? field('સેટઅપ કોડ (ડેવલપરે આપેલ)', 'setupCode', { type: 'password', attrs: 'required autocomplete="off"' }) + field('તમારું નામ', 'name', { attrs: 'required maxlength="60"' }) : ''}
      ${field('મોબાઇલ નંબર', 'mobile', { type: 'tel', attrs: 'required inputmode="numeric" autocomplete="username" maxlength="13"' })}
      ${field(setup ? 'નવો PIN (4–6 અંક)' : 'PIN', 'pin', { type: 'password', attrs: 'required inputmode="numeric" autocomplete="current-password" maxlength="6" minlength="4"' })}
      <div class="formerror" role="alert" hidden></div>
      <button class="btn primary big" type="submit">${setup ? 'ખાતું બનાવો' : 'લોગિન કરો'}</button>
    </form>
    <p class="note">PIN ભૂલી ગયા? માલિકને "સેટિંગ્સ → પરિવારના સભ્યો" માંથી PIN રીસેટ કરવા કહો. 5 ખોટા પ્રયાસ પછી 15 મિનિટ લૉક થાય છે.</p></div>`;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, err = $('.formerror', f), b = $('button[type=submit]', f);
    err.hidden = true; b.disabled = true;
    try {
      const body = { mobile: f.mobile.value, pin: f.pin.value };
      if (setup) Object.assign(body, { setupCode: f.setupCode.value, name: f.name.value });
      await post(setup ? '/auth/setup' : '/auth/login', body);
      await start();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; } finally { b.disabled = false; }
  });
}

async function start() {
  try { await reloadMeta(); } catch (e) { if (e.status === 401) return showLogin(); throw e; }
  state.date = state.date || state.meta.today;
  $('#workDate').value = state.date;
  $('#workDate').max = state.meta.today;
  renderNav();
  shell(true);
  go((location.hash || '#home').slice(1));
}

// ---------- actions ----------
async function reloadAfter(promise) {
  const r = await promise;
  if (r) await render();
  return r;
}

const ACTIONS = {
  go: (el) => go(el.dataset.page),
  reload: () => render(),
  print: () => window.print(),
  new: (el) => reloadAfter(FORMS[el.dataset.type]()),
  pay: (el) => reloadAfter(FORMS.payments(null, Number(el.dataset.trader), el.dataset.bill ? Number(el.dataset.bill) : null)),
  async edit(el) {
    const { type, id } = el.dataset;
    const rec = await get(`/records/${type}/${id}`);
    return reloadAfter(FORMS[type](rec));
  },
  async void(el) {
    const { type, id } = el.dataset;
    const extra = type === 'purchases' ? ' (આ બિલ સાથે જોડાયેલ ચુકવણી/ખર્ચ અલગથી રદ કરવા પડશે)' : '';
    const reason = await askReason(`એન્ટ્રી #${id} રદ કરો?${extra}`, 'રદ કરવાનું કારણ (ફરજિયાત)');
    if (!reason) return;
    try { await del(`/records/${type}/${id}`, { reason }); toast('એન્ટ્રી રદ થઈ — હિસાબ ફરી ગણાયો'); await render(); } catch (e) { toast(e.message, 'err'); }
  },
  audit: (el) => P.auditDialog(el.dataset.type, el.dataset.id),
  count: () => reloadAfter(P.countDialog()),
  closing: () => reloadAfter(P.closingDialog()),
  daysale: () => reloadAfter(P.daySaleDialog()),
  period: (el) => P.periodResult(el),
  statement: (el) => P.statementDialog(el.dataset.id),
  'trader-new': () => reloadAfter(P.traderDialog().then(async (r) => { if (r) await reloadMeta(); return r; })),
  async 'trader-edit'(el) {
    const list = await get('/traders');
    const t = list.find((x) => x.id === Number(el.dataset.id));
    return reloadAfter(P.traderDialog(t).then(async (r) => { if (r) await reloadMeta(); return r; }));
  },
  'market-analyse': () => P.marketAnalyse(),
  'report-show': () => showReport(),
  'pin-change': () => S.pinDialog(),
  async logout() { await post('/auth/logout').catch(() => {}); state.user = null; state.meta = null; showLogin(); },
  'user-new': () => reloadAfter(S.userDialog()),
  'user-edit': (el) => reloadAfter(S.userDialog(el.dataset.id)),
  'veg-new': () => reloadAfter(S.vegDialog()),
  'veg-edit': (el) => reloadAfter(S.vegDialog(el.dataset.id)),
  'import-local': (el) => S.importLocal(el.dataset.key),
  'import-commit': () => S.commitImport(),
  backup: () => S.backup(),
  csv: () => S.csv(),
};

document.addEventListener('click', async (e) => {
  const nav = e.target.closest('#nav button[data-page]');
  if (nav) return go(nav.dataset.page);
  const el = e.target.closest('[data-action]');
  if (!el || !ACTIONS[el.dataset.action]) return;
  e.preventDefault();
  if (el.dataset.busy) return;
  el.dataset.busy = '1';
  try { await ACTIONS[el.dataset.action](el); } catch (err) { toast(err.message || 'ભૂલ આવી', 'err'); } finally { delete el.dataset.busy; }
});

// ---------- date bar ----------
function setDate(d) {
  if (!d || d > state.meta.today) d = state.meta.today;
  state.date = d; $('#workDate').value = d;
  $('#dateLabel').textContent = d === state.meta.today ? 'આજે' : gDate(d);
  render();
}
$('#workDate').addEventListener('change', (e) => setDate(e.target.value));
$('#prevDay').addEventListener('click', () => setDate(addDays(state.date, -1)));
$('#nextDay').addEventListener('click', () => setDate(addDays(state.date, 1)));
$('#todayBtn').addEventListener('click', () => setDate(state.meta.today));
window.addEventListener('hashchange', () => { if (state.user) go(location.hash.slice(1)); });
window.addEventListener('cms:unauthorized', () => { if (state.user) { state.user = null; toast('સત્ર પૂરું થયું — ફરી લોગિન કરો', 'warn'); showLogin(); } });

function netStatus() {
  const s = $('#syncStatus');
  s.textContent = navigator.onLine ? '● ઓનલાઇન — બધા ફોનમાં સરખો ડેટા' : '● ઇન્ટરનેટ નથી — એન્ટ્રી સેવ નહીં થાય';
  s.className = navigator.onLine ? 'online' : 'offline';
}
window.addEventListener('online', () => { netStatus(); if (state.user) render(); });
window.addEventListener('offline', netStatus);
netStatus();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
showLogin();

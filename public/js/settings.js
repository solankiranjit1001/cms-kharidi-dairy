// Settings: own PIN, family users, vegetables, old-data import, backups, audit log.
import { $, esc, money, gDate, dateTime, table, field, selectField, openModal, toast, download, confirmBox } from './ui.js';
import { get, post, patch } from './api.js';
import { state, ROLE_LABEL, isOwner, reloadMeta } from './state.js';

const LEGACY_KEYS = [
  { key: 'cmsKharidiDiaryV4', label: 'જૂની એપ V4' },
  { key: 'cms_kharidi_dairy_records_v1', label: 'જૂની એપ V1/V2' },
];

export async function settings(root) {
  const owner = isOwner();
  const [users, audit] = owner ? await Promise.all([get('/users'), get('/audit')]) : [[], []];
  const legacy = LEGACY_KEYS.map((l) => {
    let raw = null; try { raw = localStorage.getItem(l.key); } catch { raw = null; }
    if (!raw) return null;
    let n = 0; try { const d = JSON.parse(raw); n = Array.isArray(d) ? d.length : ['purchases', 'sales', 'waste', 'payments', 'expenses', 'surveys'].reduce((a, k) => a + (d[k]?.length || 0), 0); } catch { n = 0; }
    return { ...l, raw, n };
  }).filter(Boolean);

  root.innerHTML = `<div class="pagehead"><div><h2>સેટિંગ્સ</h2><div class="sub">${esc(state.user.name)} • ${ROLE_LABEL[state.user.role]}</div></div></div>
  <div class="grid two">
    <div class="card"><h3 class="sectiontitle">મારું ખાતું</h3>
      <p>નામ: <b>${esc(state.user.name)}</b><br>ભૂમિકા: <b>${ROLE_LABEL[state.user.role]}</b></p>
      <div class="actions"><button class="btn light" data-action="pin-change">🔑 PIN બદલો</button><button class="btn danger" data-action="logout">🚪 લોગઆઉટ</button></div></div>
    <div class="card"><h3 class="sectiontitle">ડેટા સલામતી</h3>
      <p class="note">બધો ડેટા સુરક્ષિત સર્વર ડેટાબેઝમાં રહે છે અને પરિવારના દરેક ફોન પર સરખો દેખાય છે. એન્ટ્રી કાયમ માટે કાઢી નખાતી નથી — "રદ" થાય છે અને દરેક ફેરફારનો ઇતિહાસ રહે છે.</p>
      ${owner ? `<div class="actions"><button class="btn primary" data-action="backup">⬇️ સંપૂર્ણ બેકઅપ (JSON)</button>
        ${selectField('CSV એક્સપોર્ટ', 'csvtable', [['purchases', 'ખરીદી'], ['purchase_lines', 'ખરીદી પંક્તિઓ'], ['sales', 'વેચાણ'], ['waste', 'બગાડ'], ['payments', 'ચુકવણી'], ['expenses', 'ખર્ચ'], ['market_prices', 'બજાર ભાવ'], ['traders', 'વેપારી'], ['day_closings', 'ક્લોઝિંગ મૂલ્ય']].map(([value, label]) => ({ value, label })), 'purchases', { cls: 'inline' })}
        <button class="btn light" data-action="csv">CSV ⬇️</button></div>` : ''}</div>
  </div>
  ${owner ? `
  <div class="card"><h3 class="sectiontitle">પરિવારના સભ્યો (લોગિન)</h3>
    <button class="btn primary" data-action="user-new">＋ સભ્ય ઉમેરો</button>
    <p class="note">માલિક: બધું + રદ કરવું + સભ્યો. એન્ટ્રી: એન્ટ્રી અને ફેરફાર (કારણ સાથે). ફક્ત જોવું: માત્ર જોઈ શકે.</p>
    ${table(['નામ', 'મોબાઇલ', 'ભૂમિકા', 'સ્થિતિ', ''], users.map((u) => `<tr${u.active ? '' : ' class="voided"'}><td>${esc(u.name)}</td><td>${esc(u.mobile)}</td><td>${ROLE_LABEL[u.role]}</td><td>${u.active ? (u.locked ? '<span class="pill amber">લૉક (ખોટા PIN)</span>' : '<span class="pill green">ચાલુ</span>') : '<span class="pill">બંધ</span>'}</td>
      <td><button class="btn light small" data-action="user-edit" data-id="${u.id}">✏️ સુધારો / PIN રીસેટ</button></td></tr>`))}</div>
  <div class="card"><h3 class="sectiontitle">શાકભાજી યાદી</h3>
    <p class="note">એકમ (kg, નંગ, ડઝન…) ફક્ત પહેલી એન્ટ્રી પહેલાં બદલી શકાય. બંધ કરેલ શાક નવી એન્ટ્રીમાં નહીં દેખાય; જૂનો હિસાબ સાચવાય છે.</p>
    <button class="btn secondary" data-action="veg-new">＋ શાક ઉમેરો</button>
    ${table(['શાક', 'એકમ', 'સ્થિતિ', ''], state.meta.vegetables.map((v) => `<tr${v.active ? '' : ' class="voided"'}><td>${esc(v.name)}</td><td>${esc(v.unit)}</td><td>${v.active ? 'ચાલુ' : 'બંધ'}</td><td><button class="btn light small" data-action="veg-edit" data-id="${v.id}">✏️</button></td></tr>`), { empty: 'પહેલી ખરીદી વખતે શાક આપમેળે ઉમેરાશે' })}</div>
  <div class="card" id="importCard"><h3 class="sectiontitle">⬆️ જૂની એપનો ડેટા લાવો</h3>
    <p class="note">પહેલા <b>તપાસ</b> થાય છે — કશું બદલાતું નથી. પછી તમે પુષ્ટિ કરો ત્યારે જ ઇમ્પોર્ટ થાય. એક જ ફાઇલ બે વાર ઇમ્પોર્ટ કરો તો પણ ડુપ્લિકેટ નહીં બને. જૂનો ડેટા ફોનમાંથી કાઢવામાં આવતો નથી.</p>
    ${legacy.length ? `<div class="alert success">આ ફોનમાં જૂની એપનો ડેટા મળ્યો: ${legacy.map((l) => `<b>${esc(l.label)}</b> (${l.n} એન્ટ્રી) <button class="btn small secondary" data-action="import-local" data-key="${esc(l.key)}">તપાસો</button>`).join(' ')}</div>` : '<p class="muted">આ ફોન/બ્રાઉઝરમાં જૂની એપનો ડેટા મળ્યો નથી.</p>'}
    <div class="field"><label for="importFile">અથવા જૂની એપની JSON બેકઅપ ફાઇલ પસંદ કરો</label><input type="file" id="importFile" accept="application/json,.json"></div>
    <div id="importOut"></div></div>
  <div class="card"><h3 class="sectiontitle">ફેરફાર ઇતિહાસ (છેલ્લા 300)</h3>${table(['સમય', 'કોણે', 'શું', 'ક્યાં', 'કારણ'], audit.map((a) => `<tr><td>${dateTime(a.at)}</td><td>${esc(a.user_name || '')}</td><td>${esc(a.action)}</td><td>${esc(a.entity)} #${esc(a.entity_id || '')}</td><td>${esc(a.reason || '')}</td></tr>`))}</div>` : ''}
  <p class="note center">CMS ખરીદી ડાયરી • આવૃત્તિ 5</p>`;

  const fileInput = $('#importFile');
  if (fileInput) fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0]; if (!f) return;
    if (f.size > 5 * 1024 * 1024) return toast('ફાઇલ બહુ મોટી છે.', 'warn');
    let data; try { data = JSON.parse(await f.text()); } catch { return toast('આ ફાઇલ માન્ય JSON નથી.', 'warn'); }
    await previewImport(data, f.name);
  });
}

export async function importLocal(key) {
  let data; try { data = JSON.parse(localStorage.getItem(key)); } catch { return toast('ડેટા વાંચી શકાયો નહીં.', 'warn'); }
  await previewImport(data, `આ ફોન (${key})`);
}

const KIND = { purchase: 'ખરીદી', sale: 'વેચાણ', waste: 'બગાડ', payment: 'ચુકવણી', expense: 'ખર્ચ', market: 'બજાર ભાવ', plan: 'આયોજન', adjustment: 'સ્ટોક સુધારો', count: 'સ્ટોક ગણતરી', trader: 'વેપારી' };

async function previewImport(data, fileName) {
  const out = $('#importOut');
  out.innerHTML = '<div class="empty">તપાસ થઈ રહી છે…</div>';
  let r;
  try { r = await post('/import', { data, dryRun: true, fileName }); } catch (e) { out.innerHTML = `<div class="alert">${esc(e.message)}</div>`; return; }
  const kinds = [...new Set([...Object.keys(r.total), ...Object.keys(r.new)])];
  out.innerHTML = `<div class="card inner"><h4>તપાસ પરિણામ — ${esc(fileName)}</h4>
    <p>તારીખો: ${r.date_range.from ? `${gDate(r.date_range.from)} થી ${gDate(r.date_range.to)}` : '—'}</p>
    ${table(['પ્રકાર', 'ફાઇલમાં', 'નવી (ઇમ્પોર્ટ થશે)', 'પહેલેથી ઇમ્પોર્ટ'], kinds.map((k) => `<tr><td>${KIND[k] || esc(k)}</td><td>${r.total[k] || 0}</td><td><b>${k === 'trader' ? '—' : r.new[k] || 0}</b></td><td>${r.already_imported[k] || 0}</td></tr>`))}
    ${r.error_count ? `<div class="alert"><b>${r.error_count} એન્ટ્રી છોડી દેવાશે</b> (ખોટી તારીખ/સંખ્યા):<ul>${r.errors.slice(0, 20).map((e) => `<li>${esc(e.type ? KIND[e.type] || e.type : '')} ${esc(e.date || '')} — ${esc(e.reason)}</li>`).join('')}</ul></div>` : ''}
    ${r.possible_duplicate_count ? `<div class="alert"><b>${r.possible_duplicate_count} શક્ય ડુપ્લિકેટ</b> — નવી એપમાં સરખી તારીખ/શાક/જથ્થો/દરની એન્ટ્રી પહેલેથી છે. ઇમ્પોર્ટ પછી ઇતિહાસમાં તપાસીને જરૂર હોય તો રદ કરો.<ul>${r.possible_duplicates.slice(0, 10).map((p) => `<li>${esc(KIND[p.type])} ${gDate(p.date)} ${esc(p.veg)} ${p.qty} × ${money(p.rate)}</li>`).join('')}</ul></div>` : ''}
    ${Object.values(r.new).some(Boolean) ? '<button class="btn primary" data-action="import-commit">✅ ઇમ્પોર્ટ કરો</button>' : '<div class="alert success">બધો ડેટા પહેલેથી ઇમ્પોર્ટ થયેલો છે.</div>'}</div>`;
  pendingImport = { data, fileName };
}
let pendingImport = null;

export async function commitImport() {
  if (!pendingImport) return;
  if (!(await confirmBox('ઇમ્પોર્ટની પુષ્ટિ', 'જૂનો ડેટા સર્વરમાં ઉમેરવો છે? (કોઈ હાલની એન્ટ્રી બદલાશે નહીં)', 'હા, ઇમ્પોર્ટ કરો'))) return;
  const out = $('#importOut');
  try {
    const r = await post('/import', { ...pendingImport, dryRun: false });
    try { localStorage.setItem('cms_imported_' + r.file_hash.slice(0, 16), new Date().toISOString()); } catch { /* ignore */ }
    pendingImport = null;
    await reloadMeta();
    out.innerHTML = `<div class="alert success"><b>ઇમ્પોર્ટ પૂર્ણ.</b> ${Object.entries(r.inserted).map(([k, v]) => `${KIND[k] || k}: ${v}`).join(' • ') || 'કોઈ નવી એન્ટ્રી નહીં'}</div>
      ${r.warnings.length ? `<div class="alert"><ul>${r.warnings.slice(0, 20).map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}
      ${r.negative_stock.length ? `<div class="alert"><b>ઋણ સ્ટોક મળ્યો</b> (જૂના ડેટામાં વેચાણ ખરીદીથી વધુ): ${r.negative_stock.map((n) => `${esc(n.name)} (${gDate(n.d)})`).join(', ')}. "સ્ટોક" પાનામાં કારણ સાથે સુધારો કરો.</div>` : ''}
      <p class="note">હવે ડેશબોર્ડ અને વેપારી બાકી કાગળની ડાયરી સાથે સરખાવો.</p>`;
    toast('જૂનો ડેટા ઇમ્પોર્ટ થયો');
  } catch (e) { out.insertAdjacentHTML('afterbegin', `<div class="alert">${esc(e.message)}</div>`); }
}

export async function backup() {
  const data = await get('/export');
  download(`cms-kharidi-backup-${state.meta.today}.json`, JSON.stringify(data, null, 2));
  toast('બેકઅપ ડાઉનલોડ થયો');
}

export async function csv() {
  const t = $('#f_csvtable').value;
  const data = await get('/export');
  const rows = data[t] || [];
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const text = '﻿' + [keys.join(','), ...rows.map((r) => keys.map((k) => cell(typeof r[k] === 'object' && r[k] !== null ? JSON.stringify(r[k]) : r[k])).join(','))].join('\r\n');
  download(`cms-${t}-${state.meta.today}.csv`, text, 'text/csv;charset=utf-8');
}

export function pinDialog() {
  return openModal({
    title: '🔑 PIN બદલો',
    body: `<div class="formgrid one">${field('જૂનો PIN', 'oldPin', { type: 'password', attrs: 'inputmode="numeric" autocomplete="current-password" required maxlength="6"' })}
      ${field('નવો PIN (4–6 અંક)', 'newPin', { type: 'password', attrs: 'inputmode="numeric" autocomplete="new-password" required minlength="4" maxlength="6" pattern="[0-9]{4,6}"' })}
      ${field('નવો PIN ફરી', 'newPin2', { type: 'password', attrs: 'inputmode="numeric" autocomplete="new-password" required minlength="4" maxlength="6"' })}</div>
      <p class="note">PIN બદલતાં બીજાં ડિવાઇસ પરથી લોગઆઉટ થશે.</p>`,
    async onSubmit(f) {
      if (f.newPin.value !== f.newPin2.value) throw new Error('બંને નવા PIN સરખા નથી.');
      await post('/auth/pin', { oldPin: f.oldPin.value, newPin: f.newPin.value });
      toast('PIN બદલાયો');
    },
  });
}

export async function userDialog(id = null) {
  const u = id ? (await get('/users')).find((x) => x.id === Number(id)) : null;
  const roles = Object.entries(ROLE_LABEL).map(([value, label]) => ({ value, label }));
  return openModal({
    title: u ? `સભ્ય સુધારો — ${esc(u.name)}` : '＋ નવો સભ્ય',
    body: `<div class="formgrid">${field('નામ', 'name', { value: u?.name || '', attrs: 'required maxlength="60"' })}
      ${u ? `<div class="field"><label>મોબાઇલ</label><input value="${esc(u.mobile)}" disabled></div>` : field('મોબાઇલ નંબર', 'mobile', { type: 'tel', attrs: 'required inputmode="numeric" maxlength="13"' })}
      ${selectField('ભૂમિકા', 'role', roles, u?.role || 'entry')}
      ${field(u ? 'નવો PIN (ખાલી = ન બદલો)' : 'PIN (4–6 અંક)', 'pin', { type: 'password', attrs: `inputmode="numeric" autocomplete="new-password" maxlength="6" ${u ? '' : 'required minlength="4"'}` })}
      ${u ? selectField('સ્થિતિ', 'active', [{ value: 'true', label: 'ચાલુ' }, { value: 'false', label: 'બંધ (લોગિન નહીં થાય)' }], String(u.active)) : ''}
      ${u?.locked ? '<div class="field"><label><input type="checkbox" name="unlock" checked> લૉક ખોલો</label></div>' : ''}</div>`,
    async onSubmit(f) {
      if (u) {
        const body = { name: f.name.value, role: f.role.value, active: f.active.value === 'true' };
        if (f.pin.value) body.pin = f.pin.value;
        if (f.unlock?.checked) body.unlock = true;
        await patch(`/users/${u.id}`, body);
      } else {
        await post('/users', { name: f.name.value, mobile: f.mobile.value, role: f.role.value, pin: f.pin.value });
      }
      toast('સભ્ય સેવ થયો');
    },
  });
}

export async function vegDialog(id = null) {
  const v = id ? state.meta.vegetables.find((x) => x.id === Number(id)) : null;
  return openModal({
    title: v ? `શાક સુધારો — ${esc(v.name)}` : '＋ નવું શાક',
    body: `<div class="formgrid">${field('શાકનું નામ', 'name', { value: v?.name || '', attrs: 'required maxlength="60"' })}
      ${selectField('એકમ', 'unit', state.meta.units, v?.unit || 'kg')}
      ${v ? selectField('સ્થિતિ', 'active', [{ value: 'true', label: 'ચાલુ' }, { value: 'false', label: 'બંધ' }], String(v.active)) : ''}</div>`,
    async onSubmit(f) {
      if (v) await patch(`/vegetables/${v.id}`, { name: f.name.value, unit: f.unit.value, active: f.active.value === 'true' });
      else await post('/vegetables', { name: f.name.value, unit: f.unit.value });
      await reloadMeta();
      toast('શાક સેવ થયું');
    },
  });
}


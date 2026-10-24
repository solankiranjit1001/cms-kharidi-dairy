// Small DOM helpers. All dynamic text goes through esc() before reaching innerHTML.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function money(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function num(n) {
  if (n === null || n === undefined || n === '') return '—';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 });
}
export const qty = (n, unit = 'kg') => (n === null || n === undefined ? '—' : `${num(n)} ${esc(unit || '')}`);
export function gDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).slice(0, 10).split('-');
  return `${day}/${m}/${y}`;
}
export function weekday(d) {
  try { return new Date(d + 'T12:00:00').toLocaleDateString('gu-IN', { weekday: 'long' }); } catch { return ''; }
}
export function dateTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('gu-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function addDays(d, n) {
  const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10);
}

export function toast(msg, kind = 'ok') {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show ' + kind;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = ''; }, 3200);
}

export function table(headers, rows, { empty = 'હજુ કોઈ એન્ટ્રી નથી', cls = '' } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  const fit = headers.length <= 4 ? ' fit' : '';
  return `<div class="tablewrap"><table class="${cls}${fit}"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
export const metric = (label, value, cls = '', sub = '') =>
  `<div class="card metriccard"><div class="metric">${label}</div><div class="amount ${cls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

// ---------- form field builders ----------
export function field(label, name, { type = 'text', value = '', attrs = '', help = '', cls = '' } = {}) {
  return `<div class="field ${cls}"><label for="f_${name}">${label}</label><input id="f_${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}>${help ? `<small class="help">${help}</small>` : ''}</div>`;
}
export function numField(label, name, value = '', { step = '0.01', min = '0', required = true, help = '', cls = '' } = {}) {
  return field(label, name, { type: 'text', value, cls, help, attrs: `inputmode="decimal" autocomplete="off" data-num data-step="${step}" ${min !== null ? `data-min="${min}"` : ''} ${required ? 'required' : ''}` });
}
export function selectField(label, name, options, value = '', { attrs = '', cls = '' } = {}) {
  const opts = options.map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  return `<div class="field ${cls}"><label for="f_${name}">${label}</label><select id="f_${name}" name="${name}" ${attrs}>${opts.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>`;
}
export const textArea = (label, name, value = '', attrs = '') =>
  `<div class="field wide"><label for="f_${name}">${label}</label><textarea id="f_${name}" name="${name}" ${attrs}>${esc(value)}</textarea></div>`;

export function formData(form) {
  const d = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') d[el.name] = el.checked;
    else d[el.name] = el.value.trim();
  }
  return d;
}

/** Normalise Gujarati digits & commas in numeric inputs, before the server validates them. */
export function cleanNum(v) {
  return String(v ?? '').replace(/[૦-૯]/g, (c) => '૦૧૨૩૪૫૬૭૮૯'.indexOf(c)).replace(/[,\s]/g, '');
}

// ---------- modal ----------
let modalBusy = false;
/**
 * Open a form dialog. onSubmit(form) may throw an ApiError → shown in the dialog, which stays open
 * so nothing typed is lost. Resolves with onSubmit's result, or null if cancelled.
 */
export function openModal({ title, body, saveLabel = 'સેવ કરો', onSubmit, wide = false, onOpen, readOnly = false }) {
  const dlg = $('#modal');
  // Fresh form node each time so listeners from a previous dialog never leak into this one.
  const old = $('#modalForm');
  const form = old.cloneNode(true);
  old.replaceWith(form);
  dlg.classList.toggle('wide', wide);
  $('#modalContent').innerHTML = `<h3>${title}</h3>${body}<div class="formerror" role="alert" hidden></div>`;
  const saveBtn = $('#modalSave');
  saveBtn.textContent = saveLabel;
  saveBtn.hidden = readOnly;
  $('#modalCancel').textContent = readOnly ? 'બંધ કરો' : 'રદ કરો';
  return new Promise((resolve) => {
    const errBox = $('.formerror', form);
    const showErr = (m) => { errBox.textContent = m; errBox.hidden = false; errBox.scrollIntoView({ block: 'nearest' }); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (modalBusy || readOnly) return;
      errBox.hidden = true;
      for (const el of $$('[data-num]', form)) {
        el.value = cleanNum(el.value);
        if (!el.value && !el.required) continue;
        if (el.value && !/^-?\d+(\.\d+)?$/.test(el.value)) { el.focus(); return showErr(`"${el.closest('.field')?.querySelector('label')?.textContent || ''}" માં માત્ર સંખ્યા લખો.`); }
        if (el.dataset.min !== undefined && el.value && Number(el.value) < Number(el.dataset.min)) { el.focus(); return showErr('સંખ્યા માન્ય નથી.'); }
      }
      if (!form.reportValidity()) return;
      modalBusy = true; saveBtn.disabled = true; saveBtn.textContent = 'સેવ થઈ રહ્યું છે…';
      try {
        const out = await onSubmit(form);
        if (out === false) return;
        dlg.close(); resolve(out ?? true);
      } catch (err) {
        showErr(err.message || 'ભૂલ આવી.');
      } finally {
        modalBusy = false; saveBtn.disabled = false; saveBtn.textContent = saveLabel;
      }
    };
    $('#modalCancel').onclick = (e) => { e.preventDefault(); dlg.close(); resolve(null); };
    dlg.oncancel = () => resolve(null);
    dlg.showModal();
    if (onOpen) onOpen(form);
    const first = $('input:not([type=hidden]):not([readonly]),select,textarea', form);
    if (first && window.matchMedia('(min-width: 700px)').matches) first.focus();
  });
}

export function showInfo(title, body) {
  return openModal({ title, body, readOnly: true, wide: true });
}

/** Ask for a reason (edits/voids). Resolves with the text or null. */
export async function askReason(title, prompt = 'કારણ લખો (ફરજિયાત)') {
  let reason = null;
  const ok = await openModal({
    title, saveLabel: 'પુષ્ટિ કરો',
    body: `<div class="formgrid one">${field(prompt, 'reason', { attrs: 'required minlength="2" maxlength="200" autocomplete="off"' })}</div>`,
    onSubmit: (f) => { reason = f.reason.value.trim(); if (reason.length < 2) throw new Error('કારણ લખો.'); return true; },
  });
  return ok ? reason : null;
}

export function confirmBox(title, message, yes = 'હા') {
  return openModal({ title, body: `<p>${message}</p>`, saveLabel: yes, onSubmit: () => true }).then(Boolean);
}

export function download(name, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

// ---------- optional voice input (always reviewed by the user before saving) ----------
export const voiceSupported = () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

export function listen() {
  return new Promise((resolve, reject) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return reject(new Error('આ બ્રાઉઝરમાં અવાજથી લખવાની સુવિધા નથી. હાથથી લખો.'));
    const rec = new SR();
    rec.lang = 'gu-IN'; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => resolve(e.results[0][0].transcript);
    rec.onerror = (e) => reject(new Error(`અવાજ ઓળખાયો નહીં (${e.error}). ફરી પ્રયાસ કરો અથવા હાથથી લખો.`));
    rec.onnomatch = () => reject(new Error('અવાજ ઓળખાયો નહીં.'));
    try { rec.start(); } catch { reject(new Error('માઇક્રોફોન શરૂ ન થયો.')); }
  });
}

/** "ટામેટાં 50 કિલો 20 રૂપિયે" → { veg, qty, rate } using the known vegetable list. */
export function parseSpoken(text, vegNames) {
  const t = cleanNumText(text);
  const qtyM = t.match(/(\d+(?:\.\d+)?)\s*(?:કિલો|કિ\.?ગ્રા|kg|કિલોગ્રામ|નંગ|ડઝન|મણ|બોક્સ|થેલી|જુડી)/i);
  const rateM = t.match(/(\d+(?:\.\d+)?)\s*(?:રૂપિયે|રૂપિયા|રૂ\.?|₹|ના ભાવે|ભાવે)/i) || t.match(/(?:₹|રૂ\.?)\s*(\d+(?:\.\d+)?)/);
  const veg = [...vegNames].sort((a, b) => b.length - a.length).find((v) => t.includes(v)) || '';
  const nums = [...t.matchAll(/\d+(?:\.\d+)?/g)].map((m) => m[0]);
  return { veg, qty: qtyM ? qtyM[1] : nums[0] || '', rate: rateM ? rateM[1] : (qtyM ? nums.find((n) => n !== qtyM[1]) : nums[1]) || '' };
}
function cleanNumText(s) { return String(s).replace(/[૦-૯]/g, (c) => '૦૧૨૩૪૫૬૭૮૯'.indexOf(c)); }

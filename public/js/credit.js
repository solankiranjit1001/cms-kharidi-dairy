// ઉધાર — credit given to our customers. Separate book: not part of the day result or any other report.
import { $, $$, esc, money, num, gDate, table, metric, field, numField, openModal, toast, cleanNum } from './ui.js';
import { get, post, patch, del, uuid } from './api.js';
import { state, canWrite } from './state.js';

let openCustomer = null; // customer id whose ledger is shown, or null for the list
let ledger = null; // v9.2: the open customer's data (for editing entries)
// v9.2: on phones nothing is focused until tapped (no keyboard / date picker popping up)
const focusWide = (el) => { if (el && window.matchMedia('(min-width: 700px)').matches) el.focus(); };

const btn = (label, action, cls = 'primary', extra = '') => (canWrite() ? `<button class="btn ${cls}" data-action="${action}" ${extra}>${label}</button>` : '');

export async function creditPage(root) {
  if (openCustomer) return customerLedger(root, openCustomer);
  const s = await get('/credit');
  root.innerHTML = `<div class="pagehead"><div><h2>📝 ઉધાર (ગ્રાહકો પાસે બાકી)</h2><div class="sub">અલગ ખાતું — આજના પરિણામ કે બીજા રિપોર્ટમાં ગણાતું નથી</div></div></div>
  <div class="card noprint"><div class="actions">${btn('＋ નવું ઉધાર', 'credit-new')}${btn('💵 પૈસા મળ્યા', 'credit-receipt', 'secondary')}</div>
    <p class="note">ગ્રાહકના નામ પર ક્લિક કરો — તારીખ પ્રમાણે બધી વસ્તુ દેખાશે. જેનું ઉધાર પૂરું ચૂકવાઈ ગયું હોય તે અહીં દેખાતા નથી.</p></div>
  <div class="grid">${metric('કુલ ઉધાર બાકી', money(s.total), 'amber', `${s.customers.length} ગ્રાહક`)}</div>
  <div class="card">${table(['ગ્રાહક', 'છેલ્લું ઉધાર', 'ઉધાર', 'મળેલ', 'બાકી', ''],
    s.customers.map((c) => `<tr><td><button class="linkbtn" data-action="credit-open" data-id="${c.id}"><b>${esc(c.name)}</b></button></td><td>${c.last_credit ? gDate(c.last_credit) : ''}</td><td>${money(c.credit)}</td><td>${money(c.received)}</td><td class="amber"><b>${money(c.balance)}</b></td>
      <td><div class="rowactions"><button class="btn light small" data-action="credit-open" data-id="${c.id}">📒 જુઓ</button>${btn('＋ ઉધાર', 'credit-new', 'light small', `data-id="${c.id}"`)}${btn('💵 મળ્યા', 'credit-receipt', 'secondary small', `data-id="${c.id}"`)}</div></td></tr>`),
    { empty: 'કોઈ ગ્રાહકનું ઉધાર બાકી નથી' })}</div>`;
  state.creditNames = s.names;
}

async function customerLedger(root, id) {
  ledger = await get(`/credit/customers/${id}`);
  const { customer: c, entries } = ledger;
  root.innerHTML = `<div class="pagehead"><div><h2>📒 ${esc(c.name)} — ઉધાર ખાતું</h2><div class="sub">બાકી: <b class="amber">${money(c.balance)}</b></div></div>
    <div class="actions noprint"><button class="btn light" data-action="credit-back">◀ બધા ગ્રાહક</button>${btn('✏️ નામ બદલો', 'credit-rename', 'light', `data-id="${c.id}"`)}${btn('🗑️ ગ્રાહક કાઢો', 'credit-cust-delete', 'danger', `data-id="${c.id}"`)}<button class="btn light" data-action="print">🖨️ પ્રિન્ટ</button></div></div>
  <div class="card noprint"><div class="actions">${btn('＋ ઉધાર ઉમેરો', 'credit-new', 'primary', `data-id="${c.id}"`)}${btn('💵 પૈસા મળ્યા', 'credit-receipt', 'secondary', `data-id="${c.id}"`)}</div></div>
  <div class="card">${table(['વસ્તુ', 'તારીખ', 'ઉધાર', 'મળેલ', 'બાકી', ''],
    entries.map((e) => `<tr>
      <td>${e.kind === 'credit' ? e.lines.map((l) => `<div>${esc(l.item)} ${num(l.qty)} kg × ${money(l.rate)} = <b>${money(l.amount)}</b></div>`).join('') : '<span class="green">💵 પૈસા મળ્યા</span>'}${e.note ? `<div><small class="muted">${esc(e.note)}</small></div>` : ''}</td>
      <td>${gDate(e.entry_date)}</td>
      <td>${e.kind === 'credit' ? `<b>${money(e.amount)}</b>` : ''}</td><td class="green">${e.kind === 'receipt' ? `<b>${money(e.amount)}</b>` : ''}</td><td class="amber"><b>${money(e.balance)}</b></td>
      <td>${canWrite() ? `<div class="rowactions noprint"><button class="btn light small" data-action="credit-edit" data-id="${e.id}" title="સુધારો">✏️</button><button class="btn danger small" data-action="credit-delete" data-id="${e.id}" title="કાઢી નાખો">🗑️</button></div>` : ''}</td></tr>`),
    { empty: 'કોઈ એન્ટ્રી નથી' })}
    <p class="balance">કુલ ઉધાર ${money(c.credit)} • મળેલ ${money(c.received)} • બાકી <span class="amber">${money(c.balance)}</span></p></div>`;
}

function namesList() {
  return `<datalist id="custList">${(state.creditNames || []).map((n) => `<option value="${esc(n.name)}"></option>`).join('')}</datalist>
    <datalist id="itemList">${state.meta.vegetables.filter((v) => v.active).map((v) => `<option value="${esc(v.name)}"></option>`).join('')}</datalist>`;
}

async function ensureNames() { if (!state.creditNames) state.creditNames = (await get('/credit')).names; }
const custName = (id) => (state.creditNames || []).find((n) => String(n.id) === String(id))?.name || '';

function itemRow(i, l = {}) {
  return `<div class="lineitem creditline" data-line>
    <div class="field"><label>વસ્તુ ${i + 1}</label><input name="item_${i}" list="itemList" required maxlength="60" autocomplete="off" value="${esc(l.item || '')}"></div>
    ${numField('kg', `qty_${i}`, l.qty ? num(l.qty) : '', { step: '0.001' })}
    ${numField('દર ₹', `rate_${i}`, l.rate ? String(Number(l.rate)) : '')}
    <div class="field lineamt"><label>રકમ</label><output data-lineamt>${money(l.amount || 0)}</output></div>
    <button type="button" class="btn light small removeline" data-remove-line title="પંક્તિ કાઢો">✕</button></div>`;
}

export async function creditForm(customerId = null, rec = null) {
  await ensureNames();
  const cid = uuid();
  const fixed = customerId ? (custName(customerId) || ledger?.customer?.name || '') : '';
  return openModal({
    title: rec ? `✏️ ઉધાર સુધારો — ${esc(fixed)}` : fixed ? `＋ ઉધાર — ${esc(fixed)}` : '＋ નવું ઉધાર', wide: true,
    body: `<div class="formgrid">
      ${field('ગ્રાહકનું નામ', 'customer', { value: fixed, attrs: `required maxlength="80" autocomplete="off" list="custList" ${fixed ? 'readonly' : ''}` })}
      ${field('તારીખ', 'entry_date', { type: 'date', value: rec?.entry_date || state.date, attrs: `required max="${state.meta.today}"` })}</div>
      <h4 class="formsub">વસ્તુઓ</h4><div id="lines">${rec ? rec.lines.map((l, i) => itemRow(i, l)).join('') : itemRow(0)}</div>
      <button type="button" class="btn secondary small" data-add-line>＋ બીજી વસ્તુ ઉમેરો</button>
      <div class="billtotal">કુલ ઉધાર: <b data-total>${money(rec?.amount || 0)}</b></div>
      <div class="formgrid one">${field('નોંધ (વૈકલ્પિક)', 'note', { value: rec?.note || '', attrs: 'maxlength="200"' })}</div>${namesList()}`,
    onOpen(form) {
      const recalc = () => {
        let t = 0;
        for (const row of $$('[data-line]', form)) {
          const q = Number(cleanNum($('[name^=qty_]', row).value)) || 0, r = Number(cleanNum($('[name^=rate_]', row).value)) || 0;
          const a = Math.round(Math.round(q * r * 100) / 100); t += a;
          $('[data-lineamt]', row).textContent = money(a);
        }
        $('[data-total]', form).textContent = money(t);
      };
      const renumber = () => $$('[data-line]', form).forEach((row, i) => {
        $('label', row).textContent = `વસ્તુ ${i + 1}`;
        $('[name^=item_]', row).name = `item_${i}`; $('[name^=qty_]', row).name = `qty_${i}`; $('[name^=rate_]', row).name = `rate_${i}`;
      });
      form.addEventListener('input', recalc);
      $('[data-add-line]', form).addEventListener('click', () => {
        const n = $$('[data-line]', form).length; if (n >= 40) return;
        $('#lines', form).insertAdjacentHTML('beforeend', itemRow(n)); renumber();
        focusWide($('[name^=item_]', $('#lines', form).lastElementChild));
      });
      $('#lines', form).addEventListener('click', (e) => {
        if (!e.target.closest('[data-remove-line]')) return;
        if ($$('[data-line]', form).length === 1) return toast('ઓછામાં ઓછી એક વસ્તુ જોઈએ.', 'warn');
        e.target.closest('[data-line]').remove(); renumber(); recalc();
      });
      if (!rec) focusWide(fixed ? $('[name=item_0]', form) : form.customer);
    },
    async onSubmit(form) {
      const rows = $$('[data-line]', form);
      const body = { client_id: cid, kind: 'credit', entry_date: form.entry_date.value, note: form.note.value,
        lines: rows.map((row) => ({ item: $('[name^=item_]', row).value.trim(), qty: $('[name^=qty_]', row).value, rate: $('[name^=rate_]', row).value })) };
      if (rec) {
        const out = await patch(`/credit/${rec.id}`, body);
        toast(`ઉધાર સુધાર્યું — ${money(out.amount)}`);
        return out;
      }
      if (customerId) body.customer_id = customerId; else body.customer = form.customer.value.trim();
      const out = await post('/credit', body);
      state.creditNames = null;
      toast(`ઉધાર નોંધાયું — ${money(out.amount)}`);
      return out;
    },
  });
}

export async function receiptForm(customerId = null, rec = null) {
  await ensureNames();
  const cid = uuid();
  const fixed = customerId ? (custName(customerId) || ledger?.customer?.name || '') : '';
  let due = '';
  if (customerId && !rec) { try { due = (await get(`/credit/customers/${customerId}`)).customer.balance; } catch { /* optional */ } }
  return openModal({
    title: rec ? `✏️ મળેલ પૈસા સુધારો — ${esc(fixed)}` : fixed ? `💵 પૈસા મળ્યા — ${esc(fixed)}` : '💵 ગ્રાહક પાસેથી પૈસા મળ્યા',
    body: `${due !== '' ? `<div class="billdue">બાકી ઉધાર: <b class="amber">${money(due)}</b></div>` : ''}<div class="formgrid">
      ${field('ગ્રાહકનું નામ', 'customer', { value: fixed, attrs: `required maxlength="80" autocomplete="off" list="custList" ${fixed ? 'readonly' : ''}` })}
      ${field('તારીખ', 'entry_date', { type: 'date', value: rec?.entry_date || state.date, attrs: `required max="${state.meta.today}"` })}
      ${numField('મળેલ રકમ ₹', 'amount', rec ? String(Number(rec.amount)) : '')}
      ${field('નોંધ (વૈકલ્પિક)', 'note', { value: rec?.note || '', attrs: 'maxlength="200"' })}</div>${namesList()}`,
    onOpen(form) { if (!rec) focusWide(fixed ? form.amount : form.customer); },
    async onSubmit(form) {
      const body = { client_id: cid, kind: 'receipt', entry_date: form.entry_date.value, amount: form.amount.value, note: form.note.value };
      if (rec) {
        const out = await patch(`/credit/${rec.id}`, body);
        toast(`મળેલ પૈસા સુધાર્યા — ${money(out.amount)}`);
        return out;
      }
      if (customerId) body.customer_id = customerId;
      else {
        const name = form.customer.value.trim();
        const known = (state.creditNames || []).find((n) => n.name.trim().toLowerCase() === name.toLowerCase());
        if (!known) throw new Error(`"${name}" નામનો ગ્રાહક ઉધાર યાદીમાં નથી.`);
        body.customer_id = known.id;
      }
      const out = await post('/credit', body);
      toast(`પૈસા મળ્યા — ${money(out.amount)}`);
      return out;
    },
  });
}

export const creditActions = {
  'credit-open': (el, render) => { openCustomer = Number(el.dataset.id); render(); window.scrollTo(0, 0); },
  'credit-back': (el, render) => { openCustomer = null; render(); },
  'credit-new': async (el, render) => { if (await creditForm(el.dataset.id ? Number(el.dataset.id) : null)) render(); },
  'credit-receipt': async (el, render) => { if (await receiptForm(el.dataset.id ? Number(el.dataset.id) : null)) render(); },
  async 'credit-edit'(el, render) {
    const rec = ledger?.entries.find((e) => String(e.id) === el.dataset.id);
    if (!rec) return;
    const cust = ledger.customer.id;
    if (await (rec.kind === 'credit' ? creditForm(cust, rec) : receiptForm(cust, rec))) render();
  },
  async 'credit-rename'(el, render) {
    const c = ledger?.customer; if (!c) return;
    const out = await openModal({
      title: '✏️ ગ્રાહકનું નામ બદલો',
      body: `<div class="formgrid one">${field('નવું નામ', 'name', { value: c.name, attrs: 'required maxlength="80" autocomplete="off"' })}</div>`,
      async onSubmit(form) { return patch(`/credit/customers/${c.id}`, { name: form.name.value.trim() }); },
    });
    if (out) { state.creditNames = null; toast('નામ બદલાયું'); render(); }
  },
  async 'credit-cust-delete'(el, render) {
    const c = ledger?.customer; if (!c) return;
    const due = Number(c.balance);
    if (!window.confirm(`"${c.name}" ગ્રાહકને કાઢી નાખવો છે?${due ? `\nતેનું બાકી ઉધાર ${money(c.balance)} પણ યાદીમાંથી નીકળી જશે.` : ''}`)) return;
    await del(`/credit/customers/${c.id}`);
    state.creditNames = null; openCustomer = null; ledger = null;
    toast('ગ્રાહક કાઢી નાખ્યો');
    render();
  },
  async 'credit-delete'(el, render) {
    if (!window.confirm('આ એન્ટ્રી કાઢી નાખવી છે?')) return;
    await del(`/credit/${el.dataset.id}`);
    toast('એન્ટ્રી કાઢી નાખી');
    render();
  },
};

/** Called when leaving / entering the page from the menu: always start from the customer list. */
export function resetCredit() { openCustomer = null; }

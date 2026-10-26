// ઉધાર — credit given to our customers. Separate book: not part of the day result or any other report.
import { $, $$, esc, money, num, gDate, table, metric, field, numField, openModal, toast, cleanNum } from './ui.js';
import { get, post, del, uuid } from './api.js';
import { state, canWrite } from './state.js';

let openCustomer = null; // customer id whose ledger is shown, or null for the list

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
  const { customer: c, entries } = await get(`/credit/customers/${id}`);
  root.innerHTML = `<div class="pagehead"><div><h2>📒 ${esc(c.name)} — ઉધાર ખાતું</h2><div class="sub">બાકી: <b class="amber">${money(c.balance)}</b></div></div>
    <div class="actions noprint"><button class="btn light" data-action="credit-back">◀ બધા ગ્રાહક</button><button class="btn light" data-action="print">🖨️ પ્રિન્ટ</button></div></div>
  <div class="card noprint"><div class="actions">${btn('＋ ઉધાર ઉમેરો', 'credit-new', 'primary', `data-id="${c.id}"`)}${btn('💵 પૈસા મળ્યા', 'credit-receipt', 'secondary', `data-id="${c.id}"`)}</div></div>
  <div class="card">${table(['તારીખ', 'વસ્તુ', 'ઉધાર', 'મળેલ', 'બાકી', ''],
    entries.map((e) => `<tr><td>${gDate(e.entry_date)}</td>
      <td>${e.kind === 'credit' ? e.lines.map((l) => `<div>${esc(l.item)} ${num(l.qty)} kg × ${money(l.rate)} = <b>${money(l.amount)}</b></div>`).join('') : '<span class="green">💵 પૈસા મળ્યા</span>'}${e.note ? `<small class="muted">${esc(e.note)}</small>` : ''}</td>
      <td>${e.kind === 'credit' ? `<b>${money(e.amount)}</b>` : ''}</td><td class="green">${e.kind === 'receipt' ? `<b>${money(e.amount)}</b>` : ''}</td><td class="amber"><b>${money(e.balance)}</b></td>
      <td>${canWrite() ? `<button class="btn danger small noprint" data-action="credit-delete" data-id="${e.id}" title="કાઢી નાખો">🗑️</button>` : ''}</td></tr>`),
    { empty: 'કોઈ એન્ટ્રી નથી' })}
    <p class="balance">કુલ ઉધાર ${money(c.credit)} • મળેલ ${money(c.received)} • બાકી <span class="amber">${money(c.balance)}</span></p></div>`;
}

function namesList() {
  return `<datalist id="custList">${(state.creditNames || []).map((n) => `<option value="${esc(n.name)}"></option>`).join('')}</datalist>
    <datalist id="itemList">${state.meta.vegetables.filter((v) => v.active).map((v) => `<option value="${esc(v.name)}"></option>`).join('')}</datalist>`;
}

async function ensureNames() { if (!state.creditNames) state.creditNames = (await get('/credit')).names; }
const custName = (id) => (state.creditNames || []).find((n) => String(n.id) === String(id))?.name || '';

function itemRow(i) {
  return `<div class="lineitem creditline" data-line>
    <div class="field"><label>વસ્તુ ${i + 1}</label><input name="item_${i}" list="itemList" required maxlength="60" autocomplete="off"></div>
    ${numField('kg', `qty_${i}`, '', { step: '0.001' })}
    ${numField('દર ₹', `rate_${i}`, '')}
    <div class="field lineamt"><label>રકમ</label><output data-lineamt>₹0.00</output></div>
    <button type="button" class="btn light small removeline" data-remove-line title="પંક્તિ કાઢો">✕</button></div>`;
}

export async function creditForm(customerId = null) {
  await ensureNames();
  const cid = uuid();
  const fixed = customerId ? custName(customerId) : '';
  return openModal({
    title: fixed ? `＋ ઉધાર — ${esc(fixed)}` : '＋ નવું ઉધાર', wide: true,
    body: `<div class="formgrid">
      ${field('ગ્રાહકનું નામ', 'customer', { value: fixed, attrs: `required maxlength="80" autocomplete="off" list="custList" ${fixed ? 'readonly' : ''}` })}
      ${field('તારીખ', 'entry_date', { type: 'date', value: state.date, attrs: `required max="${state.meta.today}"` })}</div>
      <h4 class="formsub">વસ્તુઓ</h4><div id="lines">${itemRow(0)}</div>
      <button type="button" class="btn secondary small" data-add-line>＋ બીજી વસ્તુ ઉમેરો</button>
      <div class="billtotal">કુલ ઉધાર: <b data-total>₹0.00</b></div>
      <div class="formgrid one">${field('નોંધ (વૈકલ્પિક)', 'note', { attrs: 'maxlength="200"' })}</div>${namesList()}`,
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
        $('[name^=item_]', $('#lines', form).lastElementChild).focus();
      });
      $('#lines', form).addEventListener('click', (e) => {
        if (!e.target.closest('[data-remove-line]')) return;
        if ($$('[data-line]', form).length === 1) return toast('ઓછામાં ઓછી એક વસ્તુ જોઈએ.', 'warn');
        e.target.closest('[data-line]').remove(); renumber(); recalc();
      });
      (fixed ? $('[name=item_0]', form) : form.customer).focus();
    },
    async onSubmit(form) {
      const rows = $$('[data-line]', form);
      const body = { client_id: cid, kind: 'credit', entry_date: form.entry_date.value, note: form.note.value,
        lines: rows.map((row) => ({ item: $('[name^=item_]', row).value.trim(), qty: $('[name^=qty_]', row).value, rate: $('[name^=rate_]', row).value })) };
      if (customerId) body.customer_id = customerId; else body.customer = form.customer.value.trim();
      const out = await post('/credit', body);
      state.creditNames = null;
      toast(`ઉધાર નોંધાયું — ${money(out.amount)}`);
      return out;
    },
  });
}

export async function receiptForm(customerId = null) {
  await ensureNames();
  const cid = uuid();
  const fixed = customerId ? custName(customerId) : '';
  let due = '';
  if (customerId) { try { due = (await get(`/credit/customers/${customerId}`)).customer.balance; } catch { /* optional */ } }
  return openModal({
    title: fixed ? `💵 પૈસા મળ્યા — ${esc(fixed)}` : '💵 ગ્રાહક પાસેથી પૈસા મળ્યા',
    body: `${due !== '' ? `<div class="billdue">બાકી ઉધાર: <b class="amber">${money(due)}</b></div>` : ''}<div class="formgrid">
      ${field('ગ્રાહકનું નામ', 'customer', { value: fixed, attrs: `required maxlength="80" autocomplete="off" list="custList" ${fixed ? 'readonly' : ''}` })}
      ${field('તારીખ', 'entry_date', { type: 'date', value: state.date, attrs: `required max="${state.meta.today}"` })}
      ${numField('મળેલ રકમ ₹', 'amount', '')}
      ${field('નોંધ (વૈકલ્પિક)', 'note', { attrs: 'maxlength="200"' })}</div>${namesList()}`,
    onOpen(form) { (fixed ? form.amount : form.customer).focus(); },
    async onSubmit(form) {
      const body = { client_id: cid, kind: 'receipt', entry_date: form.entry_date.value, amount: form.amount.value, note: form.note.value };
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
  async 'credit-delete'(el, render) {
    if (!window.confirm('આ એન્ટ્રી કાઢી નાખવી છે?')) return;
    await del(`/credit/${el.dataset.id}`);
    toast('એન્ટ્રી કાઢી નાખી');
    render();
  },
};

/** Called when leaving / entering the page from the menu: always start from the customer list. */
export function resetCredit() { openCustomer = null; }

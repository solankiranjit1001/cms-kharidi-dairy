// Entry / edit forms for every record type. The server recalculates every amount; the
// totals shown here are only a live preview.
import { $, $$, esc, money, num, field, numField, selectField, formData, cleanNum, openModal, toast,
  voiceSupported, listen, parseSpoken } from './ui.js';
import { get, post, patch, uuid, qs } from './api.js';
import { state, reloadMeta } from './state.js';

export const TYPE_LABEL = {
  purchases: 'ખરીદી', sales: 'વેચાણ', waste: 'બગડેલ માલ', returns: 'વેપારીને પરત', adjustments: 'સ્ટોક સુધારો',
  payments: 'વેપારી ચુકવણી', trader_adjustments: 'વેપારી ખાતા સુધારો', expenses: 'ખર્ચ', market: 'બજાર ભાવ', plans: 'આવતીકાલનું આયોજન', day_sales: 'દિવસનું વેચાણ',
};

const activeVegs = () => state.meta.vegetables.filter((v) => v.active);
const activeTraders = () => state.meta.traders.filter((t) => t.active);
const vegByName = (name) => state.meta.vegetables.find((v) => v.name.trim().toLowerCase() === String(name).trim().toLowerCase());
const unitOptions = () => state.meta.units.map((u) => ({ value: u, label: u }));

function vegDatalist() {
  return `<datalist id="vegList">${activeVegs().map((v) => `<option value="${esc(v.name)}"></option>`).join('')}</datalist>`;
}

function reasonField(rec) {
  return rec ? `<div class="field wide editreason">${''}<label for="f_reason">ફેરફારનું કારણ (ફરજિયાત)</label><input id="f_reason" name="reason" required minlength="2" maxlength="200" autocomplete="off" placeholder="દા.ત. જથ્થો ખોટો લખાયો હતો"></div>` : '';
}

function voiceButton() {
  return voiceSupported()
    ? `<div class="voicebar"><button type="button" class="btn voice small" data-voice>🎙️ બોલીને ભરો</button><small class="help">દા.ત. "ટામેટાં 50 કિલો 20 રૂપિયે" — સેવ પહેલાં વિગતો તપાસો.</small><div class="voiceout" hidden></div></div>`
    : '';
}

function bindVoice(form, apply) {
  const btn = $('[data-voice]', form);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const out = $('.voiceout', form);
    btn.disabled = true; btn.textContent = '🎙️ સાંભળું છું…';
    try {
      const text = await listen();
      const p = parseSpoken(text, state.meta.vegetables.map((v) => v.name));
      apply(p);
      out.hidden = false;
      out.innerHTML = `<b>સાંભળ્યું:</b> ${esc(text)}<br>શાક: <b>${esc(p.veg || 'ઓળખાયું નહીં')}</b> • જથ્થો: <b>${esc(p.qty || '—')}</b> • દર: <b>${esc(p.rate || '—')}</b><br><span class="amber">ખાના ભરાયા છે — તપાસીને પછી જ "સેવ કરો" દબાવો.</span>`;
    } catch (e) {
      out.hidden = false; out.textContent = e.message;
    } finally { btn.disabled = false; btn.textContent = '🎙️ બોલીને ભરો'; }
  });
}

/** Trader picker: existing traders + "new trader" option that reveals a name box. */
function traderPicker(selectedId, { label = 'વેપારી', allowNew = true } = {}) {
  const opts = [{ value: '', label: '— વેપારી પસંદ કરો —' }, ...activeTraders().map((t) => ({ value: t.id, label: t.name }))];
  if (selectedId && !activeTraders().some((t) => t.id === selectedId)) {
    const t = state.meta.traders.find((x) => x.id === selectedId); if (t) opts.push({ value: t.id, label: t.name });
  }
  if (allowNew) opts.push({ value: '__new', label: '➕ નવો વેપારી ઉમેરો' });
  return selectField(label, 'trader_id', opts, selectedId || '', { attrs: 'required data-trader-select' }) +
    `<div class="field newtrader" hidden><label for="f_new_trader">નવા વેપારીનું નામ</label><input id="f_new_trader" name="new_trader" maxlength="80" autocomplete="off"></div>`;
}
function bindTraderPicker(form) {
  const sel = $('[data-trader-select]', form);
  if (!sel) return;
  const box = $('.newtrader', form);
  const sync = () => { const isNew = sel.value === '__new'; box.hidden = !isNew; $('input', box).required = isNew; };
  sel.addEventListener('change', sync); sync();
}
function traderBody(d) {
  if (d.trader_id === '__new') return { trader: d.new_trader, createTrader: true };
  return { trader_id: d.trader_id };
}

/** Vegetable text box with suggestions; reveals a unit selector when the name is new. */
function vegInput(name, value = '', { label = 'શાક', idx = '' } = {}) {
  return `<div class="field veginput"><label>${label}</label><input name="${name}" list="vegList" value="${esc(value)}" required maxlength="60" autocomplete="off" data-veg>
    <div class="newveg" hidden><small class="amber">નવું શાક યાદીમાં ઉમેરાશે. એકમ:</small><select name="${name}_unit${idx}">${unitOptions().map((o) => `<option>${esc(o.value)}</option>`).join('')}</select></div></div>`;
}
function bindVegInputs(form) {
  for (const inp of $$('[data-veg]', form)) {
    const sync = () => {
      const box = $('.newveg', inp.closest('.field'));
      const known = !inp.value.trim() || vegByName(inp.value);
      box.hidden = Boolean(known);
      const v = vegByName(inp.value);
      const unitLabel = inp.closest('.lineitem')?.querySelector('[data-unit]');
      if (unitLabel) unitLabel.textContent = v ? v.unit : $('select', box).value;
    };
    inp.addEventListener('input', sync); $('select', inp.closest('.field')).addEventListener('change', sync); sync();
  }
}
function vegBody(nameValue, unitValue) {
  const v = vegByName(nameValue);
  return v ? { vegetable_id: v.id } : { vegetable: nameValue, unit: unitValue, createVegetable: true };
}

// ============ PURCHASE (bill with many lines) ============
function lineRow(i, l = {}) {
  const v = l.vegetable_id ? state.meta.vegetables.find((x) => x.id === l.vegetable_id) : null;
  return `<div class="lineitem" data-line>
    ${vegInput(`veg_${i}`, v ? v.name : l.vegetable || '', { label: `શાક ${i + 1}`, idx: '' })}
    ${numField('જથ્થો <span data-unit>' + esc(v ? v.unit : 'kg') + '</span>', `qty_${i}`, l.qty ? Number(l.qty) : '', { step: '0.001' })}
    ${numField('દર ₹', `rate_${i}`, l.rate ? Number(l.rate) : '')}
    ${numField('મુદ્દા (પાર્સલ)', `mudda_${i}`, l.mudda ?? '', { step: '1', required: false })}
    ${selectField('6% કમિશન', `comm_${i}`, [{ value: 'incl', label: 'ભેગું' }, { value: 'excl', label: 'અલગ (+6%)' }], l.commission_excl ? 'excl' : 'incl')}
    <div class="field lineamt"><label>રકમ</label><output data-lineamt>₹0.00</output><small class="muted" data-linecomm></small></div>
    <button type="button" class="btn light small removeline" data-remove-line title="પંક્તિ કાઢો">✕</button>
  </div>`;
}

export async function purchaseForm(rec = null) {
  const lines = rec ? rec.lines : [{}];
  const body = `${voiceButton()}<div class="formgrid">
      ${field('તારીખ', 'entry_date', { type: 'date', value: rec ? rec.entry_date : state.date, attrs: `required max="${state.meta.today}"` })}
      ${traderPicker(rec ? rec.trader_id : '')}
      ${field('બિલ નંબર (વૈકલ્પિક)', 'bill_no', { value: rec?.bill_no || '', attrs: 'maxlength="40" autocomplete="off"' })}
    </div>
    <h4 class="formsub">શાકભાજી</h4>
    <div id="lines">${lines.map((l, i) => lineRow(i, l)).join('')}</div>
    <button type="button" class="btn secondary small" data-add-line>＋ બીજું શાક ઉમેરો</button>
    <div class="billtotal">કુલ બિલ: <b data-total>₹0.00</b><span data-mudda></span><br><small class="muted">દરેક રકમ પૂરા રૂપિયામાં રાઉન્ડ ઑફ થાય છે (50 પૈસા કે વધુ = ઉપર)</small></div>
    ${rec ? '' : `<h4 class="formsub">વેપારીને ચુકવણી અને ખર્ચ (વૈકલ્પિક)</h4><div class="formgrid">
      ${numField('અત્યારે ચૂકવેલ રકમ ₹', 'paid_amount', '', { required: false, help: 'ખાલી = પૂરું ઉધાર • ઓછી રકમ = બાકી વેપારી ખાતામાં રહેશે' })}
      ${selectField('ચુકવણી માધ્યમ', 'paid_method', state.meta.paymentMethods, 'રોકડ')}
      ${field('રેફરન્સ / UPI', 'paid_reference', { attrs: 'maxlength="80" autocomplete="off"' })}
      ${numField('ટ્રાન્સપોર્ટ / હમાલી ખર્ચ ₹', 'transport_amount', '', { required: false, help: 'અલગ ખર્ચ તરીકે નોંધાશે' })}
      ${selectField('ખર્ચ પ્રકાર', 'transport_category', ['ટ્રાન્સપોર્ટ', 'હમાલી/મજૂરી'], 'ટ્રાન્સપોર્ટ')}
    </div><div class="billtotal">ચૂકવેલ <b data-paid>₹0.00</b> • વેપારીને ચૂકવવાના બાકી: <b class="amber" data-due>₹0.00</b></div>`}
    <div class="formgrid one">${field('નોંધ', 'note', { value: rec?.note || '', attrs: 'maxlength="300"' })}${reasonField(rec)}</div>
    ${vegDatalist()}`;
  const cid = uuid();
  return openModal({
    title: rec ? `ખરીદી બિલ #${rec.id} માં ફેરફાર` : '🧺 નવી ખરીદી', body, wide: true,
    onOpen(form) {
      bindTraderPicker(form);
      const recalc = () => {
        let total = 0, mudda = 0;
        for (const row of $$('[data-line]', form)) {
          const q = Number(cleanNum($('[name^=qty_]', row).value)) || 0, r = Number(cleanNum($('[name^=rate_]', row).value)) || 0;
          // round off to whole rupees, same rule as the server (₹0.50 and above goes up)
          const base = Math.round(Math.round(q * r * 100) / 100);
          const excl = $('[name^=comm_]', row).value === 'excl';
          const comm = excl ? Math.round(base * 6 / 100) : 0;
          const amt = base + comm; total += amt;
          $('[data-lineamt]', row).textContent = money(amt);
          $('[data-linecomm]', row).textContent = excl ? `${money(base)} + 6% ${money(comm)}` : '';
          mudda += Number(cleanNum($('[name^=mudda_]', row).value)) || 0;
        }
        $('[data-total]', form).textContent = money(total);
        $('[data-mudda]', form).textContent = mudda ? ` • કુલ મુદ્દા: ${mudda}` : '';
        const dueEl = $('[data-due]', form);
        if (dueEl) {
          const paid = Math.round(Number(cleanNum(form.paid_amount.value)) || 0);
          $('[data-paid]', form).textContent = money(paid);
          const due = Math.round((total - paid) * 100) / 100;
          dueEl.textContent = due < 0 ? 'ચૂકવેલ રકમ બિલથી વધુ છે' : money(due);
          dueEl.className = due < 0 ? 'red' : due === 0 ? 'green' : 'amber';
        }
      };
      const renumber = () => $$('[data-line]', form).forEach((row, i) => {
        $('label', row).textContent = `શાક ${i + 1}`;
        $('[data-veg]', row).name = `veg_${i}`; $('.newveg select', row).name = `veg_${i}_unit`;
        $('[name^=qty_]', row).name = `qty_${i}`; $('[name^=rate_]', row).name = `rate_${i}`;
        $('[name^=mudda_]', row).name = `mudda_${i}`; $('[name^=comm_]', row).name = `comm_${i}`;
      });
      form.addEventListener('input', recalc); form.addEventListener('change', recalc);
      $('[data-add-line]', form).addEventListener('click', () => {
        const n = $$('[data-line]', form).length;
        if (n >= 40) return;
        $('#lines', form).insertAdjacentHTML('beforeend', lineRow(n));
        renumber(); bindVegInputs($('#lines', form).lastElementChild); recalc();
        $('[data-veg]', $('#lines', form).lastElementChild).focus();
      });
      $('#lines', form).addEventListener('click', (e) => {
        if (!e.target.closest('[data-remove-line]')) return;
        if ($$('[data-line]', form).length === 1) return toast('ઓછામાં ઓછું એક શાક જોઈએ.', 'warn');
        e.target.closest('[data-line]').remove(); renumber(); recalc();
      });
      renumber(); bindVegInputs(form); recalc();
      bindVoice(form, (p) => {
        const rows = $$('[data-line]', form);
        let row = rows.find((r) => !$('[data-veg]', r).value.trim());
        if (!row) { $('[data-add-line]', form).click(); row = $$('[data-line]', form).pop(); }
        if (p.veg) $('[data-veg]', row).value = p.veg;
        if (p.qty) $('[name^=qty_]', row).value = p.qty;
        if (p.rate) $('[name^=rate_]', row).value = p.rate;
        $('[data-veg]', row).dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
    async onSubmit(form) {
      const d = formData(form);
      const rows = $$('[data-line]', form);
      const payload = {
        entry_date: d.entry_date, ...traderBody(d), bill_no: d.bill_no, note: d.note,
        lines: rows.map((row, i) => ({ ...vegBody(d[`veg_${i}`], d[`veg_${i}_unit`]), qty: d[`qty_${i}`], rate: d[`rate_${i}`],
          mudda: d[`mudda_${i}`], commission: d[`comm_${i}`] })),
      };
      let out;
      if (rec) out = await patch(`/records/purchases/${rec.id}`, { ...payload, reason: d.reason });
      else out = await post('/records/purchases', { ...payload, client_id: cid, paid_amount: d.paid_amount, paid_method: d.paid_method,
        paid_reference: d.paid_reference, transport_amount: d.transport_amount, transport_category: d.transport_category });
      if (payload.lines.some((l) => l.createVegetable) || d.trader_id === '__new') await reloadMeta();
      toast(out.duplicate ? 'આ ખરીદી પહેલેથી સેવ થઈ ગઈ હતી.' : `ખરીદી સેવ થઈ — કુલ ${money(out.total_amount)}`);
      return out;
    },
  });
}

// ============ SALE ============
async function stockChoices(date, keepVegId) {
  const s = await get(`/stock${qs({ date })}`);
  const rows = s.rows.filter((r) => Number(r.closing) > 0 || r.vegetable_id === keepVegId);
  return rows;
}

export async function saleForm(rec = null) {
  const date = rec ? rec.entry_date : state.date;
  const rows = await stockChoices(date, rec?.vegetable_id);
  if (!rows.length) { toast('આ તારીખે વેચાણ માટે સ્ટોક નથી. પહેલા ખરીદી નોંધો.', 'warn'); return null; }
  const cid = uuid();
  const opts = rows.map((r) => ({ value: r.vegetable_id, label: `${r.name} — ${num(r.closing)} ${r.unit}` }));
  const body = `${voiceButton()}<div class="formgrid">
    ${field('તારીખ', 'entry_date', { type: 'date', value: date, attrs: `required max="${state.meta.today}"` })}
    ${selectField('શાક (ઉપલબ્ધ સ્ટોક)', 'vegetable_id', opts, rec ? rec.vegetable_id : rows.find((r) => Number(r.closing) > 0)?.vegetable_id)}
    ${numField('જથ્થો', 'qty', rec ? Number(rec.qty) : '', { step: '0.001', help: '<span data-avail></span>' })}
    ${numField('વેચાણ દર ₹', 'rate', rec ? Number(rec.rate) : '')}
    ${numField('છૂટ / બાદ ₹', 'discount', rec && Number(rec.discount) ? Number(rec.discount) : '', { required: false })}
    ${selectField('ચુકવણી', 'payment_mode', state.meta.saleModes, rec?.payment_mode || 'રોકડ')}
    ${field('ગ્રાહક (વૈકલ્પિક)', 'customer', { value: rec?.customer || '', attrs: 'maxlength="80" autocomplete="off"' })}
    ${field('નોંધ', 'note', { value: rec?.note || '', attrs: 'maxlength="300"' })}
    </div><div class="billtotal">ચોખ્ખું વેચાણ: <b data-total>₹0.00</b></div><div class="formgrid one">${reasonField(rec)}</div>`;
  return openModal({
    title: rec ? `વેચાણ #${rec.id} માં ફેરફાર` : '🛒 વેચાણ ઉમેરો', body,
    onOpen(form) {
      const recalc = () => {
        const g = Math.round((Number(cleanNum(form.qty.value)) || 0) * (Number(cleanNum(form.rate.value)) || 0));
        $('[data-total]', form).textContent = money(g - Math.round(Number(cleanNum(form.discount.value)) || 0));
      };
      const avail = async () => {
        const span = $('[data-avail]', form);
        try {
          const a = await get(`/stock/available${qs({ vegetable_id: form.vegetable_id.value, date: form.entry_date.value })}`);
          const own = rec && String(rec.vegetable_id) === form.vegetable_id.value ? Number(rec.qty) : 0;
          const v = state.meta.vegetables.find((x) => String(x.id) === form.vegetable_id.value);
          span.textContent = `વેચી શકાય: ${num(Number(a.canTake) + own)} ${v ? v.unit : ''}`;
        } catch { span.textContent = ''; }
      };
      form.addEventListener('input', recalc);
      form.vegetable_id.addEventListener('change', avail); form.entry_date.addEventListener('change', avail);
      recalc(); avail();
      bindVoice(form, (p) => {
        const v = vegByName(p.veg);
        if (v && [...form.vegetable_id.options].some((o) => o.value === String(v.id))) { form.vegetable_id.value = v.id; avail(); }
        if (p.qty) form.qty.value = p.qty;
        if (p.rate) form.rate.value = p.rate;
        recalc();
      });
    },
    async onSubmit(form) {
      const d = formData(form);
      const payload = { entry_date: d.entry_date, vegetable_id: d.vegetable_id, qty: d.qty, rate: d.rate, discount: d.discount || '0',
        payment_mode: d.payment_mode, customer: d.customer, note: d.note };
      const out = rec ? await patch(`/records/sales/${rec.id}`, { ...payload, reason: d.reason }) : await post('/records/sales', { ...payload, client_id: cid });
      toast(`વેચાણ સેવ થયું — ${money(out.amount)}`);
      return out;
    },
  });
}

// ============ simple forms ============
function simple({ type, rec, title, fields, onOpen, toBody, done }) {
  const cid = uuid();
  return openModal({
    title: rec ? `${TYPE_LABEL[type]} #${rec.id} માં ફેરફાર` : title,
    body: `<div class="formgrid">${fields}</div><div class="formgrid one">${reasonField(rec)}</div>${vegDatalist()}`,
    onOpen(form) { bindTraderPicker(form); bindVegInputs(form); if (onOpen) onOpen(form); },
    async onSubmit(form) {
      const d = formData(form);
      const payload = toBody(d);
      const out = rec ? await patch(`/records/${type}/${rec.id}`, { ...payload, reason: d.reason }) : await post(`/records/${type}`, { ...payload, client_id: cid });
      if (payload.createVegetable || payload.createTrader) await reloadMeta();
      toast(done ? done(out) : 'સેવ થયું');
      return out;
    },
  });
}

const dateField = (rec, name = 'entry_date', any = false) =>
  field('તારીખ', name, { type: 'date', value: rec ? rec[name] : state.date, attrs: `required ${any ? '' : `max="${state.meta.today}"`}` });
const vegName = (rec) => (rec ? state.meta.vegetables.find((v) => v.id === rec.vegetable_id)?.name || rec.vegetable : '');

export async function wasteForm(rec = null) {
  const rows = await stockChoices(rec ? rec.entry_date : state.date, rec?.vegetable_id);
  if (!rows.length) { toast('બગડેલ માલ નોંધવા માટે સ્ટોક નથી.', 'warn'); return null; }
  return simple({ type: 'waste', rec, title: '♻️ બગડેલ માલ નોંધો',
    fields: `${dateField(rec)}
      ${selectField('શાક', 'vegetable_id', rows.map((r) => ({ value: r.vegetable_id, label: `${r.name} — ${num(r.closing)} ${r.unit}` })), rec?.vegetable_id)}
      ${numField('જથ્થો', 'qty', rec ? Number(rec.qty) : '', { step: '0.001' })}
      ${selectField('કારણ', 'reason_kind', ['બગડેલ / સડેલ', 'સુકાઈ ગયેલ', 'તૂટેલ / દબાયેલ', 'વજન ઘટ', 'અન્ય'], 'બગડેલ / સડેલ')}
      ${field('વિગત (વૈકલ્પિક)', 'reason_text', { value: rec?.reason || '', attrs: 'maxlength="150"' })}
      ${numField('અંદાજિત દર ₹ (ખાલી = સરેરાશ ખરીદી દર)', 'est_rate', rec ? Number(rec.est_rate) : '', { required: false })}`,
    toBody: (d) => ({ entry_date: d.entry_date, vegetable_id: d.vegetable_id, qty: d.qty, est_rate: d.est_rate,
      reason: d.reason_text && rec ? d.reason_text : [d.reason_kind, d.reason_text].filter(Boolean).join(' • ') }),
    done: (o) => `બગડેલ માલ નોંધાયો (${num(o.qty)}) — આવકમાં ગણાતો નથી`,
  });
}

export function returnForm(rec = null, traderId = null) {
  return simple({ type: 'returns', rec, title: '↩️ વેપારીને માલ પરત',
    fields: `${dateField(rec)}${traderPicker(rec ? rec.trader_id : traderId, { allowNew: false })}
      ${vegInput('vegetable', vegName(rec))}
      ${numField('જથ્થો', 'qty', rec ? Number(rec.qty) : '', { step: '0.001' })}
      ${numField('દર ₹', 'rate', rec ? Number(rec.rate) : '')}
      ${field('નોંધ', 'note', { value: rec?.note || '', attrs: 'maxlength="300"' })}`,
    toBody: (d) => ({ entry_date: d.entry_date, ...traderBody(d), ...vegBody(d.vegetable, d.vegetable_unit), qty: d.qty, rate: d.rate, note: d.note }),
    done: (o) => `પરત નોંધાયું — ${money(o.amount)} વેપારીની બાકીમાંથી ઘટ્યા`,
  });
}

export function adjustmentForm(rec = null) {
  return simple({ type: 'adjustments', rec, title: '± કારણ સાથે સ્ટોક સુધારો',
    fields: `${dateField(rec)}${vegInput('vegetable', vegName(rec))}
      ${numField('જથ્થો (+ ઉમેરો / − ઘટાડો)', 'qty', rec ? Number(rec.qty) : '', { step: '0.001', min: null, help: 'ઘટાડવા માટે આગળ − લખો, દા.ત. -2' })}
      ${field('કારણ (ફરજિયાત)', 'adj_reason', { value: rec?.reason || '', attrs: 'required minlength="2" maxlength="200"' })}`,
    toBody: (d) => ({ entry_date: d.entry_date, ...vegBody(d.vegetable, d.vegetable_unit), qty: d.qty, reason: d.adj_reason }),
    done: () => 'સ્ટોક સુધારો નોંધાયો',
  });
}

export async function paymentForm(rec = null, traderId = null) {
  return simple({ type: 'payments', rec, title: '💳 વેપારીને ચુકવણી',
    fields: `${dateField(rec)}${traderPicker(rec ? rec.trader_id : traderId, { allowNew: false })}
      ${numField('રકમ ₹', 'amount', rec ? Number(rec.amount) : '')}
      ${selectField('માધ્યમ', 'method', state.meta.paymentMethods, rec?.method || 'રોકડ')}
      ${field('રેફરન્સ / UPI / ચેક નં.', 'reference', { value: rec?.reference || '', attrs: 'maxlength="80" autocomplete="off"' })}
      ${selectField('બિલ સામે (વૈકલ્પિક)', 'purchase_id', [{ value: '', label: '— ખાતામાં સામાન્ય ચુકવણી —' }], rec?.purchase_id || '', { attrs: 'data-bills' })}
      ${field('નોંધ', 'note', { value: rec?.note || '', attrs: 'maxlength="300"' })}`,
    onOpen(form) {
      const load = async () => {
        const sel = $('[data-bills]', form);
        const tid = form.trader_id.value;
        sel.innerHTML = '<option value="">— ખાતામાં સામાન્ય ચુકવણી —</option>';
        if (!tid || tid === '__new') return;
        try {
          const bills = await get(`/records/purchases${qs({ trader_id: tid, unpaid: 1, limit: 50 })}`);
          for (const b of bills) sel.insertAdjacentHTML('beforeend', `<option value="${b.id}">#${b.id} • ${esc(b.entry_date)} • બાકી ${money(b.due_amount)}</option>`);
          if (rec?.purchase_id && ![...sel.options].some((o) => o.value === String(rec.purchase_id))) sel.insertAdjacentHTML('beforeend', `<option value="${rec.purchase_id}">#${rec.purchase_id}</option>`);
          if (rec?.purchase_id) sel.value = rec.purchase_id;
        } catch { /* optional */ }
      };
      form.trader_id.addEventListener('change', load); load();
    },
    toBody: (d) => ({ entry_date: d.entry_date, ...traderBody(d), amount: d.amount, method: d.method, reference: d.reference, purchase_id: d.purchase_id || null, note: d.note }),
    done: (o) => `ચુકવણી નોંધાઈ — ${money(o.amount)}`,
  });
}

export function traderAdjForm(rec = null, traderId = null) {
  return simple({ type: 'trader_adjustments', rec, title: '⚖️ વેપારી ખાતામાં સુધારો (માલિક)',
    fields: `${dateField(rec)}${traderPicker(rec ? rec.trader_id : traderId, { allowNew: false })}
      ${numField('રકમ ₹ (+ બાકી વધે / − બાકી ઘટે)', 'amount', rec ? Number(rec.amount) : '', { min: null, help: 'દા.ત. ભાવ ફરક માટે -50' })}
      ${field('કારણ (ફરજિયાત)', 'adj_reason', { value: rec?.reason || '', attrs: 'required minlength="2" maxlength="200"' })}`,
    toBody: (d) => ({ entry_date: d.entry_date, ...traderBody(d), amount: d.amount, reason: d.adj_reason }),
    done: () => 'ખાતા સુધારો નોંધાયો',
  });
}

export function expenseForm(rec = null) {
  return simple({ type: 'expenses', rec, title: '💸 દૈનિક ખર્ચ',
    fields: `${dateField(rec)}
      ${selectField('ખર્ચ પ્રકાર', 'category', [...new Set([...state.meta.expenseCategories, ...(rec ? [rec.category] : [])])], rec?.category || 'ટ્રાન્સપોર્ટ')}
      ${numField('રકમ ₹', 'amount', rec ? Number(rec.amount) : '')}
      ${field('નોંધ', 'note', { value: rec?.note || '', attrs: 'maxlength="300"' })}`,
    toBody: (d) => ({ entry_date: d.entry_date, category: d.category, amount: d.amount, note: d.note }),
    done: (o) => `ખર્ચ નોંધાયો — ${money(o.amount)}`,
  });
}

export function marketForm(rec = null) {
  const markets = [...state.meta.markets, 'અન્ય'];
  const isOther = rec && !state.meta.markets.includes(rec.market);
  return simple({ type: 'market', rec, title: '📊 બજાર ભાવ નોંધો',
    fields: `${dateField(rec, 'obs_date')}
      ${selectField('બજાર', 'market_sel', markets, rec ? (isOther ? 'અન્ય' : rec.market) : 'ભાવનગર')}
      ${field('અન્ય બજારનું નામ', 'market_other', { value: isOther ? rec.market : '', attrs: 'maxlength="40"' })}
      ${vegInput('vegetable', vegName(rec))}
      ${numField('ભાવ ₹', 'price', rec ? Number(rec.price) : '')}
      ${selectField('એકમ', 'unit', state.meta.units, rec?.unit || 'kg')}
      ${field('ગ્રેડ / ગુણવત્તા', 'grade', { value: rec?.grade || '', attrs: 'maxlength="60"' })}
      ${field('સ્રોત / નોંધ (કોણે કહ્યું?)', 'source', { value: rec?.source || '', attrs: 'maxlength="200"' })}`,
    onOpen(form) {
      const sync = () => { const o = form.market_sel.value === 'અન્ય'; form.market_other.closest('.field').hidden = !o; form.market_other.required = o; };
      form.market_sel.addEventListener('change', sync); sync();
    },
    toBody: (d) => ({ obs_date: d.obs_date, market: d.market_sel === 'અન્ય' ? d.market_other : d.market_sel, ...vegBody(d.vegetable, d.vegetable_unit),
      price: d.price, unit: d.unit, grade: d.grade, source: d.source }),
    done: () => 'બજાર ભાવ નોંધાયો',
  });
}

export function planForm(rec = null) {
  const tomorrow = new Date(state.date + 'T00:00:00Z'); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return simple({ type: 'plans', rec, title: '🌅 આવતીકાલનું આયોજન',
    fields: `${field('તારીખ', 'plan_date', { type: 'date', value: rec ? rec.plan_date : tomorrow.toISOString().slice(0, 10), attrs: 'required' })}
      ${vegInput('vegetable', vegName(rec))}
      ${numField('લક્ષ્ય જથ્થો', 'qty', rec?.qty ? Number(rec.qty) : '', { step: '0.001', required: false })}
      ${numField('લક્ષ્ય ખરીદી ભાવ ₹', 'rate', rec?.rate ? Number(rec.rate) : '', { required: false })}
      ${field('નોંધ', 'note', { value: rec?.note || '', attrs: 'maxlength="300"' })}`,
    toBody: (d) => ({ plan_date: d.plan_date, ...vegBody(d.vegetable, d.vegetable_unit), qty: d.qty, rate: d.rate, note: d.note }),
    done: () => 'આયોજન સેવ થયું',
  });
}

export const FORMS = {
  purchases: purchaseForm, sales: saleForm, waste: wasteForm, returns: returnForm, adjustments: adjustmentForm,
  payments: paymentForm, trader_adjustments: traderAdjForm, expenses: expenseForm, market: marketForm, plans: planForm,
};

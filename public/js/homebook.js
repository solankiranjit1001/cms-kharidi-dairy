// v10: ઘર ખર્ચ — home income & expenses, Khatabook cash-book style. A separate book (not in any business figure).
// Every entry says only where the money came from / what it was spent on — no person accounts.
import { $, esc, money, gDate, field, numField, metric, openModal, toast, addDays } from './ui.js';
import { get, post, patch, del, uuid } from './api.js';
import { state, canWrite } from './state.js';

const PERIODS = [{ key: 'month', label: 'આ મહિનો' }, { key: 'last', label: 'ગયો મહિનો' }, { key: 'today', label: 'આજે' }, { key: 'custom', label: '📅 તારીખ પસંદ કરો' }];
let period = 'month';
const custom = { from: '', to: '' };
let book = null;

function range() {
  const t = state.meta.today;
  if (period === 'today') return { from: t, to: t };
  if (period === 'last') { const end = addDays(`${t.slice(0, 8)}01`, -1); return { from: `${end.slice(0, 8)}01`, to: end }; }
  if (period === 'custom' && custom.from && custom.to) return { ...custom };
  return { from: `${t.slice(0, 8)}01`, to: t };
}

const wbtn = (label, action, cls, extra = '') => (canWrite() ? `<button class="btn ${cls}" data-action="${action}" ${extra}>${label}</button>` : '');

export async function homebookPage(root) {
  const r = range();
  book = await get(`/homebook?from=${r.from}&to=${r.to}`);
  const b = book;
  const net = Number(b.net);
  // group entries by date (newest first), with the day's in / out
  const days = [];
  for (const e of b.entries) {
    let d = days[days.length - 1];
    if (!d || d.date !== e.entry_date) { d = { date: e.entry_date, inc: 0, exp: 0, list: [] }; days.push(d); }
    d.list.push(e); if (e.kind === 'income') d.inc += Number(e.amount); else d.exp += Number(e.amount);
  }
  root.innerHTML = `<div class="pagehead"><div><h2>👪 ઘર ખર્ચ — આવક અને ખર્ચ</h2>
      <div class="sub">ઘરનો અલગ હિસાબ — ધંધાના પરિણામ કે બીજા કોઈ રિપોર્ટમાં ગણાતો નથી</div></div>
    <div class="actions noprint"><button class="btn light" data-action="print">🖨️ પ્રિન્ટ</button></div></div>
  <div class="card noprint"><div class="periodbtns">${PERIODS.map((x) => `<button class="btn ${x.key === period ? 'primary' : 'light'} small" data-action="hb-period" data-p="${x.key}">${x.label}</button>`).join('')}</div>
    <div class="periodrange" ${period === 'custom' ? '' : 'hidden'}>${field('તારીખથી', 'hbfrom', { type: 'date', value: r.from, attrs: `max="${state.meta.today}"` })}
      ${field('તારીખ સુધી', 'hbto', { type: 'date', value: r.to, attrs: `max="${state.meta.today}"` })}
      <button class="btn primary small" data-action="hb-period" data-p="custom" data-go="1">બતાવો</button></div></div>
  <div class="hbbig noprint">${wbtn('＋ આવક', 'hb-new', 'hbin', 'data-kind="income"')}${wbtn('− ખર્ચ', 'hb-new', 'hbout', 'data-kind="expense"')}</div>
  <div class="grid">
    ${metric('કુલ આવક', money(b.income), 'green', `${gDate(b.from)} – ${gDate(b.to)}`)}
    ${metric('કુલ ખર્ચ', money(b.expense), 'red', `${b.entries.filter((e) => e.kind === 'expense').length} એન્ટ્રી`)}
    ${metric(net >= 0 ? 'બચત (આવક − ખર્ચ)' : 'આવક કરતાં વધુ ખર્ચ', money(Math.abs(net)), net >= 0 ? 'green' : 'red')}
    ${metric('હાથ પર બાકી (શરૂઆતથી)', money(b.closing), Number(b.closing) >= 0 ? 'blue' : 'red', `આ સમયગાળા પહેલાંનું ${money(b.opening)}`)}
  </div>
  <div class="card"><h3 class="sectiontitle">રોજમેળ</h3>
    ${days.length ? days.map((d) => `<div class="hbday"><div class="hbdayhead"><b>${gDate(d.date)}</b><span>${d.inc ? `<span class="green">+ ${money(d.inc)}</span>` : ''}${d.exp ? ` <span class="red">− ${money(d.exp)}</span>` : ''}</span></div>
      ${d.list.map((e) => `<div class="hbrow ${e.kind}"><div class="hbwhat"><b>${e.kind === 'income' ? 'આવક: ' : ''}${esc(e.head)}</b> <span class="pill">${esc(e.mode)}</span>${e.note ? `<div class="muted small">${esc(e.note)}</div>` : ''}</div>
        <div class="hbamt ${e.kind === 'income' ? 'green' : 'red'}">${e.kind === 'income' ? '+' : '−'} ${money(e.amount)}</div>
        ${canWrite() ? `<div class="rowactions noprint"><button class="btn light small" data-action="hb-edit" data-id="${e.id}" title="સુધારો">✏️</button><button class="btn danger small" data-action="hb-delete" data-id="${e.id}" title="કાઢી નાખો">🗑️</button></div>` : ''}</div>`).join('')}</div>`).join('')
    : '<div class="empty">આ સમયગાળામાં કોઈ એન્ટ્રી નથી</div>'}</div>
  ${b.by_head.length ? `<div class="card"><h3 class="sectiontitle">શેના પર કેટલું</h3><div class="tablewrap hbheads"><table><thead><tr><th>વિગત</th><th>આવક</th><th>ખર્ચ</th></tr></thead><tbody>
    ${b.by_head.map((h) => `<tr><td>${esc(h.head)}</td><td class="green">${h.kind === 'income' ? money(h.amount) : ''}</td><td class="red">${h.kind === 'expense' ? money(h.amount) : ''}</td></tr>`).join('')}
    </tbody><tfoot><tr><td><b>કુલ</b></td><td class="green"><b>${money(b.income)}</b></td><td class="red"><b>${money(b.expense)}</b></td></tr></tfoot></table></div></div>` : ''}`;
}

/** Add / edit one entry. kind = 'income' | 'expense'. */
async function entryForm(kind, rec = null) {
  const cid = uuid();
  const inc = kind === 'income';
  const heads = (book?.heads?.[kind] || []);
  const mode = rec?.mode || 'રોકડ';
  return openModal({
    title: rec ? (inc ? '✏️ આવક સુધારો' : '✏️ ખર્ચ સુધારો') : (inc ? '＋ આવક (પૈસા આવ્યા)' : '− ખર્ચ (પૈસા ગયા)'),
    body: `<div class="formgrid">
      ${numField('રકમ ₹', 'amount', rec ? String(Number(rec.amount)) : '')}
      ${field('તારીખ', 'entry_date', { type: 'date', value: rec?.entry_date || state.meta.today, attrs: `required max="${state.meta.today}"` })}
      ${field(inc ? 'આવક ક્યાંથી' : 'ખર્ચ શેના પર', 'head', { value: rec?.head || '', attrs: 'required maxlength="60" autocomplete="off" list="hbHeads"' })}
      <div class="field"><label>રોકડ / ઓનલાઇન</label><div class="hbmode">${['રોકડ', 'ઓનલાઇન'].map((m) => `<label class="paidtick"><input type="radio" name="mode" value="${m}"${m === mode ? ' checked' : ''}> ${m === 'રોકડ' ? '💵' : '📱'} ${m}</label>`).join('')}</div></div>
      </div>
      <div class="hbchips">${heads.slice(0, 12).map((h) => `<button type="button" class="btn light small" data-head="${esc(h)}">${esc(h)}</button>`).join('')}</div>
      <div class="formgrid one">${field('નોંધ (વૈકલ્પિક)', 'note', { value: rec?.note || '', attrs: 'maxlength="200"' })}</div>
      <datalist id="hbHeads">${heads.map((h) => `<option value="${esc(h)}"></option>`).join('')}</datalist>`,
    onOpen(form) {
      form.addEventListener('click', (e) => { const c = e.target.closest('[data-head]'); if (c) form.head.value = c.dataset.head; });
    },
    async onSubmit(form) {
      const body = { kind, amount: form.amount.value, entry_date: form.entry_date.value, head: form.head.value.trim(), mode: form.mode.value, note: form.note.value };
      const out = rec ? await patch(`/homebook/${rec.id}`, body) : await post('/homebook', { ...body, client_id: cid });
      toast(`${inc ? 'આવક' : 'ખર્ચ'} ${rec ? 'સુધારી' : 'નોંધાઈ'} — ${money(out.amount || body.amount)}`);
      return out;
    },
  });
}

export const homebookActions = {
  'hb-period': (el, render) => {
    if (el.dataset.go) { custom.from = $('[name=hbfrom]').value; custom.to = $('[name=hbto]').value; if (!custom.from || !custom.to) return toast('બંને તારીખ પસંદ કરો', 'warn'); }
    period = el.dataset.p; render();
  },
  'hb-new': async (el, render) => { if (await entryForm(el.dataset.kind)) render(); },
  'hb-edit': async (el, render) => {
    const rec = book?.entries.find((e) => String(e.id) === el.dataset.id);
    if (rec && await entryForm(rec.kind, rec)) render();
  },
  async 'hb-delete'(el, render) {
    if (!window.confirm('આ એન્ટ્રી કાઢી નાખવી છે?')) return;
    await del(`/homebook/${el.dataset.id}`);
    toast('એન્ટ્રી કાઢી નાખી');
    render();
  },
};

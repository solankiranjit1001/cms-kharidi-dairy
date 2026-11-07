// v9: message the trader (and his people) on WhatsApp or the phone's own SMS — no SMS package needed.
// A web app cannot send by itself, so we open WhatsApp / the SMS app with the Gujarati text already typed; one tap sends it.
import { $, $$, esc, openModal, toast } from './ui.js';
import { get, post, put } from './api.js';
import { state, canWrite, isOwner } from './state.js';

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const smsLink = (mobile, text) => `sms:${mobile}${isIOS() ? '&' : '?'}body=${encodeURIComponent(text)}`;
export const waLink = (mobile, text) => `https://wa.me/91${mobile}?text=${encodeURIComponent(text)}`;

const TITLE = { purchases: 'ખરીદી બિલ', payments: 'ચુકવણી', traders: 'હિસાબ' };

function personRow(c) {
  return `<div class="msgperson" data-mobile="${esc(c.mobile)}">
    <div class="who"><b>${esc(c.name)}</b> <span class="muted">${esc(c.mobile)}</span>${c.auto_send ? ' <span class="pill green">આપોઆપ</span>' : ''}${c.note ? `<br><small class="muted">${esc(c.note)}</small>` : ''}</div>
    <div class="how"><a class="btn wa small" data-ch="whatsapp" target="_blank" rel="noopener" href="#">🟢 WhatsApp</a><a class="btn light small" data-ch="sms" href="#">✉️ SMS</a></div>
  </div>`;
}

/**
 * Message window for one purchase / payment / trader. With { auto: true } it opens only when the trader has
 * at least one person marked "આપોઆપ" (automatic). Resolves after it is closed.
 */
export async function messageDialog(type, id, { auto = false } = {}) {
  const m = await get(`/messages/${type}/${id}`);
  const autoPeople = m.contacts.filter((c) => c.auto_send);
  if (auto && !autoPeople.length) return null;
  const others = m.contacts.filter((c) => !c.auto_send);
  let wantContacts = false;
  const people = m.contacts.length
    ? `${autoPeople.map(personRow).join('')}${others.length ? `<h4 class="formsub">બીજા માણસો</h4>${others.map(personRow).join('')}` : ''}`
    : `<div class="alert">આ વેપારીનો કોઈ મોબાઇલ નંબર નથી.</div>`;
  const body = `${auto ? `<div class="alert success">✅ ${TITLE[type]} સેવ થયું — મેસેજ તૈયાર છે. જેને મોકલવો હોય તેની સામે WhatsApp કે SMS દબાવો.</div>` : ''}
    <div class="field wide"><label for="msgText">મેસેજ (જરૂર હોય તો સુધારો)</label><textarea id="msgText" class="msgtext" rows="9" maxlength="1500">${esc(m.text)}</textarea></div>
    <h4 class="formsub">કોને મોકલવો — ${esc(m.trader.name)}</h4>
    ${people}
    <div class="actions">${canWrite() ? '<button type="button" class="btn light small" data-people>👥 માણસ / મોબાઇલ ઉમેરો-સુધારો</button>' : ''}<button type="button" class="btn light small" data-copy>📋 મેસેજ કૉપી કરો</button></div>
    <p class="note">SMS તમારા ફોનના પોતાના SMS થી જશે (કોઈ SMS પેકેજ નહીં). ગુજરાતી SMS લાંબો હોય તો 2–4 SMS ગણાય છે.</p>`;
  await openModal({
    title: `📩 ${esc(m.trader.name)} ને મેસેજ`, body, readOnly: true, wide: true,
    onOpen(form) {
      const ta = $('#msgText', form);
      const refresh = () => {
        for (const row of $$('.msgperson', form)) {
          const mob = row.dataset.mobile;
          $('[data-ch=whatsapp]', row).href = waLink(mob, ta.value);
          $('[data-ch=sms]', row).href = smsLink(mob, ta.value);
        }
      };
      ta.addEventListener('input', refresh);
      refresh();
      form.addEventListener('click', (e) => {
        const a = e.target.closest('a[data-ch]');
        if (a) {
          // the link itself opens WhatsApp / SMS; we only note it in the history
          const row = a.closest('.msgperson');
          a.textContent = (a.dataset.ch === 'sms' ? '✉️ SMS' : '🟢 WhatsApp') + ' ✓';
          if (canWrite()) post('/messages/log', { type, id: m.id, channel: a.dataset.ch, to: [row.dataset.mobile], auto }).catch(() => {});
          return;
        }
        if (e.target.closest('[data-copy]')) {
          navigator.clipboard?.writeText(ta.value).then(() => toast('મેસેજ કૉપી થયો'), () => { ta.select(); toast('મેસેજ પસંદ થયો — કૉપી કરો', 'warn'); });
        }
        if (e.target.closest('[data-people]')) { wantContacts = true; $('#modalCancel').click(); }
      });
    },
  });
  if (wantContacts) {
    const saved = await contactsDialog(m.trader.id, m.trader.name);
    if (saved) return messageDialog(type, id);
  }
  return true;
}

/** Called after a new purchase / payment is saved: opens the message window if the owner switched automatic messages on. */
export async function autoAfterSave(type, rec) {
  if (!rec || rec.duplicate || !rec.id) return rec;
  const s = state.meta?.messages;
  if (!s?.auto || (type === 'purchases' && !s.on_purchase) || (type === 'payments' && !s.on_payment)) return rec;
  try { await messageDialog(type, rec.id, { auto: true }); } catch (e) { toast(e.message || 'મેસેજ તૈયાર ન થયો', 'warn'); }
  return rec;
}

function contactRow(c = {}, i = 0) {
  return `<div class="contactrow" data-contact data-id="${c.id || ''}">
    <div class="field"><label>નામ</label><input name="cname" value="${esc(c.name || '')}" maxlength="60" required autocomplete="off" placeholder="દા.ત. રમેશ (મુનીમ)"></div>
    <div class="field"><label>મોબાઇલ</label><input name="cmobile" type="tel" inputmode="numeric" value="${esc(c.mobile || '')}" maxlength="14" required placeholder="10 અંક"></div>
    <div class="field"><label>નોંધ</label><input name="cnote" value="${esc(c.note || '')}" maxlength="80" placeholder="દા.ત. પૈસા લેવા આવે છે"></div>
    <label class="paidtick small"><input type="checkbox" name="cauto"${c.auto_send === false ? '' : ' checked'}> આપોઆપ મેસેજ</label>
    <button type="button" class="btn ghost small" data-remove-contact title="કાઢો">✖</button>
  </div>`;
}

/** Edit the trader's people: who sells / collects money for him, and which of them get the automatic message. */
export async function contactsDialog(traderId, traderName = '') {
  const list = await get(`/traders/${traderId}/contacts`);
  return openModal({
    title: `👥 ${esc(traderName)} — માણસો અને મોબાઇલ`, wide: true,
    body: `<p class="note">વેપારી પોતે અને તેના વતી માલ વેચનાર / પૈસા લેનાર માણસો. "આપોઆપ મેસેજ" ટિક હોય તેને ખરીદી / ચુકવણી પછી મેસેજ તૈયાર થઈને ખૂલશે.</p>
      <div id="contacts">${(list.length ? list : [{ name: traderName }]).map(contactRow).join('')}</div>
      <button type="button" class="btn secondary small" data-add-contact>＋ બીજો માણસ</button>`,
    onOpen(form) {
      form.addEventListener('click', (e) => {
        if (e.target.closest('[data-add-contact]')) {
          if ($$('[data-contact]', form).length >= 15) return toast('વધુમાં વધુ 15 માણસ.', 'warn');
          $('#contacts', form).insertAdjacentHTML('beforeend', contactRow({}));
          $('[data-contact]:last-child [name=cname]', form).focus();
        }
        if (e.target.closest('[data-remove-contact]')) e.target.closest('[data-contact]').remove();
      });
    },
    async onSubmit(form) {
      const contacts = $$('[data-contact]', form).map((row) => ({
        id: row.dataset.id || null,
        name: $('[name=cname]', row).value.trim(),
        mobile: $('[name=cmobile]', row).value.trim(),
        note: $('[name=cnote]', row).value.trim(),
        auto_send: $('[name=cauto]', row).checked,
      }));
      const out = await put(`/traders/${traderId}/contacts`, { contacts });
      toast('માણસો સેવ થયા');
      return out;
    },
  });
}

/** Owner: automatic messages on/off, which entries, and the name at the end of each message. */
export async function settingsDialog() {
  const s = state.meta.messages || {};
  const tick = (name, label, on) => `<label class="paidtick"><input type="checkbox" name="${name}"${on ? ' checked' : ''}> ${label}</label>`;
  const out = await openModal({
    title: '📩 વેપારીને મેસેજ — સેટિંગ',
    body: `${tick('auto', '<b>આપોઆપ મેસેજ ચાલુ</b> — એન્ટ્રી સેવ થતાં જ મેસેજ તૈયાર થઈને ખૂલે', s.auto)}
      ${tick('on_purchase', 'ખરીદી બિલ સેવ થાય ત્યારે', s.on_purchase)}
      ${tick('on_payment', 'વેપારીને ચુકવણી સેવ થાય ત્યારે', s.on_payment)}
      <div class="formgrid one"><div class="field"><label for="msgSig">મેસેજના અંતે નામ</label><input id="msgSig" name="signature" maxlength="40" value="${esc(s.signature ?? 'CMS')}"></div></div>
      <p class="note">બંધ હોય તો પણ દરેક બિલ, ચુકવણી અને વેપારી સામે "📩 મેસેજ" બટનથી હાથે મોકલી શકાય.</p>`,
    async onSubmit(form) {
      return put('/messages/settings', { auto: form.auto.checked, on_purchase: form.on_purchase.checked, on_payment: form.on_payment.checked, signature: form.signature.value });
    },
  });
  if (out) { state.meta.messages = out; toast('મેસેજ સેટિંગ સેવ થયું'); }
  return out;
}

export const statusText = () => {
  const s = state.meta?.messages;
  if (!s?.auto) return 'આપોઆપ મેસેજ: <b>બંધ</b> (હાથે "📩 મેસેજ" બટન ચાલુ છે)';
  const on = [s.on_purchase && 'ખરીદી', s.on_payment && 'ચુકવણી'].filter(Boolean).join(' + ') || '—';
  return `આપોઆપ મેસેજ: <b class="green">ચાલુ</b> — ${on}`;
};

export const ownerSettingsCard = () => (isOwner() ? `<div class="card"><h3 class="sectiontitle">📩 વેપારીને મેસેજ (WhatsApp / SMS)</h3>
  <p>${statusText()}</p><button class="btn secondary" data-action="msg-settings">⚙️ મેસેજ સેટિંગ</button></div>` : '');

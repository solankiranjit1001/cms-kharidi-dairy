// Gujarati message text sent to a trader (WhatsApp / phone SMS). Pure functions — no database — so they are easy to test.
// Amounts arrive as NUMERIC strings ("5000.00"); quantities as "50.000".

const n = (v) => Number(v ?? 0);
/** ₹5,000 / ₹62.50 — Indian digit grouping, paise only when present. */
export function rs(v) {
  const x = n(v);
  return '₹' + x.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(x) ? 0 : 2, maximumFractionDigits: 2 });
}
const qty = (v) => String(v ?? '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
/** 2026-11-07 → 07-11-2026 */
export const dmy = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? String(d).split('-').reverse().join('-') : String(d ?? ''));

/** Line that tells the trader where his account stands after this entry. balance > 0 = we owe him. */
export function balanceLine(balance) {
  const b = n(balance);
  if (b > 0) return `તમારી કુલ બાકી: ${rs(b)}`;
  if (b < 0) return `તમારી પાસે અમારો એડવાન્સ: ${rs(-b)}`;
  return 'તમારો હિસાબ પૂરો — કોઈ બાકી નથી.';
}

const sign = (s) => (s ? `\n— ${s}` : '');

/** p: purchase record (lines, total_amount, paid_amount, due_amount, entry_date, id, trader_name). */
export function purchaseText(p, balance, signature) {
  const lines = (p.lines || []).map((l) => {
    const comm = l.commission_excl ? ` + ${l.commission_pct || 6}%` : '';
    const mudda = l.mudda !== null && l.mudda !== undefined ? ` (${l.mudda} મુદ્દા)` : '';
    return `${l.vegetable} ${qty(l.qty)} ${l.unit || 'kg'}${mudda} × ${rs(l.rate)}${comm} = ${rs(l.amount)}`;
  });
  const out = [`નમસ્તે ${p.trader_name},`, `ખરીદી બિલ #${p.id} — ${dmy(p.entry_date)}`, ...lines, `કુલ બિલ: ${rs(p.total_amount)}`];
  const paid = n(p.paid_amount), due = n(p.due_amount);
  if (paid > 0 && due <= 0) out.push(`ચૂકવ્યા: ${rs(paid)} (આખું બિલ ચૂકવેલ)`);
  else if (paid > 0) out.push(`ચૂકવ્યા: ${rs(paid)}`, `આ બિલની બાકી: ${rs(due)}`);
  out.push(balanceLine(balance));
  return out.join('\n') + sign(signature);
}

/** pay: payment record (amount, method, entry_date, purchase_id, trader_name). */
export function paymentText(pay, balance, signature) {
  const out = [`નમસ્તે ${pay.trader_name},`, `તમને ${rs(pay.amount)} ચૂકવ્યા — ${dmy(pay.entry_date)} (${pay.method || 'રોકડ'})`];
  if (pay.purchase_id) out.push(`બિલ #${pay.purchase_id} સામે`);
  if (pay.reference) out.push(`રેફરન્સ: ${pay.reference}`);
  out.push(balanceLine(balance));
  return out.join('\n') + sign(signature);
}

/** Plain account summary for the trader. */
export function balanceText(trader, balance, today, signature) {
  return [`નમસ્તે ${trader.name},`, `${dmy(today)} સુધીનો હિસાબ:`, balanceLine(balance)].join('\n') + sign(signature);
}

// Exact decimal arithmetic using BigInt. Money = paise (scale 2), quantity = scale 3.
import { bad } from './errors.js';

const GU_DIGITS = '૦૧૨૩૪૫૬૭૮૯';
export function normalizeDigits(s) {
  return String(s).replace(/[૦-૯]/g, (c) => String(GU_DIGITS.indexOf(c))).replace(/[,\s]/g, '');
}

/** Parse a decimal string/number into a BigInt scaled by 10^scale. Rejects more decimals than scale. */
export function parseDec(value, scale, label = 'સંખ્યા', { allowNegative = false } = {}) {
  if (value === null || value === undefined || value === '') throw bad(`${label} લખો.`);
  const s = normalizeDigits(typeof value === 'number' ? numberToPlain(value) : value);
  const m = /^(-)?(\d{1,12})(?:\.(\d+))?$/.exec(s);
  if (!m) throw bad(`${label} માન્ય સંખ્યા નથી.`);
  const [, neg, int, fracRaw = ''] = m;
  if (neg && !allowNegative) throw bad(`${label} ઋણ (માઇનસ) ન હોઈ શકે.`);
  const frac = fracRaw.replace(/0+$/, '');
  if (frac.length > scale) throw bad(`${label} માં વધુમાં વધુ ${scale} દશાંશ અંક ચાલે.`);
  const v = BigInt(int + frac.padEnd(scale, '0'));
  return neg ? -v : v;
}

function numberToPlain(n) {
  if (!Number.isFinite(n)) return 'x';
  // Avoid exponent notation and binary noise (0.1+0.2 style); trailing zeros are stripped by parseDec.
  return (Math.round(n * 1e6) / 1e6).toFixed(6);
}

export function fmtDec(v, scale) {
  const neg = v < 0n;
  let s = (neg ? -v : v).toString().padStart(scale + 1, '0');
  const out = scale ? `${s.slice(0, -scale)}.${s.slice(-scale)}` : s;
  return (neg ? '-' : '') + out;
}

export const paise = (v, label, opts) => parseDec(v, 2, label, opts);
export const milli = (v, label, opts) => parseDec(v, 3, label, opts);
export const rupees = (p) => fmtDec(p, 2);
export const qtyStr = (m) => fmtDec(m, 3);

/** qty (scale 3) × rate (scale 2) → paise, rounded half-up. */
export function lineAmount(qtyMilli, ratePaise) {
  const prod = qtyMilli * ratePaise; // scale 5
  const neg = prod < 0n;
  const abs = neg ? -prod : prod;
  const r = (abs + 500n) / 1000n;
  return neg ? -r : r;
}

/** Sum of NUMERIC strings at given scale → string. */
export function sumStr(values, scale = 2) {
  let t = 0n;
  for (const v of values) if (v !== null && v !== undefined) t += parseDec(v, scale, 'રકમ', { allowNegative: true });
  return fmtDec(t, scale);
}

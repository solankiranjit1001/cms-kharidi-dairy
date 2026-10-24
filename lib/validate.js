import { bad } from './errors.js';

export const PAYMENT_METHODS = ['રોકડ', 'UPI', 'બેંક', 'ચેક', 'અન્ય'];
export const SALE_MODES = ['રોકડ', 'UPI', 'બેંક', 'અન્ય'];
export const UNITS = ['kg', 'નંગ', 'ડઝન', 'મણ', 'બોક્સ', 'થેલી', 'જુડી'];
export const MARKETS = ['ભાવનગર', 'નડિયાદ', 'અમદાવાદ', 'ગોંડલ', 'મહુવા', 'રાજકોટ', 'સુરત'];
export const EXPENSE_CATEGORIES = ['ટ્રાન્સપોર્ટ', 'હમાલી/મજૂરી', 'દુકાન ભાડું', 'પેકિંગ', 'વીજળી', 'ચા/નાસ્તો', 'કમિશન', 'અન્ય'];
export const ROLES = ['owner', 'entry', 'viewer'];

/** Today's date in India (Asia/Kolkata) as YYYY-MM-DD. */
export function todayIST(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** A transaction date: valid, not before 2000, not after today (IST). */
export function txDate(s, label = 'તારીખ') {
  if (!isDate(s)) throw bad(`${label} માન્ય નથી.`);
  if (s < '2000-01-01') throw bad(`${label} બહુ જૂની છે.`);
  if (s > todayIST()) throw bad(`${label} ભવિષ્યની ન હોઈ શકે.`);
  return s;
}

export function anyDate(s, label = 'તારીખ') {
  if (!isDate(s) || s < '2000-01-01' || s > '2100-12-31') throw bad(`${label} માન્ય નથી.`);
  return s;
}

export function optDate(s, label) {
  if (s === undefined || s === null || s === '') return null;
  return anyDate(s, label);
}

export function text(s, { label = 'લખાણ', max = 200, required = false, min = 0 } = {}) {
  if (s === undefined || s === null) s = '';
  if (typeof s !== 'string' && typeof s !== 'number') throw bad(`${label} માન્ય નથી.`);
  const v = String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !v) throw bad(`${label} લખવું ફરજિયાત છે.`);
  if (v && v.length < min) throw bad(`${label} બહુ ટૂંકું છે.`);
  if (v.length > max) throw bad(`${label} વધુમાં વધુ ${max} અક્ષરનું હોઈ શકે.`);
  return v || null;
}

export function oneOf(v, list, label) {
  if (!list.includes(v)) throw bad(`${label} માન્ય નથી.`);
  return v;
}

export function id(v, label = 'ID') {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (!Number.isSafeInteger(n) || n <= 0) throw bad(`${label} માન્ય નથી.`);
  return n;
}

export function optId(v, label) {
  if (v === undefined || v === null || v === '') return null;
  return id(v, label);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function clientId(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw bad('client_id માન્ય નથી.');
  return v.toLowerCase();
}

export function nameKey(name) {
  return String(name).normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function mobile(v) {
  const s = String(v ?? '').replace(/[૦-૯]/g, (c) => '૦૧૨૩૪૫૬૭૮૯'.indexOf(c)).replace(/[\s-]/g, '').replace(/^(\+91|91|0)(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(s)) throw bad('મોબાઇલ નંબર 10 અંકનો હોવો જોઈએ.');
  return s;
}

export function pin(v) {
  const s = String(v ?? '').replace(/[૦-૯]/g, (c) => '૦૧૨૩૪૫૬૭૮૯'.indexOf(c));
  if (!/^\d{4,6}$/.test(s)) throw bad('PIN 4 થી 6 અંકનો હોવો જોઈએ.');
  if (/^(\d)\1+$/.test(s) || ['1234', '12345', '123456', '4321', '654321'].includes(s)) throw bad('આ PIN બહુ સરળ છે. બીજો PIN પસંદ કરો.');
  return s;
}

export function phone(v) {
  const s = text(v, { label: 'ફોન', max: 16 });
  if (s && !/^[0-9+ -]{6,16}$/.test(s)) throw bad('ફોન નંબર માન્ય નથી.');
  return s;
}

export function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

// Well-known wholesale markets (APMC/mandi) by vegetable — a static reference list to help decide
// where to compare prices. It is NOT price data. Live official prices: Agmarknet (Govt. of India).
export const AGMARKNET_URL = 'https://agmarknet.gov.in/';

export const GUJARAT_MARKETS = ['ભાવનગર', 'મહુવા', 'ગોંડલ', 'રાજકોટ', 'અમદાવાદ', 'સુરત', 'નડિયાદ', 'વડોદરા', 'ડીસા', 'જામનગર', 'જૂનાગઢ', 'હિંમતનગર'];
export const INDIA_MARKETS = ['નાશિક (લાસલગાંવ)', 'પિંપળગાંવ', 'પુણે', 'મુંબઈ (વાશી)', 'દિલ્હી (આઝાદપુર)', 'ઇન્દોર', 'આગ્રા', 'બેંગલુરુ', 'કોલાર', 'મદનપલ્લે', 'મંદસૌર', 'ગુંટુર'];

// key: normalized vegetable name (and common alternate spellings)
const REF = [
  { names: ['ડુંગળી', 'કાંદા', 'onion'], gujarat: ['મહુવા', 'ભાવનગર', 'ગોંડલ'], india: ['નાશિક (લાસલગાંવ)', 'પિંપળગાંવ', 'પુણે'] },
  { names: ['બટાકા', 'બટેટા', 'potato'], gujarat: ['ડીસા', 'હિંમતનગર', 'અમદાવાદ'], india: ['આગ્રા', 'ઇન્દોર', 'દિલ્હી (આઝાદપુર)'] },
  { names: ['ટામેટાં', 'ટમેટા', 'ટામેટા', 'tomato'], gujarat: ['અમદાવાદ', 'સુરત', 'વડોદરા'], india: ['કોલાર', 'મદનપલ્લે', 'નાશિક (પિંપળગાંવ)'] },
  { names: ['લસણ', 'garlic'], gujarat: ['ગોંડલ', 'જામનગર', 'રાજકોટ'], india: ['મંદસૌર', 'નીમચ', 'ઇન્દોર'] },
  { names: ['સૂકા મરચાં', 'સુકા મરચા'], gujarat: ['ગોંડલ', 'રાજકોટ'], india: ['ગુંટુર', 'ખમ્મમ', 'બ્યાડગી'] },
  { names: ['આદુ', 'ginger'], gujarat: ['અમદાવાદ', 'સુરત'], india: ['બેંગલુરુ', 'ઔરંગાબાદ', 'દિલ્હી (આઝાદપુર)'] },
];

const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();

export function famousMarkets(vegName) {
  const n = norm(vegName);
  return REF.find((r) => r.names.some((x) => norm(x) === n)) || null;
}

export function allReference() { return REF; }

// All server calls go through here. The browser never sees database credentials.
export class ApiError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

// Thin bar at the top of the screen while any request is running, so every tap gives instant feedback.
let inflight = 0;
function busy(delta) {
  inflight = Math.max(0, inflight + delta);
  document.body.classList.toggle('netbusy', inflight > 0);
}

export async function api(method, path, body) {
  busy(1);
  try { return await call(method, path, body); } finally { busy(-1); }
}

async function call(method, path, body) {
  let res;
  try {
    res = await fetch('/api' + path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-CMS': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'ઇન્ટરનેટ જોડાણ નથી. એન્ટ્રી સેવ થઈ નથી — જોડાણ આવે ત્યારે ફરી "સેવ કરો" દબાવો.');
  }
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new CustomEvent('cms:unauthorized'));
  }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || 'સર્વરમાં ભૂલ આવી. ફરી પ્રયાસ કરો.', data && data.details);
  return data;
}

export const get = (p) => api('GET', p);
export const post = (p, b = {}) => api('POST', p, b);
export const patch = (p, b = {}) => api('PATCH', p, b);
export const put = (p, b = {}) => api('PUT', p, b);
export const del = (p, b = {}) => api('DELETE', p, b);

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function qs(obj) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const s = p.toString();
  return s ? '?' + s : '';
}

export class HttpError extends Error {
  constructor(status, message, extra = undefined) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const bad = (msg, extra) => new HttpError(400, msg, extra);
export const forbidden = (msg = 'આ કામ માટે તમને પરવાનગી નથી.') => new HttpError(403, msg);
export const notFound = (msg = 'રેકોર્ડ મળ્યો નથી.') => new HttpError(404, msg);
export const conflict = (msg, extra) => new HttpError(409, msg, extra);

/** Convert any thrown error into a safe {status, body}. Never leaks SQL, stack or connection details. */
export function toResponse(err) {
  if (err instanceof HttpError) {
    return { status: err.status, body: { error: err.message, ...(err.extra ? { details: err.extra } : {}) } };
  }
  const code = err && err.code;
  if (code === '23505') return { status: 409, body: { error: 'આ માહિતી પહેલેથી સાચવેલી છે (ડુપ્લિકેટ).' } };
  if (code === '23503') return { status: 400, body: { error: 'સંબંધિત રેકોર્ડ (વેપારી/શાક) મળ્યો નથી.' } };
  if (code === '23514' || code === '22P02' || code === '22003' || code === '22007' || code === '22008') {
    return { status: 400, body: { error: 'દાખલ કરેલી માહિતી માન્ય નથી.' } };
  }
  if (code === '40P01' || code === '40001') return { status: 503, body: { error: 'સર્વર વ્યસ્ત છે, ફરી પ્રયાસ કરો.' } };
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === '57P01' || code === '53300') {
    console.error('db connection error', code);
    return { status: 503, body: { error: 'ડેટાબેઝ સાથે જોડાણ થયું નથી. થોડી વાર પછી ફરી પ્રયાસ કરો.' } };
  }
  console.error('unhandled error', code || '', err && err.message);
  return { status: 500, body: { error: 'સર્વરમાં ભૂલ આવી. ફરી પ્રયાસ કરો.' } };
}

// Data protection helpers.
//  - Sensitive partner details (PAN, Aadhaar digits, licence, RC, bank account) are encrypted at rest with AES-256-GCM.
//  - OTPs are never stored: only an HMAC of phone + code.
//  - Login tokens are HMAC-signed.
import crypto from 'node:crypto';
import { config } from '../config.js';

const KEY = crypto.createHash('sha256').update('zipi-data:' + config.dataKey).digest();
const PREFIX = 'enc:v1:';

export function encrypt(plain) {
  if (plain == null || plain === '' || String(plain).startsWith(PREFIX)) return plain ?? '';
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const body = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url');
}
export function decrypt(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value ?? '';
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'base64url'), d = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28)); return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; }
}
export const isEncrypted = v => typeof v === 'string' && v.startsWith(PREFIX);
// masked view for screens: shows just enough to recognise the value
export function mask(value, keep = 4) {
  const v = decrypt(value); if (!v) return '';
  return v.length <= keep ? '•'.repeat(v.length) : '•'.repeat(Math.min(6, v.length - keep)) + v.slice(-keep);
}
export const SENSITIVE = { vendors: ['pan', 'accountNo', 'drugLicense'], riders: ['pan', 'aadhaarLast4', 'dl', 'rc', 'accountNo'] };
export const encryptFields = (coll, doc) => { const out = { ...doc }; for (const f of SENSITIVE[coll] || []) if (out[f]) out[f] = encrypt(out[f]); return out; };
export const maskFields = (coll, doc) => { if (!doc) return doc; const out = { ...doc }; for (const f of SENSITIVE[coll] || []) if (out[f]) out[f] = mask(out[f]); return out; };
export const revealFields = (coll, doc) => { const out = {}; for (const f of SENSITIVE[coll] || []) out[f] = decrypt(doc[f]); return out; };

export const hmac = (s, purpose = 'otp') => crypto.createHmac('sha256', config.secret).update(purpose + ':' + s).digest('base64url');
export const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
export const randomDigits = n => String(crypto.randomInt(10 ** (n - 1), 10 ** n));

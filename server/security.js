import crypto from 'node:crypto';
import {config} from './config.js';

// ---------- password hashing (scrypt) ----------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(password, stored) {
  const [alg, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}
export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

// ---------- stateless signed session cookie ----------
const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
export const COOKIE = 'ev_admin';

export function createSession(username) {
  const body = b64u(JSON.stringify({u: username, csrf: crypto.randomBytes(24).toString('base64url'), exp: Date.now() + config.sessionHours * 3600e3}));
  return {token: `${body}.${sign(body)}`, maxAge: config.sessionHours * 3600};
}
export function readSession(cookieHeader) {
  const raw = /(?:^|;\s*)ev_admin=([^;]+)/.exec(cookieHeader || '')?.[1];
  if (!raw) return null;
  const [body, sig] = raw.split('.');
  if (!body || !sig || !safeEqual(sig, sign(body))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString());
    return s.exp > Date.now() ? s : null;
  } catch { return null; }
}
export function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.cookieSecure ? '; Secure' : ''}`;
}

// ---------- in-memory sliding-window rate limiter ----------
const buckets = new Map();
export function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) { buckets.set(key, hits); return false; }
  hits.push(now); buckets.set(key, hits);
  return true;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of buckets) if (!v.some((t) => now - t < 3600e3)) buckets.delete(k); }, 600e3).unref();

export function clientIp(req) {
  const hops = config.trustProxyHops;
  if (hops > 0) {
    const parts = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length >= hops) return parts[parts.length - hops];
  }
  return req.socket.remoteAddress || 'unknown';
}
export const hashIp = (ip) => crypto.createHmac('sha256', config.sessionSecret).update(ip).digest('hex').slice(0, 16);

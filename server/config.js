// All deployment-specific values come from the environment. Nothing secret is hard-coded.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

export const config = {
  port: int(process.env.PORT, 8080),
  host: process.env.HOST || '0.0.0.0',
  publicDir: process.env.PUBLIC_DIR || path.join(root, 'public'),
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  production: process.env.NODE_ENV === 'production',
  cookieSecure: (process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production' ? '1' : '0')) === '1',
  // Number of reverse proxies in front of the app (Traefik = 1). The client IP is the Nth entry from the right.
  trustProxyHops: int(process.env.TRUST_PROXY_HOPS, 0),
  sessionSecret: process.env.SESSION_SECRET || '',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  // scrypt hash produced by scripts/hash-password.mjs. ADMIN_PASSWORD (plain) is accepted for local dev only.
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
  adminPasswordPlain: process.env.ADMIN_PASSWORD || '',
  sessionHours: int(process.env.SESSION_HOURS, 8),
  // Payment defaults. The admin panel can override these at runtime (stored in the DB).
  feeToman: int(process.env.FEE_TOMAN, 3900000),
  // Registrations taken before this system existed; shown publicly together with approved ones recorded here.
  registeredBase: int(process.env.REGISTERED_BASE, 17),
  paymentCardNumber: (process.env.PAYMENT_CARD_NUMBER || '').replace(/\D/g, ''),
  paymentCardHolder: process.env.PAYMENT_CARD_HOLDER || '',
  maxReceiptBytes: int(process.env.MAX_RECEIPT_MB, 5) * 1024 * 1024,
  registrationsPerIpPerHour: int(process.env.REGISTRATIONS_PER_IP_PER_HOUR, 6),
};

export function assertConfig() {
  if (config.production) {
    if (config.sessionSecret.length < 32) throw new Error('SESSION_SECRET must be set (>=32 chars) in production');
    if (!config.adminPasswordHash) throw new Error('ADMIN_PASSWORD_HASH must be set in production');
  } else if (!config.sessionSecret) {
    config.sessionSecret = 'dev-only-secret-dev-only-secret-dev-only';
  }
}

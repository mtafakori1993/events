import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Readable} from 'node:stream';
import {config, assertConfig} from './config.js';
import {openDb, getSettings, setSetting} from './db.js';
import {clientIp, hashIp, rateLimit, createSession, readSession, sessionCookie, verifyPassword, hashPassword, safeEqual, COOKIE} from './security.js';
import {validateRegistration, sniffImage, csvCell, toFaDigits} from './validate.js';

assertConfig();
const db = openDb();
const adminHash = config.adminPasswordHash || (config.adminPasswordPlain ? hashPassword(config.adminPasswordPlain) : '');
const RECEIPT_DIR = path.join(config.dataDir, 'receipts');

// ---------- helpers ----------
class HttpError extends Error { constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; } }
const SEC_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  ...(config.cookieSecure ? {'Strict-Transport-Security': 'max-age=31536000'} : {}),
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, {...SEC_HEADERS, ...headers});
  res.end(body);
}
const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers});

async function readJson(req, limit = 16 * 1024) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'too_large', 'درخواست بیش از حد بزرگ است.'); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new HttpError(400, 'bad_json', 'درخواست نامعتبر است.'); }
}

// multipart via the platform parser, with a hard cap on bytes read
async function readForm(req, limit) {
  const declared = Number.parseInt(req.headers['content-length'] || '0', 10);
  if (declared > limit) throw new HttpError(413, 'too_large', 'حجم فایل بیش از حد مجاز است.');
  let seen = 0;
  const body = new ReadableStream({
    start(controller) {
      req.on('data', (c) => { seen += c.length; if (seen > limit) { controller.error(new HttpError(413, 'too_large', 'حجم فایل بیش از حد مجاز است.')); req.destroy(); } else controller.enqueue(new Uint8Array(c)); });
      req.on('end', () => controller.close());
      req.on('error', (e) => controller.error(e));
    },
  });
  try {
    return await new Request('http://local/', {method: 'POST', headers: {'content-type': req.headers['content-type'] || ''}, body, duplex: 'half'}).formData();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'bad_form', 'فرم ارسال‌شده نامعتبر است.');
  }
}

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => 'EV-' + Array.from(crypto.randomBytes(6), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('');
const luhn = (n) => { let s = 0; [...n].reverse().forEach((d, i) => { let x = +d; if (i % 2) { x *= 2; if (x > 9) x -= 9; } s += x; }); return s % 10 === 0; };

function publicSessions() {
  const rows = db.prepare(`SELECT s.id, s.title, s.time_label, s.capacity,
      (SELECT COUNT(*) FROM registrations r WHERE r.session_id = s.id AND r.status <> 'rejected') AS taken
    FROM sessions s WHERE s.is_active = 1 ORDER BY s.sort_order, s.id`).all();
  return rows.map((r) => ({id: r.id, title: r.title, time: r.time_label, full: r.capacity != null && r.taken >= r.capacity}));
}

// ---------- public API ----------
function handleConfig(res) {
  const s = getSettings(db);
  json(res, 200, {
    fee: s.feeToman,
    paymentConfigured: s.cardNumber.length === 16,
    cardNumber: s.cardNumber.length === 16 ? s.cardNumber : null,
    cardHolder: s.cardNumber.length === 16 ? s.cardHolder : null,
    maxReceiptBytes: config.maxReceiptBytes,
    registered: s.registeredBase + db.prepare("SELECT COUNT(*) c FROM registrations WHERE status = 'approved'").get().c,
    sessions: publicSessions(),
  });
}

async function handleRegister(req, res) {
  const ip = clientIp(req);
  if (!rateLimit(`reg:${ip}`, config.registrationsPerIpPerHour, 3600e3)) throw new HttpError(429, 'rate_limited', 'تعداد درخواست‌ها زیاد است. کمی بعد دوباره تلاش کنید.');
  if (!/^multipart\/form-data/i.test(req.headers['content-type'] || '')) throw new HttpError(415, 'bad_type', 'درخواست نامعتبر است.');
  const settings = getSettings(db);
  if (settings.cardNumber.length !== 16) throw new HttpError(503, 'payment_not_configured', 'اطلاعات پرداخت هنوز توسط مدیر تکمیل نشده است. لطفاً بعداً دوباره تلاش کنید.');

  const form = await readForm(req, config.maxReceiptBytes + 256 * 1024);
  if (String(form.get('website') || '') !== '') return json(res, 201, {ok: true, ref: newRef()}); // honeypot: pretend success, store nothing

  const {errors, value} = validateRegistration(Object.fromEntries(['firstName', 'lastName', 'mobile', 'sessionId', 'token'].map((k) => [k, form.get(k)])));
  const file = form.get('receipt');
  let receipt = null;
  if (!file || typeof file === 'string' || file.size === 0) errors.receipt = 'تصویر رسید پرداخت را بارگذاری کنید.';
  else if (file.size > config.maxReceiptBytes) errors.receipt = `حجم تصویر نباید بیش از ${toFaDigits(config.maxReceiptBytes / 1048576)} مگابایت باشد.`;
  else {
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = sniffImage(buf);
    if (!kind) errors.receipt = 'فقط تصویر با فرمت JPG، PNG یا WebP پذیرفته می‌شود.';
    else receipt = {buf, ...kind};
  }
  if (Object.keys(errors).length) throw new HttpError(422, 'validation', 'اطلاعات واردشده را بررسی کنید.', {errors});

  // Same form submitted twice (double tap / network retry): answer with the original result, whatever else the retry violates.
  const prev = db.prepare('SELECT ref_code FROM registrations WHERE submit_token = ?').get(value.token);
  if (prev) return json(res, 200, {ok: true, ref: prev.ref_code, duplicate: true});

  const session = db.prepare('SELECT id, capacity FROM sessions WHERE id = ? AND is_active = 1').get(value.sessionId);
  if (!session) throw new HttpError(422, 'validation', 'روز انتخاب‌شده معتبر نیست.', {errors: {sessionId: 'روز انتخاب‌شده معتبر نیست.'}});
  if (session.capacity != null && db.prepare("SELECT COUNT(*) c FROM registrations WHERE session_id = ? AND status <> 'rejected'").get(session.id).c >= session.capacity)
    throw new HttpError(409, 'full', 'ظرفیت این روز تکمیل شده است. روز دیگری را انتخاب کنید.');

  const sha = crypto.createHash('sha256').update(receipt.buf).digest('hex');
  const fileName = `${crypto.randomBytes(24).toString('hex')}.${receipt.ext}`;
  const filePath = path.join(RECEIPT_DIR, fileName);
  fs.writeFileSync(filePath, receipt.buf, {mode: 0o600, flag: 'wx'});
  const ref = newRef();
  try {
    db.prepare(`INSERT INTO registrations (ref_code, submit_token, session_id, first_name, last_name, mobile, receipt_file, receipt_mime, receipt_size, receipt_sha256, ip_hash)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(ref, value.token, session.id, value.firstName, value.lastName, value.mobile, fileName, receipt.mime, receipt.buf.length, sha, hashIp(ip));
  } catch (e) {
    fs.rmSync(filePath, {force: true});
    const msg = String(e.message || '');
    const raced = db.prepare('SELECT ref_code FROM registrations WHERE submit_token = ?').get(value.token); // concurrent double-submit
    if (raced) return json(res, 200, {ok: true, ref: raced.ref_code, duplicate: true});
    if (/receipt_sha256/.test(msg)) throw new HttpError(409, 'duplicate_receipt', 'این تصویر رسید قبلاً ثبت شده است. اگر اشتباهی رخ داده با پشتیبانی تماس بگیرید.');
    if (/mobile|session_id/.test(msg)) throw new HttpError(409, 'duplicate', 'برای این شماره موبایل در این روز قبلاً ثبت‌نام انجام شده است.');
    throw e;
  }
  json(res, 201, {ok: true, ref});
}

// ---------- admin API ----------
function requireAdmin(req, mutating) {
  const s = readSession(req.headers.cookie);
  if (!s) throw new HttpError(401, 'unauthorized', 'نیاز به ورود دارید.');
  if (mutating && !safeEqual(req.headers['x-csrf-token'] || '', s.csrf)) throw new HttpError(403, 'csrf', 'نشست نامعتبر است. صفحه را تازه‌سازی کنید.');
  return s;
}

const regRow = (r) => ({
  id: r.id, ref: r.ref_code, firstName: r.first_name, lastName: r.last_name, mobile: r.mobile, sessionId: r.session_id, sessionTitle: r.session_title,
  status: r.status, rejectReason: r.reject_reason, reviewedAt: r.reviewed_at, reviewedBy: r.reviewed_by, createdAt: r.created_at, receiptSize: r.receipt_size,
  duplicateMobile: r.dup_mobile > 0,
});
const REG_SELECT = `SELECT r.*, s.title AS session_title,
  (SELECT COUNT(*) FROM registrations o WHERE o.mobile = r.mobile AND o.id <> r.id AND o.status <> 'rejected') AS dup_mobile
  FROM registrations r JOIN sessions s ON s.id = r.session_id`;

function listRegistrations(url) {
  const q = url.searchParams;
  const where = []; const args = [];
  if (['pending', 'approved', 'rejected'].includes(q.get('status'))) { where.push('r.status = ?'); args.push(q.get('status')); }
  if (Number.parseInt(q.get('session'), 10)) { where.push('r.session_id = ?'); args.push(Number.parseInt(q.get('session'), 10)); }
  const term = (q.get('q') || '').trim().slice(0, 50);
  if (term) { where.push("(r.first_name LIKE ? ESCAPE '\\' OR r.last_name LIKE ? ESCAPE '\\' OR r.mobile LIKE ? ESCAPE '\\' OR r.ref_code LIKE ? ESCAPE '\\')"); const l = `%${term.replace(/[\\%_]/g, '\\$&')}%`; args.push(l, l, l, l); }
  return {where: where.length ? 'WHERE ' + where.join(' AND ') : '', args};
}

async function handleAdmin(req, res, url) {
  const p = url.pathname, m = req.method;

  if (p === '/api/admin/login' && m === 'POST') {
    const ip = clientIp(req);
    if (!rateLimit(`login:${ip}`, 8, 15 * 60e3) || !rateLimit('login:global', 60, 15 * 60e3)) throw new HttpError(429, 'rate_limited', 'تلاش‌های ناموفق زیاد بود. چند دقیقه بعد دوباره تلاش کنید.');
    const b = await readJson(req);
    const okUser = safeEqual(String(b.username ?? ''), config.adminUsername);
    const okPass = adminHash ? verifyPassword(String(b.password ?? ''), adminHash) : false; // always run the hash: constant-ish time
    if (!okUser || !okPass) throw new HttpError(401, 'bad_credentials', 'نام کاربری یا گذرواژه نادرست است.');
    const {token, maxAge} = createSession(config.adminUsername);
    return json(res, 200, {ok: true}, {'Set-Cookie': sessionCookie(token, maxAge)});
  }
  if (p === '/api/admin/logout' && m === 'POST') return json(res, 200, {ok: true}, {'Set-Cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`});

  if (p === '/api/admin/me') { const cur = readSession(req.headers.cookie); return json(res, 200, cur ? {authenticated: true, username: cur.u, csrf: cur.csrf} : {authenticated: false}); }
  const s = requireAdmin(req, m !== 'GET');

  if (p === '/api/admin/registrations' && m === 'GET') {
    const {where, args} = listRegistrations(url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page'), 10) || 1), size = 25;
    const total = db.prepare(`SELECT COUNT(*) c FROM registrations r ${where}`).get(...args).c;
    const rows = db.prepare(`${REG_SELECT} ${where} ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
    const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) c FROM registrations GROUP BY status').all().map((r) => [r.status, r.c]));
    return json(res, 200, {total, page, pageSize: size, counts: {pending: counts.pending || 0, approved: counts.approved || 0, rejected: counts.rejected || 0}, items: rows.map(regRow)});
  }

  if (p === '/api/admin/export.csv' && m === 'GET') {
    const {where, args} = listRegistrations(url);
    const rows = db.prepare(`${REG_SELECT} ${where} ORDER BY r.created_at`).all(...args);
    const head = ['کد پیگیری', 'نام', 'نام خانوادگی', 'موبایل', 'روز', 'وضعیت', 'زمان ثبت (UTC)', 'دلیل رد'];
    const lines = [head.map(csvCell).join(','), ...rows.map((r) => [r.ref_code, r.first_name, r.last_name, r.mobile, r.session_title, r.status, r.created_at, r.reject_reason].map(csvCell).join(','))];
    return send(res, 200, '﻿' + lines.join('\r\n'), {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="registrations.csv"', 'Cache-Control': 'no-store'});
  }

  let mm;
  if ((mm = /^\/api\/admin\/registrations\/(\d+)\/receipt$/.exec(p)) && m === 'GET') {
    const r = db.prepare('SELECT receipt_file, receipt_mime FROM registrations WHERE id = ?').get(+mm[1]);
    if (!r) throw new HttpError(404, 'not_found', 'یافت نشد.');
    const file = path.join(RECEIPT_DIR, path.basename(r.receipt_file));
    if (!fs.existsSync(file)) throw new HttpError(404, 'not_found', 'فایل رسید یافت نشد.');
    res.writeHead(200, {...SEC_HEADERS, 'Content-Type': r.receipt_mime, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox"});
    return fs.createReadStream(file).pipe(res);
  }

  if ((mm = /^\/api\/admin\/registrations\/(\d+)\/status$/.exec(p)) && m === 'POST') {
    const b = await readJson(req);
    if (!['pending', 'approved', 'rejected'].includes(b.status)) throw new HttpError(422, 'validation', 'وضعیت نامعتبر است.');
    const reason = b.status === 'rejected' ? String(b.reason || '').trim().slice(0, 300) : null;
    if (b.status === 'rejected' && !reason) throw new HttpError(422, 'validation', 'دلیل رد را بنویسید.');
    try {
      const info = db.prepare("UPDATE registrations SET status = ?, reject_reason = ?, reviewed_at = CASE WHEN ? = 'pending' THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ','now') END, reviewed_by = CASE WHEN ? = 'pending' THEN NULL ELSE ? END WHERE id = ?")
        .run(b.status, reason, b.status, b.status, s.u, +mm[1]);
      if (!info.changes) throw new HttpError(404, 'not_found', 'یافت نشد.');
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (/UNIQUE/.test(String(e.message))) throw new HttpError(409, 'duplicate', 'ثبت فعال دیگری با همین شماره/رسید وجود دارد؛ تغییر وضعیت ممکن نیست.');
      throw e;
    }
    return json(res, 200, {ok: true});
  }

  if (p === '/api/admin/sessions' && m === 'GET') return json(res, 200, {items: db.prepare('SELECT id, title, time_label AS time, capacity, is_active AS active, sort_order AS sort FROM sessions ORDER BY sort_order, id').all()});
  if (p === '/api/admin/sessions' && m === 'POST') {
    const b = await readJson(req); const v = sessionInput(b);
    const info = db.prepare('INSERT INTO sessions (title, time_label, capacity, is_active, sort_order) VALUES (?,?,?,?,?)').run(v.title, v.time, v.capacity, v.active, v.sort);
    return json(res, 201, {ok: true, id: Number(info.lastInsertRowid)});
  }
  if ((mm = /^\/api\/admin\/sessions\/(\d+)$/.exec(p)) && m === 'PUT') {
    const b = await readJson(req); const v = sessionInput(b);
    const info = db.prepare('UPDATE sessions SET title=?, time_label=?, capacity=?, is_active=?, sort_order=? WHERE id=?').run(v.title, v.time, v.capacity, v.active, v.sort, +mm[1]);
    if (!info.changes) throw new HttpError(404, 'not_found', 'یافت نشد.');
    return json(res, 200, {ok: true});
  }

  if (p === '/api/admin/settings' && m === 'GET') { const st = getSettings(db); return json(res, 200, {feeToman: st.feeToman, cardNumber: st.cardNumber, cardHolder: st.cardHolder, registeredBase: st.registeredBase}); }
  if (p === '/api/admin/settings' && m === 'PUT') {
    const b = await readJson(req);
    const card = String(b.cardNumber ?? '').replace(/[\s-]/g, '').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d));
    if (card && (!/^\d{16}$/.test(card) || !luhn(card))) throw new HttpError(422, 'validation', 'شماره کارت معتبر نیست (۱۶ رقم).');
    const fee = Number.parseInt(b.feeToman, 10);
    if (!Number.isInteger(fee) || fee < 0 || fee > 1e9) throw new HttpError(422, 'validation', 'مبلغ نامعتبر است.');
    const base = b.registeredBase === undefined ? getSettings(db).registeredBase : (b.registeredBase === '' || b.registeredBase === null ? 0 : Number.parseInt(b.registeredBase, 10));
    if (!Number.isInteger(base) || base < 0 || base > 100000) throw new HttpError(422, 'validation', 'تعداد ثبت‌نام قبلی نامعتبر است.');
    setSetting(db, 'registered_base', base);
    setSetting(db, 'card_number', card); setSetting(db, 'card_holder', String(b.cardHolder ?? '').trim().slice(0, 80)); setSetting(db, 'fee_toman', fee);
    return json(res, 200, {ok: true});
  }
  throw new HttpError(404, 'not_found', 'یافت نشد.');
}

function sessionInput(b) {
  const title = String(b.title ?? '').trim().slice(0, 60), time = String(b.time ?? '').trim().slice(0, 40);
  if (!title || !time) throw new HttpError(422, 'validation', 'عنوان و ساعت الزامی است.');
  const cap = b.capacity === '' || b.capacity == null ? null : Number.parseInt(b.capacity, 10);
  if (cap !== null && (!Number.isInteger(cap) || cap < 1)) throw new HttpError(422, 'validation', 'ظرفیت نامعتبر است.');
  return {title, time, capacity: cap, active: b.active ? 1 : 0, sort: Number.parseInt(b.sort, 10) || 0};
}

// ---------- static files ----------
const MIME = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json'};
const PAGES = {'/': 'index.html', '/success': 'success.html', '/admin': 'admin.html'};
function serveStatic(req, res, url) {
  let rel;
  try { rel = PAGES[url.pathname] || decodeURIComponent(url.pathname).replace(/^\/+/, ''); } catch { return send(res, 400, 'Bad request'); }
  const file = path.resolve(config.publicDir, rel);
  if (!file.startsWith(path.resolve(config.publicDir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', {'Content-Type': 'text/plain; charset=utf-8'});
  const ext = path.extname(file);
  const long = /^\/(fonts|img)\//.test(url.pathname);
  const headers = {'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': long ? 'public, max-age=604800' : 'no-cache'};
  if (url.pathname === '/admin' || url.pathname === '/success') headers['X-Robots-Tag'] = 'noindex, nofollow';
  res.writeHead(200, {...SEC_HEADERS, ...headers});
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const url = new URL(req.url, 'http://local');
  res.on('finish', () => { if (!url.pathname.startsWith('/healthz')) console.log(JSON.stringify({t: new Date().toISOString(), m: req.method, p: url.pathname.replace(/\/\d+/g, '/:id'), s: res.statusCode, ms: Date.now() - t0})); });
  try {
    if (url.pathname === '/healthz') return json(res, 200, {ok: db.prepare('SELECT 1 x').get().x === 1});
    if (url.pathname === '/api/config' && req.method === 'GET') return handleConfig(res);
    if (url.pathname === '/api/registrations' && req.method === 'POST') return await handleRegister(req, res);
    if (url.pathname.startsWith('/api/admin/')) return await handleAdmin(req, res, url);
    if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'یافت نشد.');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method', 'روش نامعتبر.');
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return json(res, e.status, {ok: false, code: e.code, message: e.message, ...(e.extra || {})});
    console.error(JSON.stringify({t: new Date().toISOString(), error: String(e && e.stack || e).slice(0, 500)}));
    if (!res.headersSent) json(res, 500, {ok: false, code: 'server_error', message: 'خطای غیرمنتظره رخ داد. لطفاً دوباره تلاش کنید.'});
  }
});
server.requestTimeout = 60000; server.headersTimeout = 15000;
server.listen(config.port, config.host, () => console.log(`events listening on ${config.host}:${config.port}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => { db.close(); process.exit(0); }));

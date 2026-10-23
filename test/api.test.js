import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'events-test-'));
let proc;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const png = () => Buffer.concat([PNG, crypto.randomBytes(16)]); // unique bytes => unique receipt hash

before(async () => {
  proc = spawn('node', ['server/index.js'], {env: {...process.env, PORT, DATA_DIR: dataDir, ADMIN_PASSWORD: 'correct-horse-battery', ADMIN_USERNAME: 'admin', PAYMENT_CARD_NUMBER: '4111111111111111', PAYMENT_CARD_HOLDER: 'Test Holder', COOKIE_SECURE: '0', REGISTRATIONS_PER_IP_PER_HOUR: '1000'}, stdio: 'ignore'});
  for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/healthz')).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('server did not start');
});
after(() => { proc.kill(); fs.rmSync(dataDir, {recursive: true, force: true}); });

const form = (o = {}, file = png(), name = 'r.png') => {
  const f = new FormData();
  const v = {sessionId: '1', firstName: 'علی', lastName: 'رضایی', mobile: '09123456789', token: crypto.randomUUID(), ...o};
  for (const [k, x] of Object.entries(v)) if (x !== null) f.set(k, x);
  if (file) f.set('receipt', new Blob([file]), name);
  return f;
};
const post = (f) => fetch(BASE + '/api/registrations', {method: 'POST', body: f});

let cookie = '', csrf = '';
const admin = (p, opt = {}) => fetch(BASE + p, {...opt, headers: {cookie, 'content-type': 'application/json', ...(opt.method && opt.method !== 'GET' ? {'x-csrf-token': csrf} : {}), ...(opt.headers || {})}});

test('config exposes sessions and payment info', async () => {
  const c = await (await fetch(BASE + '/api/config')).json();
  assert.equal(c.sessions.length, 3); assert.equal(c.fee, 3900000); assert.equal(c.paymentConfigured, true);
  assert.equal(c.registered, 17); // baseline shown publicly; pending registrations do not inflate it
});

test('register: success, double-submit idempotent, duplicates blocked', async () => {
  const token = crypto.randomUUID();
  const a = await post(form({token})); assert.equal(a.status, 201);
  const ref = (await a.json()).ref; assert.match(ref, /^EV-[A-Z2-9]{6}$/);
  const again = await post(form({token})); assert.equal(again.status, 200); assert.equal((await again.json()).ref, ref);
  const dupMobile = await post(form({mobile: '+98 912 345 6789'})); assert.equal(dupMobile.status, 409);
  const dupReceipt = await (async () => { const f = form({mobile: '09350000001'}, PNG_FIXED); await post(f); return post(form({mobile: '09350000002'}, PNG_FIXED)); })();
  assert.equal(dupReceipt.status, 409); assert.equal((await dupReceipt.json()).code, 'duplicate_receipt');
});
const PNG_FIXED = Buffer.concat([PNG, Buffer.from('fixed')]);

test('same person can register for a different day', async () => {
  assert.equal((await post(form({sessionId: '2', mobile: '09121111111'}))).status, 201);
  assert.equal((await post(form({sessionId: '3', mobile: '09121111111'}))).status, 201);
});

test('validation errors', async () => {
  let r = await post(form({mobile: '12345'})); assert.equal(r.status, 422); assert.ok((await r.json()).errors.mobile);
  r = await post(form({firstName: 'a'})); assert.ok((await r.json()).errors.firstName);
  r = await post(form({sessionId: '99'})); assert.equal(r.status, 422);
  r = await post(form({}, null)); assert.ok((await r.json()).errors.receipt);
  r = await post(form({mobile: '09130000001'}, Buffer.from('<?php echo 1;'), 'evil.png')); assert.equal(r.status, 422); // wrong magic bytes despite .png name
  r = await post(form({mobile: '09130000002'}, Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]))); assert.ok([413, 422].includes(r.status));
  r = await post(form({website: 'spam'})); assert.equal(r.status, 201); // honeypot looks like success
});

test('Persian digits in mobile are normalised', async () => {
  assert.equal((await post(form({mobile: '۰۹۱۴۰۰۰۰۰۰۱'}))).status, 201);
});

test('admin: auth, csrf, receipt privacy, review flow', async () => {
  assert.equal((await fetch(BASE + '/api/admin/registrations')).status, 401);
  assert.equal((await fetch(BASE + '/api/admin/registrations/1/receipt')).status, 401);
  assert.equal((await fetch(BASE + '/api/admin/export.csv')).status, 401);
  let r = await fetch(BASE + '/api/admin/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'wrong'})});
  assert.equal(r.status, 401);
  r = await fetch(BASE + '/api/admin/login', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({username: 'admin', password: 'correct-horse-battery'})});
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie'); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  cookie = sc.split(';')[0];
  csrf = (await (await admin('/api/admin/me')).json()).csrf;

  const list = await (await admin('/api/admin/registrations')).json();
  assert.ok(list.total >= 4); assert.ok(list.counts.pending >= 4);
  const id = list.items[0].id;

  const noCsrf = await fetch(BASE + `/api/admin/registrations/${id}/status`, {method: 'POST', headers: {cookie, 'content-type': 'application/json'}, body: JSON.stringify({status: 'approved'})});
  assert.equal(noCsrf.status, 403);

  const rc = await admin(`/api/admin/registrations/${id}/receipt`);
  assert.equal(rc.status, 200); assert.equal(rc.headers.get('content-type'), 'image/png'); assert.match(rc.headers.get('cache-control'), /no-store/);

  assert.equal((await admin(`/api/admin/registrations/${id}/status`, {method: 'POST', body: JSON.stringify({status: 'rejected'})})).status, 422); // reason required
  assert.equal((await admin(`/api/admin/registrations/${id}/status`, {method: 'POST', body: JSON.stringify({status: 'approved'})})).status, 200);
  const after = await (await admin('/api/admin/registrations?status=approved')).json();
  assert.ok(after.items.some((x) => x.id === id));

  const csv = await (await admin('/api/admin/export.csv')).text(); assert.match(csv, /EV-/);
});

test('rejecting frees the mobile+day for a new attempt', async () => {
  const mobile = '09155550000';
  const first = await post(form({mobile, sessionId: '1'})); assert.equal(first.status, 201);
  const list = await (await admin('/api/admin/registrations?q=' + mobile)).json();
  const id = list.items[0].id;
  assert.equal((await admin(`/api/admin/registrations/${id}/status`, {method: 'POST', body: JSON.stringify({status: 'rejected', reason: 'رسید خوانا نیست'})})).status, 200);
  assert.equal((await post(form({mobile, sessionId: '1'}))).status, 201);
});

test('admin: settings and sessions management', async () => {
  assert.equal((await admin('/api/admin/settings', {method: 'PUT', body: JSON.stringify({cardNumber: '1234567890123456', cardHolder: 'x', feeToman: 3900000})})).status, 422); // fails Luhn
  assert.equal((await admin('/api/admin/settings', {method: 'PUT', body: JSON.stringify({cardNumber: '4111 1111 1111 1111', cardHolder: 'علی رضایی', feeToman: 4000000})})).status, 200);
  const c = await (await fetch(BASE + '/api/config')).json(); assert.equal(c.fee, 4000000); assert.equal(c.cardHolder, 'علی رضایی');
  assert.ok(c.registered >= 18); // 17 baseline + at least the one approved earlier in this run
  assert.equal((await admin('/api/admin/settings', {method: 'PUT', body: JSON.stringify({cardNumber: '4111111111111111', cardHolder: 'علی رضایی', feeToman: 4000000, registeredBase: 20})})).status, 200);
  assert.ok((await (await fetch(BASE + '/api/config')).json()).registered >= 21);
  const add = await admin('/api/admin/sessions', {method: 'POST', body: JSON.stringify({title: '۲۶ آبان', time: 'ساعت ۱۴:۰۰', capacity: 1, active: true, sort: 4})});
  assert.equal(add.status, 201); const sid = (await add.json()).id;
  assert.equal((await post(form({sessionId: String(sid), mobile: '09166660001'}))).status, 201);
  assert.equal((await post(form({sessionId: String(sid), mobile: '09166660002'}))).status, 409); // capacity 1 reached
  await admin('/api/admin/sessions/' + sid, {method: 'PUT', body: JSON.stringify({title: '۲۶ آبان', time: 'ساعت ۱۴:۰۰', capacity: 1, active: false, sort: 4})});
  assert.ok(!(await (await fetch(BASE + '/api/config')).json()).sessions.some((s) => s.id === sid));
});

test('static serving is traversal-safe and private data is not reachable', async () => {
  for (const p of ['/..%2fserver%2findex.js', '/%2e%2e/server/config.js', '/data/events.db', '/server/index.js', '/receipts/x.png']) assert.equal((await fetch(BASE + p)).status, 404, p);
  const h = (await fetch(BASE + '/')).headers; assert.match(h.get('content-security-policy'), /default-src 'self'/);
});

test('logout clears the session cookie', async () => {
  const r = await admin('/api/admin/logout', {method: 'POST', body: '{}'}); assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
});

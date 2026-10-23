// Real-browser end-to-end check over the Chrome DevTools Protocol (no dependencies).
// Usage: BASE=http://localhost:18555 ADMIN_PW=... node test/e2e-cdp.mjs <outdir>
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const BASE = process.env.BASE, PW = process.env.ADMIN_PW, OUT = process.argv[2] || '/tmp/e2e-out', PORT = 9333;
fs.mkdirSync(OUT, {recursive: true});
const chrome = spawn('/usr/bin/google-chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--user-data-dir=/tmp/ev-chrome-profile', 'about:blank'], {stdio: 'ignore'});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws; for (let i = 0; i < 50; i++) { try { const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const page = t.find((x) => x.type === 'page'); ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; }); break; } catch { await sleep(200); } }
let id = 0; const pending = new Map(); const problems = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') problems.push('exception: ' + d.params.exceptionDetails.text + ' ' + (d.params.exceptionDetails.exception?.description || ''));
  else if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') problems.push('console.error: ' + d.params.args.map((a) => a.value || a.description).join(' '));
  else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') problems.push('log: ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({id: i, method, params})); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300)); return r.result.result.value; };
const nav = async (url) => { await send('Page.navigate', {url}); await sleep(1200); await ev('document.fonts.ready.then(()=>1)'); };
const shot = async (name, full = true) => { const r = await send('Page.captureScreenshot', {format: 'png', captureBeyondViewport: full}); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const view = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile});
const overflow = () => ev('({sw:document.documentElement.scrollWidth, iw:innerWidth, bad:[...document.querySelectorAll("body *")].filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left<-1}).slice(0,5).map(e=>e.tagName+"."+e.className)})');
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, extra); };

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Network.enable'); await send('Network.setCacheDisabled', {cacheDisabled: true});

for (const [w, h, mobile, tag] of [[320, 700, true, 'm320'], [390, 844, true, 'm390'], [820, 1100, true, 'tablet'], [1440, 900, false, 'desktop']]) {
  await view(w, h, mobile); await nav(BASE + '/');
  await ev('document.querySelectorAll(".reveal").forEach(e=>e.classList.add("in"))'); await sleep(900);
  const o = await overflow(); check(`no horizontal overflow @${w}px`, o.sw <= o.iw, JSON.stringify(o));
  await shot('landing-' + tag);
}

// ----- full registration flow on a phone -----
await view(390, 844, true); await nav(BASE + '/');
await ev('document.querySelectorAll(".reveal").forEach(e=>e.classList.add("in"))');
check('3 day options rendered', (await ev('document.querySelectorAll("input[name=sessionId]").length')) === 3);
await ev('document.querySelector("[data-next]").click()'); await sleep(200);
check('step 1 blocks empty form', (await ev('document.querySelector("#err-firstName").textContent.length>0 && document.querySelector("#err-mobile").textContent.length>0')) === true);
await shot('step1-errors', false);
await ev(`(()=>{document.querySelector("input[name=sessionId][value='2']").click();firstName.value='محمد';lastName.value='نمونه';mobile.value='۰۹۱۲۳۴۵۶۷۸۱';document.querySelector("[data-step='1'] [data-next]").click()})()`); await sleep(500);
check('step 2 shows fee + card', (await ev('fee.textContent.includes("۳٬۹۰۰٬۰۰۰") && cardnum.textContent.replace(/\\s/g,"")==="۵۸۵۹۸۳۸۸۲۰۴۹۶۹۷۸"')) === true, await ev('fee.textContent+" | "+cardnum.textContent+" | "+cardholder.textContent'));
await shot('step2-payment', false);
await ev('copy.click()'); await sleep(300);
await ev('document.querySelector("#pay-next").click()'); await sleep(500);
check('step 3 visible', (await ev('!document.querySelector("[data-step=\'3\']").hidden')) === true);
await send('DOM.enable'); const doc = await send('DOM.getDocument'); const q = await send('DOM.querySelector', {nodeId: doc.result.root.nodeId, selector: '#receipt'});
await send('DOM.setFileInputFiles', {nodeId: q.result.nodeId, files: ['/tmp/test-receipt.png']}); await sleep(500);
check('receipt preview shown', (await ev('!document.querySelector("#drop-has").hidden')) === true);
await shot('step3-receipt', false);
await ev('document.querySelector("#submit").click()'); await sleep(2500);
check('redirected to success page', (await ev('location.pathname')) === '/success', await ev('location.pathname'));
check('reference code displayed', /^EV-[A-Z2-9]{6}$/.test(await ev('document.getElementById("ref").textContent')), await ev('document.getElementById("ref").textContent'));
await shot('success', false);
const so = await overflow(); check('success page no overflow', so.sw <= so.iw);

// ----- duplicate attempt shows friendly error -----
await nav(BASE + '/'); await ev('document.querySelectorAll(".reveal").forEach(e=>e.classList.add("in"))');
await ev(`(()=>{document.querySelector("input[name=sessionId][value='2']").click();firstName.value='محمد';lastName.value='نمونه';mobile.value='09123456781';document.querySelector("[data-step='1'] [data-next]").click();document.querySelector("#pay-next").click()})()`); await sleep(400);
const doc2 = await send('DOM.getDocument'); const q2 = await send('DOM.querySelector', {nodeId: doc2.result.root.nodeId, selector: '#receipt'});
await send('DOM.setFileInputFiles', {nodeId: q2.result.nodeId, files: ['/tmp/test-receipt.png']}); await sleep(300);
await ev('document.querySelector("#submit").click()'); await sleep(1800);
check('duplicate registration rejected with message', (await ev('!document.getElementById("form-error").hidden || document.getElementById("err-receipt").textContent.length>0')) === true, await ev('document.getElementById("form-error").textContent'));

// ----- admin flow -----
await view(390, 844, true); await nav(BASE + '/admin'); await shot('admin-login', false);
await ev(`(()=>{u.value='admin';p.value=${JSON.stringify(PW)};document.querySelector("form").requestSubmit()})()`); await sleep(1500);
check('admin list shows the registration', (await ev('document.body.innerText.includes("محمد نمونه")')) === true);
await shot('admin-list', false);
await ev('document.querySelector(".item").click()'); await sleep(1200);
check('receipt image loads in dialog', (await ev('(()=>{const i=document.querySelector("dialog img.rc");return i && i.complete && i.naturalWidth>0})()')) === true);
await shot('admin-dialog', false);
await ev('[...document.querySelectorAll("dialog button")].find(b=>b.textContent.includes("تأیید پرداخت")).click()'); await sleep(1200);
check('approved status visible', (await ev('document.body.innerText.includes("تأییدشده")')) === true);

const unexpected = problems.filter((x) => !/status of 409/.test(x)); // the 409 is the deliberate duplicate-registration probe
check('no console errors / exceptions', unexpected.length === 0, unexpected.join(' || '));
chrome.kill(); ws.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);

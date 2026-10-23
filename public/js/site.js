'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const FA = '۰۱۲۳۴۵۶۷۸۹';
const fa = (n) => String(n).replace(/\d/g, (d) => FA[d]);
const toAscii = (s) => String(s).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- background knowledge graph (canvas, paused when hidden) ---------- */
(function graph() {
  const c = $('#graph'); if (!c) return;
  const ctx = c.getContext('2d');
  let w, h, nodes = [], raf = 0, running = false;
  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    w = c.clientWidth; h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const n = Math.round(Math.min(70, Math.max(26, (w * h) / 22000)));
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    nodes = Array.from({length: n}, () => ({x: rnd() * w, y: rnd() * h, vx: (rnd() - .5) * .18, vy: (rnd() - .5) * .18, r: 1 + rnd() * 1.8}));
  };
  const draw = (t) => {
    ctx.clearRect(0, 0, w, h);
    const link = Math.min(190, w * .3);
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (running) { a.x += a.vx; a.y += a.vy; if (a.x < 0 || a.x > w) a.vx *= -1; if (a.y < 0 || a.y > h) a.vy *= -1; }
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j], d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < link) { ctx.strokeStyle = `rgba(145,218,115,${(1 - d / link) * .35})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
    }
    const pulse = (Math.sin(t / 900) + 1) / 2;
    for (const a of nodes) { ctx.fillStyle = `rgba(214,255,242,${.55 + pulse * .3})`; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, 7); ctx.fill(); }
  };
  const loop = (t) => { draw(t); raf = running ? requestAnimationFrame(loop) : 0; };
  const start = () => { if (!running && !reduceMotion) { running = true; raf = requestAnimationFrame(loop); } };
  const stop = () => { running = false; cancelAnimationFrame(raf); };
  size(); draw(0);
  addEventListener('resize', () => { size(); draw(0); });
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
  start();
})();

/* ---------- scroll reveal ---------- */
(function reveal() {
  const els = $$('.reveal');
  if (!('IntersectionObserver' in window) || reduceMotion) return els.forEach((e) => e.classList.add('in'));
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), {threshold: .12});
  els.forEach((e) => io.observe(e));
})();

/* ---------- registration wizard ---------- */
(async function wizard() {
  const form = $('#reg-form'); if (!form) return;
  const state = {step: 1, cfg: null, file: null};
  const token = (() => { let t = sessionStorage.getItem('ev_token'); if (!t) { t = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).replace(/[^A-Za-z0-9-]/g, ''); if (t.length < 16) t = t.padEnd(16, '0'); sessionStorage.setItem('ev_token', t); } return t; })();

  const showErr = (name, msg) => { const e = $('#err-' + name); if (e) e.textContent = msg || ''; const i = form.elements[name]; if (i && i.setAttribute) { msg ? i.setAttribute('aria-invalid', 'true') : i.removeAttribute('aria-invalid'); } };
  const clearErrs = () => ['sessionId', 'firstName', 'lastName', 'mobile', 'receipt'].forEach((n) => showErr(n, ''));
  const banner = (msg) => { const b = $('#form-error'); b.textContent = msg || ''; b.hidden = !msg; if (msg) b.scrollIntoView({block: 'nearest', behavior: 'smooth'}); };

  const go = (n) => {
    state.step = n;
    $$('.panel', form).forEach((p) => { p.hidden = +p.dataset.step !== n; });
    $$('#steps li').forEach((li, i) => { li.classList.toggle('active', i + 1 === n); li.classList.toggle('done', i + 1 < n); });
    if (n === 3) renderSummary();
    banner('');
    $('#reg-card').scrollIntoView({block: 'start', behavior: reduceMotion ? 'auto' : 'smooth'});
    const first = $('.panel:not([hidden]) input:not([type=hidden]):not(.hp), .panel:not([hidden]) button', form); if (first && n !== 1) first.focus({preventScroll: true});
  };

  // ----- config -----
  async function loadConfig() {
    try {
      const r = await fetch('/api/config', {cache: 'no-store'}); if (!r.ok) throw 0; state.cfg = await r.json();
    } catch { $('#session-radios').innerHTML = ''; const p = document.createElement('p'); p.className = 'alert'; p.textContent = 'بارگذاری اطلاعات ثبت‌نام ممکن نشد. صفحه را تازه‌سازی کنید.'; $('#session-radios').append(p); return; }
    const cfg = state.cfg;
    const radios = $('#session-radios'); radios.replaceChildren();
    cfg.sessions.forEach((s) => {
      const l = document.createElement('label'); l.className = 'radio';
      const i = Object.assign(document.createElement('input'), {type: 'radio', name: 'sessionId', value: s.id, disabled: s.full});
      const sp = document.createElement('span'); const b = document.createElement('b'); b.textContent = s.title; const sm = document.createElement('small'); sm.textContent = s.full ? 'ظرفیت تکمیل' : s.time;
      sp.append(b, sm); l.append(i, sp); radios.append(l);
    });
    if (!cfg.sessions.length) radios.textContent = 'در حال حاضر روزی برای ثبت‌نام باز نیست.';
    // keep landing "schedule" cards in sync with admin-managed days
    const days = $('#days'); if (days && cfg.sessions.length) { days.replaceChildren(...cfg.sessions.map((s) => { const d = document.createElement('div'); d.className = 'card day in'; d.innerHTML = '<div class="d"></div><div class="t"></div><span class="tag"></span>'; d.children[0].textContent = s.title; d.children[1].textContent = s.time; d.children[2].textContent = s.full ? 'ظرفیت تکمیل' : 'آنلاین'; return d; })); }
    if (Number.isInteger(cfg.registered)) { $('#reg-count').textContent = fa(cfg.registered); $('#reg-count-2').textContent = fa(cfg.registered); }
    $('#fee').textContent = fa(cfg.fee.toLocaleString('en-US').replace(/,/g, '٬')) + ' تومان';
    $('#max-mb').textContent = fa(Math.round(cfg.maxReceiptBytes / 1048576));
    $('#card-ready').hidden = !cfg.paymentConfigured; $('#card-missing').hidden = cfg.paymentConfigured;
    $('#pay-next').disabled = !cfg.paymentConfigured;
    if (cfg.paymentConfigured) { $('#cardnum').textContent = fa(cfg.cardNumber.replace(/(\d{4})(?=\d)/g, '$1 ')); $('#cardholder').textContent = cfg.cardHolder ? 'به نام: ' + cfg.cardHolder : ''; }
  }
  await loadConfig();

  // ----- copy -----
  $('#copy')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget, num = state.cfg?.cardNumber; if (!num) return;
    let ok = false;
    try { await navigator.clipboard.writeText(num); ok = true; } catch {
      const ta = Object.assign(document.createElement('textarea'), {value: num, readOnly: true}); ta.className = 'hp'; document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch {} ta.remove();
    }
    btn.textContent = ok ? '✓ کپی شد' : 'کپی نشد؛ شماره را دستی انتخاب کنید';
    setTimeout(() => { btn.textContent = 'کپی شماره کارت'; }, 2200);
  });

  // ----- step 1 validation (mirrors the server) -----
  const NAME = /^[\p{L}\p{M}‌' -]{2,40}$/u;
  const normMobile = (v) => { let m = toAscii(v).replace(/[\s\-()]/g, ''); if (m.startsWith('+98')) m = '0' + m.slice(3); else if (m.startsWith('0098')) m = '0' + m.slice(4); else if (/^98\d{10}$/.test(m)) m = '0' + m.slice(2); else if (/^9\d{9}$/.test(m)) m = '0' + m; return /^09\d{9}$/.test(m) ? m : null; };
  function validateStep1() {
    clearErrs(); let first = null; const bad = (n, m) => { showErr(n, m); first = first || n; };
    if (!form.elements.sessionId.value && !$('input[name=sessionId]:checked')) bad('sessionId', 'یکی از روزهای وبینار را انتخاب کنید.');
    if (!NAME.test(form.firstName.value.trim())) bad('firstName', 'نام را وارد کنید (حداقل ۲ حرف).');
    if (!NAME.test(form.lastName.value.trim())) bad('lastName', 'نام خانوادگی را وارد کنید (حداقل ۲ حرف).');
    if (!normMobile(form.mobile.value)) bad('mobile', 'شماره موبایل معتبر نیست. نمونه: ۰۹۱۲۳۴۵۶۷۸۹');
    if (first) { (form.elements[first] && form.elements[first].focus ? form.elements[first] : $('input[name=sessionId]'))?.focus(); return false; }
    return true;
  }
  function renderSummary() {
    const s = $('#summary'); s.replaceChildren();
    const sess = state.cfg.sessions.find((x) => String(x.id) === form.elements.sessionId.value);
    [['روز', sess ? `${sess.title} — ${sess.time}` : ''], ['نام', `${form.firstName.value.trim()} ${form.lastName.value.trim()}`], ['موبایل', fa(normMobile(form.mobile.value) || '')], ['مبلغ', $('#fee').textContent]].forEach(([k, v]) => { const d = document.createElement('div'); const b = document.createElement('b'); b.textContent = k + ': '; d.append(b, document.createTextNode(v)); s.append(d); });
  }
  $$('[data-next]', form).forEach((b) => b.addEventListener('click', () => { if (state.step === 1 && !validateStep1()) return; go(state.step + 1); }));
  $$('[data-back]', form).forEach((b) => b.addEventListener('click', () => go(state.step - 1)));
  form.mobile.addEventListener('input', () => { form.mobile.value = form.mobile.value.replace(/[^\d۰-۹٠-٩+\s-]/g, ''); });

  // ----- receipt picker -----
  const input = $('#receipt'), drop = $('#drop');
  const OK_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  function setFile(f) {
    showErr('receipt', '');
    if (!f) return;
    if (!OK_TYPES.includes(f.type)) return showErr('receipt', 'فقط تصویر با فرمت JPG، PNG یا WebP پذیرفته می‌شود.');
    if (f.size > state.cfg.maxReceiptBytes) return showErr('receipt', `حجم تصویر نباید بیش از ${fa(Math.round(state.cfg.maxReceiptBytes / 1048576))} مگابایت باشد.`);
    state.file = f;
    const img = $('#preview-img'); if (img.dataset.url) URL.revokeObjectURL(img.dataset.url); img.dataset.url = img.src = URL.createObjectURL(f);
    $('#file-name').textContent = f.name.length > 28 ? f.name.slice(0, 25) + '…' : f.name; $('#file-size').textContent = fa((f.size / 1024).toFixed(0)) + ' کیلوبایت';
    $('#drop-empty').hidden = true; $('#drop-has').hidden = false; drop.classList.add('has');
  }
  input.addEventListener('change', () => { if (input.files[0]) setFile(input.files[0]); else if (!state.file) input.value = ''; });
  ['dragover', 'dragenter'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => { const f = e.dataTransfer?.files?.[0]; if (f) { const dt = new DataTransfer(); dt.items.add(f); input.files = dt.files; setFile(f); } });

  // ----- submit -----
  let busy = false;
  form.addEventListener('submit', (e) => {
    e.preventDefault(); if (busy) return;
    banner(''); showErr('receipt', '');
    if (!validateStep1()) return go(1);
    if (!state.file) return showErr('receipt', 'تصویر رسید پرداخت را بارگذاری کنید.');
    const fd = new FormData(); ['sessionId', 'firstName', 'lastName', 'mobile', 'website'].forEach((k) => fd.set(k, form.elements[k].value.trim?.() ?? form.elements[k].value));
    fd.set('sessionId', $('input[name=sessionId]:checked').value); fd.set('mobile', normMobile(form.mobile.value)); fd.set('token', token); fd.set('receipt', state.file, state.file.name);
    const btn = $('#submit'); const label = btn.textContent; busy = true; btn.disabled = true; btn.replaceChildren(Object.assign(document.createElement('span'), {className: 'spin'}), document.createTextNode(' در حال ارسال…'));
    const bar = $('#progress'); bar.hidden = false; bar.firstElementChild.style.width = '0%';
    const done = () => { busy = false; btn.disabled = false; btn.textContent = label; bar.hidden = true; };
    const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/registrations'); xhr.timeout = 120000;
    xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.firstElementChild.style.width = Math.round((ev.loaded / ev.total) * 100) + '%'; };
    xhr.onload = () => {
      let data = {}; try { data = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status === 200 || xhr.status === 201) { sessionStorage.setItem('ev_ref', data.ref || ''); sessionStorage.removeItem('ev_token'); location.assign('/success'); return; }
      done();
      if (xhr.status === 422 && data.errors) {
        let jump = 3; Object.entries(data.errors).forEach(([k, m]) => { showErr(k, m); if (['sessionId', 'firstName', 'lastName', 'mobile'].includes(k)) jump = 1; });
        if (data.errors.token) { sessionStorage.removeItem('ev_token'); banner(data.errors.token); } return go(jump);
      }
      banner(data.message || 'ارسال انجام نشد. لطفاً دوباره تلاش کنید.');
    };
    xhr.onerror = xhr.ontimeout = () => { done(); banner('ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کنید و دوباره تلاش کنید؛ ثبت تکراری ایجاد نمی‌شود.'); };
    xhr.send(fd);
  });
})();

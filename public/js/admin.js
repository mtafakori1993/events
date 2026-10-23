'use strict';
const app = document.getElementById('app');
let csrf = '';
const fa = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k in e && !k.startsWith('aria-')) e[k] = v; else e.setAttribute(k, v === true ? '' : v); }
  e.append(...kids.flat().filter((x) => x != null && x !== false).map((x) => (x instanceof Node ? x : document.createTextNode(String(x)))));
  return e;
};
const fmtDate = (iso) => { try { return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(iso)); } catch { return iso; } };
const STATUS = {pending: 'در انتظار بررسی', approved: 'تأییدشده', rejected: 'ردشده'};

async function api(path, opt = {}) {
  const method = opt.method || 'GET';
  const r = await fetch(path, {method, headers: {'content-type': 'application/json', ...(method !== 'GET' ? {'x-csrf-token': csrf} : {})}, body: opt.body ? JSON.stringify(opt.body) : undefined, credentials: 'same-origin'});
  let data = {}; try { data = await r.json(); } catch {}
  if (r.status === 401 && path !== '/api/admin/login') { renderLogin(); throw new Error('unauthorized'); }
  if (!r.ok) throw Object.assign(new Error(data.message || 'خطا'), {data});
  return data;
}
const toast = (msg) => { const t = h('div', {class: 'toast', role: 'status'}, msg); document.body.append(t); setTimeout(() => t.remove(), 3000); };

function renderLogin() {
  const err = h('p', {class: 'err', role: 'alert'});
  const u = h('input', {type: 'text', id: 'u', autocomplete: 'username', required: true}), p = h('input', {type: 'password', id: 'p', autocomplete: 'current-password', required: true});
  const btn = h('button', {class: 'btn btn-primary', type: 'submit'}, 'ورود');
  app.replaceChildren(h('form', {class: 'card login', onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; err.textContent = '';
    try { await api('/api/admin/login', {method: 'POST', body: {username: u.value, password: p.value}}); await boot(); } catch (x) { err.textContent = x.message; btn.disabled = false; }
  }}, h('h1', {}, 'ورود به پنل مدیریت'), h('div', {class: 'field'}, h('label', {class: 'lbl', for: 'u'}, 'نام کاربری'), u), h('div', {class: 'field'}, h('label', {class: 'lbl', for: 'p'}, 'گذرواژه'), p), err, btn));
  u.focus();
}

const state = {tab: 'regs', status: '', session: '', q: '', page: 1, sessions: []};

async function boot() {
  const me = await api('/api/admin/me'); if (!me.authenticated) return renderLogin(); csrf = me.csrf;
  state.sessions = (await api('/api/admin/sessions')).items;
  renderShell();
}

function renderShell() {
  const tabs = [['regs', 'ثبت‌نام‌ها'], ['sessions', 'روزهای وبینار'], ['settings', 'پرداخت']];
  app.replaceChildren(
    h('div', {class: 'bar'}, h('h1', {}, 'مدیریت وبینار'), h('div', {}, h('a', {class: 'btn btn-ghost btn-sm', href: '/', target: '_blank', rel: 'noopener'}, 'صفحه عمومی'), ' ', h('button', {class: 'btn btn-ghost btn-sm', onclick: async () => { await api('/api/admin/logout', {method: 'POST', body: {}}); renderLogin(); }}, 'خروج'))),
    h('div', {class: 'tabs', role: 'tablist'}, tabs.map(([k, t]) => h('button', {class: 'tab', role: 'tab', 'aria-selected': String(state.tab === k), onclick: () => { state.tab = k; renderShell(); }}, t))),
    h('div', {id: 'view'}));
  ({regs: viewRegs, sessions: viewSessions, settings: viewSettings})[state.tab]();
}

async function viewRegs() {
  const view = document.getElementById('view');
  const qs = new URLSearchParams({page: state.page, ...(state.status && {status: state.status}), ...(state.session && {session: state.session}), ...(state.q && {q: state.q})});
  const data = await api('/api/admin/registrations?' + qs);
  const stat = (k, label) => h('button', {class: 'stat', 'aria-pressed': String(state.status === k), onclick: () => { state.status = state.status === k ? '' : k; state.page = 1; renderShell(); }}, h('b', {}, fa(data.counts[k])), label);
  const sel = h('select', {'aria-label': 'روز', onchange: (e) => { state.session = e.target.value; state.page = 1; renderShell(); }}, h('option', {value: ''}, 'همه روزها'), state.sessions.map((s) => h('option', {value: s.id, selected: String(s.id) === String(state.session)}, s.title)));
  const search = h('input', {type: 'search', placeholder: 'جست‌وجوی نام، موبایل یا کد پیگیری', 'aria-label': 'جست‌وجو', value: state.q, onkeydown: (e) => { if (e.key === 'Enter') { state.q = e.target.value.trim(); state.page = 1; renderShell(); } }});
  const exp = h('a', {class: 'btn btn-ghost btn-sm', href: '/api/admin/export.csv?' + new URLSearchParams({...(state.status && {status: state.status}), ...(state.session && {session: state.session})})}, 'خروجی CSV');
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  view.replaceChildren(
    h('div', {class: 'stats'}, stat('pending', 'در انتظار'), stat('approved', 'تأیید‌شده'), stat('rejected', 'رد‌شده')),
    h('div', {class: 'filters'}, sel, exp, search),
    h('div', {class: 'list'}, data.items.length ? data.items.map((r) => h('button', {class: 'item', onclick: () => openDialog(r)},
      h('div', {class: 'top'}, h('b', {}, `${r.firstName} ${r.lastName}`), h('span', {class: 'st ' + r.status}, STATUS[r.status])),
      h('div', {class: 'meta'}, h('span', {dir: 'ltr'}, r.mobile), h('span', {}, r.sessionTitle), h('span', {dir: 'ltr'}, r.ref), h('span', {}, fmtDate(r.createdAt))),
      r.duplicateMobile && h('div', {class: 'warn'}, '⚠ این شماره در ثبت‌نام فعال دیگری هم وجود دارد'))) : h('p', {class: 'hint'}, 'موردی یافت نشد.')),
    pages > 1 && h('div', {class: 'pager'}, h('button', {class: 'btn btn-ghost btn-sm', disabled: state.page <= 1, onclick: () => { state.page--; renderShell(); }}, 'قبلی'), h('span', {}, `${fa(state.page)} از ${fa(pages)}`), h('button', {class: 'btn btn-ghost btn-sm', disabled: state.page >= pages, onclick: () => { state.page++; renderShell(); }}, 'بعدی')));
}

function openDialog(r) {
  const dlg = h('dialog', {});
  const reason = h('textarea', {rows: 2, maxLength: 300, placeholder: 'دلیل رد (برای رد کردن الزامی است)', 'aria-label': 'دلیل رد'});
  const msg = h('p', {class: 'err', role: 'alert'});
  const act = (status) => async () => {
    msg.textContent = '';
    try { await api(`/api/admin/registrations/${r.id}/status`, {method: 'POST', body: {status, reason: reason.value}}); dlg.close(); dlg.remove(); toast('وضعیت ذخیره شد'); renderShell(); } catch (e) { msg.textContent = e.message; }
  };
  dlg.append(h('div', {class: 'dlg'},
    h('div', {class: 'top'}, h('h2', {}, `${r.firstName} ${r.lastName}`), h('span', {class: 'st ' + r.status}, STATUS[r.status])),
    h('img', {class: 'rc', src: `/api/admin/registrations/${r.id}/receipt`, alt: 'تصویر رسید پرداخت'}),
    h('a', {href: `/api/admin/registrations/${r.id}/receipt`, target: '_blank', rel: 'noopener'}, 'باز کردن رسید در اندازه کامل'),
    h('dl', {class: 'kv'}, h('dt', {}, 'موبایل'), h('dd', {dir: 'ltr'}, r.mobile), h('dt', {}, 'روز'), h('dd', {}, r.sessionTitle), h('dt', {}, 'کد پیگیری'), h('dd', {dir: 'ltr'}, r.ref), h('dt', {}, 'زمان ثبت'), h('dd', {}, fmtDate(r.createdAt)),
      r.reviewedAt && [h('dt', {}, 'بررسی'), h('dd', {}, `${fmtDate(r.reviewedAt)} (${r.reviewedBy})`)], r.rejectReason && [h('dt', {}, 'دلیل رد'), h('dd', {}, r.rejectReason)]),
    r.duplicateMobile && h('p', {class: 'warn'}, '⚠ این شماره در ثبت‌نام فعال دیگری هم وجود دارد.'),
    reason, msg,
    h('div', {class: 'row-actions'},
      r.status !== 'approved' && h('button', {class: 'btn btn-primary', onclick: act('approved')}, 'تأیید پرداخت'),
      r.status !== 'rejected' && h('button', {class: 'btn btn-danger', onclick: act('rejected')}, 'رد پرداخت'),
      r.status !== 'pending' && h('button', {class: 'btn btn-ghost', onclick: act('pending')}, 'بازگرداندن به انتظار'),
      h('button', {class: 'btn btn-ghost', onclick: () => { dlg.close(); dlg.remove(); }}, 'بستن'))));
  dlg.addEventListener('cancel', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
}

function viewSessions() {
  const view = document.getElementById('view');
  const row = (s) => {
    const title = h('input', {type: 'text', value: s.title, 'aria-label': 'عنوان روز'}), time = h('input', {type: 'text', value: s.time, 'aria-label': 'ساعت'});
    const cap = h('input', {type: 'number', min: 1, value: s.capacity ?? '', placeholder: 'ظرفیت (اختیاری)', 'aria-label': 'ظرفیت'});
    const sort = h('input', {type: 'number', value: s.sort, 'aria-label': 'ترتیب'});
    const active = h('input', {type: 'checkbox', checked: !!s.active, id: 'a' + (s.id || 'new')});
    const save = h('button', {class: 'btn btn-primary btn-sm', onclick: async () => {
      try { await api(s.id ? '/api/admin/sessions/' + s.id : '/api/admin/sessions', {method: s.id ? 'PUT' : 'POST', body: {title: title.value, time: time.value, capacity: cap.value, active: active.checked, sort: sort.value}}); toast('ذخیره شد'); state.sessions = (await api('/api/admin/sessions')).items; renderShell(); } catch (e) { toast(e.message); }
    }}, s.id ? 'ذخیره' : 'افزودن');
    return h('div', {class: 'srow'}, h('div', {}, title), time, cap, h('label', {}, active, ' فعال'), save, h('div', {}, sort));
  };
  view.replaceChildren(h('p', {class: 'hint'}, 'عنوان، ساعت، ظرفیت (خالی = نامحدود) و ترتیب نمایش. روزهای غیرفعال در فرم عمومی دیده نمی‌شوند. ثبت‌نام‌های قبلی حذف نمی‌شوند.'),
    h('div', {class: 'table'}, state.sessions.map(row), h('h2', {}, 'افزودن روز جدید'), row({title: '', time: 'ساعت ۱۴:۰۰', capacity: null, active: 1, sort: state.sessions.length + 1})));
}

async function viewSettings() {
  const view = document.getElementById('view');
  const s = await api('/api/admin/settings');
  const card = h('input', {type: 'text', inputMode: 'numeric', dir: 'ltr', value: s.cardNumber, placeholder: '6037 0000 0000 0000', id: 'card'});
  const base = h('input', {type: 'number', min: 0, value: s.registeredBase, id: 'base'}), holder = h('input', {type: 'text', value: s.cardHolder, id: 'holder'}), fee = h('input', {type: 'number', min: 0, value: s.feeToman, id: 'fee'});
  const msg = h('p', {class: 'err', role: 'alert'});
  view.replaceChildren(h('div', {class: 'formgrid'},
    h('p', {class: 'hint'}, s.cardNumber ? 'شماره کارت تنظیم شده است.' : '⚠ شماره کارت هنوز تنظیم نشده؛ تا آن زمان ثبت‌نام جدید پذیرفته نمی‌شود.'),
    h('div', {}, h('label', {class: 'lbl', for: 'card'}, 'شماره کارت مقصد'), card), h('div', {}, h('label', {class: 'lbl', for: 'holder'}, 'نام صاحب کارت'), holder),
    h('div', {}, h('label', {class: 'lbl', for: 'fee'}, 'مبلغ ثبت‌نام (تومان)'), fee),
    h('div', {}, h('label', {class: 'lbl', for: 'base'}, 'تعداد ثبت‌نام‌های قبلی (نمایش عمومی)'), base, h('p', {class: 'hint'}, 'عدد نمایش‌داده‌شده در صفحه = این عدد + تعداد پرداخت‌های تأییدشده در این سامانه.')), msg,
    h('button', {class: 'btn btn-primary', onclick: async () => { msg.textContent = ''; try { await api('/api/admin/settings', {method: 'PUT', body: {cardNumber: card.value, cardHolder: holder.value, feeToman: fee.value, registeredBase: base.value}}); toast('ذخیره شد'); } catch (e) { msg.textContent = e.message; } }}, 'ذخیره')));
}

boot().catch(() => {});

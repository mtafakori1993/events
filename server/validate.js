// Input normalisation and validation. All messages are user-facing Persian.
const FA = '۰۱۲۳۴۵۶۷۸۹', AR = '٠١٢٣٤٥٦٧٨٩';
export const toAsciiDigits = (s) => String(s).replace(/[۰-۹]/g, (d) => FA.indexOf(d)).replace(/[٠-٩]/g, (d) => AR.indexOf(d));
export const toFaDigits = (s) => String(s).replace(/\d/g, (d) => FA[d]);

export function normalizeMobile(input) {
  let m = toAsciiDigits(input).replace(/[\s\-()]/g, '');
  if (m.startsWith('+98')) m = '0' + m.slice(3);
  else if (m.startsWith('0098')) m = '0' + m.slice(4);
  else if (/^98\d{10}$/.test(m)) m = '0' + m.slice(2);
  else if (/^9\d{9}$/.test(m)) m = '0' + m;
  return /^09\d{9}$/.test(m) ? m : null;
}

const clean = (s) => String(s ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
const NAME_RE = /^[\p{L}\p{M}‌' -]{2,40}$/u;

export function validateRegistration(f) {
  const errors = {};
  const firstName = clean(f.firstName), lastName = clean(f.lastName);
  if (!NAME_RE.test(firstName)) errors.firstName = 'نام را به‌درستی وارد کنید (۲ تا ۴۰ حرف).';
  if (!NAME_RE.test(lastName)) errors.lastName = 'نام خانوادگی را به‌درستی وارد کنید (۲ تا ۴۰ حرف).';
  const mobile = normalizeMobile(f.mobile ?? '');
  if (!mobile) errors.mobile = 'شماره موبایل معتبر نیست. نمونه: ۰۹۱۲۳۴۵۶۷۸۹';
  const sessionId = Number.parseInt(f.sessionId, 10);
  if (!Number.isInteger(sessionId) || sessionId < 1) errors.sessionId = 'یکی از روزهای وبینار را انتخاب کنید.';
  const token = String(f.token ?? '');
  if (!/^[A-Za-z0-9-]{16,64}$/.test(token)) errors.token = 'درخواست نامعتبر است. صفحه را دوباره بارگذاری کنید.';
  return {errors, value: {firstName, lastName, mobile, sessionId, token}};
}

// Receipt images are validated by magic bytes, never by the client-supplied type or file name.
export function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return {mime: 'image/jpeg', ext: 'jpg'};
  if (buf.length > 12 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return {mime: 'image/png', ext: 'png'};
  if (buf.length > 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return {mime: 'image/webp', ext: 'webp'};
  return null;
}

export const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return `"${s.replace(/"/g, '""')}"`;
};

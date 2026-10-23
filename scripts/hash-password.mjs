// Usage: node scripts/hash-password.mjs  (reads the password from stdin, prints the scrypt hash for ADMIN_PASSWORD_HASH)
import {hashPassword} from '../server/security.js';
let data = ''; process.stdin.setEncoding('utf8');
for await (const c of process.stdin) data += c;
const pw = data.replace(/\r?\n$/, '');
if (pw.length < 12) { console.error('password must be at least 12 characters'); process.exit(1); }
console.log(hashPassword(pw));

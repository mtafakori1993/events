# events.tafakorpardazan.ir

Persian RTL landing page + registration + manual payment review for the webinar
«معماری بازیابی دانش و حافظه در هوش مصنوعی».

Zero npm dependencies: Node 24 (`node:http`, `node:sqlite`, built-in multipart parsing). Data lives in SQLite on a volume.

## Flow
1. Visitor picks a day, enters name + mobile → sees fee and card number (copy button) → uploads the receipt image.
2. A registration is stored as `pending`. The success page says confirmation happens only after manual payment verification.
3. Admin (`/admin`) opens the receipt, then approves or rejects (reason required). Rejecting frees the mobile/day and the receipt for a retry.

## Safety
- Receipts are stored outside the web root with random names (mode 600) and are only served through `/api/admin/.../receipt` to a logged-in admin (`Cache-Control: private, no-store`, `sandbox` CSP).
- Uploads are validated by magic bytes (JPG/PNG/WebP), size-limited (5 MB), never trusted by name/type.
- Duplicates: one live registration per mobile per day, one live use per receipt image (DB unique indexes), idempotent double-submit via a per-form token, honeypot field, per-IP rate limit.
- Admin: scrypt password hash, HttpOnly + SameSite=Strict signed cookie, CSRF header on every write, login rate limit, CSV export escapes formula injection.
- Strict CSP (no inline script/style), HSTS, no third-party requests (font, images and QR are self-hosted).

## Configuration (env / ConfigMap)
`PAYMENT_CARD_NUMBER`, `PAYMENT_CARD_HOLDER`, `FEE_TOMAN`, `REGISTERED_BASE` (public counter baseline, default 17; shown number = baseline + approved registrations),
`SESSION_SECRET` + `ADMIN_PASSWORD_HASH` (secret), `ADMIN_USERNAME`, `MAX_RECEIPT_MB`, `TRUST_PROXY_HOPS`. The admin panel's *Payment* tab overrides card/fee/baseline at runtime.
Days (title, time, capacity, active) are managed in the admin panel.

## Develop / test
```
cp .env.example .env   # then: set -a; . ./.env; set +a
npm start              # http://localhost:8080  (admin: /admin)
npm test               # API tests (10)
BASE=http://localhost:8080 ADMIN_PW=... node test/e2e-cdp.mjs /tmp/out   # real-browser flow at 320/390/820/1440px
node scripts/hash-password.mjs < pw.txt   # produce ADMIN_PASSWORD_HASH
```

## Deploy (k3s, same pattern as the other sites on the server)
Needs the WireGuard VPN. Once: `scp deploy/bootstrap.sh opsadmin@10.20.0.1:` and run it there (creates ns + secret, writes `~/events-admin-credentials.txt`).
Then from here: `deploy/deploy.sh` (builds the image, imports it into k3s containerd, applies `deploy/base`, waits for rollout).
TLS is Traefik ACME HTTP-01 (`le`); DNS for the host already points at the server.

## Backups
`events-data` PVC (db + receipts) is on the same node and **not backed up off-server** — add a scheduled copy.

## Updating campaign details
Dates/times/capacity: admin → *Days*. Card/fee/counter: admin → *Payment*. Copy: `public/index.html`. QR: `scripts/make-qr.mjs <url> public/img/qr.svg` (it verifies the decode).

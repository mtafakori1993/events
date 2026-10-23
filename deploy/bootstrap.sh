#!/usr/bin/env bash
# One-time, run ON THE SERVER as opsadmin. Creates the namespace and the secret (random session key + admin password hash).
# The admin password is written to ~/events-admin-credentials.txt (mode 600) and is never printed.
set -euo pipefail
K="sudo k3s kubectl"
$K get ns events >/dev/null 2>&1 || $K create ns events
if $K -n events get secret events-secrets >/dev/null 2>&1; then echo "events-secrets already exists - leaving it untouched"; exit 0; fi
umask 077
PW=$(python3 -c 'import secrets;print(secrets.token_urlsafe(18))')
SESSION=$(python3 -c 'import secrets;print(secrets.token_urlsafe(48))')
HASH=$(PW="$PW" python3 -c 'import os,hashlib,base64;s=os.urandom(16);h=hashlib.scrypt(os.environ["PW"].encode(),salt=s,n=16384,r=8,p=1,dklen=64);print("scrypt$%s$%s"%(base64.b64encode(s).decode(),base64.b64encode(h).decode()))')
$K -n events create secret generic events-secrets --from-literal=SESSION_SECRET="$SESSION" --from-literal=ADMIN_PASSWORD_HASH="$HASH" >/dev/null
printf 'url: https://events.tafakorpardazan.ir/admin\nusername: admin\npassword: %s\n' "$PW" > ~/events-admin-credentials.txt
echo "secret created; admin credentials saved to ~/events-admin-credentials.txt (mode 600)"

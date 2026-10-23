#!/usr/bin/env bash
# Build the image locally, ship it to the k3s node's containerd (same approach as the node-local minio image), apply manifests, wait for rollout.
# Usage: deploy/deploy.sh [user@host]   (default opsadmin@10.20.0.1; requires the WireGuard VPN and ./bootstrap.sh to have been run once)
set -euo pipefail
HOST=${1:-opsadmin@10.20.0.1}
cd "$(dirname "$0")/.."
TAG=$(git rev-parse --short HEAD 2>/dev/null || date +%s)$(git diff --quiet 2>/dev/null || echo -dirty)
IMG=events-local/app:$TAG
docker build -q -t "$IMG" .
docker save "$IMG" | ssh "$HOST" 'sudo k3s ctr images import -' >/dev/null
rm -rf /tmp/events-deploy && cp -r deploy /tmp/events-deploy-src && mv /tmp/events-deploy-src /tmp/events-deploy
(cd /tmp/events-deploy/base && sed -i "s#newTag: dev#newTag: $TAG#" kustomization.yaml)
tar -C /tmp/events-deploy -cz base | ssh "$HOST" 'rm -rf ~/events-deploy && mkdir ~/events-deploy && tar -C ~/events-deploy -xz'
ssh "$HOST" 'sudo k3s kubectl apply -k ~/events-deploy/base && sudo k3s kubectl -n events rollout status deploy/events --timeout=180s'
echo "deployed $IMG"

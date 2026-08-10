#!/usr/bin/env bash
# Redeploy Small Software Cloud after a code change. Run as root from the repo.
#   sudo bash deploy/update.sh
#
# Pulls the latest code, rebuilds, and restarts the control plane. Persistent
# data in /var/lib/small-software-cloud and running apps are untouched (apps
# wake on their next request after the restart).
set -euo pipefail

SERVICE_USER="smallcloud"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }
cd "$INSTALL_DIR"

echo "==> Pulling latest code"
sudo -u "$SERVICE_USER" git pull --ff-only

echo "==> Installing dependencies and building"
sudo -u "$SERVICE_USER" npm ci
sudo -u "$SERVICE_USER" npm run build

echo "==> Restarting control plane"
systemctl restart small-software-cloud
sleep 2
systemctl --no-pager --lines=0 status small-software-cloud || true
echo "==> Done. Health: $(curl -fsS http://127.0.0.1:3000/api/health || echo unreachable)"

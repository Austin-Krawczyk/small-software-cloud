#!/usr/bin/env bash
# Install (or refresh) the pull-based auto-update timer. Run as root.
#   sudo bash deploy/install-autoupdate.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }

# Point the unit at wherever the repo actually lives.
sed "s#/opt/small-software-cloud#$INSTALL_DIR#g" \
  "$SCRIPT_DIR/small-software-cloud-update.service" \
  > /etc/systemd/system/small-software-cloud-update.service
cp "$SCRIPT_DIR/small-software-cloud-update.timer" \
  /etc/systemd/system/small-software-cloud-update.timer
# Instant deploys: a .path unit watches the file the webhook touches.
cp "$SCRIPT_DIR/small-software-cloud-update.path" \
  /etc/systemd/system/small-software-cloud-update.path

# Make sure the trigger file exists and is writable by the service user.
TRIGGER=/var/lib/small-software-cloud/.deploy-trigger
if [ -d /var/lib/small-software-cloud ]; then
  touch "$TRIGGER" && chown smallcloud:smallcloud "$TRIGGER" 2>/dev/null || true
fi

systemctl daemon-reload
systemctl enable --now small-software-cloud-update.timer
systemctl enable --now small-software-cloud-update.path

echo "Auto-update enabled (poll every ~5 min + instant on push webhook)."
systemctl list-timers small-software-cloud-update.timer --no-pager || true
echo
echo "For instant deploys, add a GitHub webhook (see DEPLOY.md) and set"
echo "SCLOUD_DEPLOY_SECRET in /etc/small-software-cloud.env."
echo "Logs:     journalctl -u small-software-cloud-update -f"
echo "Run now:  systemctl start small-software-cloud-update"

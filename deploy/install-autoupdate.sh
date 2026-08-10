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

systemctl daemon-reload
systemctl enable --now small-software-cloud-update.timer

echo "Auto-update enabled. Upcoming runs:"
systemctl list-timers small-software-cloud-update.timer --no-pager || true
echo
echo "Logs:     journalctl -u small-software-cloud-update -f"
echo "Run now:  systemctl start small-software-cloud-update"
echo "Disable:  systemctl disable --now small-software-cloud-update.timer"

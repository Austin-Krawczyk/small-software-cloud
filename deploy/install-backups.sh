#!/usr/bin/env bash
# Install (or refresh) the daily backup timer. Run as root.
#   sudo bash deploy/install-backups.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)."; exit 1; }

sed "s#/opt/small-software-cloud#$INSTALL_DIR#g" \
  "$SCRIPT_DIR/small-software-cloud-backup.service" \
  > /etc/systemd/system/small-software-cloud-backup.service
cp "$SCRIPT_DIR/small-software-cloud-backup.timer" \
  /etc/systemd/system/small-software-cloud-backup.timer

systemctl daemon-reload
systemctl enable --now small-software-cloud-backup.timer

echo "Daily backups enabled. Running one now to prove it works…"
systemctl start small-software-cloud-backup
sleep 1
ls -1t /var/backups/small-software-cloud/ 2>/dev/null | head -3 || echo "(no backup yet — check: journalctl -u small-software-cloud-backup)"
echo
echo "Backups dir:  /var/backups/small-software-cloud"
echo "Run now:      systemctl start small-software-cloud-backup"
echo "Logs:         journalctl -u small-software-cloud-backup"

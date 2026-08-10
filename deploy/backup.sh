#!/usr/bin/env bash
# Snapshot the platform's data directory into a timestamped, compressed archive
# and prune old ones. Run daily by small-software-cloud-backup.timer, or by hand.
#
# The whole platform is one folder, so this is a full backup. It's consistent
# even while the control plane is running: the SQLite database is copied with
# VACUUM INTO (an atomic online snapshot), not a raw file copy.
set -euo pipefail

DATA_DIR="${SCLOUD_DATA_DIR:-/var/lib/small-software-cloud}"
BACKUP_DIR="${SCLOUD_BACKUP_DIR:-/var/backups/small-software-cloud}"
KEEP="${SCLOUD_BACKUP_KEEP:-7}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

[ -d "$DATA_DIR" ] || { echo "No data dir at $DATA_DIR"; exit 1; }
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Consistent DB snapshot (safe while the service holds the DB open in WAL mode).
if [ -f "$DATA_DIR/smallcloud.db" ]; then
  node "$SCRIPT_DIR/db-snapshot.mjs" "$DATA_DIR/smallcloud.db" "$WORK/smallcloud.db"
fi

# Collect the durable, at-rest parts of the data dir that exist.
EXTRAS=()
for d in appdata uploads secret_key; do
  [ -e "$DATA_DIR/$d" ] && EXTRAS+=(-C "$DATA_DIR" "$d")
done

ARCHIVE="$BACKUP_DIR/backup-$STAMP.tar.gz"
tar -czf "$ARCHIVE" \
  $( [ -f "$WORK/smallcloud.db" ] && echo "-C $WORK smallcloud.db" ) \
  "${EXTRAS[@]}"
echo "Wrote $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# Keep only the newest $KEEP archives.
ls -1t "$BACKUP_DIR"/backup-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "Retaining newest $KEEP backups in $BACKUP_DIR."

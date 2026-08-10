#!/usr/bin/env bash
# Pull-based auto-deploy. Invoked by small-software-cloud-update.timer every few
# minutes: if the tracked branch on GitHub has new commits, redeploy via
# update.sh; otherwise do nothing. Cheap when there's nothing to do (just a
# git fetch). Safe to run by hand at any time.
set -euo pipefail

SERVICE_USER="smallcloud"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
cd "$INSTALL_DIR"

# Git runs as the repo owner to avoid "dubious ownership" and keep file perms right.
run_git() { sudo -u "$SERVICE_USER" git "$@"; }

BRANCH="$(run_git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "HEAD" ] && BRANCH="main"

run_git fetch --quiet origin "$BRANCH"
LOCAL="$(run_git rev-parse HEAD)"
REMOTE="$(run_git rev-parse "origin/$BRANCH")"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "Up to date at ${LOCAL:0:8} — nothing to deploy."
  exit 0
fi

echo "New commits on $BRANCH: ${LOCAL:0:8} -> ${REMOTE:0:8}. Deploying…"
bash "$SCRIPT_DIR/update.sh"

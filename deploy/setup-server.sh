#!/usr/bin/env bash
# One-shot Ubuntu VPS setup for Small Software Cloud.
#
# Installs Node 24, Docker, and Caddy; creates the service user and persistent
# data dir; installs the systemd unit, env file, and Caddy config; builds the
# app; and starts everything. Safe to re-run.
#
# Usage (as root, from the repo checked out at /opt/small-software-cloud):
#   sudo DOMAIN=example.com EMAIL=you@example.com bash deploy/setup-server.sh
set -euo pipefail

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
SERVICE_USER="smallcloud"
DATA_DIR="/var/lib/small-software-cloud"
ENV_FILE="/etc/small-software-cloud.env"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root (sudo)."
[ -n "$DOMAIN" ] || die "Set DOMAIN=your-domain.com"
[ -n "$EMAIL" ] || die "Set EMAIL=you@your-domain.com (for Let's Encrypt)"
[ -f "$INSTALL_DIR/package.json" ] || die "Run from the repo (expected $INSTALL_DIR/package.json)."

log "Installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw

# Builds run in a memory-limited container; on a small (1 GB) droplet that needs
# swap headroom so a build can't OOM-kill the control plane. Add 2 GB if there's
# little RAM and no swap yet.
if [ ! -f /swapfile ] && [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 2048 ] \
   && [ "$(free -m | awk '/^Swap:/{print $2}')" -lt 512 ]; then
  log "Adding a 2 GB swap file (low RAM detected)"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  log "Installing Node.js 24"
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y -qq nodejs
fi
log "Node $(node -v), npm $(npm -v)"

if ! command -v docker >/dev/null; then
  log "Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker
log "Docker $(docker --version)"

if ! command -v caddy >/dev/null; then
  log "Installing Caddy"
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy
fi

log "Creating service user '$SERVICE_USER' and data dir"
id "$SERVICE_USER" &>/dev/null || useradd --system --create-home --shell /usr/sbin/nologin "$SERVICE_USER"
usermod -aG docker "$SERVICE_USER"
mkdir -p "$DATA_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$DATA_DIR" "$INSTALL_DIR"

log "Writing platform env file ($ENV_FILE)"
if [ ! -f "$ENV_FILE" ]; then
  sed "s/^SCLOUD_BASE_HOST=.*/SCLOUD_BASE_HOST=$DOMAIN/" \
    "$SCRIPT_DIR/small-software-cloud.env.example" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE"
else
  echo "  $ENV_FILE exists — leaving it untouched."
fi

log "Installing systemd unit"
sed "s#/opt/small-software-cloud#$INSTALL_DIR#g" \
  "$SCRIPT_DIR/small-software-cloud.service" > /etc/systemd/system/small-software-cloud.service

log "Installing Caddy config"
cp "$SCRIPT_DIR/Caddyfile" /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/scloud.conf <<EOF
[Service]
Environment=SCLOUD_DOMAIN=$DOMAIN
Environment=SCLOUD_EMAIL=$EMAIL
EOF

log "Configuring firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH >/dev/null 2>&1 || ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

log "Pre-pulling runtime images"
docker pull -q node:22-slim
docker pull -q python:3.12-slim || true

log "Building the control plane (as $SERVICE_USER)"
cd "$INSTALL_DIR"
sudo -u "$SERVICE_USER" npm ci
sudo -u "$SERVICE_USER" npm run build

log "Installing auto-update timer"
bash "$SCRIPT_DIR/install-autoupdate.sh" || echo "  (auto-update install skipped)"

log "Starting services"
systemctl daemon-reload
systemctl enable --now small-software-cloud
systemctl restart caddy

log "Done."
cat <<EOF

Small Software Cloud is starting.

  Platform:   https://$DOMAIN
  Apps:       https://<app-slug>.$DOMAIN
  Data:       $DATA_DIR
  Logs:       journalctl -u small-software-cloud -f

Make sure DNS has an A record for $DOMAIN AND a wildcard A record for
*.$DOMAIN, both pointing at this server's public IP. HTTPS certificates are
issued automatically on first visit.

Redeploy later with:  sudo bash deploy/update.sh
Run the E2E test:     bash scripts/e2e-test.sh
EOF

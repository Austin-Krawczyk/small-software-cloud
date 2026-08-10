# Deploying Small Software Cloud on a single Ubuntu VPS

This is an **MVP deployment**: one small VPS running the control plane directly
(systemd + Node), Caddy in front for HTTPS, and Docker for the apps it deploys.
No Kubernetes, no Terraform, no cloud services. It comfortably serves the
"1–20 people per app" scale this platform targets.

> **Security note (read this).** The Docker runner gives each app CPU/memory/pid
> limits, a non-root user, and only its own build folder mounted — good enough
> for trusted small teams. It is **not** hardened multi-tenant isolation: apps
> share the Docker daemon and kernel and have outbound network access. Do not
> run untrusted third-party code on a shared instance yet. See
> [SECURITY.md](SECURITY.md) for the full breakdown of MVP vs production-grade.

## What you need

- An Ubuntu 22.04/24.04 VPS (1 vCPU / 1–2 GB RAM is enough to start), root/sudo.
- A domain you control, with **two** DNS records pointing at the VPS IP:
  - `A   example.com        → <VPS IP>`
  - `A   *.example.com      → <VPS IP>`  ← the wildcard gives each app its own subdomain
- Ports 80 and 443 open to the world (the setup script configures ufw).

## Architecture

```
                 Internet (HTTPS)
                       │
                       ▼
                 ┌───────────┐    on-demand TLS for example.com + *.example.com
                 │   Caddy   │    (cert gated by /api/tls-check)
                 └─────┬─────┘
                       │ reverse_proxy 127.0.0.1:3000  (Host preserved)
                       ▼
        ┌──────────────────────────────┐   systemd: small-software-cloud
        │   Control plane (Node 24)     │   runs as user 'smallcloud'
        │   dashboard · API · gateway   │   loopback only (HOSTNAME=127.0.0.1)
        └───────┬───────────────┬───────┘
                │ SQLite + files │ docker run (via docker group)
                ▼                ▼
     /var/lib/small-software-cloud   ┌─────────────┐ ┌─────────────┐
       (DB, builds, uploads, logs)   │ app: slug-a │ │ app: slug-b │  loopback ports
                                     └─────────────┘ └─────────────┘  9100–9500
```

- **Clear separation:** the control plane runs directly as a Node process; the
  apps it deploys run in Docker containers. The control plane talks to Docker
  via the `docker` group.
- **Persistence:** everything durable lives in `/var/lib/small-software-cloud`
  (set by `SCLOUD_DATA_DIR`), outside the code checkout, so redeploys never
  touch data.

## One-command setup

```bash
# 1. Put the code on the server
sudo git clone https://github.com/Austin-Krawczyk/small-software-cloud.git /opt/small-software-cloud
cd /opt/small-software-cloud

# 2. Run setup (installs Node 24, Docker, Caddy; creates the user, data dir,
#    config, and services; builds and starts everything)
sudo DOMAIN=example.com EMAIL=you@example.com bash deploy/setup-server.sh
```

That's it. Visit `https://example.com`, sign up, create an app, click Deploy,
and share it — each app is live at `https://<slug>.example.com`. Certificates
are issued automatically on first visit.

### What the script does

1. Installs **Node 24** (NodeSource), **Docker** (get.docker.com), **Caddy** (apt).
2. Creates the **`smallcloud`** system user and adds it to the `docker` group.
3. Creates **`/var/lib/small-software-cloud`** (owned by `smallcloud`).
4. Writes **`/etc/small-software-cloud.env`** from
   [`deploy/small-software-cloud.env.example`](deploy/small-software-cloud.env.example)
   with your domain.
5. Installs the **systemd unit**
   ([`deploy/small-software-cloud.service`](deploy/small-software-cloud.service))
   and the **Caddy config** ([`deploy/Caddyfile`](deploy/Caddyfile)), passing
   `SCLOUD_DOMAIN`/`SCLOUD_EMAIL` to Caddy via a systemd drop-in.
6. Opens the firewall (SSH, 80, 443), pre-pulls `node:22-slim` / `python:3.12-slim`.
7. Builds the app and starts `small-software-cloud` + `caddy`.

## Verifying the deployment

Run the end-to-end test (it boots a throwaway instance on a random port with a
temp data dir — it does **not** touch your production data):

```bash
bash scripts/e2e-test.sh
```

It registers a user, uploads a small Node app, deploys it, waits for the health
check, asserts the app is **running inside a Docker container**, and fetches it
**through the platform proxy** (full auth handoff) — verifying the injected env
var too. On success it prints `ALL CHECKS PASSED`.

Also check the platform health endpoint (used by monitoring/Caddy):

```bash
curl -s http://127.0.0.1:3000/api/health        # {"status":"ok","runner":"docker",...}
```

## Configuration reference

`/etc/small-software-cloud.env` (see
[the example](deploy/small-software-cloud.env.example)):

| Variable | Purpose |
|---|---|
| `SCLOUD_BASE_HOST` | Public domain; apps are served at `{slug}.<this>` |
| `SCLOUD_PROTO` | `https` in production (also marks cookies Secure) |
| `SCLOUD_DATA_DIR` | Persistent state dir (`/var/lib/small-software-cloud`) |
| `HOSTNAME` / `PORT` | Bind loopback only — reachable solely via Caddy |

## Operating it

```bash
# Logs
journalctl -u small-software-cloud -f
journalctl -u caddy -f

# Restart / status
systemctl restart small-software-cloud
systemctl status small-software-cloud

# Redeploy after a code change (pull, build, restart; data & apps untouched)
sudo bash deploy/update.sh
```

### Automatic deploys (optional)

`setup-server.sh` installs a **pull-based auto-update timer** that checks the
tracked branch on GitHub every ~5 minutes and runs `update.sh` only when there
are new commits — so pushing to `main` deploys itself, with no secrets or
inbound access. Manage it with:

```bash
sudo bash deploy/install-autoupdate.sh        # install/enable (setup does this)
systemctl start small-software-cloud-update   # deploy right now if there are changes
journalctl -u small-software-cloud-update -f   # watch what it does
systemctl disable --now small-software-cloud-update.timer  # turn it off
```

- **Backups:** the entire platform state is one folder — back up
  `/var/lib/small-software-cloud` (stop the service first for a consistent copy,
  or copy the SQLite DB with `sqlite3 .backup`).
- **Restarts:** on control-plane restart, running app containers are cleared and
  each app transparently restarts on its next request (scale-to-zero shape).
- **Docker images:** `node:22-slim` and `python:3.12-slim` are pre-pulled; update
  them with `docker pull` and redeploy affected apps.

## Troubleshooting

- **Cert not issued for an app subdomain** — confirm the `*.example.com`
  wildcard A record exists and `GET /api/tls-check?domain=<slug>.example.com`
  returns 200 (it only does once the project exists).
- **Apps won't start** — `docker ps -a`, then `docker logs scloud-<projectId>`.
  A deploy that fails on boot shows the app's own output in the deployment log.
- **502 through the proxy** — the app didn't bind `0.0.0.0:$PORT` inside its
  container; make sure it listens on `process.env.PORT`.
- **Permission denied talking to Docker** — the `smallcloud` user must be in the
  `docker` group (the setup script does this); re-login/restart the service after
  group changes.

## Scope — what this deployment intentionally is not

No Kubernetes, no autoscaling, no multi-region, no managed database, no CI/CD
pipeline, no per-app hardened sandbox. It is the smallest reliable setup that
delivers the product loop — create → deploy → access → share — on one machine.
Hardening steps (per-app network policy, stronger sandbox such as gVisor,
encrypted secrets at rest, rate limiting) are catalogued in [SECURITY.md](SECURITY.md).

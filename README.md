# ☁️ Small Software Cloud

Deploy and share small, purpose-built applications the way you share a document.

**Build a tool → click Deploy → share the link.**

The target user is a person or small team whose AI coding agent just wrote them a
custom app for a specific workflow — and who has no interest in EC2, Docker,
Kubernetes, IAM, DNS, or SSL. The MVP demonstrates the complete loop:

```
Create → Deploy → Access → Share
```

## Running the platform (local dev)

Requirements: Node.js 22+ (uses the built-in `node:sqlite`), git.
Optional: Python 3.10+ (to deploy Python apps), Docker (for container isolation).

```bash
npm install
npm run dev        # http://localhost:3000
```

Everything the platform stores lives in `./data` — delete it for a fresh install.

## Deploying to a server

See **[DEPLOY.md](DEPLOY.md)** for a one-command setup on a single Ubuntu VPS
(Caddy + HTTPS, systemd, Docker-based app runner, persistent data). Verify any
deployment — or just the local build — with the end-to-end test:

```bash
npm run build && bash scripts/e2e-test.sh
```

It deploys a sample Node app, runs it (in Docker where available), health-checks
it, and fetches it through the platform proxy.

## The 5-minute demo

1. Sign up at http://localhost:3000.
2. **+ New app** → name it → *Start from a sample app* → `team-notes` → **Create app**.
3. Click **Deploy**. Watch the log stream; ~5 seconds later the app is **Running**.
4. Click **Open** — the app is live on its own origin, `http://team-notes.localhost:3000/`,
   and knows who you are (browsers resolve `*.localhost` natively; no hosts-file edits).
5. In **Sharing**, enter a teammate's email → **Share**.
6. The teammate signs up with that email and immediately sees and can open the app.
   People who aren't shared on it get *Access denied*.

## What users can deploy

| Type | Detected by | How it runs |
|---|---|---|
| Static site | `index.html` (root or a `dist/`, `build/`, `public/`… folder) | served directly by the platform |
| Node.js / Next.js server | `package.json` with a server (Next, Express, Fastify, a `start` script, or `server.js`) | `npm install` (+ build), then the server, listening on `process.env.PORT` |
| Frontend app (Vite / CRA / Vue / plain) | `package.json` with a build step and no server | `npm run build`, then the compiled `dist/`/`build/`/`out/` served as static |
| Python / FastAPI | `main.py`/`app.py`/… exposing `app` (ASGI) | own virtualenv, `uvicorn` |
| Python / Flask · Django | Flask/Django in the code or `requirements.txt` (WSGI) | own virtualenv, `gunicorn` |

Code sources: a public git URL, an uploaded zip, or a built-in sample.
Deliberately few frameworks — this is a product decision, not a limitation to fix.

**Durable storage:** every app gets a persistent folder at the path in its
`SCLOUD_DATA_DIR` env var (mounted at `/data` in production). Files written there
survive restarts, idle-stops, and redeploys — so an app can keep JSON, uploads,
etc. without an external database. See `samples/team-notes`.

**Managed database:** attach a SQLite database to a project in one click (no
server to run). The platform injects `DATABASE_URL` (and `SCLOUD_DATABASE_PATH`)
and keeps the file in durable storage, so it persists across redeploys. See
`samples/sqlite-guestbook`. The engine abstraction leaves room for Postgres later.

## How it works

```
User ──► Next.js dashboard (React)
              │
              ▼
        Control plane  (app/api/* routes → lib/*, SQLite via node:sqlite)
        projects · users · permissions · deployments · logs
              │  deployment job
              ▼
        Build system   (lib/builder.ts: fetch → detect → install → build)
              ▼
        Runner         (lib/runner.ts: subprocess today, Docker when available)
              ▼
        App gateway    (/app/{slug}/… — the authenticating reverse proxy)
```

Key properties:

- **Apps never implement auth.** Every request to an app passes the platform's
  gateway, which checks a signed app-session cookie and project membership,
  then forwards the request with `X-SmallSoftware-User` so apps can personalize.
- **Each app has its own origin.** Apps are served at `{slug}.localhost:3000`
  (configurable via `SCLOUD_BASE_HOST` for a real wildcard domain), so app code
  is fully isolated from the dashboard's cookies and API — see SECURITY.md.
- **Stable URLs.** Each project gets `http://{its-slug}.{base-host}/` forever;
  old `/app/{slug}` links redirect.
- **Scale-to-zero shape.** Idle apps are stopped after 30 minutes; a request to
  a stopped app transparently restarts it (sub-second for Node apps).
- **Sharing is Google-Docs-style.** Share with any email; if they don't have an
  account yet, the invite converts to access the moment they sign up.
- **Roles:** `owner` (deploy, edit, share, delete), `editor` (can use + deploy,
  change code, and env vars — but not share or delete), and `collaborator` (open
  and use the app, see basic info). Pick the role in the Share form; the owner can
  change a member's role inline.

## API (for AI agents)

Create a token on `/account`, then `Authorization: Bearer <token>`:

```
POST /api/projects                 {name, description?, repository_url? | sample?}
GET  /api/projects
GET  /api/projects/:id             (includes members + latest deployment/logs)
POST /api/projects/:id/code        (multipart zip: code_zip)
POST /api/projects/:id/deploy
GET  /api/deployments/:id
GET  /api/projects/:id/access
POST /api/projects/:id/members     {email}
GET  /api/projects/:id/env         (owner only)
PUT  /api/projects/:id/env         {key, value}   — applied on next deploy/restart
DELETE /api/projects/:id/env       {key}
```

And the matching CLI:

```bash
node cli/smallsoftware.mjs login   # server + token, stored in ~/.smallsoftware.json
node cli/smallsoftware.mjs init    # register the current folder as an app
node cli/smallsoftware.mjs deploy  # zip → upload → deploy → prints the live URL
```

## Security

See [SECURITY.md](SECURITY.md) for the honest breakdown of MVP-level vs
production-grade guarantees. Summary: apps run as restricted subprocesses with
a minimal environment on this host (Docker container isolation is selected
automatically when Docker is present), and platform credentials are never
exposed to deployed applications.

## Repo layout

```
app/            Next.js pages + API routes (+ /app/[slug] gateway)
components/     React client components
lib/            control plane: config, db, auth, projects, builder, runner, deploy
samples/        team-notes (Node), orchard-tracker (FastAPI),
                sqlite-guestbook (Node + managed DB), hello-static
cli/            smallsoftware CLI
data/           runtime state: SQLite DB, builds, uploads, app logs (gitignored)
```

## What's done and what's next

See **[ROADMAP.md](ROADMAP.md)** for the shipped feature list and the honest
priority order for what remains (Postgres, org/teams, hardened multi-tenant
isolation, …).

# Roadmap

**Small Software Cloud** — deploy and share small, purpose-built apps as easily
as a Google Doc. Build a tool → click Deploy → share the link. No servers,
containers, DNS, or IAM to configure.

**Status:** live MVP, running on a single VPS (Caddy + systemd + Docker). It is
an honest MVP for **trusted small teams** — the deploy-and-share loop is real and
proven; hardened multi-tenant isolation for *untrusted* code is not built yet
(see [SECURITY.md](SECURITY.md)).

Legend: ✅ done & deployed · 🔜 next · 🪨 large/multi-part · ⛔ deliberately out of scope

---

## ✅ Done

**Core loop — create → deploy → access → share**
- Project management (create, rename, describe, delete) with a clean dashboard.
- One-click deploy with a friendly, infra-free log stream and clear states
  (not deployed / building / running / failed / stopped).
- Each app gets a stable URL on its own origin (`{slug}.domain`).

**Deploy & runtime**
- App types: **Node/Next.js servers**, **frontend SPAs** (Vite/CRA/Vue/plain →
  built to static), **Python FastAPI** (uvicorn) and **Flask/Django** (gunicorn),
  and **static sites** (root or a `dist/`/`build/`/`public/` folder).
- Sources: public git URL (sanitized), uploaded zip (hardened extraction —
  traversal/symlink/zip-bomb safe), or a built-in sample.
- Runners behind one interface: **subprocess** (dev) and **Docker** (production,
  auto-selected) with cpu/memory/pid limits, non-root, per-app port on loopback.
- **Builds run sandboxed** in a throwaway container with no access to the
  platform's data or secrets.
- Real health checks (reject 5xx, fail fast on crash-on-boot, surface app output).
- Scale-to-zero: idle apps stop after 30 min and wake on the next request.

**Environment**
- Per-app **environment variables / secrets** (owner-configurable, injected at start).
- **Durable storage** — a persistent `/data` folder (`SCLOUD_DATA_DIR`) that
  survives restarts, idle-stops, and redeploys.
- **Managed SQLite database** — one-click attach, injected as `DATABASE_URL` /
  `SCLOUD_DATABASE_PATH`, persisted in durable storage, isolated per project.

**Reliability**
- **Password reset** — signed, single-use, 30-min token by email; resetting
  signs the user out everywhere.
- **Automated daily backups** — consistent snapshot of the whole data dir
  (SQLite via `VACUUM INTO`), pruned to the newest 7, on a systemd timer.
- **Automated tests** (`npm test`, node:test) over the security-relevant logic;
  `update.sh` runs them and aborts the deploy if they fail.

**Auth & sharing**
- Email/password auth (scrypt), server-side sessions, and bearer **API tokens**
  for the CLI/agents.
- **Per-origin app gateway** with a signed session handoff, so deployed apps
  never implement auth; membership is re-checked on every request.
- **Cross-origin API lock** — a deployed app can't drive the platform API in the
  user's browser.
- **Three roles**: owner / editor (use + deploy/edit) / collaborator (use).
- **Email-on-invite** (SMTP; degrades to a local outbox when unset).
- **Rate limiting** on login and signup.

**Platform**
- JSON API + a tiny `smallsoftware` CLI (agent-friendly).
- Single-VPS deploy kit: Caddy (auto-HTTPS incl. wildcard via on-demand TLS),
  systemd unit, `setup-server.sh`, `update.sh`, health endpoint, and an
  end-to-end test that deploys a Node app in Docker and checks it through the proxy.

---

## 🔜 Next

Organized by the three genuinely hard problems the product must solve. Rough
effort/risk notes included so priorities are legible.

### 1. Environment customization
| Item | Value | Notes |
|---|---|---|
| 🔜 **Postgres databases** | High | Extends the DB engine abstraction (already in place) with a shared Postgres, one DB per project, injected as `DATABASE_URL`. Needs Docker to verify — build then test on the server. |
| 🔜 Custom build/runtime (Dockerfile or system packages) | High | Let apps declare a base image or extra packages. Bigger change to the build path. |
| 🔜 Attached services (cron, queues) | Medium | Only if demand appears; keep it small. |

### 2. Auth & permissions
| Item | Value | Notes |
|---|---|---|
| 🔜 **Org/team model** | High | Sharing that scales past a single owner: teams own projects, member management at the org level. A real data-model change (~a day), fully testable. |
| 🔜 Ownership transfer / co-owners | Medium | Small once the membership model is richer. |
| ✅ Google sign-in (OAuth) | — | "Continue with Google", state-cookie CSRF, link-by-email, config-gated. GitHub/SSO still open via the same pattern. |
| 🔜 Email verification | Medium | Password reset ✅ done; verification still open. |
| 🔜 Audit log | Low–Med | Who deployed/shared/accessed what. |

### 3. Secure execution of untrusted code — 🪨 the big rock
This is what turns "great for trusted teams" into "a public cloud."
| Item | Notes |
|---|---|
| 🪨 Stronger sandbox (gVisor / Firecracker microVMs) | The `Runner` interface is built to accept this without touching deploy/proxy/UI. |
| 🔜 Per-app egress network policy (default-deny) | Apps (and builds) currently have outbound network. |
| 🔜 Encryption-at-rest for env vars / secrets | Plaintext in SQLite today; the platform secret already lives outside the DB. |
| 🔜 Deeper upload/repo validation | Beyond the current size / traversal / symlink / bomb checks. |

### Operational / smaller
| Item | Notes |
|---|---|
| 🔜 Deployment history + rollback | Needs build-artifact retention (today builds are ephemeral). |
| 🔜 Real-time log streaming | Currently 2s polling. |
| 🔜 Concurrency limits / port-pool management | Cap simultaneous running apps. |
| 🔜 Broaden test coverage | Unit suite ✅ exists; add integration/deploy-path tests. |

---

## ⛔ Explicitly not building (per the product brief)

Kubernetes, multi-region, advanced autoscaling, enterprise SSO beyond the auth
abstraction, complex billing, GPU scheduling, a global CDN, sophisticated CI/CD,
or dozens of framework integrations. The point is to validate the *small
software* deploy-and-share experience — not to rebuild AWS.

---

## Guiding principles

1. **Applications, not infrastructure.** Users think "my app," never "my container."
2. **Deploy, don't configure.** Code → Deploy → URL.
3. **Sharing is first-class.** As easy as a Google Doc.
4. **Small by default.** Optimize for 1–20 users, not millions.
5. **AI-native.** An agent can create, deploy, and share via the API/CLI.

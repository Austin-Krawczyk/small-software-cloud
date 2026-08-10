# Security: MVP-level vs production-grade

This platform will eventually execute arbitrary AI-generated code, so being
explicit about the current guarantees matters more than pretending they are
stronger than they are.

## What the MVP guarantees today

| Guarantee | How |
|---|---|
| Apps are only reachable through the platform | Apps bind to loopback ports (9100–9500); the only public surface is the authenticating gateway |
| **Apps run on their own origin** | Each app is served at `{slug}.BASE_HOST`, a different origin from the dashboard/API. The platform session cookie is host-only to the platform origin and is **never sent to an app**; an app's JavaScript is cross-origin to the platform (`lib/config.ts`, `middleware.ts`, `app/gateway`) |
| **The platform API can't be driven by a deployed app** | Cookie-authenticated API requests must carry the platform's own `Origin`; a call from an app origin is refused (`lib/api.ts`), and the API sets no CORS headers so browsers block it too. Bearer-token callers (CLI/agents) send no cookie and are unaffected |
| Access control on every request | The gateway validates a signed, app-scoped session cookie and re-checks project membership before any byte is proxied — so un-sharing takes effect immediately. Deployed apps never see platform credentials |
| Platform secrets are not exposed to apps | Child processes get a minimal environment (`PORT`, `HOST`, temp dirs, runtime path) plus only the owner-configured env vars — the platform's own env and session secret are **not** inherited (verified: an app cannot read `SCLOUD_*`) |
| App config/secrets are separate from platform config | Per-app env vars live in their own table, are owner-only over the API, and are injected at process start; reserved launch keys (`PORT`, `PATH`, …) can't be overridden (`lib/runner.ts`) |
| Apps can't read each other's builds via the proxy | Static serving is jailed to the project's build dir (path-resolution check); uploads are validated against zip path traversal |
| A broken app is reported as failed, not "running" | Health checks reject 5xx responses and fail fast when the process exits on boot, surfacing the app's own output in the deploy log (`lib/deploy.ts`) |
| Resource ceilings exist | Upload ≤ 50 MB, project ≤ 200 MB, build timeout 5 min, health-check timeout 60 s, idle apps stopped after 30 min |
| No privileged execution paths | The platform never runs user code with elevated rights, never mounts the Docker socket into apps, and there is no "run as root" option |

## What is NOT guaranteed at MVP level (subprocess runner)

On a host without Docker (like this dev machine), apps run as **OS subprocesses
under the platform's user account**. That means a malicious app could:

- read/write files the platform's user can access (it is *not* filesystem-jailed),
- make arbitrary outbound network requests,
- attempt to connect to other loopback ports (including other apps'),
- consume CPU/RAM (no hard cgroup-style limits on Windows subprocesses).

**Therefore: the subprocess runner is for trusted/dev use.** It exists so the
product loop works anywhere; it is not a sandbox.

## The path to production-grade (already shaped in the code)

`lib/runner.ts` defines a `Runner` interface with two implementations. When
Docker is available it is selected automatically and provides the next tier:

- container per app (`--user 1000:1000`, `--security-opt no-new-privileges`)
- `--memory 256m --cpus 0.5 --pids-limit 128`
- only the app's own build dir mounted; port published to loopback only

Beyond that, the same interface accommodates gVisor/Firecracker or remote
execution hosts without touching deploy, proxy, or UI code. Other planned
hardening, in rough order of value:

1. Per-app outbound network policy (default-deny for containers).
2. Encryption-at-rest for app env vars (they are plaintext in SQLite today; the platform secret already lives outside the DB).
3. Rate limiting + login throttling on the platform API.
4. Scanning/validation of uploaded repositories beyond size and zip-traversal checks.

Already done from the original roadmap: per-origin app isolation with a signed
session handoff (`/api/app-access` → `{app}/__scloud_auth`), cross-origin
refusal on the platform API, and a per-app secrets/env store.

### How the app-origin handoff works

```
browser → {slug}.BASE_HOST/…        no valid app cookie
        → BASE_HOST/api/app-access  platform session visible here; membership checked
        → {slug}.BASE_HOST/__scloud_auth?token=…   60-second signed handoff token
        → sets scloud_app cookie    HMAC-signed {user, slug, expiry}, host-only
        → back to the app URL       gateway re-checks membership on every request
```

In dev this uses `*.localhost` subdomains (browsers resolve them to 127.0.0.1
natively). In production set `SCLOUD_BASE_HOST`/`SCLOUD_PROTO` and point a
wildcard DNS record at the host.

## Platform auth

- Passwords: scrypt (Node crypto), per-user salt, constant-time compare.
- Sessions: 32-byte random tokens, server-side table, 14-day expiry, `HttpOnly` + `SameSite=Lax` cookies.
- API tokens: random bearer tokens; only SHA-256 hashes stored; shown once.
- The auth module (`lib/auth.ts`) is the single swap point for Clerk/Supabase/OAuth/SSO later.

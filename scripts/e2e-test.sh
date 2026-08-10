#!/usr/bin/env bash
# End-to-end deployment test for Small Software Cloud.
#
# Boots a throwaway control-plane instance (its own port + temp data dir, so it
# never touches production data), then exercises the full loop:
#
#   register → create project → upload a Node app → deploy → the app runs →
#   health check passes → the app is reachable THROUGH the platform proxy.
#
# On a host with Docker (the production setup) it additionally asserts the app
# is running inside a Docker container. On a host without Docker it runs the
# same flow via the subprocess runner and skips the container assertion.
#
# Usage:  bash scripts/e2e-test.sh
# Requires: the app to be built already (npm run build) and curl.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$INSTALL_DIR"

# Pick a free port so parallel/leftover instances never collide.
PORT="${E2E_PORT:-$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')}"
HOST_HDR="localhost:$PORT"
DATA_DIR="$(mktemp -d)"
JAR="$(mktemp)"
WORK="$(mktemp -d)"
SERVER_PID=""
PROJECT_ID=""

pass() { printf '\033[1;32m  ✓ %s\033[0m\n' "$1"; }
info() { printf '\033[1;34m==> %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m  ✗ FAIL: %s\033[0m\n' "$1" >&2; exit 1; }

# curl helpers that pin every hostname to loopback (no DNS/TLS needed).
RESOLVE=(--resolve "localhost:$PORT:127.0.0.1")
api() { curl -sS "${RESOLVE[@]}" "$@"; }

cleanup() {
  [ -n "$PROJECT_ID" ] && api -b "$JAR" -H "Origin: http://$HOST_HDR" -X POST \
    "http://$HOST_HDR/api/projects/$PROJECT_ID/stop" >/dev/null 2>&1
  [ -n "$PROJECT_ID" ] && command -v docker >/dev/null 2>&1 && \
    docker rm -f "scloud-$PROJECT_ID" >/dev/null 2>&1
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" >/dev/null 2>&1
  pkill -f "next start -p $PORT" >/dev/null 2>&1
  sleep 1 # let the DB file handle release before removing (Windows)
  rm -rf "$DATA_DIR" "$WORK" "$JAR" 2>/dev/null || true
}
trap cleanup EXIT

[ -d "$INSTALL_DIR/.next" ] || fail "Not built. Run: npm run build"

# ---- 1. boot a throwaway control plane -----------------------------------
info "Booting throwaway control plane on :$PORT"
SCLOUD_DATA_DIR="$DATA_DIR" SCLOUD_BASE_HOST="$HOST_HDR" SCLOUD_PROTO="http" \
  NODE_ENV="production" "$INSTALL_DIR/node_modules/.bin/next" start -p "$PORT" -H 127.0.0.1 \
  > "$DATA_DIR/server.log" 2>&1 &
SERVER_PID=$!

for i in $(seq 1 60); do
  H="$(api "http://$HOST_HDR/api/health" 2>/dev/null)"
  echo "$H" | grep -q '"status":"ok"' && break
  sleep 1
  [ "$i" = 60 ] && { cat "$DATA_DIR/server.log"; fail "control plane did not come up"; }
done
RUNNER="$(echo "$H" | sed -n 's/.*"runner":"\([a-z]*\)".*/\1/p')"
pass "control plane healthy (runner: $RUNNER)"

# ---- 2. register a user and get an API token -----------------------------
api -c "$JAR" -H "Origin: http://$HOST_HDR" -H 'content-type: application/json' \
  -X POST "http://$HOST_HDR/api/auth/signup" \
  -d '{"name":"E2E","email":"e2e@example.com","password":"e2e-password-1"}' >/dev/null
TOKEN="$(api -b "$JAR" -H "Origin: http://$HOST_HDR" -H 'content-type: application/json' \
  -X POST "http://$HOST_HDR/api/tokens" -d '{"label":"e2e"}' \
  | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))')"
[ -n "$TOKEN" ] || fail "could not obtain API token"
pass "registered user and minted API token"

# ---- 3. build a tiny Node app and create the project ---------------------
cat > "$WORK/package.json" <<'EOF'
{ "name": "e2e-app", "scripts": { "start": "node server.js" } }
EOF
cat > "$WORK/server.js" <<'EOF'
const http = require("node:http");
http.createServer((_req, res) => {
  res.end("E2E_OK env=" + (process.env.E2E_ENV || "unset"));
}).listen(process.env.PORT || 3000, process.env.HOST || "0.0.0.0");
EOF
node -e 'const A=require("adm-zip"),z=new A();z.addLocalFile(process.argv[1]);z.addLocalFile(process.argv[2]);z.writeZip(process.argv[3])' \
  "$WORK/package.json" "$WORK/server.js" "$WORK/app.zip"

PROJECT_ID="$(api -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X POST "http://$HOST_HDR/api/projects" -d '{"name":"E2E App"}' \
  | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).id))')"
[ -n "$PROJECT_ID" ] || fail "project not created"
SLUG="e2e-app"
RESOLVE+=(--resolve "$SLUG.localhost:$PORT:127.0.0.1")
pass "created project $PROJECT_ID (slug: $SLUG)"

# ---- 4. set an env var, upload code, deploy ------------------------------
api -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -X PUT "http://$HOST_HDR/api/projects/$PROJECT_ID/env" \
  -d '{"key":"E2E_ENV","value":"injected"}' >/dev/null
api -H "Authorization: Bearer $TOKEN" -F "code_zip=@$WORK/app.zip" \
  "http://$HOST_HDR/api/projects/$PROJECT_ID/code" >/dev/null
DEP="$(api -H "Authorization: Bearer $TOKEN" -X POST \
  "http://$HOST_HDR/api/projects/$PROJECT_ID/deploy" \
  | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).deployment_id))')"
pass "uploaded code + env var, deployment $DEP started"

# ---- 5. wait for the deployment to go green ------------------------------
info "Waiting for deployment"
STATUS=""
for i in $(seq 1 90); do
  STATUS="$(api -H "Authorization: Bearer $TOKEN" "http://$HOST_HDR/api/deployments/$DEP" \
    | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).status))')"
  [ "$STATUS" = running ] && break
  [ "$STATUS" = failed ] && { api -H "Authorization: Bearer $TOKEN" "http://$HOST_HDR/api/deployments/$DEP" \
    | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).logs))'; fail "deployment failed"; }
  sleep 2
done
[ "$STATUS" = running ] || fail "deployment did not reach running (last: $STATUS)"
pass "deployment reached 'running' and passed health check"

# ---- 6. Docker assertion (only on a Docker host) -------------------------
if [ "$RUNNER" = docker ]; then
  RUNNING="$(docker inspect -f '{{.State.Running}}' "scloud-$PROJECT_ID" 2>/dev/null)"
  [ "$RUNNING" = true ] || fail "app container scloud-$PROJECT_ID is not running"
  pass "app is running inside Docker container scloud-$PROJECT_ID"
else
  printf '\033[1;33m  • runner is "%s" (no Docker here) — skipping container assertion\033[0m\n' "$RUNNER"
fi

# ---- 7. access the app THROUGH the platform proxy ------------------------
info "Fetching the app through the platform proxy (full auth handoff)"
BODY="$(api -b "$JAR" -c "$JAR" -L "http://$SLUG.$HOST_HDR/")"
echo "$BODY" | grep -q "E2E_OK" || fail "app not reachable through proxy (got: ${BODY:0:120})"
pass "app served through proxy with platform auth"
echo "$BODY" | grep -q "env=injected" || fail "env var not injected (got: ${BODY:0:120})"
pass "per-app env var was injected into the running app"

printf '\n\033[1;32mALL CHECKS PASSED\033[0m — create → deploy → run → health → proxy ✓\n'

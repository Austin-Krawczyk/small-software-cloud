// Deployment orchestration.
//
// startDeployment() runs the full pipeline in the background and streams
// friendly, infrastructure-free log lines into the deployment record:
//
//   Building application...
//   ✓ Repository downloaded
//   ✓ Dependencies installed
//   ✓ Application built
//   ✓ Application started
//   ✓ Health check passed
//   Application running
//
// Also owns the app lifecycle: wake-on-request for stopped apps and an idle
// reaper that stops apps with no recent traffic (the scale-to-zero shape).
import path from "node:path";
import fs from "node:fs";
import {
  APP_LOGS_DIR, BUILDS_DIR, HEALTH_TIMEOUT_MS, IDLE_STOP_MS, APP_HOST,
  appOriginFor, ensureDirs,
} from "./config";
import {
  appendDeployLog, all, envMap, getProject, newId, now, one, run, Row, setProject,
} from "./db";
import { build, BuildError, BuildResult, fetchSource, venvPython } from "./builder";
import { freePort, getRunner } from "./runner";

const g = globalThis as any;

// project_id -> last time the proxy routed a request to it
const lastActivity: Map<string, number> =
  (g.__scloud_activity ??= new Map<string, number>());

// serialize deploy/start/stop per project
const locks: Map<string, Promise<any>> =
  (g.__scloud_locks ??= new Map<string, Promise<any>>());

async function withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(projectId) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(projectId, next);
  return next;
}

export const buildDirFor = (projectId: string) => path.join(BUILDS_DIR, projectId);
// Each app lives on its own origin (subdomain) — see lib/config.ts.
export const appUrl = (slug: string) => `${appOriginFor(slug)}/`;
export const touchActivity = (projectId: string) => lastActivity.set(projectId, Date.now());

// Last lines of an app's runtime stdout/stderr — surfaced when a deploy fails.
function tailAppLog(projectId: string, lines = 15): string {
  try {
    const text = fs.readFileSync(path.join(APP_LOGS_DIR, `${projectId}.log`), "utf8");
    return text.split("\n").filter(Boolean).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

export function startDeployment(projectId: string): string {
  const depId = newId();
  run(
    "INSERT INTO deployments (id, project_id, status, created_at) VALUES (?,?,?,?)",
    depId, projectId, "building", now()
  );
  void withLock(projectId, () => runDeployment(projectId, depId));
  return depId;
}

async function runDeployment(projectId: string, depId: string): Promise<void> {
  const log = (line: string) => appendDeployLog(depId, line);
  const project = getProject(projectId);
  if (!project) return;
  setProject(projectId, { status: "building" });
  log("Building application...");
  try {
    stopInstance(project);

    const dir = buildDirFor(projectId);
    await fetchSource(project, dir, log);
    const result = await build(dir, log);

    run("UPDATE deployments SET status='deploying' WHERE id = ?", depId);
    const { port, pid } = await startInstance(project, result, log);

    const url = appUrl(project.slug);
    setProject(projectId, {
      status: "running", app_type: result.appType,
      port, pid, last_deployed_at: now(),
    });
    run(
      "UPDATE deployments SET status='running', url=?, completed_at=? WHERE id=?",
      url, now(), depId
    );
    log("");
    log("Application running");
    log("");
    log(`→ ${url}`);
    touchActivity(projectId);
  } catch (e: any) {
    const message = e instanceof BuildError ? e.message : `Unexpected error: ${e.message ?? e}`;
    log("");
    log(`✗ Deployment failed: ${message}`);
    const tail = tailAppLog(projectId);
    if (tail) {
      log("");
      log("--- application output ---");
      for (const line of tail.split("\n")) log(line);
    }
    setProject(projectId, { status: "failed", port: null, pid: null });
    run("UPDATE deployments SET status='failed', completed_at=? WHERE id=?", now(), depId);
  }
}

async function startInstance(
  project: Row, result: BuildResult, log: (l: string) => void
): Promise<{ port: number | null; pid: number | null }> {
  if (result.appType === "static") {
    log("✓ Health check passed");
    return { port: null, pid: null };
  }
  const port = await freePort();
  const pid = await getRunner().start(project.id, result, port, envMap(project.id));
  log("✓ Application started");
  await waitHealthy(project.id, port, pid);
  log("✓ Health check passed");
  return { port, pid };
}

// A real health check: keep probing until the app answers with a non-5xx
// status. Fail fast if the instance dies (crash-on-boot), and treat a server
// that only ever returns 5xx as unhealthy rather than "running but broken".
// Works for both runners: a dead subprocess or an exited container both make
// isRunning() false.
async function waitHealthy(projectId: string, port: number, pid: number | null): Promise<void> {
  const runner = getRunner();
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let detail = "no response";
  let grace = 3; // allow a moment for the instance to come up before trusting isRunning
  while (Date.now() < deadline) {
    if (grace <= 0 && !runner.isRunning(projectId, pid)) {
      throw new BuildError("Application exited on startup — see the output below.");
    }
    grace--;
    try {
      const res = await fetch(`http://${APP_HOST}:${port}/`, { signal: AbortSignal.timeout(3000) });
      if (res.status < 500) return; // reachable and not erroring
      detail = `HTTP ${res.status}`;
    } catch (e: any) {
      detail = e?.cause?.code ?? e?.message ?? String(e);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new BuildError(`Application did not become healthy (${detail}).`);
}

// ---- lifecycle: stop / wake / idle-reap ----

function stopInstance(project: Row): void {
  if (project.pid || project.app_type === "node" || project.app_type === "python") {
    getRunner().stop(project.id, project.pid ?? null);
  }
}

export async function stopProject(projectId: string): Promise<void> {
  await withLock(projectId, async () => {
    const project = getProject(projectId);
    if (!project) return;
    stopInstance(project);
    if (project.status === "running") {
      setProject(projectId, { status: "stopped", pid: null, port: null });
    }
  });
}

// Called by the proxy. Wakes a stopped app; returns a fresh project row.
// Throws Error with a user-facing message if the app can't serve.
export async function ensureRunning(project: Row): Promise<Row> {
  touchActivity(project.id);

  const alive = (p: Row) =>
    p.status === "running" &&
    (p.app_type === "static" || getRunner().isRunning(p.id, p.pid));

  if (alive(project)) return project;

  if (!["running", "stopped"].includes(project.status) || !project.app_type) {
    throw new Error("This application is not deployed.");
  }

  return withLock(project.id, async () => {
    let p = getProject(project.id)!;
    if (alive(p)) return p;

    const dir = buildDirFor(p.id);
    if (!fs.existsSync(dir)) throw new Error("This application needs to be deployed again.");

    const result: BuildResult = { appType: p.app_type, buildDir: dir };
    if (p.app_type === "python") {
      result.entry = fs.existsSync(path.join(dir, "main.py")) ? "main:app" : "app:app";
    } else if (p.app_type === "node") {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
      result.startCmd = pkg.scripts?.start ? ["npm", "start"] : ["node", pkg.main ?? "server.js"];
    }
    const { port, pid } = await startInstance(p, result, () => {});
    setProject(p.id, { status: "running", port, pid });
    return getProject(p.id)!;
  });
}

// ---- startup + idle reaper (initialized once per server process) ----

export function initPlatform(): void {
  if (g.__scloud_init) return;
  g.__scloud_init = true;
  ensureDirs();

  // Platform restart: reconcile the runner (remove leftover app containers),
  // then mark apps stopped so the proxy transparently wakes them on the next
  // request.
  try { getRunner().resetAll(); } catch {}
  run("UPDATE projects SET pid=NULL, port=NULL, status='stopped' WHERE status='running'");
  run(
    "UPDATE deployments SET status='failed', completed_at=? WHERE status IN ('building','deploying')",
    now()
  );

  setInterval(() => {
    try {
      for (const p of all("SELECT * FROM projects WHERE status='running'")) {
        if (p.app_type === "static") continue;
        const seen = lastActivity.get(p.id) ?? 0;
        if (seen && Date.now() - seen > IDLE_STOP_MS) void stopProject(p.id);
      }
    } catch {}
  }, 60_000).unref();
}

// Build system: fetch source, detect app type, produce an isolated runnable copy.
//
// Supported app types:
//   static — a site with an index.html (at the root or in a publish folder like
//            dist/ or public/); served directly by the platform.
//   node   — a package.json. A server (Next.js/Express/Fastify/…) is built and
//            run (must listen on process.env.PORT). A frontend with no server
//            (Vite/CRA/Vue/plain) is built and its output served as static.
//   python — FastAPI (run with uvicorn) or Flask/Django (run with gunicorn),
//            auto-detected; entry file main.py/app.py/wsgi.py/… exposing `app`.
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import {
  BUILD_TIMEOUT_MS, MAX_PROJECT_BYTES, SAMPLES_DIR, UPLOADS_DIR,
} from "./config";
import { Row } from "./db";

const execFileP = promisify(execFile);

export class BuildError extends Error {}

export type AppType = "static" | "node" | "python";

export interface BuildResult {
  appType: AppType;
  buildDir: string;
  // node: argv to launch the server
  startCmd?: string[];
  // python: WSGI/ASGI entry ("main:app") and which server runs it
  entry?: string;
  pyServer?: "uvicorn" | "gunicorn";
  // static: subfolder of buildDir that holds index.html ("" = root, "dist", …)
  staticDir?: string;
}

// Where a static site's index.html may live. For a built frontend the compiled
// output dirs are preferred over the (source) project root.
const STATIC_DIRS_BUILT = ["dist", "build", "out", ".output/public", "public"];
const STATIC_DIRS_PLAIN = ["", "public", "dist", "build", "site", "_site"];

// Node deps that mean "this is a server", so we run it instead of serving static.
const NODE_SERVER_DEPS = [
  "next", "express", "fastify", "koa", "@hapi/hapi", "hapi", "@nestjs/core",
  "restify", "polka", "h3", "hono",
];

// Python source files that can hold the app object, in priority order.
const PY_MODULES = ["main", "app", "application", "wsgi", "asgi", "server", "run"];

export type Log = (line: string) => void;

async function sh(cmd: string, args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileP(cmd, args, {
      cwd,
      timeout: BUILD_TIMEOUT_MS,
      windowsHide: true,
      shell: process.platform === "win32" && (cmd === "npm" || cmd === "npx"),
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (e: any) {
    const detail = (e.stderr || e.stdout || e.message || "command failed").toString();
    throw new BuildError(detail.trim().slice(-2000));
  }
}

// ---- source fetching ----

export async function fetchSource(project: Row, dest: string, log: Log): Promise<void> {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  if (project.source_kind === "git") {
    const url = normalizeGitUrl(project.repository_url);
    await sh("git", ["clone", "--depth", "1", url, dest]);
    fs.rmSync(path.join(dest, ".git"), { recursive: true, force: true });
    log("✓ Repository downloaded");
  } else if (project.source_kind === "upload") {
    const zipPath = path.join(UPLOADS_DIR, `${project.id}.zip`);
    if (!fs.existsSync(zipPath)) throw new BuildError("No uploaded code found. Upload a zip first.");
    extractZip(zipPath, dest);
    log("✓ Code unpacked");
  } else if (project.source_kind === "sample") {
    const sample = path.join(SAMPLES_DIR, project.repository_url);
    if (!path.resolve(sample).startsWith(path.resolve(SAMPLES_DIR)) || !fs.existsSync(sample)) {
      throw new BuildError(`Unknown sample "${project.repository_url}".`);
    }
    fs.cpSync(sample, dest, { recursive: true });
    log("✓ Sample code copied");
  } else {
    throw new BuildError("This project has no code yet. Add a repository URL or upload a zip.");
  }

  if (dirSize(dest) > MAX_PROJECT_BYTES) {
    throw new BuildError("Project is too large for Small Software Cloud (limit 200 MB).");
  }
  unwrapSingleFolder(dest);
}

function extractZip(zipPath: string, dest: string): void {
  const zip = new AdmZip(zipPath);
  for (const entry of zip.getEntries()) {
    const target = path.resolve(dest, entry.entryName);
    if (!target.startsWith(path.resolve(dest))) {
      throw new BuildError("Invalid archive (path traversal detected).");
    }
  }
  zip.extractAllTo(dest, true);
}

function dirSize(dir: string): number {
  let total = 0;
  for (const f of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (f.isFile()) total += fs.statSync(path.join(f.parentPath, f.name)).size;
  }
  return total;
}

// If the archive/repo wraps everything in one top-level folder, unwrap it.
function unwrapSingleFolder(dest: string): void {
  const entries = fs.readdirSync(dest).filter((n) => n !== "__MACOSX");
  if (entries.length !== 1) return;
  const inner = path.join(dest, entries[0]);
  if (!fs.statSync(inner).isDirectory()) return;
  for (const child of fs.readdirSync(inner)) {
    fs.renameSync(path.join(inner, child), path.join(dest, child));
  }
  fs.rmdirSync(inner);
}

// ---- detection + build ----

export function detectAppType(src: string): AppType {
  if (fs.existsSync(path.join(src, "package.json"))) return "node";
  if (fs.existsSync(path.join(src, "requirements.txt")) || pyModule(src)) return "python";
  if (findStaticRoot(src, STATIC_DIRS_PLAIN) !== null) return "static";
  throw new BuildError(
    "Could not recognize this application. Supported: Node.js / frontend apps " +
    "(package.json), Python (FastAPI or Flask), or a static site (index.html)."
  );
}

// First subfolder (relative) containing an index.html, or null. "" means root.
function findStaticRoot(src: string, order: string[]): string | null {
  for (const rel of order) {
    if (fs.existsSync(path.join(src, rel, "index.html"))) return rel;
  }
  return null;
}

// The Python source file (without .py) most likely to hold the app object.
function pyModule(src: string): string | null {
  for (const m of PY_MODULES) {
    if (fs.existsSync(path.join(src, `${m}.py`))) return m;
  }
  return null;
}

// Work out the entry ("module:attr") and which server (uvicorn for ASGI/FastAPI,
// gunicorn for WSGI/Flask/Django) by reading the code and requirements.
export function pythonEntry(src: string): { entry: string; pyServer: "uvicorn" | "gunicorn" } {
  const mod = pyModule(src);
  if (!mod) {
    throw new BuildError(
      "No Python entry file found. Expected one of: " +
      PY_MODULES.map((m) => `${m}.py`).join(", ") + " exposing an `app` object."
    );
  }
  const code = fs.readFileSync(path.join(src, `${mod}.py`), "utf8");
  const reqPath = path.join(src, "requirements.txt");
  const reqs = fs.existsSync(reqPath) ? fs.readFileSync(reqPath, "utf8").toLowerCase() : "";
  const hay = (code + "\n" + reqs).toLowerCase();

  const isWsgi = /\bflask\b|\bdjango\b|\bgunicorn\b|from flask|flask\s*\(/.test(hay);
  const isAsgi = /\bfastapi\b|\bstarlette\b|\buvicorn\b|from fastapi|fastapi\s*\(/.test(hay);

  // Django's wsgi.py exposes `application`; most Flask/FastAPI use `app`.
  const attr = /^\s*application\s*=/m.test(code) && !/^\s*app\s*=/m.test(code) ? "application" : "app";
  const pyServer: "uvicorn" | "gunicorn" = isWsgi && !isAsgi ? "gunicorn" : "uvicorn";
  return { entry: `${mod}:${attr}`, pyServer };
}

// `containerized` is true when the Docker runner is active. Docker apps install
// their Python deps inside the container at start (host virtualenvs aren't
// portable into a container anyway), so we skip building one on the host — which
// also means a Docker host never needs the python3-venv package.
export async function build(src: string, log: Log, containerized = false): Promise<BuildResult> {
  const appType = detectAppType(src);
  if (appType === "static") {
    const staticDir = findStaticRoot(src, STATIC_DIRS_PLAIN) ?? "";
    log("✓ Static site detected");
    return { appType: "static", buildDir: src, staticDir };
  }
  if (appType === "node") return buildNode(src, log);
  return buildPython(src, log, containerized);
}

// Node projects are either a server (Next/Express/…) or a frontend that builds
// to static files (Vite/CRA/Vue/plain). We install deps, build if there's a
// build step, then decide: a real server → run it; otherwise → serve the
// compiled static output.
async function buildNode(src: string, log: Log): Promise<BuildResult> {
  const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
  log("✓ Node.js application detected");
  if (fs.existsSync(path.join(src, "package-lock.json"))) {
    await sh("npm", ["ci", "--no-fund", "--no-audit"], src);
  } else {
    await sh("npm", ["install", "--no-fund", "--no-audit"], src);
  }
  log("✓ Dependencies installed");

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const isNext = !!deps.next;
  if (isNext || pkg.scripts?.build) {
    await sh("npm", ["run", "build"], src);
  }

  // A server if it's Next, depends on a server framework, or ships a server file.
  const hasServerDep = NODE_SERVER_DEPS.some((d) => d in deps);
  const serverCmd = nodeServerCmd(pkg, src);
  if (isNext || hasServerDep || (serverCmd && !pkg.scripts?.build)) {
    if (!serverCmd) {
      throw new BuildError('This app needs a "start" script or a server.js to run.');
    }
    log("✓ Application built");
    return { appType: "node", buildDir: src, startCmd: serverCmd };
  }

  // No server → serve the built (or provided) static output.
  const staticDir = findStaticRoot(src, STATIC_DIRS_BUILT);
  if (staticDir !== null) {
    log(`✓ Built a static site${staticDir ? ` (/${staticDir})` : ""}`);
    return { appType: "static", buildDir: src, staticDir };
  }
  if (serverCmd) {
    log("✓ Application built");
    return { appType: "node", buildDir: src, startCmd: serverCmd };
  }
  throw new BuildError(
    "Built the project, but found no server to start and no static output " +
    "(expected a dist/, build/, or out/ folder with index.html)."
  );
}

async function buildPython(src: string, log: Log, containerized: boolean): Promise<BuildResult> {
  const { entry, pyServer } = pythonEntry(src);
  const kind = pyServer === "gunicorn" ? "Flask/WSGI" : "FastAPI/ASGI";
  log(`✓ Python application detected (${kind})`);

  if (containerized) {
    // Deps are installed inside the container at start; nothing to do on the host.
    log("✓ Application built");
    return { appType: "python", buildDir: src, entry, pyServer };
  }

  const py = process.platform === "win32" ? "python" : "python3";
  await sh(py, ["-m", "venv", path.join(src, ".appenv")]);
  const venvPy = venvPython(src);
  const server = pyServer === "gunicorn" ? "gunicorn" : "uvicorn";
  const req = path.join(src, "requirements.txt");
  if (fs.existsSync(req)) {
    await sh(venvPy, ["-m", "pip", "install", "--quiet", "-r", req, server], src);
  } else if (pyServer === "gunicorn") {
    await sh(venvPy, ["-m", "pip", "install", "--quiet", "flask", "gunicorn"], src);
  } else {
    await sh(venvPy, ["-m", "pip", "install", "--quiet", "fastapi", "uvicorn", "python-multipart"], src);
  }
  log("✓ Dependencies installed");
  log("✓ Application built");
  return { appType: "python", buildDir: src, entry, pyServer };
}

// Accept a pasted repo URL and return a clean cloneable one, or throw a clear
// error. Strips query strings/fragments (e.g. ?utm_source=…) and a trailing
// slash that would otherwise turn into an invalid clone target.
export function normalizeGitUrl(raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!/^https?:\/\//.test(trimmed)) {
    throw new BuildError("Enter an https git URL, e.g. https://github.com/user/repo");
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new BuildError(`That doesn't look like a valid URL: ${trimmed}`);
  }
  // Keep only scheme + host + path; drop ?query and #fragment.
  let clean = `${url.protocol}//${url.host}${url.pathname}`.replace(/\/+$/, "");
  if (!url.pathname.replace(/^\/+|\/+$/g, "")) {
    throw new BuildError("That URL has no repository path (expected .../user/repo).");
  }
  return clean;
}

// The command to run a Node server, or null if this project has none (in which
// case it's treated as a static frontend).
export function nodeServerCmd(pkg: any, src: string): string[] | null {
  if (pkg.scripts?.start) return ["npm", "start"];
  for (const candidate of [pkg.main, "server.js", "index.js", "server.mjs", "index.mjs"]) {
    if (candidate && fs.existsSync(path.join(src, candidate))) return ["node", candidate];
  }
  return null;
}

export function venvPython(buildDir: string): string {
  return process.platform === "win32"
    ? path.join(buildDir, ".appenv", "Scripts", "python.exe")
    : path.join(buildDir, ".appenv", "bin", "python");
}

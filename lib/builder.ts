// Build system: fetch source, detect app type, produce an isolated runnable copy.
//
// Supported app types (deliberately few, per the MVP scope):
//   static — index.html at the project root; served directly by the platform
//   node   — package.json; `npm install`, then `npm start` (or server.js/index.js).
//            Apps must listen on process.env.PORT. Next.js apps get `next build`.
//   python — main.py/app.py exposing a FastAPI `app`; own virtualenv (if Python
//            is installed on the host)
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
  // node: argv to launch; python: uvicorn entry ("main:app")
  startCmd?: string[];
  entry?: string;
}

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
    const url: string = project.repository_url;
    if (!/^https?:\/\//.test(url)) throw new BuildError("Only https git URLs are supported.");
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
  if (fs.existsSync(path.join(src, "main.py")) || fs.existsSync(path.join(src, "app.py"))) return "python";
  if (fs.existsSync(path.join(src, "index.html"))) return "static";
  throw new BuildError(
    "Could not recognize this application. Supported: Node.js (package.json), " +
    "Python/FastAPI (main.py exposing `app`), or a static site (index.html)."
  );
}

// `containerized` is true when the Docker runner is active. Docker apps install
// their Python deps inside the container at start (host virtualenvs aren't
// portable into a container anyway), so we skip building one on the host — which
// also means a Docker host never needs the python3-venv package.
export async function build(src: string, log: Log, containerized = false): Promise<BuildResult> {
  const appType = detectAppType(src);

  if (appType === "static") {
    log("✓ Static site detected");
    return { appType, buildDir: src };
  }

  if (appType === "node") {
    log("✓ Node.js application detected");
    const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
    if (fs.existsSync(path.join(src, "package-lock.json"))) {
      await sh("npm", ["ci", "--no-fund", "--no-audit"], src);
    } else {
      await sh("npm", ["install", "--no-fund", "--no-audit"], src);
    }
    log("✓ Dependencies installed");
    const isNext = !!(pkg.dependencies?.next || pkg.devDependencies?.next);
    if (isNext || pkg.scripts?.build) {
      await sh("npm", ["run", "build"], src);
    }
    log("✓ Application built");
    return { appType, buildDir: src, startCmd: nodeStartCmd(pkg, src) };
  }

  // python
  log("✓ Python application detected");
  const entry = fs.existsSync(path.join(src, "main.py")) ? "main:app" : "app:app";

  if (containerized) {
    // Deps are installed inside the container at start; nothing to do on the host.
    log("✓ Application built");
    return { appType, buildDir: src, entry };
  }

  const py = process.platform === "win32" ? "python" : "python3";
  const venv = path.join(src, ".appenv");
  await sh(py, ["-m", "venv", venv]);
  const venvPy = venvPython(src);
  const req = path.join(src, "requirements.txt");
  if (fs.existsSync(req)) {
    await sh(venvPy, ["-m", "pip", "install", "--quiet", "-r", req, "uvicorn"], src);
  } else {
    await sh(venvPy, ["-m", "pip", "install", "--quiet", "fastapi", "uvicorn", "python-multipart"], src);
  }
  log("✓ Dependencies installed");
  log("✓ Application built");
  return { appType, buildDir: src, entry };
}

function nodeStartCmd(pkg: any, src: string): string[] {
  if (pkg.scripts?.start) return ["npm", "start"];
  for (const candidate of [pkg.main, "server.js", "index.js", "server.mjs", "index.mjs"]) {
    if (candidate && fs.existsSync(path.join(src, candidate))) return ["node", candidate];
  }
  throw new BuildError(
    'No way to start this app: add a "start" script to package.json or a server.js.'
  );
}

export function venvPython(buildDir: string): string {
  return process.platform === "win32"
    ? path.join(buildDir, ".appenv", "Scripts", "python.exe")
    : path.join(buildDir, ".appenv", "bin", "python");
}

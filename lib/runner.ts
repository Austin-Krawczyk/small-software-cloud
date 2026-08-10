// Runners: start/stop a built application in an isolated environment.
//
// SubprocessRunner (hosts without Docker, e.g. a Windows dev machine):
//   apps run as separate OS processes bound to a loopback port, with a minimal
//   environment (no platform secrets inherited). MVP-level isolation only.
//
// DockerRunner (selected automatically when Docker is available — the intended
//   production setup): each app runs in its own container as a non-root user
//   (matching the build files' uid) with cpu/memory/pid limits, only its build
//   folder bind-mounted, and only its port published to loopback. See
//   SECURITY.md for the isolation caveats — this is MVP isolation, not yet
//   hardened multi-tenant sandboxing.
//
// The rest of the platform only calls the Runner interface, so a stronger
// sandbox (gVisor, Firecracker, a remote build host) can replace this without
// touching deploy, proxy, or UI code.
import { execFileSync, spawn, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { APP_HOST, APP_LOGS_DIR, APP_PORT_END, APP_PORT_START } from "./config";
import { BuildResult, venvPython } from "./builder";

export class RunError extends Error {}

export const containerName = (projectId: string) => `scloud-${projectId}`;

export interface Runner {
  name: string;
  // `appEnv` is the project's own environment variables/secrets, layered on top
  // of a minimal base env — the platform's own env is never inherited, so an app
  // sees only PORT/HOST and what its owner configured.
  start(projectId: string, result: BuildResult, port: number, appEnv: Record<string, string>): Promise<number>;
  stop(projectId: string, pid: number | null): void;
  isRunning(projectId: string, pid: number | null): boolean;
  // Reconcile after a control-plane restart (clear anything the old process left
  // behind). Called once on startup.
  resetAll(): void;
}

// Keys an app is not allowed to override — they define how it's launched.
const RESERVED_ENV = new Set(["PORT", "HOST", "PATH", "SYSTEMROOT", "NODE_ENV"]);

function safeAppEnv(appEnv: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(appEnv)) {
    if (!RESERVED_ENV.has(k.toUpperCase())) out[k] = v;
  }
  return out;
}

export async function freePort(): Promise<number> {
  for (let port = APP_PORT_START; port < APP_PORT_END; port++) {
    const ok = await new Promise<boolean>((resolve) => {
      const srv = net.createServer();
      srv.once("error", () => resolve(false));
      srv.listen(port, APP_HOST, () => srv.close(() => resolve(true)));
    });
    if (ok) return port;
  }
  throw new RunError("No free application ports available.");
}

class SubprocessRunner implements Runner {
  name = "subprocess";

  async start(projectId: string, result: BuildResult, port: number, appEnv: Record<string, string>): Promise<number> {
    // Minimal environment: platform env vars and secrets are NOT inherited.
    const env: Record<string, string> = {
      ...safeAppEnv(appEnv),
      PORT: String(port),
      HOST: APP_HOST,
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      TEMP: process.env.TEMP ?? "",
      TMP: process.env.TMP ?? "",
      NODE_ENV: "production",
    };

    let cmd: string[];
    if (result.appType === "python") {
      env.PATH = path.dirname(venvPython(result.buildDir));
      cmd = [venvPython(result.buildDir), "-m", "uvicorn", result.entry!,
             "--host", APP_HOST, "--port", String(port)];
    } else {
      // node — the app must listen on process.env.PORT
      const sysRoot = process.env.SYSTEMROOT ?? "";
      env.PATH = [path.dirname(process.execPath), sysRoot ? `${sysRoot}\\System32` : "/usr/bin"]
        .join(path.delimiter);
      cmd = result.startCmd!;
    }

    const out = fs.openSync(path.join(APP_LOGS_DIR, `${projectId}.log`), "a");
    const opts: SpawnOptions = {
      cwd: result.buildDir,
      env: env as NodeJS.ProcessEnv,
      stdio: ["ignore", out, out],
      detached: false,
      windowsHide: true,
      shell: process.platform === "win32" && cmd[0] === "npm",
    };
    const child = spawn(cmd[0], cmd.slice(1), opts);
    child.unref();
    if (!child.pid) throw new RunError("Failed to start application process.");
    return child.pid;
  }

  stop(_projectId: string, pid: number | null): void {
    if (!pid) return;
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      } else {
        process.kill(pid, "SIGTERM");
      }
    } catch {
      // already gone
    }
  }

  isRunning(_projectId: string, pid: number | null): boolean {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  resetAll(): void {
    // Nothing to reconcile: child processes are gone with the parent, and the
    // deploy service marks apps stopped on boot so they wake on next request.
  }
}

class DockerRunner implements Runner {
  name = "docker";

  async start(projectId: string, result: BuildResult, port: number, appEnv: Record<string, string>): Promise<number> {
    const name = containerName(projectId);

    // Run as the same uid/gid that owns the build files so the mounted code is
    // readable/writable but the container is still non-root (assuming the
    // control plane itself runs as a non-root user).
    const st = fs.statSync(result.buildDir);
    const user = `${st.uid}:${st.gid}`;

    const image = result.appType === "python" ? "python:3.12-slim" : "node:22-slim";
    const inner = this.launchCmd(result);

    // Base env: bind to all interfaces INSIDE the container so the published
    // loopback port reaches the app. Platform secrets are never passed.
    const envArgs = ["-e", "PORT=8080", "-e", "HOST=0.0.0.0", "-e", "HOME=/tmp", "-e", "NODE_ENV=production"];
    for (const [k, v] of Object.entries(safeAppEnv(appEnv))) envArgs.push("-e", `${k}=${v}`);

    try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch {}
    execFileSync(
      "docker",
      [
        "run", "-d", "--name", name, "--restart", "no",
        "--memory", "256m", "--cpus", "0.5", "--pids-limit", "128",
        "--user", user, "--security-opt", "no-new-privileges",
        "-v", `${result.buildDir}:/srv/app`, "-w", "/srv/app",
        ...envArgs,
        "-p", `${APP_HOST}:${port}:8080`,
        image, ...inner,
      ],
      { stdio: "pipe" }
    );
    return 0; // tracked by container name, not pid
  }

  private launchCmd(result: BuildResult): string[] {
    if (result.appType === "python") {
      // Host-built virtualenvs aren't portable into a container, so install the
      // app's deps in-container at start. (Node's node_modules ARE portable
      // across same-OS/arch, so Node apps reuse the host build directly.)
      const hasReq = fs.existsSync(path.join(result.buildDir, "requirements.txt"));
      const pip = hasReq
        ? "pip install --user --quiet --disable-pip-version-check -r requirements.txt uvicorn"
        : "pip install --user --quiet --disable-pip-version-check fastapi uvicorn";
      return ["sh", "-c", `${pip}; exec python -m uvicorn ${result.entry} --host 0.0.0.0 --port 8080`];
    }
    return result.startCmd!;
  }

  stop(projectId: string): void {
    try { execFileSync("docker", ["rm", "-f", containerName(projectId)], { stdio: "ignore" }); } catch {}
  }

  isRunning(projectId: string): boolean {
    try {
      const out = execFileSync(
        "docker", ["inspect", "-f", "{{.State.Running}}", containerName(projectId)],
        { stdio: "pipe" }
      ).toString().trim();
      return out === "true";
    } catch {
      return false; // no such container
    }
  }

  resetAll(): void {
    // On control-plane restart, remove any app containers the previous process
    // launched; the deploy service marks apps stopped, so they wake on demand.
    try {
      const ids = execFileSync(
        "docker", ["ps", "-aq", "--filter", "name=scloud-"], { stdio: "pipe" }
      ).toString().split("\n").map((s) => s.trim()).filter(Boolean);
      if (ids.length) execFileSync("docker", ["rm", "-f", ...ids], { stdio: "ignore" });
    } catch {}
  }
}

let runner: Runner | null = null;

export function getRunner(): Runner {
  if (!runner) {
    let hasDocker = false;
    try {
      execFileSync("docker", ["--version"], { windowsHide: true, stdio: "pipe" });
      hasDocker = true;
    } catch {}
    runner = hasDocker ? new DockerRunner() : new SubprocessRunner();
  }
  return runner;
}

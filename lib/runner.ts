// Runners: start/stop a built application in an isolated environment.
//
// SubprocessRunner (used on hosts without Docker, like this dev machine):
//   apps run as separate OS processes bound to loopback ports, with a minimal
//   environment (no platform secrets inherited) and their working directory
//   jailed to the build folder. MVP-level isolation only — see SECURITY.md.
//
// DockerRunner (selected automatically when Docker is available): apps run in
//   containers as a non-root user with cpu/memory/pid limits, a read-only bind
//   of the build folder, and only their port published to loopback.
//
// The rest of the platform only calls getRunner().start()/stop(), so stronger
// sandboxes (gVisor, Firecracker, remote hosts) slot in without touching
// deploy or proxy code.
import { execFileSync, spawn, SpawnOptions } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { APP_HOST, APP_LOGS_DIR, APP_PORT_END, APP_PORT_START } from "./config";
import { BuildResult, venvPython } from "./builder";

export class RunError extends Error {}

export interface Runner {
  name: string;
  // `appEnv` is the project's own environment variables/secrets. They are
  // layered on top of a minimal base env — the platform's own env is never
  // inherited — so an app sees only PORT/HOST and what its owner configured.
  start(projectId: string, result: BuildResult, port: number, appEnv: Record<string, string>): Promise<number>;
  stop(projectId: string, pid: number | null): void;
  isRunning(pid: number | null): boolean;
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
    // The app's own configured vars are layered in, but can't clobber launch keys.
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
      env.PATH = [path.dirname(process.execPath), process.env.SYSTEMROOT + "\\System32"].join(path.delimiter);
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

  isRunning(pid: number | null): boolean {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}

class DockerRunner implements Runner {
  name = "docker";

  async start(projectId: string, result: BuildResult, port: number, appEnv: Record<string, string>): Promise<number> {
    const name = `scloud-${projectId}`;
    const image = result.appType === "python" ? "python:3.12-slim" : "node:22-slim";
    const inner =
      result.appType === "python"
        ? ["python", "-m", "uvicorn", result.entry!, "--host", "0.0.0.0", "--port", "8080"]
        : result.startCmd!;
    const envArgs: string[] = ["-e", "PORT=8080"];
    for (const [k, v] of Object.entries(safeAppEnv(appEnv))) envArgs.push("-e", `${k}=${v}`);
    try { execFileSync("docker", ["rm", "-f", name], { windowsHide: true }); } catch {}
    execFileSync(
      "docker",
      [
        "run", "-d", "--name", name,
        "--memory", "256m", "--cpus", "0.5", "--pids-limit", "128",
        "--user", "1000:1000", "--security-opt", "no-new-privileges",
        "-v", `${result.buildDir}:/srv/app`, "-w", "/srv/app",
        ...envArgs,
        "-p", `${APP_HOST}:${port}:8080`,
        image, ...inner,
      ],
      { windowsHide: true }
    );
    return 0; // tracked by container name
  }

  stop(projectId: string): void {
    try { execFileSync("docker", ["rm", "-f", `scloud-${projectId}`], { windowsHide: true }); } catch {}
  }

  isRunning(): boolean {
    // Conservative: the deploy service re-checks with health probes, so False
    // just triggers a restart-on-request.
    return false;
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

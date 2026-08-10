// Build sandbox.
//
// Deploying code means running it — `npm install` alone executes arbitrary
// dependency install scripts. To keep that untrusted code away from the control
// plane, builds run inside a throwaway container that mounts ONLY the project's
// build directory. It never sees the platform's data dir, SQLite database,
// secret key, or environment. (Fetching source — git clone / unzip — happens on
// the host but doesn't execute project code; see lib/builder.ts.)
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import { BUILD_CPUS, BUILD_MEMORY, BUILD_TIMEOUT_MS, NODE_IMAGE } from "./config";

const execFileP = promisify(execFile);

// Run `npm <args>` for a project in an isolated, resource-limited container.
// Runs as the uid that owns the build dir, so outputs (node_modules, dist) are
// written back with the right ownership for the runtime container to reuse.
// Returns stdout; throws with the captured output on failure.
export async function npmInSandbox(buildDir: string, args: string[]): Promise<string> {
  const st = fs.statSync(buildDir);
  try {
    const { stdout } = await execFileP(
      "docker",
      [
        "run", "--rm",
        "--user", `${st.uid}:${st.gid}`,
        "--memory", BUILD_MEMORY, "--cpus", BUILD_CPUS, "--pids-limit", "512",
        "--security-opt", "no-new-privileges",
        "-v", `${buildDir}:/srv/app`, "-w", "/srv/app",
        "-e", "HOME=/tmp", "-e", "CI=1",
        "-e", "NPM_CONFIG_FUND=false", "-e", "NPM_CONFIG_AUDIT=false", "-e", "NPM_CONFIG_UPDATE_NOTIFIER=false",
        NODE_IMAGE, "npm", ...args,
      ],
      { timeout: BUILD_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 }
    );
    return stdout;
  } catch (e: any) {
    const detail = (e.stderr?.toString() || e.stdout?.toString() || e.message || "build failed").trim();
    throw new Error(detail.slice(-2000));
  }
}

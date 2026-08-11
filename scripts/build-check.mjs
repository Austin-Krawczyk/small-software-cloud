// Compile/build check that writes to a throwaway dist dir (.next-check) so it
// never disturbs a running `next dev` (which uses .next). Usage: npm run build:check
import { spawnSync } from "node:child_process";

const r = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  env: { ...process.env, SCLOUD_BUILD_CHECK: "1" },
  shell: process.platform === "win32",
});
process.exit(r.status ?? 1);

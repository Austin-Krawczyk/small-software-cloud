#!/usr/bin/env node
// smallsoftware — a deliberately tiny CLI for Small Software Cloud.
//
//   node cli/smallsoftware.mjs login              (paste an API token once)
//   node cli/smallsoftware.mjs init [name]        (register this folder as an app)
//   node cli/smallsoftware.mjs deploy             (zip the folder, upload, deploy, wait)
//
// Designed so an AI coding agent can run it end-to-end: every command is
// non-interactive when given arguments, and output ends with the app URL.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { execFileSync } from "node:child_process";

const CONFIG_PATH = path.join(os.homedir(), ".smallsoftware.json");
const PROJECT_FILE = "smallsoftware.json";

const cfg = () => (fs.existsSync(CONFIG_PATH) ? JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) : {});
const saveCfg = (c) => fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));

async function api(method, apiPath, body, isForm = false) {
  const { server = "http://localhost:3000", token } = cfg();
  const headers = { authorization: `Bearer ${token}` };
  if (body && !isForm) headers["content-type"] = "application/json";
  const res = await fetch(server + apiPath, {
    method,
    headers,
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}

async function login(args) {
  const server = args[0] ?? "http://localhost:3000";
  let token = args[1];
  if (!token) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    token = (await rl.question("Paste an API token (create one at /account): ")).trim();
    rl.close();
  }
  saveCfg({ server, token });
  const { projects } = await api("GET", "/api/projects");
  console.log(`Signed in. You have ${projects.length} app(s) on ${server}.`);
}

async function init(args) {
  if (fs.existsSync(PROJECT_FILE)) {
    console.log(`${PROJECT_FILE} already exists.`);
    return;
  }
  const name = args.join(" ") || path.basename(process.cwd());
  const project = await api("POST", "/api/projects", { name });
  fs.writeFileSync(PROJECT_FILE, JSON.stringify({ project_id: project.id, name }, null, 2));
  console.log(`Created "${name}" (${project.id}). Run: smallsoftware deploy`);
}

async function deploy() {
  if (!fs.existsSync(PROJECT_FILE)) throw new Error("Run `smallsoftware init` first.");
  const { project_id } = JSON.parse(fs.readFileSync(PROJECT_FILE, "utf8"));

  // Zip the folder (excluding junk) using PowerShell/zip, then upload.
  const zipPath = path.join(os.tmpdir(), `smallsoftware-${project_id}.zip`);
  fs.rmSync(zipPath, { force: true });
  const exclude = new Set(["node_modules", ".git", ".next", ".appenv", "__pycache__", PROJECT_FILE]);
  const entries = fs.readdirSync(".").filter((e) => !exclude.has(e));
  if (process.platform === "win32") {
    execFileSync("powershell", [
      "-NoProfile", "-Command",
      `Compress-Archive -Path ${entries.map((e) => `'${e}'`).join(",")} -DestinationPath '${zipPath}'`,
    ]);
  } else {
    execFileSync("zip", ["-r", zipPath, ...entries]);
  }

  const form = new FormData();
  form.append("code_zip", new Blob([fs.readFileSync(zipPath)]), "code.zip");
  await api("POST", `/api/projects/${project_id}/code`, form, true);
  console.log("Code uploaded. Deploying…");

  const { deployment_id } = await api("POST", `/api/projects/${project_id}/deploy`);
  let printed = 0;
  for (;;) {
    const dep = await api("GET", `/api/deployments/${deployment_id}`);
    const lines = dep.logs.split("\n");
    for (; printed < lines.length - 1; printed++) console.log(lines[printed]);
    if (dep.status === "running") {
      const { server } = cfg();
      const url = /^https?:\/\//.test(dep.url) ? dep.url : `${server}${dep.url}`;
      console.log(`\nLive at: ${url}`);
      return;
    }
    if (dep.status === "failed") process.exit(1);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const [cmd, ...args] = process.argv.slice(2);
const commands = { login, init, deploy };
if (!commands[cmd]) {
  console.log("Usage: smallsoftware <login|init|deploy>");
  process.exit(1);
}
commands[cmd](args).catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});

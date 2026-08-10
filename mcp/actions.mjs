// Small Software Cloud actions — the real work behind the MCP tools. Kept free
// of MCP protocol code so it can be unit/e2e tested directly. Talks to the
// platform's JSON API with a bearer token.
//
// Config from env: SMALLSOFTWARE_TOKEN (required), SMALLSOFTWARE_SERVER
// (default https://taskicloud.com).
import AdmZip from "adm-zip";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function config() {
  const server = (process.env.SMALLSOFTWARE_SERVER || "https://taskicloud.com").replace(/\/+$/, "");
  const token = process.env.SMALLSOFTWARE_TOKEN;
  if (!token) throw new Error("Set SMALLSOFTWARE_TOKEN (create one on your Small Software Cloud account page).");
  return { server, token };
}

async function api(method, path, body) {
  const { server, token } = config();
  const headers = { authorization: `Bearer ${token}` };
  const opts = { method, headers };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(server + path, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const msg = data && typeof data === "object" ? data.error || JSON.stringify(data) : String(data);
    throw new Error(`${res.status}: ${msg}`);
  }
  return data;
}

// Build a zip from [{ path, content }]. Content is UTF-8 text.
export function zipFiles(files) {
  if (!Array.isArray(files) || files.length === 0) throw new Error("Provide files: [{ path, content }].");
  const zip = new AdmZip();
  for (const f of files) {
    if (!f || typeof f.path !== "string" || typeof f.content !== "string") {
      throw new Error("Each file needs a string `path` and string `content`.");
    }
    zip.addFile(f.path.replace(/^\/+/, ""), Buffer.from(f.content, "utf8"));
  }
  return zip.toBuffer();
}

async function resolveProjectId(ref) {
  if (!ref) throw new Error("Provide a project id, slug, or name.");
  const { projects } = await api("GET", "/api/projects");
  const hit = projects.find((p) => p.id === ref || p.slug === ref || p.name === ref);
  if (!hit) throw new Error(`No project matches "${ref}".`);
  return hit.id;
}

export async function listProjects() {
  const { projects } = await api("GET", "/api/projects");
  return projects.map((p) => ({
    id: p.id, name: p.name, slug: p.slug, status: p.status, url: p.url, role: p.role,
  }));
}

export async function createProject({ name, description, repository_url }) {
  if (!name) throw new Error("A project name is required.");
  return api("POST", "/api/projects", { name, description, repository_url });
}

async function waitForDeploy(deploymentId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const dep = await api("GET", `/api/deployments/${deploymentId}`);
    if (dep.status === "running" || dep.status === "failed") return dep;
    await sleep(2000);
  }
  throw new Error("Deployment timed out.");
}

// Upload code (inline files or a git URL) and deploy. Waits for the result by
// default and returns the live URL (or the failure logs).
export async function deployApp({ project, files, repository_url, wait = true }) {
  const id = await resolveProjectId(project);
  if (files) {
    const fd = new FormData();
    fd.append("code_zip", new Blob([zipFiles(files)], { type: "application/zip" }), "app.zip");
    await api("POST", `/api/projects/${id}/code`, fd);
  } else if (repository_url) {
    await api("PATCH", `/api/projects/${id}`, { repository_url });
  }
  const { deployment_id } = await api("POST", `/api/projects/${id}/deploy`);
  if (!wait) return { deployment_id, status: "building" };

  const dep = await waitForDeploy(deployment_id);
  const proj = await api("GET", `/api/projects/${id}`);
  return {
    status: dep.status,
    url: proj.url,
    logs_tail: (dep.logs || "").split("\n").filter(Boolean).slice(-8).join("\n"),
  };
}

// One shot: create a project, deploy the given files, optionally share it.
export async function createAndDeploy({ name, description, files, repository_url, share_with, wait = true }) {
  const project = await createProject({ name, description, repository_url });
  const result = await deployApp({ project: project.id, files, repository_url, wait });
  if (share_with) {
    for (const email of [].concat(share_with)) {
      await api("POST", `/api/projects/${project.id}/members`, { email });
    }
  }
  return { project: { id: project.id, name: project.name, slug: project.slug }, ...result };
}

export async function projectStatus({ project }) {
  const id = await resolveProjectId(project);
  const p = await api("GET", `/api/projects/${id}`);
  const dep = p.latest_deployment;
  return {
    name: p.name, status: p.status, url: p.url,
    logs_tail: dep ? (dep.logs || "").split("\n").filter(Boolean).slice(-8).join("\n") : null,
  };
}

export async function shareProject({ project, email, role }) {
  const id = await resolveProjectId(project);
  return api("POST", `/api/projects/${id}/members`, { email, role });
}

export async function setEnv({ project, key, value }) {
  const id = await resolveProjectId(project);
  return api("PUT", `/api/projects/${id}/env`, { key, value });
}

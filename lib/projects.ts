// Project CRUD + membership operations shared by the API routes.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { appOriginFor, DB_FILE_REL, SAMPLES_DIR, UPLOADS_DIR } from "./config";
import {
  all, getProject, getProjectBySlug, newId, now, one, run, Row, setProject,
  STATUS_LABELS,
} from "./db";
import { appDataDirFor, appUrl, buildDirFor, stopProject } from "./deploy";

export function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "app";
  let candidate = base;
  for (let n = 2; getProjectBySlug(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  repository_url?: string;
  sample?: string;
}

export function createProject(ownerId: string, input: CreateProjectInput): Row {
  const id = newId();
  let sourceKind = "none";
  let repo = "";
  if (input.sample) {
    sourceKind = "sample";
    repo = input.sample;
  } else if (input.repository_url?.trim()) {
    sourceKind = "git";
    repo = input.repository_url.trim();
  }
  run(
    `INSERT INTO projects (id, owner_id, name, slug, description, source_kind,
     repository_url, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    id, ownerId, input.name.trim(), slugify(input.name),
    (input.description ?? "").trim(), sourceKind, repo, now(), now()
  );
  run(
    "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?,?,?,?)",
    id, ownerId, "owner", now()
  );
  return getProject(id)!;
}

export function projectJson(p: Row, role?: string | null): Row {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    slug: p.slug,
    status: p.status,
    status_label: STATUS_LABELS[p.status] ?? p.status,
    url: p.status === "running" ? appUrl(p.slug) : null,
    app_path: appUrl(p.slug),
    source_kind: p.source_kind,
    repository_url: p.source_kind === "git" ? p.repository_url : "",
    sample: p.source_kind === "sample" ? p.repository_url : "",
    created_at: p.created_at,
    last_deployed_at: p.last_deployed_at,
    ...(role ? { role } : {}),
  };
}

export function projectsForUser(userId: string): Row[] {
  return all(
    `SELECT p.*, m.role FROM projects p JOIN project_members m ON m.project_id = p.id
     WHERE m.user_id = ? ORDER BY p.updated_at DESC`,
    userId
  );
}

export function membersOf(projectId: string): Row[] {
  return all(
    `SELECT u.id AS user_id, u.name, u.email, m.role FROM project_members m
     JOIN users u ON u.id = m.user_id WHERE m.project_id = ? ORDER BY m.created_at`,
    projectId
  );
}

export function invitesOf(projectId: string): Row[] {
  return all("SELECT email, role FROM invites WHERE project_id = ?", projectId);
}

// ---- managed database ----

// The app sees its database at the container path (/data/...) in production;
// that's the connection info we show the owner.
const RUNTIME_DB_PATH = `/data/${DB_FILE_REL}`;

export function databaseInfo(projectId: string) {
  const project = getProject(projectId);
  const engine = project?.db_engine || "";
  if (engine !== "sqlite") {
    return { attached: false, engine: "", url: null as string | null, path: null as string | null, size: 0 };
  }
  const base = path.join(appDataDirFor(projectId), DB_FILE_REL);
  let size = 0;
  for (const suffix of ["", "-wal", "-shm"]) {
    try { size += fs.statSync(base + suffix).size; } catch {}
  }
  return {
    attached: true,
    engine: "sqlite",
    url: `sqlite:///${RUNTIME_DB_PATH}`,
    path: RUNTIME_DB_PATH,
    size,
  };
}

export function attachDatabase(projectId: string): void {
  fs.mkdirSync(path.join(appDataDirFor(projectId), "database"), { recursive: true });
  setProject(projectId, { db_engine: "sqlite" });
}

// Detach and delete the database files (irreversible). Keeps the rest of the
// app's durable storage intact.
export function detachDatabase(projectId: string): void {
  setProject(projectId, { db_engine: "" });
  fs.rmSync(path.join(appDataDirFor(projectId), "database"), { recursive: true, force: true });
}

// ---- "anyone with the link" sharing ----
// A non-empty share_key means link access is on; the key is the secret embedded
// in the share URL. Rotating or clearing it instantly revokes outstanding links
// (and any guest sessions minted from them — the gateway re-checks every request).

export function shareLink(projectId: string): { enabled: boolean; url: string | null } {
  const p = getProject(projectId);
  if (!p || !p.share_key) return { enabled: false, url: null };
  return { enabled: true, url: `${appOriginFor(p.slug)}/?key=${p.share_key}` };
}

export function enableShareLink(projectId: string): { enabled: boolean; url: string | null } {
  setProject(projectId, { share_key: crypto.randomBytes(18).toString("base64url") });
  return shareLink(projectId);
}

export function disableShareLink(projectId: string): void {
  setProject(projectId, { share_key: "" });
}

export function latestDeployment(projectId: string): Row | undefined {
  return one(
    "SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    projectId
  );
}

export type ShareRole = "collaborator" | "editor";

// Share with an email at a given role ("collaborator" = can use, "editor" = can
// also deploy/edit). Existing users get access immediately — and if they're
// already a member, their role is updated. Unknown emails become pending invites
// claimed at signup. The owner's own role is never downgraded here.
export function shareWithEmail(
  projectId: string, email: string, role: ShareRole = "collaborator"
): "member_added" | "role_updated" | "invite_pending" {
  const user = one("SELECT id FROM users WHERE email = ?", email.trim());
  if (user) {
    const existing = one(
      "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?", projectId, user.id
    );
    if (existing?.role === "owner") return "member_added"; // never change the owner
    if (existing) {
      run("UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?",
        role, projectId, user.id);
      return "role_updated";
    }
    run(
      "INSERT INTO project_members (project_id, user_id, role, created_at) VALUES (?,?,?,?)",
      projectId, user.id, role, now()
    );
    return "member_added";
  }
  run(
    "INSERT INTO invites (project_id, email, role, created_at) VALUES (?,?,?,?) " +
    "ON CONFLICT(project_id, email) DO UPDATE SET role = excluded.role",
    projectId, email.trim(), role, now()
  );
  return "invite_pending";
}

export async function deleteProject(projectId: string): Promise<void> {
  await stopProject(projectId);
  for (const table of ["deployments", "project_members", "invites", "project_env"]) {
    run(`DELETE FROM ${table} WHERE project_id = ?`, projectId);
  }
  run("DELETE FROM projects WHERE id = ?", projectId);
  fs.rmSync(buildDirFor(projectId), { recursive: true, force: true });
  fs.rmSync(appDataDirFor(projectId), { recursive: true, force: true });
  fs.rmSync(path.join(UPLOADS_DIR, `${projectId}.zip`), { force: true });
}

export function listSamples(): string[] {
  if (!fs.existsSync(SAMPLES_DIR)) return [];
  return fs.readdirSync(SAMPLES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export { setProject };

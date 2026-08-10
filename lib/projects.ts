// Project CRUD + membership operations shared by the API routes.
import fs from "node:fs";
import path from "node:path";
import { SAMPLES_DIR, UPLOADS_DIR } from "./config";
import {
  all, getProject, getProjectBySlug, newId, now, one, run, Row, setProject,
  STATUS_LABELS,
} from "./db";
import { appUrl, buildDirFor, stopProject } from "./deploy";

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

export function latestDeployment(projectId: string): Row | undefined {
  return one(
    "SELECT * FROM deployments WHERE project_id = ? ORDER BY created_at DESC LIMIT 1",
    projectId
  );
}

// Share with an email: existing users become collaborators immediately;
// unknown emails become pending invites claimed at signup.
export function shareWithEmail(projectId: string, email: string): "member_added" | "invite_pending" {
  const user = one("SELECT id FROM users WHERE email = ?", email.trim());
  if (user) {
    run(
      "INSERT OR IGNORE INTO project_members (project_id, user_id, role, created_at) VALUES (?,?,?,?)",
      projectId, user.id, "collaborator", now()
    );
    return "member_added";
  }
  run(
    "INSERT OR IGNORE INTO invites (project_id, email, role, created_at) VALUES (?,?,?,?)",
    projectId, email.trim(), "collaborator", now()
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

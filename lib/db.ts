// SQLite data layer on Node's built-in node:sqlite — zero native dependencies.
// Deliberately thin; all access goes through here and the service modules, so
// swapping in Postgres later doesn't touch route code.
import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { DB_PATH, ensureDirs } from "./config";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS api_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  source_kind TEXT NOT NULL DEFAULT 'none',    -- none | git | upload | sample
  repository_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'not_deployed', -- not_deployed | building | running | failed | stopped
  app_type TEXT NOT NULL DEFAULT '',           -- static | node | python (from last successful build)
  static_dir TEXT NOT NULL DEFAULT '',         -- static: subfolder holding index.html ('' = root)
  port INTEGER,
  pid INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_deployed_at INTEGER
);
CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL REFERENCES projects(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,                          -- owner | editor | collaborator
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  project_id TEXT NOT NULL REFERENCES projects(id),
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, email)
);
CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL,                        -- building | deploying | running | failed
  url TEXT NOT NULL DEFAULT '',
  logs TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE TABLE IF NOT EXISTS project_env (
  project_id TEXT NOT NULL REFERENCES projects(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, key)
);
`;

export type Row = Record<string, any>;

// Survive Next dev-mode module reloads: keep one connection on globalThis.
const g = globalThis as any;

export function db(): DatabaseSync {
  if (!g.__scloud_db) {
    ensureDirs();
    const conn = new DatabaseSync(DB_PATH);
    conn.exec("PRAGMA journal_mode=WAL");
    conn.exec(SCHEMA);
    migrate(conn);
    g.__scloud_db = conn;
  }
  return g.__scloud_db;
}

// Additive migrations for databases created before a column existed. Each is
// guarded so it's a no-op once applied (fresh installs already have it via SCHEMA).
function migrate(conn: DatabaseSync): void {
  const cols = (conn.prepare("PRAGMA table_info(projects)").all() as Row[]).map((c) => c.name);
  if (!cols.includes("static_dir")) {
    conn.exec("ALTER TABLE projects ADD COLUMN static_dir TEXT NOT NULL DEFAULT ''");
  }
}

export function all(sql: string, ...args: any[]): Row[] {
  return db().prepare(sql).all(...args) as Row[];
}

export function one(sql: string, ...args: any[]): Row | undefined {
  return db().prepare(sql).get(...args) as Row | undefined;
}

export function run(sql: string, ...args: any[]): void {
  db().prepare(sql).run(...args);
}

export const newId = () => crypto.randomBytes(6).toString("hex");
export const now = () => Date.now();

// ---- convenience accessors ----

export const getProject = (id: string) =>
  one("SELECT * FROM projects WHERE id = ?", id);

export const getProjectBySlug = (slug: string) =>
  one("SELECT * FROM projects WHERE slug = ?", slug);

export function roleFor(projectId: string, userId: string): string | null {
  const r = one(
    "SELECT role FROM project_members WHERE project_id = ? AND user_id = ?",
    projectId,
    userId
  );
  return r ? (r.role as string) : null;
}

export function setProject(projectId: string, fields: Row): void {
  const withTime = { ...fields, updated_at: now() };
  const cols = Object.keys(withTime).map((k) => `${k} = ?`).join(", ");
  run(`UPDATE projects SET ${cols} WHERE id = ?`, ...Object.values(withTime), projectId);
}

export function appendDeployLog(deploymentId: string, line: string): void {
  run("UPDATE deployments SET logs = logs || ? WHERE id = ?", line + "\n", deploymentId);
}

// ---- per-app environment variables / secrets ----

export function envVars(projectId: string): Row[] {
  return all("SELECT key, value FROM project_env WHERE project_id = ? ORDER BY key", projectId);
}

export function envMap(projectId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of envVars(projectId)) out[r.key] = r.value;
  return out;
}

export function setEnvVar(projectId: string, key: string, value: string): void {
  run(
    "INSERT INTO project_env (project_id, key, value, created_at) VALUES (?,?,?,?) " +
    "ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value",
    projectId, key, value, now()
  );
}

export function deleteEnvVar(projectId: string, key: string): void {
  run("DELETE FROM project_env WHERE project_id = ? AND key = ?", projectId, key);
}

export const STATUS_LABELS: Record<string, string> = {
  not_deployed: "Not deployed",
  building: "Building",
  running: "Running",
  failed: "Failed",
  stopped: "Stopped",
};

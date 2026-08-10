// Authentication. MVP provider: email + password (scrypt) with server-side
// sessions, plus bearer API tokens for the CLI / AI agents.
//
// This module is the single swap point for a managed provider (Clerk,
// Supabase Auth, OAuth): nothing outside it knows how users are verified.
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { SESSION_TTL_MS } from "./config";
import { all, newId, now, one, run, Row } from "./db";

// ---- passwords ----

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const digest = crypto.scryptSync(password, salt, 64);
  return `${salt.toString("hex")}$${digest.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, digestHex] = stored.split("$");
  if (!saltHex || !digestHex) return false;
  const digest = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  return crypto.timingSafeEqual(digest, Buffer.from(digestHex, "hex"));
}

// ---- users ----

export function createUser(email: string, name: string, password: string): Row {
  const id = newId();
  run(
    "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)",
    id, email.trim(), name.trim(), hashPassword(password), now()
  );
  claimInvites(id, email);
  return one("SELECT * FROM users WHERE id = ?", id)!;
}

// Convert pending email invites into memberships (Google-Docs-style sharing).
export function claimInvites(userId: string, email: string): void {
  for (const inv of all("SELECT * FROM invites WHERE email = ?", email.trim())) {
    run(
      "INSERT OR IGNORE INTO project_members (project_id, user_id, role, created_at) VALUES (?,?,?,?)",
      inv.project_id, userId, inv.role, now()
    );
    run("DELETE FROM invites WHERE project_id = ? AND email = ?", inv.project_id, inv.email);
  }
}

// ---- sessions ----

export function createSession(userId: string): string {
  const token = crypto.randomBytes(32).toString("base64url");
  run(
    "INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)",
    token, userId, now(), now() + SESSION_TTL_MS
  );
  return token;
}

export function destroySession(token: string): void {
  run("DELETE FROM sessions WHERE token = ?", token);
}

function userFromSessionToken(token: string): Row | undefined {
  return one(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`,
    token, now()
  );
}

function userFromBearer(authz: string): Row | undefined {
  if (!authz.toLowerCase().startsWith("bearer ")) return undefined;
  const hash = crypto.createHash("sha256").update(authz.slice(7).trim()).digest("hex");
  return one(
    "SELECT u.* FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?",
    hash
  );
}

// Resolve the signed-in user in a server component / route handler.
export async function currentUser(): Promise<Row | null> {
  const jar = await cookies();
  const token = jar.get("scloud_session")?.value;
  if (token) {
    const u = userFromSessionToken(token);
    if (u) return u;
  }
  const h = await headers();
  return userFromBearer(h.get("authorization") ?? "") ?? null;
}

// ---- API tokens ----

export function createApiToken(userId: string, label: string): string {
  const token = "scloud_" + crypto.randomBytes(32).toString("base64url");
  run(
    "INSERT INTO api_tokens (token_hash, user_id, label, created_at) VALUES (?,?,?,?)",
    crypto.createHash("sha256").update(token).digest("hex"), userId, label, now()
  );
  return token; // shown once; only the hash is stored
}

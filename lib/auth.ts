// Authentication. MVP provider: email + password (scrypt) with server-side
// sessions, plus bearer API tokens for the CLI / AI agents.
//
// This module is the single swap point for a managed provider (Clerk,
// Supabase Auth, OAuth): nothing outside it knows how users are verified.
import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { secretKey, SESSION_TTL_MS } from "./config";
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

// Find or create a user from a verified OAuth identity (linked by email). New
// OAuth users get an empty password hash, which can never satisfy verifyPassword
// — they sign in with the provider (or set a password later via reset).
export function upsertOAuthUser(email: string, name: string): Row {
  const existing = one("SELECT * FROM users WHERE email = ?", email.trim());
  if (existing) return existing;
  const id = newId();
  run(
    "INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)",
    id, email.trim(), (name || email.split("@")[0]).trim(), "", now()
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

// ---- password reset ----
//
// A signed, single-use, time-limited token — no DB table needed. The token
// embeds a fingerprint of the current password hash, so it stops working the
// moment the password changes (single-use) or the link expires.

const RESET_TTL_MS = 30 * 60 * 1000;

function passwordFingerprint(hash: string): string {
  return crypto.createHash("sha256").update(hash).digest("hex").slice(0, 12);
}

export function makeResetToken(user: Row): string {
  const payload = { u: user.id, k: passwordFingerprint(user.password_hash), e: Date.now() + RESET_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", secretKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyResetToken(token: string | undefined | null): Row | null {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".", 2);
  const expected = crypto.createHmac("sha256", secretKey()).update(body).digest("base64url");
  if (mac.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    return null;
  }
  let payload: any;
  try { payload = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!payload || payload.e < Date.now()) return null;
  const user = one("SELECT * FROM users WHERE id = ?", payload.u);
  if (!user || passwordFingerprint(user.password_hash) !== payload.k) return null;
  return user;
}

export function setPassword(userId: string, password: string): void {
  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(password), userId);
  run("DELETE FROM sessions WHERE user_id = ?", userId); // sign out everywhere after a reset
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

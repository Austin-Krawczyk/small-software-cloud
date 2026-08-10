// Small helpers for API route handlers: auth + project access checks.
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "./auth";
import { platformOrigin, SESSION_COOKIE } from "./config";
import { getProject, roleFor, Row } from "./db";
import { initPlatform } from "./deploy";

export const jsonError = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

export interface Actor {
  user: Row;
  project?: Row;
  role?: string;
}

// CSRF / cross-origin lock. A cookie-authenticated request must originate from
// the platform's own origin. A deployed app (on its own subdomain) trying to
// call the API in the user's browser carries a foreign Origin and is refused —
// even if the browser attaches the session cookie. Bearer-token callers (CLI,
// AI agents) send no cookie and are unaffected.
async function crossOriginBlocked(): Promise<boolean> {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE)) return false; // not cookie-authenticated
  const origin = (await headers()).get("origin");
  return !!origin && origin !== platformOrigin();
}

export async function requireUser(): Promise<{ actor?: Actor; error?: NextResponse }> {
  initPlatform();
  if (await crossOriginBlocked()) {
    return { error: jsonError(403, "Cross-origin request refused.") };
  }
  const user = await currentUser();
  if (!user) {
    return { error: jsonError(401, "Sign in or pass an API token (Authorization: Bearer ...).") };
  }
  return { actor: { user } };
}

export async function requireProject(
  projectId: string,
  opts: { ownerOnly?: boolean } = {}
): Promise<{ actor?: Actor; error?: NextResponse }> {
  const { actor, error } = await requireUser();
  if (error) return { error };
  const project = getProject(projectId);
  const role = project ? roleFor(projectId, actor!.user.id) : null;
  if (!project || !role) return { error: jsonError(404, "Project not found.") };
  if (opts.ownerOnly && role !== "owner") {
    return { error: jsonError(403, "Only the project owner can do that.") };
  }
  return { actor: { user: actor!.user, project, role } };
}

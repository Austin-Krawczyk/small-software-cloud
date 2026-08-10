// Small helpers for API route handlers: auth + project access checks.
import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "./auth";
import { SESSION_COOKIE } from "./config";
import { getProject, roleFor, Row } from "./db";
import { initPlatform } from "./deploy";

export const jsonError = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

export interface Actor {
  user: Row;
  project?: Row;
  role?: string;
}

// CSRF / cross-origin lock. A cookie-authenticated request must be same-origin:
// its Origin header has to match the Host the request was addressed to. That
// way the dashboard works on any address it's actually served from (localhost,
// 127.0.0.1, a LAN IP, the production domain), while a deployed app (on its
// own subdomain) or a third-party site calling the API in the user's browser
// carries a foreign Origin and is refused — even though the browser attaches
// the session cookie. Bearer-token callers (CLI, AI agents) send no cookie and
// are unaffected.
async function crossOriginBlocked(): Promise<boolean> {
  const jar = await cookies();
  if (!jar.get(SESSION_COOKIE)) return false; // not cookie-authenticated
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return false; // same-origin GET/HEAD navigations omit Origin
  const host = h.get("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // "null" or malformed Origin → refuse
  }
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

// What a role is allowed to do:
//   view   — see the project and use the deployed app (owner, editor, collaborator)
//   edit   — deploy, change code, env vars, stop (owner, editor)
//   manage — share/remove members, rename, delete (owner only)
export type Capability = "view" | "edit" | "manage";

export function can(role: string | null, cap: Capability): boolean {
  if (role === "owner") return true;
  if (role === "editor") return cap === "view" || cap === "edit";
  if (role === "collaborator") return cap === "view";
  return false;
}

export async function requireProject(
  projectId: string,
  opts: { need?: Capability } = {}
): Promise<{ actor?: Actor; error?: NextResponse }> {
  const { actor, error } = await requireUser();
  if (error) return { error };
  const project = getProject(projectId);
  const role = project ? roleFor(projectId, actor!.user.id) : null;
  if (!project || !role) return { error: jsonError(404, "Project not found.") };
  if (!can(role, opts.need ?? "view")) {
    const who = (opts.need ?? "view") === "manage" ? "the project owner" : "an editor or owner";
    return { error: jsonError(403, `Only ${who} can do that.`) };
  }
  return { actor: { user: actor!.user, project, role } };
}

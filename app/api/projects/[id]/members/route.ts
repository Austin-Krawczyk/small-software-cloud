import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireProject } from "@/lib/api";
import { signToken } from "@/lib/appauth";
import { appOriginFor, platformOrigin } from "@/lib/config";
import { run } from "@/lib/db";
import { mailConfigured, sendInviteEmail } from "@/lib/mail";
import { invitesOf, membersOf, ShareRole, shareWithEmail } from "@/lib/projects";

const MAGIC_TTL_MS = 7 * 24 * 3600 * 1000;

// A magic sign-in link scoped to this email that lands on the shared app.
function magicLink(email: string, slug: string): string {
  const token = signToken({ magic: email.trim() }, MAGIC_TTL_MS);
  const next = encodeURIComponent(`${appOriginFor(slug)}/`);
  return `${platformOrigin()}/api/auth/magic?token=${token}&next=${next}`;
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id);
  if (error) return error;
  return NextResponse.json({ members: membersOf(id), pending_invites: invitesOf(id) });
}

// Share the project with an email address, or change an existing member's role.
// body: { email, role?: "collaborator" | "editor" }
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { actor, error } = await requireProject(id, { need: "manage" });
  if (error) return error;
  const { email, role } = await req.json().catch(() => ({}));
  if (!email?.trim() || !email.includes("@")) return jsonError(422, "A valid email is required.");
  const shareRole: ShareRole = role === "editor" ? "editor" : "collaborator";
  const status = shareWithEmail(id, email, shareRole);

  // Notify the invitee (best-effort; never blocks or fails the share).
  if (status === "member_added" || status === "invite_pending") {
    void sendInviteEmail({
      to: email.trim(),
      projectName: actor!.project!.name,
      openUrl: magicLink(email, actor!.project!.slug),
      inviterName: actor!.user.name,
      role: shareRole,
    });
  }
  return NextResponse.json({ ok: true, status, emailed: mailConfigured() });
}

// Remove someone. body { self: true } → the caller leaves the app; otherwise the
// owner removes a member ({user_id}) or a pending invite ({email}).
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { actor, error } = await requireProject(id); // any member
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const isOwner = actor!.role === "owner";

  if (body.self === true) {
    if (isOwner) return jsonError(400, "You own this app — delete it instead of leaving.");
    run("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", id, actor!.user.id);
    return NextResponse.json({ ok: true, left: true });
  }
  if (!isOwner) return jsonError(403, "Only the owner can remove other people.");
  if (body.user_id && body.user_id !== actor!.project!.owner_id) {
    run("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", id, body.user_id);
  }
  if (body.email) run("DELETE FROM invites WHERE project_id = ? AND email = ?", id, body.email);
  return NextResponse.json({ ok: true });
}

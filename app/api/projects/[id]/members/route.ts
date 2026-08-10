import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireProject } from "@/lib/api";
import { run } from "@/lib/db";
import { invitesOf, membersOf, ShareRole, shareWithEmail } from "@/lib/projects";

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
  const { error } = await requireProject(id, { need: "manage" });
  if (error) return error;
  const { email, role } = await req.json().catch(() => ({}));
  if (!email?.trim() || !email.includes("@")) return jsonError(422, "A valid email is required.");
  const shareRole: ShareRole = role === "editor" ? "editor" : "collaborator";
  const status = shareWithEmail(id, email, shareRole);
  return NextResponse.json({ ok: true, status });
}

// Remove a member (body: {user_id}) or a pending invite (body: {email}).
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { actor, error } = await requireProject(id, { need: "manage" });
  if (error) return error;
  const { user_id, email } = await req.json().catch(() => ({}));
  if (user_id && user_id !== actor!.project!.owner_id) {
    run("DELETE FROM project_members WHERE project_id = ? AND user_id = ?", id, user_id);
  }
  if (email) run("DELETE FROM invites WHERE project_id = ? AND email = ?", id, email);
  return NextResponse.json({ ok: true });
}

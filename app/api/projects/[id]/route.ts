import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireProject } from "@/lib/api";
import {
  deleteProject, invitesOf, latestDeployment, membersOf, projectJson, setProject,
} from "@/lib/projects";

type Params = { params: Promise<{ id: string }> };

// Full project detail: project + role + members + latest deployment.
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { actor, error } = await requireProject(id);
  if (error) return error;
  const dep = latestDeployment(id);
  return NextResponse.json({
    ...projectJson(actor!.project!, actor!.role),
    members: membersOf(id),
    pending_invites: invitesOf(id),
    latest_deployment: dep
      ? { id: dep.id, status: dep.status, logs: dep.logs, url: dep.url || null,
          created_at: dep.created_at, completed_at: dep.completed_at }
      : null,
  });
}

// Update code source (git URL) or name/description.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id, { need: "edit" });
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  const fields: Record<string, any> = {};
  if (typeof body.name === "string" && body.name.trim()) fields.name = body.name.trim();
  if (typeof body.description === "string") fields.description = body.description.trim();
  if (typeof body.repository_url === "string" && body.repository_url.trim()) {
    fields.source_kind = "git";
    fields.repository_url = body.repository_url.trim();
  }
  if (!Object.keys(fields).length) return jsonError(422, "Nothing to update.");
  setProject(id, fields);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id, { need: "manage" });
  if (error) return error;
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}

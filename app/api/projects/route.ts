import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireUser } from "@/lib/api";
import { createProject, listSamples, projectJson, projectsForUser } from "@/lib/projects";

export async function GET() {
  const { actor, error } = await requireUser();
  if (error) return error;
  return NextResponse.json({
    projects: projectsForUser(actor!.user.id).map((p) => projectJson(p, p.role)),
  });
}

export async function POST(req: NextRequest) {
  const { actor, error } = await requireUser();
  if (error) return error;
  const body = await req.json().catch(() => ({}));
  if (!body.name?.trim()) return jsonError(422, "A project name is required.");
  if (body.sample && !listSamples().includes(body.sample)) {
    return jsonError(422, `Unknown sample. Available: ${listSamples().join(", ")}`);
  }
  const project = createProject(actor!.user.id, body);
  return NextResponse.json(projectJson(project, "owner"), { status: 201 });
}

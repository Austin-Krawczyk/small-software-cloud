import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireProject } from "@/lib/api";
import { one } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dep = one("SELECT * FROM deployments WHERE id = ?", id);
  if (!dep) return jsonError(404, "Deployment not found.");
  const { error } = await requireProject(dep.project_id);
  if (error) return error;
  return NextResponse.json({
    id: dep.id,
    project_id: dep.project_id,
    status: dep.status,
    url: dep.url || null,
    logs: dep.logs,
    created_at: dep.created_at,
    completed_at: dep.completed_at,
  });
}

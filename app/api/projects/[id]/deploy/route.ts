import { NextRequest, NextResponse } from "next/server";
import { requireProject } from "@/lib/api";
import { startDeployment } from "@/lib/deploy";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await requireProject(id, { need: "edit" });
  if (error) return error;
  const deploymentId = startDeployment(id);
  return NextResponse.json({ deployment_id: deploymentId, status: "building" }, { status: 202 });
}

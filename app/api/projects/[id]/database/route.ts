// Managed per-project database. MVP engine: SQLite (a file in the app's durable
// storage). Attaching injects DATABASE_URL + SCLOUD_DATABASE_PATH into the app
// at start; the same UI/endpoint can grow other engines (e.g. Postgres) later.
// Editors and owners can manage it (it's environment configuration).
import { NextRequest, NextResponse } from "next/server";
import { requireProject } from "@/lib/api";
import { attachDatabase, databaseInfo, detachDatabase } from "@/lib/projects";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id, { need: "edit" });
  if (error) return error;
  return NextResponse.json(databaseInfo(id));
}

export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id, { need: "edit" });
  if (error) return error;
  attachDatabase(id);
  return NextResponse.json({ ...databaseInfo(id), note: "Redeploy or restart the app to connect." });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id, { need: "edit" });
  if (error) return error;
  detachDatabase(id);
  return NextResponse.json({ ok: true });
}

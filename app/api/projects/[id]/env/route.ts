// Per-app environment variables / secrets. Owner-only (values are secrets).
// Applied at process start by the runner; a redeploy or restart picks up changes.
import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireProject } from "@/lib/api";
import { deleteEnvVar, envVars, setEnvVar } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id, { ownerOnly: true });
  if (error) return error;
  return NextResponse.json({ env: envVars(id) });
}

export async function PUT(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id, { ownerOnly: true });
  if (error) return error;
  const { key, value } = await req.json().catch(() => ({}));
  if (!key || !KEY_RE.test(key)) {
    return jsonError(422, "Key must be letters, digits and underscores, not starting with a digit.");
  }
  setEnvVar(id, key, String(value ?? ""));
  return NextResponse.json({ ok: true, note: "Redeploy or restart the app to apply." });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id, { ownerOnly: true });
  if (error) return error;
  const { key } = await req.json().catch(() => ({}));
  if (!key) return jsonError(422, "A key is required.");
  deleteEnvVar(id, key);
  return NextResponse.json({ ok: true });
}

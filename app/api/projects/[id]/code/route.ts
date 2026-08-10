import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { jsonError, requireProject } from "@/lib/api";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB, UPLOADS_DIR } from "@/lib/config";
import { setProject } from "@/lib/projects";

// Upload a zip of the project's code (multipart field: code_zip).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { error } = await requireProject(id, { need: "edit" });
  if (error) return error;

  const form = await req.formData().catch(() => null);
  const file = form?.get("code_zip");
  if (!(file instanceof File) || !file.size) {
    return jsonError(422, "Attach a zip file as multipart field 'code_zip'.");
  }
  if (file.size > MAX_UPLOAD_BYTES) return jsonError(413, `Upload too large (limit ${MAX_UPLOAD_MB} MB).`);

  const buf = Buffer.from(await file.arrayBuffer());
  fs.writeFileSync(path.join(UPLOADS_DIR, `${id}.zip`), buf);
  setProject(id, { source_kind: "upload", repository_url: "" });
  return NextResponse.json({ ok: true });
}

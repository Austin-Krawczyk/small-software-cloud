// "Anyone with the link" sharing. Owner-only (it's an access decision).
//   GET    -> { enabled, url }
//   POST   -> enable (or {rotate:true} for a fresh link) -> { enabled, url }
//   DELETE -> turn it off
import { NextRequest, NextResponse } from "next/server";
import { requireProject } from "@/lib/api";
import { disableShareLink, enableShareLink, shareLink } from "@/lib/projects";
import { getProject } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id, { need: "manage" });
  if (error) return error;
  return NextResponse.json(shareLink(id));
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id, { need: "manage" });
  if (error) return error;
  const { rotate } = await req.json().catch(() => ({}));
  // Enable if off; regenerate only when explicitly rotating (so toggling on twice
  // doesn't silently break an existing link).
  if (rotate || !getProject(id)!.share_key) return NextResponse.json(enableShareLink(id));
  return NextResponse.json(shareLink(id));
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { error } = await requireProject(id, { need: "manage" });
  if (error) return error;
  disableShareLink(id);
  return NextResponse.json({ enabled: false, url: null });
}

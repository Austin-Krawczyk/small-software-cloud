import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { createApiToken } from "@/lib/auth";
import { all } from "@/lib/db";

export async function GET() {
  const { actor, error } = await requireUser();
  if (error) return error;
  return NextResponse.json({
    tokens: all(
      "SELECT label, created_at FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC",
      actor!.user.id
    ),
  });
}

export async function POST(req: NextRequest) {
  const { actor, error } = await requireUser();
  if (error) return error;
  const { label } = await req.json().catch(() => ({}));
  const token = createApiToken(actor!.user.id, (label ?? "").trim() || "CLI");
  // The token is shown once; only its hash is stored.
  return NextResponse.json({ token }, { status: 201 });
}

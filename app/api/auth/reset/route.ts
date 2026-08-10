// Complete a password reset with a valid token.
import { NextRequest, NextResponse } from "next/server";
import { setPassword, verifyResetToken } from "@/lib/auth";
import { initPlatform } from "@/lib/deploy";
import { jsonError } from "@/lib/api";

export async function POST(req: NextRequest) {
  initPlatform();
  const { token, password } = await req.json().catch(() => ({}));
  if (!password || password.length < 8) {
    return jsonError(422, "Password must be at least 8 characters.");
  }
  const user = verifyResetToken(token);
  if (!user) {
    return jsonError(400, "This reset link is invalid or has expired. Request a new one.");
  }
  setPassword(user.id, password);
  return NextResponse.json({ ok: true });
}

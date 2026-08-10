import { NextRequest, NextResponse } from "next/server";
import { claimInvites, createSession, verifyPassword } from "@/lib/auth";
import { COOKIE_SECURE, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/config";
import { one } from "@/lib/db";
import { initPlatform } from "@/lib/deploy";
import { jsonError } from "@/lib/api";

export async function POST(req: NextRequest) {
  initPlatform();
  const { email, password } = await req.json().catch(() => ({}));
  const user = one("SELECT * FROM users WHERE email = ?", (email ?? "").trim());
  if (!user || !verifyPassword(password ?? "", user.password_hash)) {
    return jsonError(401, "Wrong email or password.");
  }
  claimInvites(user.id, user.email);
  const res = NextResponse.json({ id: user.id, name: user.name, email: user.email });
  res.cookies.set(SESSION_COOKIE, createSession(user.id), {
    httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, maxAge: SESSION_TTL_MS / 1000, path: "/",
  });
  return res;
}

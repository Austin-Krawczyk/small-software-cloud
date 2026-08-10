import { NextRequest, NextResponse } from "next/server";
import { claimInvites, createSession, verifyPassword } from "@/lib/auth";
import { COOKIE_SECURE, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/config";
import { one } from "@/lib/db";
import { initPlatform } from "@/lib/deploy";
import { jsonError } from "@/lib/api";
import { clientIp, over, record, reset, retryAfterSec } from "@/lib/ratelimit";

const MAX_FAILS = 10;
const WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  initPlatform();
  // Throttle credential stuffing: cap failed attempts per IP. Successful logins
  // clear the counter, so a legitimate user is never locked out.
  const key = `login:${clientIp(req)}`;
  if (over(key, MAX_FAILS, WINDOW_MS)) {
    return jsonError(429, `Too many attempts. Try again in about ${Math.ceil(retryAfterSec(key) / 60)} minutes.`);
  }
  const { email, password } = await req.json().catch(() => ({}));
  const user = one("SELECT * FROM users WHERE email = ?", (email ?? "").trim());
  if (!user || !verifyPassword(password ?? "", user.password_hash)) {
    record(key, WINDOW_MS);
    return jsonError(401, "Wrong email or password.");
  }
  reset(key);
  claimInvites(user.id, user.email);
  const res = NextResponse.json({ id: user.id, name: user.name, email: user.email });
  res.cookies.set(SESSION_COOKIE, createSession(user.id), {
    httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, maxAge: SESSION_TTL_MS / 1000, path: "/",
  });
  return res;
}

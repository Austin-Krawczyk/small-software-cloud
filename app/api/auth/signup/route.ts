import { NextRequest, NextResponse } from "next/server";
import { createSession, createUser } from "@/lib/auth";
import { COOKIE_SECURE, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/config";
import { one } from "@/lib/db";
import { initPlatform } from "@/lib/deploy";
import { jsonError } from "@/lib/api";
import { clientIp, over, record, retryAfterSec } from "@/lib/ratelimit";

const MAX_SIGNUPS = 10;
const WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  initPlatform();
  // Cap account creation per IP to blunt mass/automated signups.
  const key = `signup:${clientIp(req)}`;
  if (over(key, MAX_SIGNUPS, WINDOW_MS)) {
    return jsonError(429, `Too many sign-ups from here. Try again in about ${Math.ceil(retryAfterSec(key) / 60)} minutes.`);
  }
  record(key, WINDOW_MS);
  const body = await req.json().catch(() => ({}));
  const { name, email, password } = body;
  if (!name?.trim() || !email?.trim() || !password) {
    return jsonError(422, "Name, email and password are required.");
  }
  if (password.length < 8) return jsonError(422, "Password must be at least 8 characters.");
  if (one("SELECT id FROM users WHERE email = ?", email.trim())) {
    return jsonError(409, "That email already has an account.");
  }
  const user = createUser(email, name, password);
  const res = NextResponse.json({ id: user.id, name: user.name, email: user.email }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, createSession(user.id), {
    httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, maxAge: SESSION_TTL_MS / 1000, path: "/",
  });
  return res;
}

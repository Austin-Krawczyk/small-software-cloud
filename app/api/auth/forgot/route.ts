// Request a password reset. Always responds ok (never reveals whether an email
// has an account), sending a reset link only if the account exists.
import { NextRequest, NextResponse } from "next/server";
import { makeResetToken } from "@/lib/auth";
import { platformOrigin } from "@/lib/config";
import { one } from "@/lib/db";
import { initPlatform } from "@/lib/deploy";
import { sendResetEmail } from "@/lib/mail";
import { clientIp, over, record, retryAfterSec } from "@/lib/ratelimit";
import { jsonError } from "@/lib/api";

const MAX = 5;
const WINDOW_MS = 15 * 60 * 1000;

export async function POST(req: NextRequest) {
  initPlatform();
  const key = `forgot:${clientIp(req)}`;
  if (over(key, MAX, WINDOW_MS)) {
    return jsonError(429, `Too many requests. Try again in about ${Math.ceil(retryAfterSec(key) / 60)} minutes.`);
  }
  record(key, WINDOW_MS);

  const { email } = await req.json().catch(() => ({}));
  const user = email?.trim() ? one("SELECT * FROM users WHERE email = ?", email.trim()) : null;
  if (user) {
    const url = `${platformOrigin()}/reset?token=${encodeURIComponent(makeResetToken(user))}`;
    void sendResetEmail(user.email, url);
  }
  // Same response whether or not the account exists.
  return NextResponse.json({ ok: true });
}

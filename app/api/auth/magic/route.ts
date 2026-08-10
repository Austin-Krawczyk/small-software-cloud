// Magic sign-in link. A share invite emails a signed link here; clicking it
// establishes the recipient's identity with no signup form — creates a
// passwordless account for the email if needed, claims any pending invites,
// starts a session, and drops them at the app they were invited to.
import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/appauth";
import { createSession, findOrCreateUserByEmail } from "@/lib/auth";
import {
  APP_PROTO, BASE_HOST, baseHostname, COOKIE_SECURE, platformOrigin,
  SESSION_COOKIE, SESSION_TTL_MS,
} from "@/lib/config";
import { initPlatform } from "@/lib/deploy";
import { clientIp, over, record } from "@/lib/ratelimit";

// Only redirect to our own platform origin or an app subdomain of it.
function safeNext(next: string | null): string {
  if (next) {
    try {
      const u = new URL(next);
      if (u.protocol === `${APP_PROTO}:` &&
          (u.host === BASE_HOST || u.hostname.endsWith(`.${baseHostname()}`))) {
        return u.toString();
      }
    } catch { /* fall through */ }
  }
  return `${platformOrigin()}/`;
}

export async function GET(req: NextRequest) {
  initPlatform();
  const bad = (msg: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url), 302);

  const key = `magic:${clientIp(req)}`;
  if (over(key, 20, 15 * 60 * 1000)) return bad("Too many attempts. Try again shortly.");
  record(key, 15 * 60 * 1000);

  const payload = verifyToken(req.nextUrl.searchParams.get("token"));
  const email = typeof payload?.magic === "string" ? payload.magic : null;
  if (!email) return bad("This sign-in link is invalid or has expired. Ask for a new invite.");

  const user = findOrCreateUserByEmail(email, email.split("@")[0]);
  const res = NextResponse.redirect(safeNext(req.nextUrl.searchParams.get("next")), 302);
  res.cookies.set(SESSION_COOKIE, createSession(user.id), {
    httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, maxAge: SESSION_TTL_MS / 1000, path: "/",
  });
  return res;
}

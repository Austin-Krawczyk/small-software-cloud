// Google redirects here with an authorization code. We verify the state cookie
// (CSRF), exchange the code for the user's profile, find-or-create the account,
// and start a session — then return to wherever they were headed.
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createSession, upsertOAuthUser } from "@/lib/auth";
import { COOKIE_SECURE, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/config";
import { initPlatform } from "@/lib/deploy";
import { exchangeGoogleCode, googleConfigured } from "@/lib/oauth";

export async function GET(req: NextRequest) {
  initPlatform();
  const fail = (msg: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url), 302);

  if (!googleConfigured()) return fail("Google sign-in isn't enabled.");

  const jar = await cookies();
  let saved: { state?: string; next?: string } | null = null;
  try { saved = JSON.parse(jar.get("scloud_oauth")?.value ?? "null"); } catch { saved = null; }

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  if (!code || !state || !saved?.state || saved.state !== state) {
    return fail("Sign-in couldn't be verified. Please try again.");
  }

  const profile = await exchangeGoogleCode(code);
  if (!profile?.email) return fail("Couldn't verify your Google account.");

  const user = upsertOAuthUser(profile.email, profile.name);
  const next = saved.next?.startsWith("/") ? saved.next : "/";
  const res = NextResponse.redirect(new URL(next, req.url), 302);
  res.cookies.set(SESSION_COOKIE, createSession(user.id), {
    httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, maxAge: SESSION_TTL_MS / 1000, path: "/",
  });
  res.cookies.delete("scloud_oauth");
  return res;
}

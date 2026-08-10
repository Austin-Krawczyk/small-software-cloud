// Start the Google sign-in flow: set a state cookie (CSRF) and redirect to the
// consent screen. If Google isn't configured, fall back to the login page.
import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { COOKIE_SECURE, GOOGLE_CLIENT_ID } from "@/lib/config";
import { initPlatform } from "@/lib/deploy";
import { googleAuthUrl, googleConfigured, googleRedirectUri } from "@/lib/oauth";

export async function GET(req: NextRequest) {
  initPlatform();
  if (!googleConfigured()) {
    return NextResponse.redirect(new URL("/login", req.url), 302);
  }
  const nextParam = req.nextUrl.searchParams.get("next") || "/";
  const next = nextParam.startsWith("/") ? nextParam : "/";
  const state = crypto.randomBytes(16).toString("base64url");

  const res = NextResponse.redirect(googleAuthUrl(GOOGLE_CLIENT_ID, googleRedirectUri(), state), 302);
  res.cookies.set("scloud_oauth", JSON.stringify({ state, next }), {
    httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, maxAge: 600, path: "/",
  });
  return res;
}

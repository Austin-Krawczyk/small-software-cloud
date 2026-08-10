// App-origin step of the handoff (reached as {slug}.BASE_HOST/__scloud_auth).
//
// Verifies the short-lived handoff token minted on the platform origin and
// exchanges it for an app-scoped session cookie. That cookie is host-only to
// this app's origin, so it never travels to the platform or to other apps.
import { NextRequest, NextResponse } from "next/server";
import { APP_COOKIE, APP_SESSION_TTL_MS, appOriginFor, appSlugFromHost } from "@/lib/config";
import { signClaim, verifyClaim } from "@/lib/appauth";

export async function GET(req: NextRequest) {
  const slug = appSlugFromHost(req.headers.get("host"));
  if (!slug) return new NextResponse("Not found", { status: 404 });

  const claim = verifyClaim(req.nextUrl.searchParams.get("token"));
  if (!claim || claim.s !== slug) {
    return new NextResponse("This sign-in link has expired. Please open the app again.", { status: 400 });
  }

  const ret = req.nextUrl.searchParams.get("return") ?? `${appOriginFor(slug)}/`;
  const safeReturn = ret.startsWith(appOriginFor(slug)) ? ret : `${appOriginFor(slug)}/`;

  const res = NextResponse.redirect(safeReturn, 302);
  res.cookies.set(APP_COOKIE, signClaim({ u: claim.u, s: slug }, APP_SESSION_TTL_MS), {
    httpOnly: true,
    sameSite: "lax",
    maxAge: APP_SESSION_TTL_MS / 1000,
    path: "/",
    // No domain attribute → host-only to this app's origin.
  });
  return res;
}

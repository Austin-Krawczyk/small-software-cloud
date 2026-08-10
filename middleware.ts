// Host-based routing. Deployed apps are served on their own origin
// ({slug}.BASE_HOST); the platform (dashboard + API) is on BASE_HOST itself.
//
// Next rewrites overwrite the request's Host header with the server's bind
// host, so downstream handlers can't recover the app subdomain from Host.
// Instead we stamp the resolved slug into a trusted request header the gateway
// keys off. This middleware only does string work — no crypto, no DB — so it
// stays edge-safe; all auth/proxy logic lives in the Node handlers it targets.
import { NextRequest, NextResponse } from "next/server";

// Kept in sync with lib/config.ts appSlugFromHost (config can't be imported
// here without pulling Node-only modules into the edge runtime).
const BASE_HOST = process.env.SCLOUD_BASE_HOST ?? "localhost:3000";
const SLUG_HEADER = "x-scloud-slug";

function appSlug(host: string | null): string | null {
  if (!host) return null;
  const base = BASE_HOST.split(":")[0].toLowerCase();
  const h = host.split(":")[0].toLowerCase();
  if (h === base) return null;
  if (h.endsWith("." + base)) {
    const slug = h.slice(0, -(base.length + 1));
    if (/^[a-z0-9-]+$/.test(slug)) return slug;
  }
  return null;
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host");
  const slug = appSlug(host);

  // Strip any client-supplied slug header so it can only ever be set here.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete(SLUG_HEADER);

  if (!slug) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  requestHeaders.set(SLUG_HEADER, slug);
  const { pathname } = req.nextUrl;
  const url = req.nextUrl.clone();
  url.pathname =
    pathname === "/__scloud_auth"
      ? "/appauth/callback" // token → app-session cookie
      : `/gateway/${slug}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url, { request: { headers: requestHeaders } });
}

export const config = {
  // Skip Next internals and the internal rewrite targets. Excluding /gateway
  // and /appauth means the rewrite doesn't re-enter middleware (which would
  // strip the header we just set), and a browser navigation straight to
  // /gateway/… — which can't set the header — falls through to the gateway's
  // guard and is refused.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|gateway/|appauth/).*)"],
};

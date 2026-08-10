// Host-based routing. Deployed apps are served on their own origin
// ({slug}.BASE_HOST); the platform (dashboard + API) is on BASE_HOST itself.
//
// This middleware only rewrites URLs by Host — no crypto, no DB — so it stays
// edge-safe. All auth/proxy logic lives in Node route handlers it points to.
import { NextRequest, NextResponse } from "next/server";

// Kept in sync with lib/config.ts appSlugFromHost (config can't be imported
// here without pulling Node-only modules into the edge runtime).
const BASE_HOST = process.env.SCLOUD_BASE_HOST ?? "localhost:3000";

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
  const slug = appSlug(req.headers.get("host"));
  if (!slug) return NextResponse.next(); // platform origin — serve normally

  // Rewrite is internal and does not re-run middleware, so no re-entry guard is
  // needed — every app-origin path maps straight to the gateway (or the auth
  // callback), and app paths that happen to start with /gateway are preserved.
  const url = req.nextUrl.clone();
  if (url.pathname === "/__scloud_auth") {
    url.pathname = "/appauth/callback"; // token → app-session cookie
  } else {
    url.pathname = `/gateway/${slug}${url.pathname === "/" ? "" : url.pathname}`;
  }
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

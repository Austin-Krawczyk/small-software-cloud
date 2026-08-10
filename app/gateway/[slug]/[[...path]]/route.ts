// Application gateway — runs on each app's own origin ({slug}.BASE_HOST).
// Reached only via the host-based rewrite in middleware.ts.
//
// Access control still lives here, so deployed apps never implement auth:
//
//   request → valid app cookie? → still a member? → wake app → route
//
// The app cookie is minted by the platform handoff (see /api/app-access and
// /appauth/callback). A missing/expired cookie bounces to the platform origin
// to (re)authenticate. The signed-in user's email is forwarded as
// X-SmallSoftware-User so apps can personalize without touching credentials.
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  APP_COOKIE, APP_HOST, appOriginFor, platformOrigin,
} from "@/lib/config";
import { getProjectBySlug, one, roleFor, Row } from "@/lib/db";
import { verifyClaim } from "@/lib/appauth";
import { buildDirFor, ensureRunning, initPlatform } from "@/lib/deploy";

const HOP_BY_HOP = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
  "te", "trailers", "transfer-encoding", "upgrade", "host", "content-length",
  "content-encoding",
]);

const MIME: Record<string, string> = {
  ".html": "text/html", ".css": "text/css", ".js": "text/javascript",
  ".mjs": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".ico": "image/x-icon", ".webp": "image/webp",
  ".txt": "text/plain", ".pdf": "application/pdf", ".woff2": "font/woff2",
};

function page(title: string, body: string, status: number): NextResponse {
  return new NextResponse(
    `<html><body style="font-family:system-ui;max-width:32rem;margin:6rem auto;text-align:center">
     <h2>${title}</h2><p>${body}</p><p><a href="${platformOrigin()}/">Back to Small Software Cloud</a></p></body></html>`,
    { status, headers: { "content-type": "text/html" } }
  );
}

function toAuth(req: NextRequest, slug: string, subPath: string): NextResponse {
  // Bounce to the platform origin to (re)authenticate, then return here. Rebuild
  // the *original* app URL from subPath — req.nextUrl.pathname is the internal
  // /gateway/{slug} rewrite target, which must not leak into the return URL.
  const ret = `${appOriginFor(slug)}/${subPath}${req.nextUrl.search}`;
  const dest = new URL(`${platformOrigin()}/api/app-access`);
  dest.searchParams.set("slug", slug);
  dest.searchParams.set("return", ret);
  const res = NextResponse.redirect(dest, 302);
  res.cookies.delete(APP_COOKIE);
  return res;
}

async function gateway(req: NextRequest, ctx: { params: Promise<{ slug: string; path?: string[] }> }) {
  initPlatform();

  const { slug, path: pathParts } = await ctx.params;
  const subPath = (pathParts ?? []).join("/");

  // Defense in depth: this route only serves an app's own origin. Middleware
  // stamps x-scloud-slug (and strips any client-supplied value) when routing an
  // app subdomain; a direct hit on the platform origin never carries it, so it
  // is refused rather than served same-origin with the dashboard.
  if (req.headers.get("x-scloud-slug") !== slug) {
    return new NextResponse("Not found", { status: 404 });
  }

  const project = getProjectBySlug(slug);
  if (!project) return page("Not found", "No application lives at this address.", 404);

  const claim = verifyClaim(req.cookies.get(APP_COOKIE)?.value);
  if (!claim || claim.s !== slug) return toAuth(req, slug, subPath);

  const role = roleFor(project.id, claim.u);
  if (!role) return toAuth(req, slug, subPath); // membership revoked since the cookie was minted

  const user = one("SELECT * FROM users WHERE id = ?", claim.u);
  if (!user) return toAuth(req, slug, subPath);

  let fresh: Row;
  try {
    fresh = await ensureRunning(project);
  } catch (e: any) {
    return page("Not running", e.message ?? "This application is not running.", 503);
  }

  if (fresh.app_type === "static") return serveStatic(fresh, subPath);
  return forward(fresh, subPath, req, user);
}

function serveStatic(project: Row, subPath: string): NextResponse {
  // Static files may live in a build subfolder (dist/, build/, …) recorded at deploy.
  const root = path.resolve(buildDirFor(project.id), project.static_dir || "");
  let target = path.resolve(root, subPath || "index.html");
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    target = path.join(target, "index.html");
  }
  if (!target.startsWith(root) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    return page("Not found", "File not found.", 404);
  }
  const mime = MIME[path.extname(target).toLowerCase()] ?? "application/octet-stream";
  return new NextResponse(new Uint8Array(fs.readFileSync(target)), {
    headers: { "content-type": mime },
  });
}

async function forward(project: Row, subPath: string, req: NextRequest, user: Row) {
  const upstream = `http://${APP_HOST}:${project.port}/${subPath}${req.nextUrl.search}`;
  const headers = new Headers();
  req.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase())) headers.set(k, v);
  });
  headers.set("x-forwarded-prefix", ""); // app is at the root of its own origin
  headers.set("x-smallsoftware-user", user.email);
  headers.set("x-smallsoftware-user-name", user.name);

  const hasBody = !["GET", "HEAD"].includes(req.method);
  let resp: Response;
  try {
    resp = await fetch(upstream, {
      method: req.method,
      headers,
      body: hasBody ? Buffer.from(await req.arrayBuffer()) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return page("Application unavailable", "The application did not respond. Try deploying again.", 502);
  }

  const outHeaders = new Headers();
  resp.headers.forEach((v, k) => {
    if (!HOP_BY_HOP.has(k.toLowerCase())) outHeaders.set(k, v);
  });
  return new NextResponse(Buffer.from(await resp.arrayBuffer()), {
    status: resp.status,
    headers: outHeaders,
  });
}

export {
  gateway as GET, gateway as POST, gateway as PUT,
  gateway as PATCH, gateway as DELETE, gateway as HEAD, gateway as OPTIONS,
};

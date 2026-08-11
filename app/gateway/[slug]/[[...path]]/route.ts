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
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import {
  APP_COOKIE, APP_HOST, APP_SESSION_TTL_MS, appOriginFor, COOKIE_SECURE, platformOrigin,
} from "@/lib/config";
import { getProjectBySlug, one, roleFor, Row } from "@/lib/db";
import { signToken, verifyToken } from "@/lib/appauth";
import { appIsLive, buildDirFor, ensureRunning, initPlatform, wakeApp } from "@/lib/deploy";

// Fingerprint of the current share key, embedded in guest cookies so rotating or
// disabling the link instantly invalidates sessions minted from the old link.
const keyFingerprint = (k: string) => crypto.createHash("sha256").update(k).digest("hex").slice(0, 16);

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

const GUEST: Row = { email: "guest", name: "Guest (shared link)" };

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

// Self-refreshing splash shown while a paused app cold-starts. It reloads the
// same URL every ~1.5s (counting attempts in the hash) until the app answers;
// after ~30s it shows a friendly "still starting" fallback.
function wakingPage(appName: string): NextResponse {
  const name = appName.replace(/[<&>]/g, "");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Waking up…</title>
<style>
  :root{color-scheme:light dark} html,body{height:100%;margin:0}
  body{display:grid;place-items:center;font-family:-apple-system,"Segoe UI",system-ui,sans-serif;background:#f7f7f5;color:#1a1a1a}
  @media (prefers-color-scheme:dark){body{background:#14161a;color:#eceef1}}
  .box{text-align:center;max-width:22rem;padding:2rem}
  .sp{width:34px;height:34px;margin:0 auto 1.2rem;border-radius:50%;border:3px solid rgba(128,128,128,.25);border-top-color:#2c6bed;animation:s .8s linear infinite}
  @keyframes s{to{transform:rotate(360deg)}}
  h1{font-size:1.15rem;margin:.2rem 0 .4rem;font-weight:640} p{color:#77787d;font-size:.92rem;margin:0} a{color:#2c6bed}
  @media (prefers-reduced-motion:reduce){.sp{animation:none}}
</style></head><body>
<div class="box" id="box">
  <div class="sp"></div>
  <h1>Waking up ${name}…</h1>
  <p>This app was paused to save resources. It&rsquo;ll be ready in a moment.</p>
</div>
<script>
(function(){
  var m=location.hash.match(/w=(\\d+)/), n=m?+m[1]:0;
  if(n>=20){
    document.getElementById('box').innerHTML='<h1>Still starting&hellip;</h1>'+
      '<p>This is taking longer than usual. <a href="'+location.pathname+'">Try again</a>, '+
      'or ask the owner to redeploy it.</p>';
    return;
  }
  setTimeout(function(){ location.hash='w='+(n+1); location.reload(); },1500);
})();
</script></body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
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

// Exchange a valid ?key= share link for an anonymous guest cookie, then redirect
// to the same URL with the secret stripped out of the address bar.
function mintGuestSession(slug: string, subPath: string, req: NextRequest, shareKey: string): NextResponse {
  const dest = new URL(`${appOriginFor(slug)}/${subPath}`);
  req.nextUrl.searchParams.forEach((v, k) => { if (k !== "key") dest.searchParams.set(k, v); });
  const res = NextResponse.redirect(dest, 302);
  res.cookies.set(APP_COOKIE, signToken({ anon: 1, s: slug, k: keyFingerprint(shareKey) }, APP_SESSION_TTL_MS), {
    httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE, maxAge: APP_SESSION_TTL_MS / 1000, path: "/",
  });
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

  // Resolve who's asking. Three ways in, in priority order:
  //   1. a valid guest cookie (from an "anyone with the link" share),
  //   2. a valid member cookie (signed handoff after login),
  //   3. a fresh ?key= that matches the current share link → mint a guest session.
  // Anything else bounces members to login. Guest sessions are re-validated
  // against the *current* share key on every request, so revocation is instant.
  const payload = verifyToken(req.cookies.get(APP_COOKIE)?.value);
  let user: Row;

  if (payload?.anon && payload.s === slug && project.share_key &&
      payload.k === keyFingerprint(project.share_key)) {
    user = GUEST;
  } else if (payload?.u && payload.s === slug) {
    if (!roleFor(project.id, payload.u)) return toAuth(req, slug, subPath); // membership revoked
    const u = one("SELECT * FROM users WHERE id = ?", payload.u);
    if (!u) return toAuth(req, slug, subPath);
    user = u;
  } else {
    const key = req.nextUrl.searchParams.get("key");
    if (key && project.share_key && safeEqual(key, project.share_key)) {
      return mintGuestSession(slug, subPath, req, project.share_key);
    }
    return toAuth(req, slug, subPath);
  }

  // Cold start: if a deployed app is asleep (idle, or paused by the concurrency
  // cap), wake it in the background and show a self-refreshing splash for page
  // loads — so the visitor sees "waking up…" rather than a hung tab.
  const wakeable = !!project.app_type && (project.status === "stopped" || project.status === "running");
  if (wakeable && !appIsLive(project)) {
    const wantsHtml = req.method === "GET" && (req.headers.get("accept") || "").includes("text/html");
    if (wantsHtml) {
      wakeApp(project);
      return wakingPage(project.name);
    }
  }

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

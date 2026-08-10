// Platform configuration. Everything lives under ./data so the whole
// platform is a single folder: delete data/ and you have a fresh install.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const BASE_DIR = process.cwd();
export const DATA_DIR = path.join(BASE_DIR, "data");
export const BUILDS_DIR = path.join(DATA_DIR, "builds"); // one folder per project
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads"); // uploaded zips
export const APP_LOGS_DIR = path.join(DATA_DIR, "applogs"); // stdout of running apps
export const DB_PATH = path.join(DATA_DIR, "smallcloud.db");
export const SAMPLES_DIR = path.join(BASE_DIR, "samples");

export const APP_HOST = "127.0.0.1";
// Deployed applications listen on loopback ports in this range; they are only
// reachable through the platform's authenticating proxy.
export const APP_PORT_START = 9100;
export const APP_PORT_END = 9500;

// Lifecycle: apps with no traffic for this long are stopped (scale-to-zero shape).
export const IDLE_STOP_MS = 30 * 60 * 1000;

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MAX_PROJECT_BYTES = 200 * 1024 * 1024;
export const BUILD_TIMEOUT_MS = 5 * 60 * 1000;
export const HEALTH_TIMEOUT_MS = 60 * 1000;

export const SESSION_COOKIE = "scloud_session";
export const SESSION_TTL_MS = 14 * 24 * 3600 * 1000;

// ---- Origin isolation ----------------------------------------------------
// Deployed apps are served on their OWN origin — a subdomain of BASE_HOST —
// so the platform's host-only session cookie is never sent to an app, and an
// app's JavaScript is cross-origin to the dashboard/API. In production set
// SCLOUD_BASE_HOST to a domain with a wildcard record (e.g. apps.example.com)
// and SCLOUD_PROTO=https. In dev, *.localhost resolves to 127.0.0.1 for free.
export const BASE_HOST = process.env.SCLOUD_BASE_HOST ?? "localhost:3000";
export const APP_PROTO = process.env.SCLOUD_PROTO ?? "http";

export const platformOrigin = () => `${APP_PROTO}://${BASE_HOST}`;
export const appHostFor = (slug: string) => `${slug}.${BASE_HOST}`;
export const appOriginFor = (slug: string) => `${APP_PROTO}://${slug}.${BASE_HOST}`;

// Bearer session cookie for an app's own origin, and the short-lived handoff
// token that mints it. Both are HMAC-signed with the platform secret.
export const APP_COOKIE = "scloud_app";
export const APP_SESSION_TTL_MS = 12 * 3600 * 1000; // bounded; re-minted silently
export const HANDOFF_TTL_MS = 60 * 1000;

// Parse the app slug out of an incoming Host header, or null for the platform
// origin. Kept dependency-free so the edge middleware can reuse the same rule.
export function appSlugFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const baseNoPort = BASE_HOST.split(":")[0].toLowerCase();
  const hostNoPort = host.split(":")[0].toLowerCase();
  if (hostNoPort === baseNoPort) return null;
  if (hostNoPort.endsWith("." + baseNoPort)) {
    const slug = hostNoPort.slice(0, -(baseNoPort.length + 1));
    if (/^[a-z0-9-]+$/.test(slug)) return slug;
  }
  return null;
}

export function ensureDirs(): void {
  for (const d of [DATA_DIR, BUILDS_DIR, UPLOADS_DIR, APP_LOGS_DIR]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

// Stable random secret, generated on first run and kept out of the DB.
let _secret: string | null = null;
export function secretKey(): string {
  if (_secret) return _secret;
  ensureDirs();
  const f = path.join(DATA_DIR, "secret_key");
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString("hex"));
  _secret = fs.readFileSync(f, "utf8").trim();
  return _secret;
}

// Signed tokens for the app-origin handoff and app-scoped sessions.
//
// Because deployed apps live on their own origin (see lib/config.ts), the
// platform session cookie can't reach them. Instead the platform mints a
// short-lived signed "handoff" token after checking membership; the app origin
// exchanges it for a longer app-session cookie. Both are HMAC-signed with the
// platform secret — no extra DB tables needed.
import crypto from "node:crypto";
import { secretKey } from "./config";

export interface AppClaim {
  u: string; // user id
  s: string; // project slug
  e: number; // expiry (epoch ms)
}

function sign(data: string): string {
  return crypto.createHmac("sha256", secretKey()).update(data).digest("base64url");
}

export function signClaim(claim: Omit<AppClaim, "e">, ttlMs: number): string {
  const payload: AppClaim = { ...claim, e: Date.now() + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function verifyClaim(token: string | undefined | null): AppClaim | null {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".", 2);
  const expected = sign(body);
  if (mac.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) {
    return null;
  }
  try {
    const claim = JSON.parse(Buffer.from(body, "base64url").toString()) as AppClaim;
    return claim.e > Date.now() ? claim : null;
  } catch {
    return null;
  }
}

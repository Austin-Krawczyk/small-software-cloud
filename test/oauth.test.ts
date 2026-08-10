// Unit tests for the pure Google-OAuth helpers.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeIdToken, googleAuthUrl } from "../lib/oauth";

test("googleAuthUrl: includes the required OAuth parameters", () => {
  const url = new URL(googleAuthUrl("client-123", "https://app.example/api/auth/google/callback", "st8"));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("client_id"), "client-123");
  assert.equal(url.searchParams.get("redirect_uri"), "https://app.example/api/auth/google/callback");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "openid email profile");
  assert.equal(url.searchParams.get("state"), "st8");
});

function jwt(payload: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "RS256" })}.${b64(payload)}.signature`;
}

test("decodeIdToken: extracts email and name from the payload", () => {
  const p = decodeIdToken(jwt({ email: "a@b.com", name: "Ada", email_verified: true }));
  assert.deepEqual(p, { email: "a@b.com", name: "Ada", emailVerified: true });
});

test("decodeIdToken: falls back to the email local-part when name is missing", () => {
  const p = decodeIdToken(jwt({ email: "ada@b.com", email_verified: true }));
  assert.equal(p?.name, "ada");
});

test("decodeIdToken: rejects malformed tokens and payloads without email", () => {
  assert.equal(decodeIdToken("not.a.valid.jwt"), null);
  assert.equal(decodeIdToken("onlyonepart"), null);
  assert.equal(decodeIdToken(jwt({ name: "no email" })), null);
});

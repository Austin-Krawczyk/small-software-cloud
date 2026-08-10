// Unit tests for the security-relevant pure logic: host parsing, signed tokens,
// and rate limiting. Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { appSlugFromHost } from "../lib/config";
import { signClaim, verifyClaim } from "../lib/appauth";
import { over, record, reset } from "../lib/ratelimit";

test("appSlugFromHost: platform apex is not an app", () => {
  assert.equal(appSlugFromHost("localhost:3000"), null);
  assert.equal(appSlugFromHost("localhost"), null);
});

test("appSlugFromHost: app subdomains resolve to their slug", () => {
  assert.equal(appSlugFromHost("team-notes.localhost:3000"), "team-notes");
  assert.equal(appSlugFromHost("orchard.localhost"), "orchard");
});

test("appSlugFromHost: rejects foreign hosts and non-slug labels", () => {
  assert.equal(appSlugFromHost("evil.com"), null);
  assert.equal(appSlugFromHost("a.b.localhost"), null); // dot isn't a valid slug char
  assert.equal(appSlugFromHost(""), null);
  assert.equal(appSlugFromHost(null), null);
});

test("signClaim / verifyClaim: valid token round-trips", () => {
  const token = signClaim({ u: "user1", s: "proj1" }, 60_000);
  const claim = verifyClaim(token);
  assert.equal(claim?.u, "user1");
  assert.equal(claim?.s, "proj1");
});

test("verifyClaim: rejects a tampered token", () => {
  const token = signClaim({ u: "user1", s: "proj1" }, 60_000);
  const tampered = token.slice(0, -2) + (token.endsWith("aa") ? "bb" : "aa");
  assert.equal(verifyClaim(tampered), null);
});

test("verifyClaim: rejects an expired token and garbage", () => {
  assert.equal(verifyClaim(signClaim({ u: "u", s: "s" }, -1000)), null);
  assert.equal(verifyClaim("not-a-token"), null);
  assert.equal(verifyClaim(""), null);
});

test("rate limiter: trips at the limit, resets on demand", () => {
  const k = "test:" + Math.random();
  assert.equal(over(k, 2, 10_000), false);
  record(k, 10_000);
  assert.equal(over(k, 2, 10_000), false); // count 1 < 2
  record(k, 10_000);
  assert.equal(over(k, 2, 10_000), true); // count 2 >= 2
  reset(k);
  assert.equal(over(k, 2, 10_000), false);
});

// Unit tests for GitHub webhook signature verification.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { test } from "node:test";
import { verifyGithubSignature } from "../lib/webhook";

function sign(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

test("verifyGithubSignature: accepts a correct signature", () => {
  const body = '{"ref":"refs/heads/main"}';
  assert.equal(verifyGithubSignature("s3cret", body, sign("s3cret", body)), true);
});

test("verifyGithubSignature: rejects wrong secret, tampered body, and junk", () => {
  const body = '{"ref":"refs/heads/main"}';
  assert.equal(verifyGithubSignature("s3cret", body, sign("other", body)), false);
  assert.equal(verifyGithubSignature("s3cret", body + " ", sign("s3cret", body)), false);
  assert.equal(verifyGithubSignature("s3cret", body, "sha256=deadbeef"), false);
});

test("verifyGithubSignature: rejects when secret or header is missing", () => {
  const body = "{}";
  assert.equal(verifyGithubSignature("", body, sign("x", body)), false);
  assert.equal(verifyGithubSignature("s3cret", body, null), false);
  assert.equal(verifyGithubSignature("s3cret", body, undefined), false);
});

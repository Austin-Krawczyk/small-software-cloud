// Verify a GitHub webhook's HMAC signature (X-Hub-Signature-256) over the raw
// request body, in constant time. Pure — unit-tested.
import crypto from "node:crypto";

export function verifyGithubSignature(
  secret: string, body: string, header: string | null | undefined
): boolean {
  if (!secret || !header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
  if (header.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

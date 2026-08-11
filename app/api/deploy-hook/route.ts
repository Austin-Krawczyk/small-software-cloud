// GitHub webhook → instant deploy. GitHub POSTs here on push; we verify the
// signature and, for a push to the default branch, touch a trigger file. A
// systemd .path unit watches that file and runs the (tests-gated) update as
// root — so this unprivileged process never needs sudo. Off unless
// SCLOUD_DEPLOY_SECRET is set.
import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { DATA_DIR, ensureDirs } from "@/lib/config";
import { verifyGithubSignature } from "@/lib/webhook";

export async function POST(req: NextRequest) {
  const secret = process.env.SCLOUD_DEPLOY_SECRET ?? "";
  if (!secret) return NextResponse.json({ error: "Deploy webhook is not configured." }, { status: 404 });

  const body = await req.text();
  if (!verifyGithubSignature(secret, body, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }

  const event = req.headers.get("x-github-event");
  if (event === "ping") return NextResponse.json({ ok: true });
  if (event !== "push") return NextResponse.json({ ok: true, ignored: event });

  // Only deploy pushes to the repo's default branch.
  try {
    const p = JSON.parse(body);
    const branch = `refs/heads/${p.repository?.default_branch ?? "main"}`;
    if (p.ref && p.ref !== branch) return NextResponse.json({ ok: true, ignored: "branch" });
  } catch { /* still deploy — the update script re-checks for real changes */ }

  ensureDirs();
  fs.writeFileSync(path.join(DATA_DIR, ".deploy-trigger"), String(Date.now()));
  return NextResponse.json({ ok: true, deploying: true }, { status: 202 });
}

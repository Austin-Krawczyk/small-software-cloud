// Liveness/readiness probe for monitoring and systemd. Cheap and unauthenticated.
import { NextResponse } from "next/server";
import { getRunner } from "@/lib/runner";
import { initPlatform } from "@/lib/deploy";
import { one } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    initPlatform();
    one("SELECT 1"); // touch the DB so the check fails if storage is broken
    return NextResponse.json({ status: "ok", runner: getRunner().name, time: Date.now() });
  } catch (e: any) {
    return NextResponse.json({ status: "error", error: String(e?.message ?? e) }, { status: 503 });
  }
}

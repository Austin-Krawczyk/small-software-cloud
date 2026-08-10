import { NextRequest, NextResponse } from "next/server";
import { destroySession } from "@/lib/auth";
import { SESSION_COOKIE } from "@/lib/config";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

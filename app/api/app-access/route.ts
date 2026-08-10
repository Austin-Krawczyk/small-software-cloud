// Platform-origin step of the app handoff.
//
// An app origin ({slug}.BASE_HOST) can't see the platform session cookie, so it
// bounces unauthenticated visitors here. On the platform origin the session IS
// visible: we verify the user is a member, then mint a 60-second signed handoff
// token and redirect back to the app origin to exchange it for an app cookie.
import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { appOriginFor, HANDOFF_TTL_MS } from "@/lib/config";
import { getProjectBySlug, roleFor } from "@/lib/db";
import { signClaim } from "@/lib/appauth";
import { initPlatform } from "@/lib/deploy";

function deniedPage(body: string, status: number): NextResponse {
  return new NextResponse(
    `<html><body style="font-family:system-ui;max-width:32rem;margin:6rem auto;text-align:center">
     <h2>Access denied</h2><p>${body}</p><p><a href="/">Back to Small Software Cloud</a></p></body></html>`,
    { status, headers: { "content-type": "text/html" } }
  );
}

export async function GET(req: NextRequest) {
  initPlatform();
  const slug = req.nextUrl.searchParams.get("slug") ?? "";
  const ret = req.nextUrl.searchParams.get("return") ?? `${appOriginFor(slug)}/`;

  const project = getProjectBySlug(slug);
  if (!project) return deniedPage("No application lives at this address.", 404);

  const user = await currentUser();
  if (!user) {
    // Sign in, then come back here to finish the handoff.
    const self = `/api/app-access?slug=${encodeURIComponent(slug)}&return=${encodeURIComponent(ret)}`;
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(self)}`, req.url), 302);
  }
  if (!roleFor(project.id, user.id)) {
    return deniedPage(
      "You don't have access to this application. Ask the owner to share it with your email address.",
      403
    );
  }

  const token = signClaim({ u: user.id, s: slug }, HANDOFF_TTL_MS);
  const dest = new URL(`${appOriginFor(slug)}/__scloud_auth`);
  dest.searchParams.set("token", token);
  dest.searchParams.set("return", ret);
  return NextResponse.redirect(dest, 302);
}

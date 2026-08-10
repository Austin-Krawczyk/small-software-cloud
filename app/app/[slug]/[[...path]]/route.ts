// Legacy path-based app URLs (/app/{slug}/…) now live on the platform origin
// only as a redirect to the app's own origin ({slug}.BASE_HOST). Apps are no
// longer served same-origin with the dashboard — see app/_gateway and
// middleware.ts for the real gateway.
import { NextRequest, NextResponse } from "next/server";
import { appOriginFor } from "@/lib/config";

async function redirectToApp(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; path?: string[] }> }
) {
  const { slug, path: pathParts } = await ctx.params;
  const rest = (pathParts ?? []).join("/");
  return NextResponse.redirect(`${appOriginFor(slug)}/${rest}${req.nextUrl.search}`, 308);
}

export {
  redirectToApp as GET, redirectToApp as POST, redirectToApp as PUT,
  redirectToApp as PATCH, redirectToApp as DELETE, redirectToApp as HEAD,
  redirectToApp as OPTIONS,
};

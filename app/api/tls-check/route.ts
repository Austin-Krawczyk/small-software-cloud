// Caddy on-demand TLS gate. Caddy asks this before issuing a certificate for an
// incoming SNI host, so certs are only minted for the platform domain and real
// app subdomains — not for arbitrary names pointed at the server.
//
//   200 → allowed to issue a cert     any other status → refused
import { NextRequest, NextResponse } from "next/server";
import { appSlugFromHost, baseHostname } from "@/lib/config";
import { getProjectBySlug } from "@/lib/db";
import { initPlatform } from "@/lib/deploy";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  initPlatform();
  const domain = (req.nextUrl.searchParams.get("domain") ?? "").toLowerCase();
  if (!domain) return new NextResponse("missing domain", { status: 400 });

  // The platform's own apex domain.
  if (domain === baseHostname()) return new NextResponse("ok", { status: 200 });

  // An app subdomain that maps to an existing project.
  const slug = appSlugFromHost(domain);
  if (slug && getProjectBySlug(slug)) return new NextResponse("ok", { status: 200 });

  return new NextResponse("unknown host", { status: 404 });
}

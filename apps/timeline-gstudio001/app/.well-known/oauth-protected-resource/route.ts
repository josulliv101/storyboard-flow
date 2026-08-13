import {
  METADATA_PREFLIGHT_HEADERS,
  metadataHeaders,
  resolveIssuerOrigin,
  protectedResourceMetadata,
} from "@/lib/oauth/metadata";

// RFC 9728 Protected Resource Metadata. The 401 from /api/mcp points here via
// its WWW-Authenticate `resource_metadata` parameter; the client fetches this
// to learn which authorization server to talk to.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const { origin, pinned } = resolveIssuerOrigin(request);
  return new Response(JSON.stringify(protectedResourceMetadata(origin), null, 2), {
    headers: metadataHeaders(pinned),
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_PREFLIGHT_HEADERS });
}

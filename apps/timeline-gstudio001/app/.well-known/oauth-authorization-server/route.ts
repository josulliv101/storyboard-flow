import {
  METADATA_PREFLIGHT_HEADERS,
  authorizationServerMetadata,
  metadataHeaders,
  resolveIssuerOrigin,
} from "@/lib/oauth/metadata";

// RFC 8414 Authorization Server Metadata — where the client discovers the
// /authorize and /token endpoints and that S256 PKCE is required.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const { origin, pinned } = resolveIssuerOrigin(request);
  return new Response(JSON.stringify(authorizationServerMetadata(origin), null, 2), {
    headers: metadataHeaders(pinned),
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: METADATA_PREFLIGHT_HEADERS });
}

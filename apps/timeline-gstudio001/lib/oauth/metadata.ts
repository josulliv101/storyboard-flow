import { MCP_SCOPE } from "./core";

// Shared shape for the two discovery documents. Origin is derived from the
// REQUEST rather than an env var so the same code serves localhost, preview
// deployments, and production without configuration drift — a metadata
// document advertising the wrong origin breaks the flow in confusing ways.

export function originFromRequest(request: Request): string {
  // x-forwarded-* is what Vercel sets in front of the function; fall back to
  // the request URL for local dev.
  const headers = request.headers;
  const forwardedHost = headers.get("x-forwarded-host") ?? headers.get("host");
  const forwardedProto = headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(request.url).origin;
}

export function mcpResourceUrl(origin: string): string {
  return `${origin}/api/mcp`;
}

/** RFC 9728 — tells the client which authorization server guards this resource. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResourceUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
  };
}

/** RFC 8414 — the authorization server's own capabilities. */
export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    // A PAGE, not an API route: it renders under the root layout, so the
    // existing AuthGate handles sign-in for an unauthenticated visitor and the
    // consent screen can reuse app chrome.
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // S256 ONLY — advertising `plain` would invite the downgrade OAuth 2.1 bans.
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    scopes_supported: [MCP_SCOPE],
    // No registration_endpoint: Dynamic Client Registration is intentionally
    // not offered, so clients use operator-provided credentials instead.
  };
}

/** Discovery documents are public and fetched cross-origin by the client. */
export const METADATA_HEADERS = {
  "content-type": "application/json",
  "cache-control": "public, max-age=300",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
} as const;

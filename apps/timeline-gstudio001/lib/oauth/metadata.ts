import { MCP_SCOPE } from "./core";

// Shared shape for the two discovery documents. Origin is derived from the
// REQUEST rather than an env var so the same code serves localhost, preview
// deployments, and production without configuration drift — a metadata
// document advertising the wrong origin breaks the flow in confusing ways.

export function originFromRequest(request: Request): string {
  // x-forwarded-* is what Vercel sets in front of the function; fall back to
  // the request URL for local dev.
  //
  // CLIENT-CONTROLLED unless something upstream overwrites it. Never call this
  // directly — go through `resolveIssuerOrigin`, which decides whether the
  // derived value may be trusted and tells the caller.
  const headers = request.headers;
  const forwardedHost = headers.get("x-forwarded-host") ?? headers.get("host");
  const forwardedProto = headers.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}`;
  return new URL(request.url).origin;
}

/** The env var that pins the advertised origin. Set it in any deployment that
 *  sits behind a shared cache, which is every real one. */
const ISSUER_ENV = "MCP_OAUTH_ISSUER";

/**
 * The origin this deployment advertises, and whether it is TRUSTWORTHY.
 *
 * Deriving it from the request is convenient — one build serves localhost,
 * previews and production — but `x-forwarded-host` is a header the client
 * sets. Two things went wrong with trusting it:
 *
 *   POISONED DISCOVERY. `/.well-known/*` served the derived origin with
 *   `cache-control: public, max-age=300` and no `Vary`, so the cache key was
 *   the path alone. One request carrying `X-Forwarded-Host: evil.example`
 *   could park a document advertising `token_endpoint:
 *   https://evil.example/api/oauth/token` in any shared cache in front of the
 *   app, and legitimate clients would send their `client_secret` and
 *   authorization code there for the next five minutes.
 *
 *   A SELF-REFERENTIAL AUDIENCE CHECK. `/api/mcp` binds tokens to
 *   `mcpResourceUrl(origin)` so "a token minted for another resource can't be
 *   replayed here" — but when both the minting and the checking derive the
 *   origin from the same client-supplied header, the comparison is between an
 *   attacker's value and the same attacker's value. It always agreed, so it
 *   was never protection at all.
 *
 * Pinned, both problems disappear: the advertised origin cannot be moved, and
 * the audience becomes a real per-deployment constant.
 *
 * UNSET IS STILL SAFE, just uncacheable — callers must use `metadataHeaders`,
 * which switches to `no-store` when the origin is derived. The insecure
 * combination (derived AND publicly cached) is the one thing that can no
 * longer be expressed.
 *
 * A MALFORMED value falls back to derived rather than throwing: a typo in an
 * env var should not take the deployment down, and falling back is safe
 * because it also drops caching. It is logged, because silently ignoring the
 * pin would leave an operator believing they were protected.
 */
export function resolveIssuerOrigin(request: Request): {
  origin: string;
  pinned: boolean;
} {
  const configured = process.env[ISSUER_ENV]?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.protocol === "https:" || url.protocol === "http:") {
        return { origin: url.origin, pinned: true };
      }
      console.error(`${ISSUER_ENV} must be http(s), got "${configured}" — ignoring it.`);
    } catch {
      console.error(`${ISSUER_ENV} is not a valid URL: "${configured}" — ignoring it.`);
    }
  }
  return { origin: originFromRequest(request), pinned: false };
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

/**
 * Discovery documents are public and fetched cross-origin by the client.
 *
 * CACHING IS CONDITIONAL on the origin being pinned. A derived origin means
 * the body depends on a request header, and a shared cache keyed on the path
 * alone would hand one client's header to the next client. `Vary` is sent
 * either way — it is the honest description of the response even when
 * `no-store` already settles it, and it protects any cache that honours
 * `Vary` but not the store directive.
 */
export function metadataHeaders(pinned: boolean): Record<string, string> {
  return {
    "content-type": "application/json",
    "cache-control": pinned ? "public, max-age=300" : "no-store",
    vary: "X-Forwarded-Host, X-Forwarded-Proto, Host",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "*",
  };
}

/** Preflight carries no body, so it never depends on the origin. */
export const METADATA_PREFLIGHT_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "*",
};

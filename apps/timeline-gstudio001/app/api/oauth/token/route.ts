import {
  ACCESS_TOKEN_TTL_SECONDS,
  getSigningSecret,
  grantAllowsResource,
  loadClient,
  safeEqual,
  signAccessToken,
  verifyPkce,
} from "@/lib/oauth/core";
import { mcpResourceUrl, resolveIssuerOrigin } from "@/lib/oauth/metadata";
import { consumeAuthCode, issueRefreshToken, rotateRefreshToken } from "@/lib/oauth/store";

// OAuth 2.1 token endpoint: authorization_code (with PKCE) and refresh_token.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth errors are a defined JSON shape, not free text (RFC 6749 §5.2). */
function oauthError(error: string, description: string, status = 400) {
  return Response.json(
    { error, error_description: description },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * RFC 6749 §2.3.1 form-urlencodes each half before base64, so they are decoded
 * here — but a client that skipped that step, or an unauthenticated prober,
 * can put a bare `%` in either half, and `decodeURIComponent` THROWS on one.
 * Unhandled it escaped the route as a 500, before client authentication, in
 * place of the `invalid_client` 401 every other path here returns. Falling back
 * to the raw value keeps the credential comparison the single arbiter.
 */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Client credentials may arrive as form fields or HTTP Basic. */
function readClientCredentials(request: Request, form: URLSearchParams) {
  const basic = request.headers.get("authorization");
  if (basic?.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(basic.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator > 0) {
      return {
        clientId: safeDecode(decoded.slice(0, separator)),
        clientSecret: safeDecode(decoded.slice(separator + 1)),
      };
    }
  }
  return {
    clientId: form.get("client_id") ?? "",
    clientSecret: form.get("client_secret") ?? "",
  };
}

export async function POST(request: Request) {
  const client = loadClient();
  const secret = getSigningSecret();
  if (!client || !secret) {
    return oauthError("server_error", "OAuth is not configured on this server.", 500);
  }

  const form = new URLSearchParams(await request.text());
  const { clientId, clientSecret } = readClientCredentials(request, form);

  // Authenticate the client before doing anything else with the grant.
  if (!safeEqual(clientId, client.clientId) || !safeEqual(clientSecret, client.clientSecret)) {
    return oauthError("invalid_client", "Unknown client or bad secret.", 401);
  }

  const { origin } = resolveIssuerOrigin(request);
  const resource = mcpResourceUrl(origin);
  const grantType = form.get("grant_type");

  if (grantType === "authorization_code") {
    const code = form.get("code");
    const redirectUri = form.get("redirect_uri");
    const codeVerifier = form.get("code_verifier");
    if (!code || !redirectUri || !codeVerifier) {
      return oauthError("invalid_request", "code, redirect_uri and code_verifier are required.");
    }

    // Single-use: consuming deletes the code even if validation below fails,
    // so an intercepted code can never be retried.
    const grant = await consumeAuthCode(code);
    if (!grant) return oauthError("invalid_grant", "Code is unknown, already used, or expired.");

    if (grant.clientId !== client.clientId) {
      return oauthError("invalid_grant", "Code was issued to a different client.");
    }
    // The redirect_uri must match the one the code was bound to (RFC 6749 §4.1.3).
    if (grant.redirectUri !== redirectUri) {
      return oauthError("invalid_grant", "redirect_uri does not match the authorization request.");
    }
    if (!verifyPkce(codeVerifier, grant.codeChallenge, grant.codeChallengeMethod)) {
      return oauthError("invalid_grant", "PKCE verification failed.");
    }
    // RFC 8707: the code was bound to a resource at /authorize, and this is
    // where that binding is honoured. `resource` here is derived from the
    // request, so without the comparison a code issued for one deployment
    // could be exchanged for a token audienced at another.
    if (!grantAllowsResource(grant.resource, resource)) {
      return oauthError("invalid_grant", "Code was issued for a different resource.");
    }

    // The GRANT's resource, not the request's — they are equal by the check
    // above, and using the stored one makes it unmistakable which is
    // authoritative.
    return issueTokens(grant.uid, grant.scope, client.clientId, origin, grant.resource, secret);
  }

  if (grantType === "refresh_token") {
    const presented = form.get("refresh_token");
    if (!presented) return oauthError("invalid_request", "refresh_token is required.");

    const rotated = await rotateRefreshToken(presented);
    if (!rotated) return oauthError("invalid_grant", "Refresh token is unknown or expired.");
    if (rotated.grant.clientId !== client.clientId) {
      return oauthError("invalid_grant", "Refresh token was issued to a different client.");
    }
    // The half that actually bit: a refresh token bound to one resource used
    // to mint an access token audienced at whatever the current request said,
    // because `rotated.grant.resource` was read from storage and then dropped.
    // Note the token has ALREADY been consumed by `rotateRefreshToken` — a
    // refusal here is terminal for it, which is the right outcome for a
    // presentation at the wrong resource.
    if (!grantAllowsResource(rotated.grant.resource, resource)) {
      return oauthError("invalid_grant", "Refresh token was issued for a different resource.");
    }

    return tokenResponse(
      signAccessToken(
        buildClaims(
          rotated.grant.uid,
          rotated.grant.scope,
          client.clientId,
          origin,
          rotated.grant.resource,
        ),
        secret,
      ),
      rotated.nextToken,
      rotated.grant.scope,
    );
  }

  return oauthError("unsupported_grant_type", `Unsupported grant_type: ${grantType ?? "(none)"}`);
}

function buildClaims(
  uid: string,
  scope: string,
  clientId: string,
  origin: string,
  resource: string,
) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: uid,
    iss: origin,
    aud: resource,
    client_id: clientId,
    scope,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL_SECONDS,
  };
}

async function issueTokens(
  uid: string,
  scope: string,
  clientId: string,
  origin: string,
  resource: string,
  secret: string,
) {
  const accessToken = signAccessToken(buildClaims(uid, scope, clientId, origin, resource), secret);
  const refreshToken = await issueRefreshToken({ clientId, uid, scope, resource });
  return tokenResponse(accessToken, refreshToken, scope);
}

function tokenResponse(accessToken: string, refreshToken: string, scope: string) {
  return Response.json(
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope,
    },
    // Tokens must never be cached by any intermediary.
    { headers: { "cache-control": "no-store", pragma: "no-cache" } },
  );
}

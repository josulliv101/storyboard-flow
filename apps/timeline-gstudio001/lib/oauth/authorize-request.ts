import { MCP_SCOPE, isRegisteredRedirectUri, safeEqual, type OAuthClient } from "./core";

// Validation for the authorization request, shared by the consent page and the
// POST that issues the code — they must agree exactly, or a request the page
// showed as safe could be issued under different terms.

export type AuthorizeParams = Readonly<{
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
}>;

export type AuthorizeValidation =
  /** Safe to show consent for. */
  | Readonly<{ ok: true; params: AuthorizeParams }>
  /**
   * FATAL: the client or redirect_uri itself is untrustworthy, so we must NOT
   * redirect — bouncing to an unverified redirect_uri is exactly how an open
   * redirector leaks codes. Render the error to the user instead (RFC 6749 §4.1.2.1).
   */
  | Readonly<{ ok: false; redirectable: false; description: string }>
  /** Recoverable: redirect back to the verified redirect_uri with ?error=. */
  | Readonly<{
      ok: false;
      redirectable: true;
      redirectUri: string;
      state: string | null;
      error: string;
      description: string;
    }>;

export function validateAuthorizeRequest(
  query: URLSearchParams,
  client: OAuthClient,
): AuthorizeValidation {
  const clientId = query.get("client_id") ?? "";
  const redirectUri = query.get("redirect_uri") ?? "";

  // These two are validated FIRST and are fatal — everything after may safely
  // report errors by redirecting, because the destination is now trusted.
  if (!clientId || !safeEqual(clientId, client.clientId)) {
    return { ok: false, redirectable: false, description: "Unknown client_id." };
  }
  if (!redirectUri || !isRegisteredRedirectUri(redirectUri, client.redirectUris)) {
    return {
      ok: false,
      redirectable: false,
      description: "redirect_uri is not registered for this client.",
    };
  }

  const state = query.get("state");
  const fail = (error: string, description: string): AuthorizeValidation => ({
    ok: false,
    redirectable: true,
    redirectUri,
    state,
    error,
    description,
  });

  if (query.get("response_type") !== "code") {
    return fail("unsupported_response_type", "Only response_type=code is supported.");
  }

  const codeChallenge = query.get("code_challenge") ?? "";
  const codeChallengeMethod = query.get("code_challenge_method") ?? "";
  if (!codeChallenge) {
    // PKCE is mandatory in OAuth 2.1 — a missing challenge is refused rather
    // than treated as a legacy plain-code request.
    return fail("invalid_request", "code_challenge is required (PKCE).");
  }
  if (codeChallengeMethod !== "S256") {
    return fail("invalid_request", "code_challenge_method must be S256.");
  }

  const requested = query.get("scope");
  if (requested && requested.split(/\s+/).some((s) => s && s !== MCP_SCOPE)) {
    return fail("invalid_scope", `Only the "${MCP_SCOPE}" scope is available.`);
  }

  return {
    ok: true,
    params: {
      clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
      scope: MCP_SCOPE,
    },
  };
}

/** Build the error redirect for a recoverable failure. */
export function errorRedirectUrl(
  redirectUri: string,
  error: string,
  description: string,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

/** Build the success redirect carrying the authorization code. */
export function successRedirectUrl(
  redirectUri: string,
  code: string,
  state: string | null,
): string {
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

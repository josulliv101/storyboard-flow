import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Pure OAuth 2.1 primitives for the MCP authorization server. No I/O, no
// Firebase, no Next — so every security-critical rule here unit-tests directly.
//
// HS256 is hand-rolled on node:crypto rather than pulling in `jose`: that
// package is what broke the Vercel deploy (pure-ESM v6 required from CJS), and
// a symmetric JWT is small enough that owning it beats re-entering that
// minefield. If this ever needs asymmetric keys for third-party verifiers,
// revisit — but the only verifier is this same server.

export type AccessTokenClaims = Readonly<{
  /** Firebase uid the token acts as. */
  sub: string;
  /** Issuer — this deployment's origin. */
  iss: string;
  /** Audience — the MCP resource URL. Bound so a token minted for one
   *  resource can't be replayed at another (RFC 8707 resource indicators). */
  aud: string;
  /** OAuth client the token was issued to. */
  client_id: string;
  scope: string;
  /** Seconds since epoch. */
  iat: number;
  exp: number;
}>;

const B64URL = { pad: /=+$/, plus: /\+/g, slash: /\//g } as const;

export function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(B64URL.pad, "")
    .replace(B64URL.plus, "-")
    .replace(B64URL.slash, "_");
}

function base64urlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64");
}

/** Constant-time string compare that doesn't leak length via early return. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Cryptographically random opaque token (codes, refresh tokens, secrets). */
export function randomToken(bytes = 32): string {
  return base64url(randomBytes(bytes));
}

/** Store secrets hashed — a leaked Firestore read must not yield usable tokens. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// --- PKCE ------------------------------------------------------------------

/**
 * Verify a PKCE code_verifier against the stored challenge.
 *
 * **S256 only.** OAuth 2.1 forbids `plain`, so an unknown or absent method is
 * rejected rather than defaulted — defaulting to `plain` is the classic PKCE
 * downgrade. The verifier's own charset/length rules (RFC 7636 §4.1) are
 * enforced too: an over-short verifier would make the challenge guessable.
 */
export function verifyPkce(
  codeVerifier: string,
  codeChallenge: string,
  method: string,
): boolean {
  if (method !== "S256") return false;
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
  if (!/^[A-Za-z0-9\-._~]+$/.test(codeVerifier)) return false;
  const computed = base64url(createHash("sha256").update(codeVerifier).digest());
  return safeEqual(computed, codeChallenge);
}

// --- Redirect URIs ---------------------------------------------------------

/**
 * OAuth 2.1 requires EXACT redirect-URI matching — no prefix or wildcard
 * matching, which is how open redirectors turn into token theft.
 */
export function isRegisteredRedirectUri(
  candidate: string,
  registered: readonly string[],
): boolean {
  return registered.some((uri) => uri === candidate);
}

// --- Access tokens (HS256 JWT) ---------------------------------------------

function signingInput(header: string, payload: string): string {
  return `${header}.${payload}`;
}

function hmac(input: string, secret: string): string {
  return base64url(createHmac("sha256", secret).update(input).digest());
}

export function signAccessToken(claims: AccessTokenClaims, secret: string): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify(claims));
  return `${signingInput(header, payload)}.${hmac(signingInput(header, payload), secret)}`;
}

export type VerifyResult =
  | Readonly<{ ok: true; claims: AccessTokenClaims }>
  | Readonly<{ ok: false; reason: "malformed" | "bad-signature" | "expired" | "wrong-audience" }>;

/**
 * Verify and decode an access token.
 *
 * Signature is checked BEFORE any claim is trusted, and `alg` is pinned to
 * HS256 from our own header rather than read from the token — honouring a
 * token-supplied `alg` is the `alg: "none"` / algorithm-confusion attack.
 */
export function verifyAccessToken(
  token: string,
  secret: string,
  expectedAudience: string,
  now = Math.floor(Date.now() / 1000),
): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [header, payload, signature] = parts;

  if (!safeEqual(hmac(signingInput(header, payload), secret), signature)) {
    return { ok: false, reason: "bad-signature" };
  }

  let claims: AccessTokenClaims;
  try {
    claims = JSON.parse(base64urlDecode(payload).toString("utf8")) as AccessTokenClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (typeof claims.exp !== "number" || typeof claims.sub !== "string" || !claims.sub) {
    return { ok: false, reason: "malformed" };
  }
  if (claims.exp <= now) return { ok: false, reason: "expired" };
  if (claims.aud !== expectedAudience) return { ok: false, reason: "wrong-audience" };

  return { ok: true, claims };
}

// --- Client registry -------------------------------------------------------

/** Just the string map these readers need — `process.env` satisfies it, and so
 *  does a test fixture, without demanding the full NodeJS.ProcessEnv shape. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

export type OAuthClient = Readonly<{
  clientId: string;
  /** Hashed comparison only; never logged or echoed. */
  clientSecret: string;
  redirectUris: readonly string[];
}>;

/**
 * The single registered client, from env. Dynamic Client Registration is
 * deliberately NOT implemented: Claude also accepts operator-provided
 * credentials, so a static client avoids exposing an unauthenticated
 * registration endpoint on a personal deployment.
 *
 * `MCP_OAUTH_REDIRECT_URIS` is comma-separated and matched exactly.
 */
export function loadClient(env: EnvLike = process.env): OAuthClient | null {
  const clientId = env.MCP_OAUTH_CLIENT_ID?.trim();
  const clientSecret = env.MCP_OAUTH_CLIENT_SECRET?.trim();
  const redirectUris = (env.MCP_OAUTH_REDIRECT_URIS ?? "")
    .split(",")
    .map((uri) => uri.trim())
    .filter(Boolean);

  if (!clientId || !clientSecret || redirectUris.length === 0) return null;
  return { clientId, clientSecret, redirectUris };
}

export function getSigningSecret(env: EnvLike = process.env): string | null {
  const secret = env.MCP_OAUTH_SIGNING_SECRET?.trim();
  // Short secrets make HS256 brute-forceable; refuse rather than warn.
  return secret && secret.length >= 32 ? secret : null;
}

/** Auth codes are single-use and short-lived; 60s is ample for a redirect. */
export const AUTH_CODE_TTL_SECONDS = 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
export const MCP_SCOPE = "timelines:read";

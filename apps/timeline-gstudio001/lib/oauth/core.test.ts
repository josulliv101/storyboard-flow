import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  base64url,
  getSigningSecret,
  grantAllowsResource,
  isRegisteredRedirectUri,
  loadClient,
  safeEqual,
  signAccessToken,
  verifyAccessToken,
  verifyPkce,
  type AccessTokenClaims,
} from "./core";

const SECRET = "x".repeat(48);
const AUDIENCE = "https://example.test/api/mcp";

function challengeFor(verifier: string) {
  return base64url(createHash("sha256").update(verifier).digest());
}

function claims(overrides: Partial<AccessTokenClaims> = {}): AccessTokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: "uid-123",
    iss: "https://example.test",
    aud: AUDIENCE,
    client_id: "client-abc",
    scope: "timelines:read",
    iat: now,
    exp: now + 3600,
    ...overrides,
  };
}

describe("verifyPkce", () => {
  const verifier = "a".repeat(64);
  const challenge = challengeFor(verifier);

  it("accepts a correct S256 verifier", () => {
    expect(verifyPkce(verifier, challenge, "S256")).toBe(true);
  });

  it("rejects a wrong verifier", () => {
    expect(verifyPkce("b".repeat(64), challenge, "S256")).toBe(false);
  });

  it("rejects the `plain` method — OAuth 2.1 forbids it (downgrade attack)", () => {
    // Even when verifier === challenge, which is what `plain` would accept.
    expect(verifyPkce(verifier, verifier, "plain")).toBe(false);
  });

  it("rejects an absent/unknown method rather than defaulting", () => {
    expect(verifyPkce(verifier, challenge, "")).toBe(false);
    expect(verifyPkce(verifier, challenge, "S512")).toBe(false);
  });

  it("enforces RFC 7636 verifier length bounds", () => {
    const short = "a".repeat(42);
    expect(verifyPkce(short, challengeFor(short), "S256")).toBe(false);
    const long = "a".repeat(129);
    expect(verifyPkce(long, challengeFor(long), "S256")).toBe(false);
  });

  it("rejects verifiers with characters outside the allowed set", () => {
    const bad = "a".repeat(60) + "!@#$";
    expect(verifyPkce(bad, challengeFor(bad), "S256")).toBe(false);
  });
});

describe("isRegisteredRedirectUri", () => {
  const registered = ["https://claude.ai/api/mcp/auth_callback"];

  it("accepts an exact match", () => {
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback", registered)).toBe(true);
  });

  it("rejects prefix / suffix variations (open-redirect vectors)", () => {
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp/auth_callback/evil", registered)).toBe(false);
    expect(isRegisteredRedirectUri("https://claude.ai/api/mcp", registered)).toBe(false);
    expect(isRegisteredRedirectUri("https://evil.test/api/mcp/auth_callback", registered)).toBe(false);
    expect(isRegisteredRedirectUri("https://claude.ai.evil.test/api/mcp/auth_callback", registered)).toBe(false);
  });
});

describe("access tokens", () => {
  it("round-trips a signed token", () => {
    const token = signAccessToken(claims(), SECRET);
    const result = verifyAccessToken(token, SECRET, AUDIENCE);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.claims.sub).toBe("uid-123");
  });

  it("rejects a tampered payload", () => {
    const token = signAccessToken(claims(), SECRET);
    const [header, , signature] = token.split(".");
    const forged = base64url(JSON.stringify(claims({ sub: "someone-else" })));
    const result = verifyAccessToken(`${header}.${forged}.${signature}`, SECRET, AUDIENCE);
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects a token signed with a different secret", () => {
    const token = signAccessToken(claims(), "y".repeat(48));
    expect(verifyAccessToken(token, SECRET, AUDIENCE)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects an expired token", () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = signAccessToken(claims({ exp: past }), SECRET);
    expect(verifyAccessToken(token, SECRET, AUDIENCE)).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a token minted for a different audience (no cross-resource replay)", () => {
    const token = signAccessToken(claims({ aud: "https://other.test/api/mcp" }), SECRET);
    expect(verifyAccessToken(token, SECRET, AUDIENCE)).toEqual({ ok: false, reason: "wrong-audience" });
  });

  it("rejects an alg:none token (algorithm confusion)", () => {
    const header = base64url(JSON.stringify({ alg: "none", typ: "JWT" }));
    const payload = base64url(JSON.stringify(claims()));
    // Unsigned, and with an empty signature segment.
    expect(verifyAccessToken(`${header}.${payload}.`, SECRET, AUDIENCE).ok).toBe(false);
    expect(verifyAccessToken(`${header}.${payload}`, SECRET, AUDIENCE)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects malformed input", () => {
    expect(verifyAccessToken("not-a-token", SECRET, AUDIENCE)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("grantAllowsResource", () => {
  it("allows a grant redeemed at the resource it was issued for", () => {
    expect(grantAllowsResource(AUDIENCE, AUDIENCE)).toBe(true);
  });

  it("refuses a grant presented at a different resource", () => {
    // The whole point of the binding: a code or refresh token minted for one
    // deployment must not mint a token audienced at another. Both sides of the
    // comparison used to be recomputed from the live request, so this pair
    // silently passed.
    expect(grantAllowsResource(AUDIENCE, "https://evil.test/api/mcp")).toBe(false);
  });

  it("refuses a grant that records no resource at all", () => {
    // An absent binding is not a wildcard. A stored grant predating the field
    // needs one re-authorization rather than 30 days of unbound refreshes.
    expect(grantAllowsResource(undefined, AUDIENCE)).toBe(false);
  });

  it("does not treat an empty string as a match for anything", () => {
    expect(grantAllowsResource("", AUDIENCE)).toBe(false);
    expect(grantAllowsResource(undefined, "")).toBe(false);
  });

  it("is exact — no prefix or host-suffix matching", () => {
    // Same trap as redirect-uri matching: a prefix rule turns
    // `https://app.test/api/mcp` into a licence for `https://app.test.evil/`.
    expect(grantAllowsResource(AUDIENCE, `${AUDIENCE}/extra`)).toBe(false);
    expect(grantAllowsResource("https://example.test", AUDIENCE)).toBe(false);
  });
});

describe("safeEqual", () => {
  it("compares by value and rejects length mismatch without throwing", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});

describe("config loading", () => {
  it("returns null unless every client field is present", () => {
    expect(loadClient({})).toBeNull();
    expect(
      loadClient({ MCP_OAUTH_CLIENT_ID: "a", MCP_OAUTH_CLIENT_SECRET: "b" }),
    ).toBeNull();
  });

  it("parses a comma-separated redirect list", () => {
    const client = loadClient({
      MCP_OAUTH_CLIENT_ID: "a",
      MCP_OAUTH_CLIENT_SECRET: "b",
      MCP_OAUTH_REDIRECT_URIS: "https://one.test/cb, https://two.test/cb",
    });
    expect(client?.redirectUris).toEqual(["https://one.test/cb", "https://two.test/cb"]);
  });

  it("refuses a signing secret that is too short to be safe", () => {
    expect(getSigningSecret({ MCP_OAUTH_SIGNING_SECRET: "short" })).toBeNull();
    expect(getSigningSecret({ MCP_OAUTH_SIGNING_SECRET: SECRET })).toBe(SECRET);
  });
});

import { describe, expect, it } from "vitest";

import { successRedirectUrl, validateAuthorizeRequest } from "./authorize-request";
import type { OAuthClient } from "./core";

const CLIENT: OAuthClient = {
  clientId: "client-abc",
  clientSecret: "secret",
  redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
};

function query(overrides: Record<string, string | null> = {}) {
  const base: Record<string, string> = {
    client_id: CLIENT.clientId,
    redirect_uri: CLIENT.redirectUris[0],
    response_type: "code",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    state: "xyz",
  };
  const params = new URLSearchParams(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return params;
}

describe("validateAuthorizeRequest", () => {
  it("accepts a well-formed request and normalizes scope", () => {
    const result = validateAuthorizeRequest(query(), CLIENT);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.params.scope).toBe("timelines:read");
      expect(result.params.state).toBe("xyz");
    }
  });

  // The core security rule: an untrusted client/redirect must NOT be
  // redirected to, or the endpoint becomes an open redirector that leaks codes.
  it("treats an unknown client_id as FATAL (never redirects)", () => {
    const result = validateAuthorizeRequest(query({ client_id: "someone-else" }), CLIENT);
    expect(result).toMatchObject({ ok: false, redirectable: false });
  });

  it("treats an unregistered redirect_uri as FATAL (never redirects)", () => {
    const result = validateAuthorizeRequest(
      query({ redirect_uri: "https://evil.test/steal" }),
      CLIENT,
    );
    expect(result).toMatchObject({ ok: false, redirectable: false });
  });

  it("treats a near-miss redirect_uri as FATAL (no prefix matching)", () => {
    const result = validateAuthorizeRequest(
      query({ redirect_uri: `${CLIENT.redirectUris[0]}/extra` }),
      CLIENT,
    );
    expect(result).toMatchObject({ ok: false, redirectable: false });
  });

  it("reports other failures as redirectable errors, preserving state", () => {
    for (const [overrides, error] of [
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ code_challenge: null }, "invalid_request"],
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ scope: "timelines:write" }, "invalid_scope"],
    ] as const) {
      const result = validateAuthorizeRequest(query(overrides), CLIENT);
      expect(result).toMatchObject({
        ok: false,
        redirectable: true,
        error,
        state: "xyz",
        redirectUri: CLIENT.redirectUris[0],
      });
    }
  });

  it("rejects a missing PKCE challenge rather than allowing a non-PKCE flow", () => {
    const result = validateAuthorizeRequest(query({ code_challenge: null }), CLIENT);
    expect(result.ok).toBe(false);
  });

  it("handles an absent state without inventing one", () => {
    const result = validateAuthorizeRequest(query({ state: null }), CLIENT);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.params.state).toBeNull();
  });
});

describe("successRedirectUrl", () => {
  it("appends code and state without clobbering existing query params", () => {
    const url = successRedirectUrl("https://claude.ai/cb?keep=1", "the-code", "xyz");
    const parsed = new URL(url);
    expect(parsed.searchParams.get("code")).toBe("the-code");
    expect(parsed.searchParams.get("state")).toBe("xyz");
    expect(parsed.searchParams.get("keep")).toBe("1");
  });

  it("omits state when there was none", () => {
    const parsed = new URL(successRedirectUrl("https://claude.ai/cb", "the-code", null));
    expect(parsed.searchParams.has("state")).toBe(false);
  });
});

import { afterEach, describe, expect, it } from "vitest";

import {
  authorizationServerMetadata,
  mcpResourceUrl,
  metadataHeaders,
  originFromRequest,
  resolveIssuerOrigin,
} from "./metadata";

// #335. The advertised origin came from `x-forwarded-host` — a header the
// CLIENT sets — and the discovery documents carrying it were served
// `public, max-age=300` with no `Vary`, so the cache key was the path alone.
// One poisoned request could park a document naming an attacker's
// `token_endpoint` in any shared cache in front of the app.
//
// The same header also fed the token AUDIENCE, which is the sharper half: the
// mint and the check both derived it the same way, so the comparison was an
// attacker's value against the same attacker's value.

const POISONED = new Request("https://real.example/.well-known/oauth-authorization-server", {
  headers: { "x-forwarded-host": "evil.example", "x-forwarded-proto": "https" },
});

const ORIGINAL = process.env.MCP_OAUTH_ISSUER;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MCP_OAUTH_ISSUER;
  else process.env.MCP_OAUTH_ISSUER = ORIGINAL;
});

describe("resolveIssuerOrigin", () => {
  it("ignores a poisoned header when the issuer is pinned", () => {
    process.env.MCP_OAUTH_ISSUER = "https://real.example";

    const resolved = resolveIssuerOrigin(POISONED);

    expect(resolved).toEqual({ origin: "https://real.example", pinned: true });
    // The whole point: the endpoints a client would be sent to.
    const metadata = authorizationServerMetadata(resolved.origin);
    expect(metadata.token_endpoint).toBe("https://real.example/api/oauth/token");
    expect(metadata.authorization_endpoint).toBe("https://real.example/oauth/authorize");
  });

  it("normalizes a pinned issuer to its origin", () => {
    // A trailing path or slash in the env var must not end up doubled inside
    // every advertised endpoint.
    process.env.MCP_OAUTH_ISSUER = "https://real.example/some/path";

    expect(resolveIssuerOrigin(POISONED).origin).toBe("https://real.example");
  });

  it("falls back to the request — UNPINNED — when nothing is configured", () => {
    delete process.env.MCP_OAUTH_ISSUER;

    const resolved = resolveIssuerOrigin(POISONED);

    // Still derived, because local dev and previews need it. The protection is
    // that `pinned: false` forces `no-store` below, so a derived origin can
    // never be cached and handed to someone else.
    expect(resolved).toEqual({ origin: "https://evil.example", pinned: false });
  });

  it("falls back rather than throwing on a malformed pin, and does not claim pinned", () => {
    // A typo in an env var must not take the deployment down — but it must
    // also not leave an operator believing the pin took effect.
    process.env.MCP_OAUTH_ISSUER = "not a url";

    expect(resolveIssuerOrigin(POISONED)).toEqual({
      origin: "https://evil.example",
      pinned: false,
    });
  });

  it("refuses a non-http scheme", () => {
    process.env.MCP_OAUTH_ISSUER = "javascript:alert(1)";

    expect(resolveIssuerOrigin(POISONED).pinned).toBe(false);
  });

  it("still reads the header directly — that is why callers must not", () => {
    // Pinning is the caller's decision, made in resolveIssuerOrigin. This
    // helper stays honest about what it does.
    expect(originFromRequest(POISONED)).toBe("https://evil.example");
  });
});

describe("metadataHeaders", () => {
  it("caches only a pinned origin", () => {
    expect(metadataHeaders(true)["cache-control"]).toBe("public, max-age=300");
  });

  it("refuses to cache a request-derived origin", () => {
    // The combination that made poisoning worth doing: a body that depends on
    // a header, stored under a key that ignores it.
    expect(metadataHeaders(false)["cache-control"]).toBe("no-store");
  });

  it("varies on the headers the body can depend on, either way", () => {
    for (const pinned of [true, false]) {
      expect(metadataHeaders(pinned).vary).toContain("X-Forwarded-Host");
      expect(metadataHeaders(pinned).vary).toContain("Host");
    }
  });
});

describe("the audience bound to a token", () => {
  it("is a per-deployment constant once pinned, not the caller's own header", () => {
    process.env.MCP_OAUTH_ISSUER = "https://real.example";

    const minted = mcpResourceUrl(resolveIssuerOrigin(POISONED).origin);
    const checked = mcpResourceUrl(
      resolveIssuerOrigin(
        new Request("https://real.example/api/mcp", {
          headers: { "x-forwarded-host": "other.example" },
        }),
      ).origin,
    );

    // Two different poisoned headers, one audience. Unpinned these would each
    // have echoed their own header and matched trivially, which is what made
    // the replay guard vacuous.
    expect(minted).toBe("https://real.example/api/mcp");
    expect(checked).toBe(minted);
  });
});

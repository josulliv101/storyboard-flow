import { afterEach, describe, expect, it } from "vitest";

import { allowedEmails, isEmailAllowed } from "./auth-allowlist";

const ENV_KEY = "AUTH_ALLOWED_EMAILS";
const original = process.env[ENV_KEY];

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

const withList = (value: string | undefined) => {
  if (value === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = value;
};

describe("when the list is not set", () => {
  // The default has to be OPEN, and this pins why: local development, the
  // Playwright suite and every preview deployment run without the variable,
  // and a default of "deny everyone" would lock all three out.
  it("allows anyone", () => {
    withList(undefined);
    expect(allowedEmails()).toBeNull();
    expect(isEmailAllowed("anyone@example.test")).toBe(true);
    expect(isEmailAllowed(null)).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["only whitespace", "   "],
    ["only separators", " , , "],
  ])("treats %s as not set, rather than as deny-all", (_name, value) => {
    withList(value);
    // A variable set to nothing is a deployment accident. Reading it as "no
    // address may sign in" turns a typo into an outage nobody can undo from
    // the outside — including the owner.
    expect(allowedEmails()).toBeNull();
    expect(isEmailAllowed("anyone@example.test")).toBe(true);
  });
});

describe("when the list is set", () => {
  it("admits an address on it and refuses one that is not", () => {
    withList("owner@example.test");
    expect(isEmailAllowed("owner@example.test")).toBe(true);
    expect(isEmailAllowed("stranger@example.test")).toBe(false);
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    // Nobody types a comma-separated list tidily, and an address is not
    // case-sensitive in a way anyone relies on.
    withList("  Owner@Example.test ,  second@example.test  ");
    expect(isEmailAllowed("owner@EXAMPLE.TEST")).toBe(true);
    expect(isEmailAllowed(" second@example.test ")).toBe(true);
  });

  it("refuses a missing address rather than defaulting to allowed", () => {
    // A session token without an email reaches `getAuthUser`; it must not
    // pass a list it cannot be checked against.
    withList("owner@example.test");
    expect(isEmailAllowed(null)).toBe(false);
    expect(isEmailAllowed(undefined)).toBe(false);
    expect(isEmailAllowed("")).toBe(false);
  });

  it("does NOT match a domain or a prefix", () => {
    // The list is short and personal. "@example.test" is not an allowlist,
    // and a substring match would make "owner@example.test.evil.com" pass.
    withList("owner@example.test");
    expect(isEmailAllowed("owner@example.test.evil.test")).toBe(false);
    expect(isEmailAllowed("notowner@example.test")).toBe(false);
    expect(isEmailAllowed("@example.test")).toBe(false);
  });

  it("refuses the account that actually turned up", () => {
    // 2026-08-14: a stranger signed in, made a project called "gggg" and five
    // empty timelines. Ownership kept them out of everyone else's work; this
    // keeps them out of the door.
    withList("josulliv101@gmail.com");
    expect(isEmailAllowed("josulliv101@gmail.com")).toBe(true);
    expect(isEmailAllowed("someone.else@gmail.com")).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { bootSessionKey } from "./boot-session-key";

describe("bootSessionKey", () => {
  it("is stable for the same uid + projectId (ordinary renders / drill-in must not remount)", () => {
    expect(bootSessionKey("user-a", "proj-1")).toBe(bootSessionKey("user-a", "proj-1"));
  });

  it("changes when the signed-in user changes (soft account switch remounts)", () => {
    expect(bootSessionKey("user-a", "proj-1")).not.toBe(bootSessionKey("user-b", "proj-1"));
  });

  it("changes when the project changes", () => {
    expect(bootSessionKey("user-a", "proj-1")).not.toBe(bootSessionKey("user-a", "proj-2"));
  });

  it("distinguishes a signed-out (null uid) session from a signed-in one", () => {
    expect(bootSessionKey(null, "proj-1")).not.toBe(bootSessionKey("", "proj-1"));
    expect(bootSessionKey(null, "proj-1")).toBe(bootSessionKey(null, "proj-1"));
  });

  it("defaults the generation, so existing two-argument callers are unaffected", () => {
    expect(bootSessionKey("user-a", "proj-1")).toBe(bootSessionKey("user-a", "proj-1", 0));
  });

  it("changes when the generation is bumped (a permanent trash empty remounts)", () => {
    expect(bootSessionKey("user-a", "proj-1", 1)).not.toBe(bootSessionKey("user-a", "proj-1"));
    expect(bootSessionKey("user-a", "proj-1", 1)).toBe(bootSessionKey("user-a", "proj-1", 1));
  });

  it("does not let a separator inside either value forge a different pairing", () => {
    // Without encoding, ("a:b", "c") and ("a", "b:c") would both stringify to
    // "a:b:c" and collide.
    expect(bootSessionKey("a:b", "c")).not.toBe(bootSessionKey("a", "b:c"));
  });
});

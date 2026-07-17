import { describe, expect, it } from "vitest";

import { checkUserScopedId, resolveOwnership } from "./timeline-ownership";

describe("resolveOwnership", () => {
  it("owns records stamped with the requester's uid", () => {
    expect(resolveOwnership("user-a", "user-a")).toBe("owned");
  });

  it("denies records stamped with another uid", () => {
    expect(resolveOwnership("user-b", "user-a")).toBe("denied");
  });

  it("claims legacy records with no owner", () => {
    expect(resolveOwnership(undefined, "user-a")).toBe("claim");
    expect(resolveOwnership(null, "user-a")).toBe("claim");
    expect(resolveOwnership("", "user-a")).toBe("claim");
  });
});

describe("checkUserScopedId", () => {
  it("passes the requester's own trash and asset-library ids", () => {
    expect(checkUserScopedId("trash-user-a", "user-a")).toBe(true);
    expect(checkUserScopedId("asset-library-user-a", "user-a")).toBe(true);
    expect(checkUserScopedId("asset-library-col-user-a-Zm9sZGVy", "user-a")).toBe(true);
  });

  it("rejects another user's scoped ids", () => {
    expect(checkUserScopedId("trash-user-b", "user-a")).toBe(false);
    expect(checkUserScopedId("asset-library-user-b", "user-a")).toBe(false);
    expect(checkUserScopedId("asset-library-col-user-b-Zm9sZGVy", "user-a")).toBe(false);
  });

  it("rejects prefix-forged ids (a uid that PREFIXES the requester's)", () => {
    // trash-user-a is NOT a valid id for a user whose uid is "user-a2".
    expect(checkUserScopedId("trash-user-a", "user-a2")).toBe(false);
    expect(checkUserScopedId("asset-library-col-user-a-x", "user-a2")).toBe(false);
  });

  it("returns null for ids that carry no embedded owner", () => {
    expect(checkUserScopedId("project-123", "user-a")).toBeNull();
    expect(checkUserScopedId("timeline-abc", "user-a")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { trashDocumentId } from "./trash-document-id";

describe("trashDocumentId", () => {
  it("derives the trash id for a signed-in uid", () => {
    expect(trashDocumentId("user-a")).toBe("trash-user-a");
  });

  it("is null only when signed out (null uid)", () => {
    expect(trashDocumentId(null)).toBeNull();
  });

  it("keeps an empty-string uid signed in (not collapsed onto signed-out)", () => {
    // Regression: a truthiness check turned uid === "" into null, so the boot
    // effect returned early and the graph never left loading for that user.
    expect(trashDocumentId("")).toBe("trash-");
    expect(trashDocumentId("")).not.toBeNull();
  });
});

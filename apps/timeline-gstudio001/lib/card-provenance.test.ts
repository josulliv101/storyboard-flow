import { describe, expect, it } from "vitest";

import { resolveCardProvenance } from "./card-provenance";

// #281: this decision lived inside `useCardProvenance`, and the app's vitest
// cannot parse `.tsx` — so the resolution order and both null rules had never
// been tested.

describe("resolveCardProvenance", () => {
  it("labels a card whose parent is NOT the focused collection", () => {
    expect(
      resolveCardProvenance({
        parentId: "scene-b",
        focusedId: "project",
        title: "Scene B",
        nodeName: "scene-b node",
      }),
    ).toEqual({ parentId: "scene-b", name: "Scene B" });
  });

  it("says nothing when the parent IS the focused collection", () => {
    // The flat-run rule that needs no mode flag: in a nested strip every
    // card's parent is the focused one, so this branch silences them all.
    expect(
      resolveCardProvenance({
        parentId: "project",
        focusedId: "project",
        title: "Project",
        nodeName: "project",
      }),
    ).toBeNull();
  });

  it("says nothing for a root card, which has no parent to name", () => {
    expect(
      resolveCardProvenance({ parentId: null, focusedId: "project", title: null, nodeName: null }),
    ).toBeNull();
  });

  it("says nothing before a focus is known", () => {
    expect(
      resolveCardProvenance({ parentId: "scene-b", focusedId: null, title: "Scene B", nodeName: null }),
    ).toBeNull();
  });

  it("prefers the stored TITLE over the graph node's name", () => {
    // The order that makes a rename show up here. Reversed, a renamed
    // collection keeps its old name in this label while the breadcrumb and the
    // card itself show the new one.
    expect(
      resolveCardProvenance({
        parentId: "scene-b",
        focusedId: "project",
        title: "Renamed",
        nodeName: "Stale optimistic name",
      })?.name,
    ).toBe("Renamed");
  });

  it("falls back to the node name while the document is still loading", () => {
    expect(
      resolveCardProvenance({
        parentId: "scene-b",
        focusedId: "project",
        title: null,
        nodeName: "Optimistic",
      })?.name,
    ).toBe("Optimistic");
  });

  it("falls back to the id last, so the row never prints nothing", () => {
    expect(
      resolveCardProvenance({ parentId: "scene-b", focusedId: "project", title: null, nodeName: null })
        ?.name,
    ).toBe("scene-b");
  });

  it("carries the parent id through, so the label can navigate", () => {
    expect(
      resolveCardProvenance({
        parentId: "scene-b",
        focusedId: "project",
        title: "Scene B",
        nodeName: null,
      })?.parentId,
    ).toBe("scene-b");
  });
});

import { describe, expect, test } from "vitest";
import {
  getKeyboardReorderAction,
  resolveKeyboardReorderAction,
  IDLE_INTERCEPTED_KEYS,
  SESSION_INTERCEPTED_KEYS,
} from "./media-strip.keyboard";
import {
  trustedCollectionId,
  trustedTimelineItemId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItem,
  type TimelineItemId,
} from "./media-strip.types";

describe("getKeyboardReorderAction", () => {
  test("returns null for any key when idle (no active session)", () => {
    expect(getKeyboardReorderAction("ArrowLeft", false)).toBeNull();
    expect(getKeyboardReorderAction("Enter", false)).toBeNull();
    expect(getKeyboardReorderAction("n", false)).toBeNull();
  });

  test("maps arrow keys to move actions during an active session", () => {
    expect(getKeyboardReorderAction("ArrowLeft", true)).toBe("move-left");
    expect(getKeyboardReorderAction("ArrowRight", true)).toBe("move-right");
    expect(getKeyboardReorderAction("ArrowUp", true)).toBe("move-up");
    expect(getKeyboardReorderAction("ArrowDown", true)).toBe("move-down");
  });

  test("maps Home/End to move-home/move-end", () => {
    expect(getKeyboardReorderAction("Home", true)).toBe("move-home");
    expect(getKeyboardReorderAction("End", true)).toBe("move-end");
  });

  test("maps 'n'/'N' to nest, case-insensitively", () => {
    expect(getKeyboardReorderAction("n", true)).toBe("nest");
    expect(getKeyboardReorderAction("N", true)).toBe("nest");
  });

  test("maps 'u'/'U' to move-to-parent, case-insensitively", () => {
    expect(getKeyboardReorderAction("u", true)).toBe("move-to-parent");
    expect(getKeyboardReorderAction("U", true)).toBe("move-to-parent");
  });

  test("maps Escape to cancel", () => {
    expect(getKeyboardReorderAction("Escape", true)).toBe("cancel");
  });

  test("maps Enter and Space to confirm", () => {
    expect(getKeyboardReorderAction("Enter", true)).toBe("confirm");
    expect(getKeyboardReorderAction(" ", true)).toBe("confirm");
  });

  test("returns null for keys with no session meaning", () => {
    expect(getKeyboardReorderAction("Tab", true)).toBeNull();
    expect(getKeyboardReorderAction("a", true)).toBeNull();
    expect(getKeyboardReorderAction("Backspace", true)).toBeNull();
  });
});

describe("IDLE_INTERCEPTED_KEYS / SESSION_INTERCEPTED_KEYS", () => {
  test("session keys are a superset of idle keys", () => {
    for (const key of IDLE_INTERCEPTED_KEYS) {
      expect(SESSION_INTERCEPTED_KEYS).toContain(key);
    }
  });

  test("session keys add the session-only controls", () => {
    expect(SESSION_INTERCEPTED_KEYS).toEqual(
      expect.arrayContaining(["Home", "End", "Escape", "n", "N", "u", "U"])
    );
  });

  test("idle keys don't include session-only controls", () => {
    expect(IDLE_INTERCEPTED_KEYS).not.toContain("Home");
    expect(IDLE_INTERCEPTED_KEYS).not.toContain("Escape");
    expect(IDLE_INTERCEPTED_KEYS).not.toContain("n");
  });
});

describe("resolveKeyboardReorderAction", () => {
  const itemA = { id: trustedTimelineItemId("item-a"), name: "Item A", kind: "image" } as TimelineItem;
  const itemB = { id: trustedTimelineItemId("item-b"), name: "Item B", kind: "image" } as TimelineItem;
  const itemC = { id: trustedTimelineItemId("item-c"), name: "Item C", kind: "image" } as TimelineItem;

  const folderItem = {
    id: trustedTimelineItemId("item-folder"),
    name: "Holiday Folder",
    kind: "collection",
    collectionId: trustedCollectionId("col-folder"),
    itemCount: 0,
  } as TimelineItem;

  // [A, B, C] in col-root, plus an empty col-target for cross-collection
  // move-up/move-down tests and an empty col-folder the folder item points
  // at (kept empty so nest/move-to-parent fixtures below can reuse it
  // without accidentally tripping the cycle check).
  const collectionsById = new Map<CollectionId, TimelineCollection>([
    [trustedCollectionId("col-root"), { id: trustedCollectionId("col-root"), name: "Root", items: [itemA, itemB, itemC] }],
    [trustedCollectionId("col-target"), { id: trustedCollectionId("col-target"), name: "Target", items: [itemA] }],
    [trustedCollectionId("col-folder"), { id: trustedCollectionId("col-folder"), name: "Folder", items: [] }],
  ]);

  const itemLookup = new Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>([
    [trustedTimelineItemId("item-a"), { collectionId: trustedCollectionId("col-root"), index: 0, item: itemA }],
    [trustedTimelineItemId("item-b"), { collectionId: trustedCollectionId("col-root"), index: 1, item: itemB }],
    [trustedTimelineItemId("item-c"), { collectionId: trustedCollectionId("col-root"), index: 2, item: itemC }],
    [trustedTimelineItemId("item-folder"), { collectionId: trustedCollectionId("col-root"), index: 0, item: folderItem }],
  ]);

  const noAdjacent = () => null;

  test("returns null when the item isn't in itemLookup", () => {
    const result = resolveKeyboardReorderAction({
      itemId: trustedTimelineItemId("nonexistent"),
      action: "move-left",
      itemLookup,
      collectionsById,
      parentByCollectionId: new Map(),
      getAdjacentCollectionId: noAdjacent,
    });
    expect(result).toBeNull();
  });

  test("returns null when the item's collection isn't in collectionsById", () => {
    const orphanItem = { id: trustedTimelineItemId("orphan"), name: "Orphan", kind: "image" } as TimelineItem;
    const orphanLookup = new Map(itemLookup).set(
      trustedTimelineItemId("orphan"),
      { collectionId: trustedCollectionId("col-missing"), index: 0, item: orphanItem }
    );
    const result = resolveKeyboardReorderAction({
      itemId: trustedTimelineItemId("orphan"),
      action: "move-left",
      itemLookup: orphanLookup,
      collectionsById,
      parentByCollectionId: new Map(),
      getAdjacentCollectionId: noAdjacent,
    });
    expect(result).toBeNull();
  });

  test("throws on an unrecognized action instead of silently returning undefined", () => {
    // A JS caller or a bad cast could hand this an action outside the union.
    // The assertNever guard turns that into a loud throw at the dispatch,
    // not a silent `undefined` flowing back to the session hook.
    expect(() =>
      resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-a"),
        action: "not-a-real-action" as never,
        itemLookup,
        collectionsById,
        parentByCollectionId: new Map(),
        getAdjacentCollectionId: noAdjacent,
      })
    ).toThrow();
  });

  describe("move-left / move-right", () => {
    test("moving the first item left is a boundary no-op with an announcement", () => {
      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-a"), action: "move-left", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({ kind: "no-op", announcement: "Already first in collection." });
    });

    test("moving a middle item left produces a same-collection move command", () => {
      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-b"), action: "move-left", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({
        kind: "move",
        command: { type: "move", itemId: trustedTimelineItemId("item-b"), fromCollectionId: trustedCollectionId("col-root"), toCollectionId: trustedCollectionId("col-root"), toIndex: 0 },
        announcement: 'Moved "Item B" to position 1.',
      });
    });

    test("moving the last item right is a boundary no-op with an announcement", () => {
      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-c"), action: "move-right", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({ kind: "no-op", announcement: "Already last in collection." });
    });
  });

  describe("move-home / move-end", () => {
    test("move-home when already first is a silent no-op (no announcement)", () => {
      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-a"), action: "move-home", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({ kind: "no-op" });
    });

    test("move-end when already last is a silent no-op (no announcement)", () => {
      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-c"), action: "move-end", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({ kind: "no-op" });
    });

    test("move-end on a non-last item moves it to the end of the collection", () => {
      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-a"), action: "move-end", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({
        kind: "move",
        command: { type: "move", itemId: trustedTimelineItemId("item-a"), fromCollectionId: trustedCollectionId("col-root"), toCollectionId: trustedCollectionId("col-root"), toIndex: 2 },
        announcement: 'Moved "Item A" to end of collection.',
      });
    });
  });

  describe("move-up / move-down", () => {
    test("no adjacent collection is a boundary no-op", () => {
      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-a"), action: "move-up", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({ kind: "no-op", announcement: "Already at the top collection." });

      const downResult = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-a"), action: "move-down", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(downResult).toEqual({ kind: "no-op", announcement: "Already at the bottom collection." });
    });

    test("moves to the adjacent collection, clamped to its length", () => {
      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-c"), action: "move-down", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: () => trustedCollectionId("col-target"),
      });
      // item-c's index (2) exceeds col-target's length (1), so it's clamped to 1.
      expect(result).toEqual({
        kind: "move",
        command: { type: "move", itemId: trustedTimelineItemId("item-c"), fromCollectionId: trustedCollectionId("col-root"), toCollectionId: trustedCollectionId("col-target"), toIndex: 1 },
        announcement: 'Moved "Item C" to collection "Target" at position 2.',
      });
    });

    test("rejects a move that would create a collection cycle", () => {
      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-folder"), action: "move-down", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: () => trustedCollectionId("col-folder"),
      });
      expect(result).toEqual({
        kind: "rejected",
        announcement: "Cannot move a collection into itself or one of its nested collections.",
      });
    });
  });

  describe("nest", () => {
    test("nests into the next item when it's a collection", () => {
      const items = [itemA, folderItem, itemC];
      const lookup = new Map(itemLookup)
        .set(trustedTimelineItemId("item-a"), { collectionId: trustedCollectionId("col-root"), index: 0, item: itemA })
        .set(trustedTimelineItemId("item-folder"), { collectionId: trustedCollectionId("col-root"), index: 1, item: folderItem })
        .set(trustedTimelineItemId("item-c"), { collectionId: trustedCollectionId("col-root"), index: 2, item: itemC });
      const cols = new Map(collectionsById).set(
        trustedCollectionId("col-root"), { id: trustedCollectionId("col-root"), name: "Root", items }
      );

      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-a"), action: "nest", itemLookup: lookup, collectionsById: cols,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({
        kind: "move",
        command: { type: "nest", itemId: trustedTimelineItemId("item-a"), fromCollectionId: trustedCollectionId("col-root"), targetCollectionId: trustedCollectionId("col-folder") },
        announcement: 'Moved "Item A" into collection "Holiday Folder".',
        endsSession: true,
      });
    });

    test("falls back to the previous item when the next one isn't a collection", () => {
      const items = [folderItem, itemB, itemC];
      const lookup = new Map(itemLookup)
        .set(trustedTimelineItemId("item-folder"), { collectionId: trustedCollectionId("col-root"), index: 0, item: folderItem })
        .set(trustedTimelineItemId("item-b"), { collectionId: trustedCollectionId("col-root"), index: 1, item: itemB })
        .set(trustedTimelineItemId("item-c"), { collectionId: trustedCollectionId("col-root"), index: 2, item: itemC });
      const cols = new Map(collectionsById).set(
        trustedCollectionId("col-root"), { id: trustedCollectionId("col-root"), name: "Root", items }
      );

      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-b"), action: "nest", itemLookup: lookup, collectionsById: cols,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({
        kind: "move",
        command: { type: "nest", itemId: trustedTimelineItemId("item-b"), fromCollectionId: trustedCollectionId("col-root"), targetCollectionId: trustedCollectionId("col-folder") },
        announcement: 'Moved "Item B" into collection "Holiday Folder".',
        endsSession: true,
      });
    });

    test("no adjacent collection to nest into is a no-op with an announcement", () => {
      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-b"), action: "nest", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({ kind: "no-op", announcement: "No adjacent collection to nest into." });
    });

    test("rejects nesting a collection into itself", () => {
      // A second card that also claims to represent col-folder, sitting
      // next to folderItem — nesting folderItem "into" it is exactly
      // wouldCreateCollectionCycle's movingCollectionId === targetCollectionId
      // shortcut (folderItem already represents col-folder).
      const selfPointingCard = {
        id: trustedTimelineItemId("card-self"), name: "Self", kind: "collection",
        collectionId: trustedCollectionId("col-folder"), itemCount: 0,
      } as TimelineItem;
      const items = [folderItem, selfPointingCard];
      const lookup = new Map(itemLookup)
        .set(trustedTimelineItemId("item-folder"), { collectionId: trustedCollectionId("col-root"), index: 0, item: folderItem })
        .set(trustedTimelineItemId("card-self"), { collectionId: trustedCollectionId("col-root"), index: 1, item: selfPointingCard });
      const cols = new Map(collectionsById).set(
        trustedCollectionId("col-root"), { id: trustedCollectionId("col-root"), name: "Root", items }
      );

      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-folder"), action: "nest", itemLookup: lookup, collectionsById: cols,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({
        kind: "rejected",
        announcement: "Cannot move a collection into itself or one of its nested collections.",
      });
    });
  });

  describe("move-to-parent", () => {
    test("at the root (no parent entry) is a no-op with an announcement", () => {
      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-a"), action: "move-to-parent", itemLookup, collectionsById,
        parentByCollectionId: new Map(), getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({ kind: "no-op", announcement: "Already at the top level; no parent collection to move out to." });
    });

    test("moves out to the parent, landing right after the anchor collection-item card", () => {
      // item-a lives in col-target; col-root's anchorCard represents
      // col-target's parent-edge. anchorIndex is anchorCard's position (0)
      // in col-root, so toIndex should be 1 (right after it), not 0 or
      // col-root.items.length.
      const anchorCard = {
        id: trustedTimelineItemId("card-col-target"),
        name: "Target Folder",
        kind: "collection",
        collectionId: trustedCollectionId("col-target"),
        itemCount: 1,
      } as TimelineItem;
      const parentByCollectionId = new Map([[trustedCollectionId("col-target"), trustedCollectionId("col-root")]]);
      const lookup = new Map(itemLookup).set(
        trustedTimelineItemId("item-a"), { collectionId: trustedCollectionId("col-target"), index: 0, item: itemA }
      );
      const cols = new Map(collectionsById).set(
        trustedCollectionId("col-root"), { id: trustedCollectionId("col-root"), name: "Root", items: [anchorCard, itemB] }
      );

      const result = resolveKeyboardReorderAction({
        itemId: trustedTimelineItemId("item-a"), action: "move-to-parent", itemLookup: lookup, collectionsById: cols,
        parentByCollectionId, getAdjacentCollectionId: noAdjacent,
      });
      expect(result).toEqual({
        kind: "move",
        command: { type: "move", itemId: trustedTimelineItemId("item-a"), fromCollectionId: trustedCollectionId("col-target"), toCollectionId: trustedCollectionId("col-root"), toIndex: 1 },
        announcement: 'Moved "Item A" out to collection "Root".',
        endsSession: true,
      });
    });
  });
});

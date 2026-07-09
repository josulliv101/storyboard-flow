import { describe, test, expect } from "vitest";
import {
  trustedTimelineItemId,
  trustedCollectionId,
  type TimelineCollection,
  type CollectionId,
  type TimelineItem,
  type TimelineItemResult,
  isCollectionItem,
} from "./media-strip.types";
import {
  createImageTimelineItem,
  createCollectionTimelineItem,
} from "./media-strip.validation";
import {
  applyTimelineItemCommand,
  syncCollectionItemCounts,
  type ApplyTimelineItemCommandResult,
} from "./media-strip.collection-ops";

function unwrap<T, E>(result: TimelineItemResult<T, E>): T {
  if (!result.ok) {
    throw new Error(`Test fixture failed to construct: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Unwraps a successful ApplyTimelineItemCommandResult, failing the test loudly otherwise. */
function expectApplied(
  result: ApplyTimelineItemCommandResult
): ReadonlyMap<CollectionId, TimelineCollection> {
  if (!result.ok) {
    throw new Error(`Expected command to apply, got rejected with reason: ${result.reason}`);
  }
  return result.collectionsById;
}

const makeImage = (id: string, name: string): TimelineItem =>
  unwrap(
    createImageTimelineItem({
      id,
      name,
      src: `${id}.png`,
      startTimeSeconds: 0,
      durationSeconds: 10,
    })
  );

const makeCollectionItem = (
  id: string,
  name: string,
  collectionId: string,
  itemCount = 0
): TimelineItem =>
  unwrap(
    createCollectionTimelineItem({
      id,
      name,
      collectionId,
      itemCount,
      startTimeSeconds: 0,
      durationSeconds: 10,
    })
  );

describe("applyTimelineItemCommand reducer", () => {
  const itemA = makeImage("item-a", "Item A");
  const itemB = makeImage("item-b", "Item B");
  const itemC = makeCollectionItem("item-col-nested", "Nested Folder", "col-nested");

  const initialCollections = new Map<CollectionId, TimelineCollection>([
    [
      trustedCollectionId("col-root"),
      {
        id: trustedCollectionId("col-root"),
        name: "Root",
        items: [itemA, itemB, itemC],
      },
    ],
    [
      trustedCollectionId("col-nested"),
      {
        id: trustedCollectionId("col-nested"),
        name: "Nested",
        items: [],
      },
    ],
    [
      trustedCollectionId("col-other"),
      {
        id: trustedCollectionId("col-other"),
        name: "Other Strip",
        items: [],
      },
    ],
  ]);

  test("move within same collection to the requested final index", () => {
    const result = expectApplied(applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: trustedTimelineItemId("item-a"),
        fromCollectionId: trustedCollectionId("col-root"),
        toCollectionId: trustedCollectionId("col-root"),
        toIndex: 1,
      },
    }));

    const rootCol = result.get(trustedCollectionId("col-root"))!;
    expect(rootCol.items.map((i) => i.id)).toEqual(["item-b", "item-a", "item-col-nested"]);
  });

  test("move backward within same collection to the requested final index", () => {
    const result = expectApplied(applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: trustedTimelineItemId("item-col-nested"),
        fromCollectionId: trustedCollectionId("col-root"),
        toCollectionId: trustedCollectionId("col-root"),
        toIndex: 0,
      },
    }));

    const rootCol = result.get(trustedCollectionId("col-root"))!;
    expect(rootCol.items.map((i) => i.id)).toEqual(["item-col-nested", "item-a", "item-b"]);
  });

  test("rejects with reason 'same-position' when the same-collection final index is unchanged", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: trustedTimelineItemId("item-a"),
        fromCollectionId: trustedCollectionId("col-root"),
        toCollectionId: trustedCollectionId("col-root"),
        toIndex: 0,
      },
    });

    expect(result).toEqual({ ok: false, reason: "same-position" });
  });

  test("move across different collections", () => {
    const result = expectApplied(applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: trustedTimelineItemId("item-a"),
        fromCollectionId: trustedCollectionId("col-root"),
        toCollectionId: trustedCollectionId("col-other"),
        toIndex: 0,
      },
    }));

    const rootCol = result.get(trustedCollectionId("col-root"))!;
    const otherCol = result.get(trustedCollectionId("col-other"))!;

    expect(rootCol.items.map((i) => i.id)).toEqual(["item-b", "item-col-nested"]);
    expect(otherCol.items.map((i) => i.id)).toEqual(["item-a"]);
  });

  test("nest media into a collection item", () => {
    const result = expectApplied(applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "nest",
        itemId: trustedTimelineItemId("item-a"),
        fromCollectionId: trustedCollectionId("col-root"),
        targetCollectionId: trustedCollectionId("col-nested"),
        toIndex: 0,
      },
    }));

    const rootCol = result.get(trustedCollectionId("col-root"))!;
    const nestedCol = result.get(trustedCollectionId("col-nested"))!;

    expect(rootCol.items.map((i) => i.id)).toEqual(["item-b", "item-col-nested"]);
    expect(nestedCol.items.map((i) => i.id)).toEqual(["item-a"]);
    // Also asserts that count sync was triggered on parent
    const nestedItem = rootCol.items.find((i) => i.id === "item-col-nested")!;
    expect(isCollectionItem(nestedItem) && nestedItem.itemCount).toBe(1);
  });

  test("nest collection into collection", () => {
    const doubleNestedCol: TimelineCollection = {
      id: trustedCollectionId("col-double"),
      name: "Double Folder",
      items: [],
    };
    const doubleNestedItem = makeCollectionItem("item-double", "Double Folder Item", "col-double");

    const collections = new Map(initialCollections);
    collections.set(trustedCollectionId("col-double"), doubleNestedCol);
    collections.set(trustedCollectionId("col-root"), {
      id: trustedCollectionId("col-root"),
      name: "Root",
      items: [itemA, itemB, itemC, doubleNestedItem],
    });

    const result = expectApplied(applyTimelineItemCommand({
      collectionsById: collections,
      command: {
        type: "nest",
        itemId: trustedTimelineItemId("item-double"),
        fromCollectionId: trustedCollectionId("col-root"),
        targetCollectionId: trustedCollectionId("col-nested"),
      },
    }));

    const nestedCol = result.get(trustedCollectionId("col-nested"))!;
    expect(nestedCol.items.map((i) => i.id)).toEqual(["item-double"]);
  });

  test("rejects with reason 'missing-source' when fromCollectionId doesn't exist", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: trustedTimelineItemId("item-a"),
        fromCollectionId: trustedCollectionId("col-does-not-exist"),
        toCollectionId: trustedCollectionId("col-root"),
        toIndex: 0,
      },
    });

    expect(result).toEqual({ ok: false, reason: "missing-source" });
  });

  test("rejects with reason 'missing-source' when the item isn't actually in fromCollectionId", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: trustedTimelineItemId("item-not-in-root"),
        fromCollectionId: trustedCollectionId("col-root"),
        toCollectionId: trustedCollectionId("col-other"),
        toIndex: 0,
      },
    });

    expect(result).toEqual({ ok: false, reason: "missing-source" });
  });

  test("rejects with reason 'missing-target' when toCollectionId doesn't exist", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: trustedTimelineItemId("item-a"),
        fromCollectionId: trustedCollectionId("col-root"),
        toCollectionId: trustedCollectionId("col-does-not-exist"),
        toIndex: 0,
      },
    });

    expect(result).toEqual({ ok: false, reason: "missing-target" });
  });

  test("rejects with reason 'missing-target' when nest targetCollectionId doesn't exist", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "nest",
        itemId: trustedTimelineItemId("item-a"),
        fromCollectionId: trustedCollectionId("col-root"),
        targetCollectionId: trustedCollectionId("col-does-not-exist"),
      },
    });

    expect(result).toEqual({ ok: false, reason: "missing-target" });
  });

  test("rejects with reason 'cycle' for cycle-creating collection nestings", () => {
    // Nested collection col-nested contains a collection col-double
    // If we try to nest col-nested into col-double, it should be rejected.
    const doubleNestedItem = makeCollectionItem("item-double", "Double Folder Item", "col-double");

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        trustedCollectionId("col-root"),
        { id: trustedCollectionId("col-root"), name: "Root", items: [itemC] }, // Root contains col-nested
      ],
      [
        trustedCollectionId("col-nested"),
        { id: trustedCollectionId("col-nested"), name: "Nested", items: [doubleNestedItem] }, // Nested contains col-double
      ],
      [
        trustedCollectionId("col-double"),
        { id: trustedCollectionId("col-double"), name: "Double Folder", items: [] },
      ],
    ]);

    // Attempt to nest itemC (which represents col-nested) into col-double
    const result = applyTimelineItemCommand({
      collectionsById: collections,
      command: {
        type: "nest",
        itemId: trustedTimelineItemId("item-col-nested"),
        fromCollectionId: trustedCollectionId("col-root"),
        targetCollectionId: trustedCollectionId("col-double"),
      },
    });

    // The operation should be rejected, not silently no-op'd, due to collection cycle prevention
    expect(result).toEqual({ ok: false, reason: "cycle" });
  });

  test("syncCollectionItemCounts defensive synchronization", () => {
    // itemCount deliberately out of sync with the backing collection's 2 items
    const parentItem = makeCollectionItem("item-folder", "Folder", "col-folder", 99);

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        trustedCollectionId("col-root"),
        { id: trustedCollectionId("col-root"), name: "Root", items: [parentItem] },
      ],
      [
        trustedCollectionId("col-folder"),
        { id: trustedCollectionId("col-folder"), name: "Folder", items: [itemA, itemB] }, // Contains 2 items
      ],
    ]);

    const synced = syncCollectionItemCounts(collections);
    const updatedParent = synced.get(trustedCollectionId("col-root"))!.items[0];
    expect(isCollectionItem(updatedParent) && updatedParent.itemCount).toBe(2);
  });

  test("syncCollectionItemCounts only clones the collections that actually changed", () => {
    // col-root's folder card has a stale count (must be rewritten); col-other
    // is untouched. The rewrite should preserve col-other's object by
    // reference rather than reallocating every collection.
    const staleParent = makeCollectionItem("item-folder", "Folder", "col-folder", 99);
    const otherCol = { id: trustedCollectionId("col-other"), name: "Other", items: [itemA] };

    const collections = new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("col-root"), { id: trustedCollectionId("col-root"), name: "Root", items: [staleParent] }],
      [trustedCollectionId("col-folder"), { id: trustedCollectionId("col-folder"), name: "Folder", items: [itemA, itemB] }],
      [trustedCollectionId("col-other"), otherCol],
    ]);

    const synced = syncCollectionItemCounts(collections);

    // A change happened, so a new map is returned...
    expect(synced).not.toBe(collections);
    // ...but the untouched collection keeps its exact object identity.
    expect(synced.get(trustedCollectionId("col-other"))).toBe(otherCol);
    // ...and the changed one does not.
    expect(synced.get(trustedCollectionId("col-root"))).not.toBe(
      collections.get(trustedCollectionId("col-root"))
    );
  });

  test("syncCollectionItemCounts preserves the fallback count when the backing collection isn't loaded", () => {
    // col-folder is NOT in collectionsById at all (e.g. lazily-loaded and
    // not yet fetched). itemCount is documented as the fallback for exactly
    // this case — syncing must not stomp it down to 0.
    const parentItem = makeCollectionItem("item-folder", "Folder", "col-folder", 12);

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        trustedCollectionId("col-root"),
        { id: trustedCollectionId("col-root"), name: "Root", items: [parentItem] },
      ],
    ]);

    const synced = syncCollectionItemCounts(collections);

    // Nothing changed, so the reducer should return the same map reference.
    expect(synced).toBe(collections);
    const updatedParent = synced.get(trustedCollectionId("col-root"))!.items[0];
    expect(isCollectionItem(updatedParent) && updatedParent.itemCount).toBe(12);
  });
});

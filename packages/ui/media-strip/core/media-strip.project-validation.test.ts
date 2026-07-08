import { describe, test, expect } from "vitest";
import {
  asCollectionId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItem,
  type TimelineItemResult,
} from "./media-strip.types";
import {
  createImageTimelineItem,
  createCollectionTimelineItem,
} from "./media-strip.validation";
import { validateProjectTimeline } from "./media-strip.project-validation";

function unwrap<T, E>(result: TimelineItemResult<T, E>): T {
  if (!result.ok) {
    throw new Error(`Test fixture failed to construct: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

const makeImage = (id: string, name: string, startTimeSeconds = 0): TimelineItem =>
  unwrap(
    createImageTimelineItem({
      id,
      name,
      src: `${id}.png`,
      startTimeSeconds,
      durationSeconds: 10,
    })
  );

const makeCollectionItem = (id: string, name: string, collectionId: string): TimelineItem =>
  unwrap(
    createCollectionTimelineItem({
      id,
      name,
      collectionId,
      itemCount: 0,
      startTimeSeconds: 0,
      durationSeconds: 10,
    })
  );

describe("validateProjectTimeline graph validator", () => {
  const itemA = makeImage("item-a", "Item A");
  const itemB = makeImage("item-b", "Item B", 10);

  test("returns valid for a simple flat project timeline", () => {
    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-root"),
        {
          id: asCollectionId("col-root"),
          name: "Root",
          items: [itemA, itemB],
        },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-root")],
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.orphanedCollectionIds).toEqual([]);
    }
  });

  test("missing root collection", () => {
    const collections = new Map<CollectionId, TimelineCollection>();

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-root")],
    });

    expect(result.valid).toBe(false);
    if (!result.valid && result.reason === "missing-collection") {
      expect(result.collectionId).toBe("col-root");
      expect(result.itemId).toBeUndefined();
    }
  });

  test("missing nested collection referenced by collection item", () => {
    const colItem = makeCollectionItem("item-folder", "Folder", "col-missing");

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-root"),
        {
          id: asCollectionId("col-root"),
          name: "Root",
          items: [colItem],
        },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-root")],
    });

    expect(result.valid).toBe(false);
    if (!result.valid && result.reason === "missing-collection") {
      expect(result.collectionId).toBe("col-missing");
      expect(result.itemId).toBe("item-folder");
    }
  });

  test("detects cyclic collection dependencies (deep cycle)", () => {
    const colItemB = makeCollectionItem("item-folder-b", "Folder B Item", "col-b");
    const colItemA = makeCollectionItem("item-folder-a", "Folder A Item", "col-a");

    // col-a references col-b; col-b references col-a (Cycle!)
    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-a"),
        { id: asCollectionId("col-a"), name: "Folder A", items: [colItemB] },
      ],
      [
        asCollectionId("col-b"),
        { id: asCollectionId("col-b"), name: "Folder B", items: [colItemA] },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-a")],
    });

    expect(result.valid).toBe(false);
    if (!result.valid && result.reason === "collection-cycle") {
      expect(result.cycle).toContain("col-a");
      expect(result.cycle).toContain("col-b");
    }
  });

  test("reported cycle includes the closing node so the loop edge is visible", () => {
    const colItemB = makeCollectionItem("item-folder-b", "Folder B Item", "col-b");
    const colItemA = makeCollectionItem("item-folder-a", "Folder A Item", "col-a");

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-a"),
        { id: asCollectionId("col-a"), name: "Folder A", items: [colItemB] },
      ],
      [
        asCollectionId("col-b"),
        { id: asCollectionId("col-b"), name: "Folder B", items: [colItemA] },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-a")],
    });

    expect(result.valid).toBe(false);
    if (!result.valid && result.reason === "collection-cycle") {
      // col-a -> col-b -> col-a: the last entry must repeat the node that
      // closes the loop, not just list the two nodes involved.
      expect(result.cycle).toEqual(["col-a", "col-b", "col-a"]);
    }
  });

  test("detects duplicate global item IDs", () => {
    const itemA2 = makeImage("item-a", "Item A Duplicate");

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-root"),
        {
          id: asCollectionId("col-root"),
          name: "Root",
          items: [itemA, itemA2],
        },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-root")],
      assumeGlobalItemIds: true,
    });

    expect(result.valid).toBe(false);
    if (!result.valid && result.reason === "duplicate-global-item-ids") {
      expect(result.itemId).toBe("item-a");
    }
  });

  test("identifies orphaned (unreachable) collections", () => {
    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-root"),
        { id: asCollectionId("col-root"), name: "Root", items: [itemA] },
      ],
      [
        asCollectionId("col-orphaned"),
        { id: asCollectionId("col-orphaned"), name: "Lost Folder", items: [itemB] },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-root")],
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.orphanedCollectionIds).toEqual(["col-orphaned"]);
    }
  });

  test("catches a dangling collection reference that lives entirely inside an orphan", () => {
    // col-orphaned is unreachable from col-root, but its own contents must
    // still be validated — a missing reference inside it must not silently
    // pass just because nothing else points to it.
    const danglingRefItem = makeCollectionItem("item-dangling", "Dangling Ref", "col-does-not-exist");

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-root"),
        { id: asCollectionId("col-root"), name: "Root", items: [itemA] },
      ],
      [
        asCollectionId("col-orphaned"),
        { id: asCollectionId("col-orphaned"), name: "Lost Folder", items: [danglingRefItem] },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-root")],
    });

    expect(result.valid).toBe(false);
    if (!result.valid && result.reason === "missing-collection") {
      expect(result.collectionId).toBe("col-does-not-exist");
      expect(result.itemId).toBe("item-dangling");
    }
  });

  test("catches a cycle that exists entirely among orphaned collections", () => {
    const orphanItemB = makeCollectionItem("item-orphan-b", "Orphan B Item", "col-orphan-b");
    const orphanItemA = makeCollectionItem("item-orphan-a", "Orphan A Item", "col-orphan-a");

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-root"),
        { id: asCollectionId("col-root"), name: "Root", items: [itemA] },
      ],
      [
        asCollectionId("col-orphan-a"),
        { id: asCollectionId("col-orphan-a"), name: "Orphan A", items: [orphanItemB] },
      ],
      [
        asCollectionId("col-orphan-b"),
        { id: asCollectionId("col-orphan-b"), name: "Orphan B", items: [orphanItemA] },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-root")],
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe("collection-cycle");
    }
  });

  test("catches a duplicate item ID that exists only inside an orphan", () => {
    const duplicateOrphanItem = makeImage("item-a", "Duplicate of root item A");

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-root"),
        { id: asCollectionId("col-root"), name: "Root", items: [itemA] },
      ],
      [
        asCollectionId("col-orphaned"),
        { id: asCollectionId("col-orphaned"), name: "Lost Folder", items: [duplicateOrphanItem] },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-root")],
      assumeGlobalItemIds: true,
    });

    expect(result.valid).toBe(false);
    if (!result.valid && result.reason === "duplicate-global-item-ids") {
      expect(result.itemId).toBe("item-a");
    }
  });

  test("rejects a collection referenced by two different parents", () => {
    // Both col-a and col-b independently reference col-shared — collections
    // are a tree, so a second parent must be rejected, not silently allowed.
    const sharedFromA = makeCollectionItem("item-shared-from-a", "Shared (via A)", "col-shared");
    const sharedFromB = makeCollectionItem("item-shared-from-b", "Shared (via B)", "col-shared");

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-root"),
        { id: asCollectionId("col-root"), name: "Root", items: [] },
      ],
      [
        asCollectionId("col-a"),
        { id: asCollectionId("col-a"), name: "Folder A", items: [sharedFromA] },
      ],
      [
        asCollectionId("col-b"),
        { id: asCollectionId("col-b"), name: "Folder B", items: [sharedFromB] },
      ],
      [
        asCollectionId("col-shared"),
        { id: asCollectionId("col-shared"), name: "Shared Folder", items: [] },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-a"), asCollectionId("col-b")],
    });

    expect(result.valid).toBe(false);
    if (!result.valid && result.reason === "multiple-parents") {
      expect(result.collectionId).toBe("col-shared");
      expect(result.parentCollectionIds).toEqual(["col-a", "col-b"]);
    } else {
      throw new Error(`Expected reason "multiple-parents", got: ${JSON.stringify(result)}`);
    }
  });

  test("does not reject the same parent referencing the same child collection twice", () => {
    // Two item cards in the SAME collection both pointing at col-shared is a
    // (weird but) different concern from a second, distinct parent — only
    // the latter violates the single-parent tree invariant.
    const cardOne = makeCollectionItem("item-shared-1", "Shared (card 1)", "col-shared");
    const cardTwo = makeCollectionItem("item-shared-2", "Shared (card 2)", "col-shared");

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-root"),
        { id: asCollectionId("col-root"), name: "Root", items: [cardOne, cardTwo] },
      ],
      [
        asCollectionId("col-shared"),
        { id: asCollectionId("col-shared"), name: "Shared Folder", items: [] },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: [asCollectionId("col-root")],
    });

    expect(result.valid).toBe(true);
  });
});

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
});

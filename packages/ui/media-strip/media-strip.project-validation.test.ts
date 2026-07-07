import { describe, test, expect } from "vitest";
import {
  type CollectionId,
  type TimelineCollection,
  type TimelineItemId,
} from "./media-strip.types";
import { validateProjectTimeline } from "./media-strip.project-validation";

describe("validateProjectTimeline graph validator", () => {
  const itemA = { id: "item-a" as TimelineItemId, name: "Item A", kind: "video" as const, startTimeSeconds: 0, durationSeconds: 10 } as any;
  const itemB = { id: "item-b" as TimelineItemId, name: "Item B", kind: "video" as const, startTimeSeconds: 10, durationSeconds: 10 } as any;

  test("returns valid for a simple flat project timeline", () => {
    const collections = new Map<CollectionId, TimelineCollection>([
      [
        "col-root" as CollectionId,
        {
          id: "col-root" as CollectionId,
          name: "Root",
          items: [itemA, itemB],
        },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: ["col-root" as CollectionId],
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
      rootCollectionIds: ["col-root" as CollectionId],
    });

    expect(result.valid).toBe(false);
    if (!result.valid && result.reason === "missing-collection") {
      expect(result.collectionId).toBe("col-root");
      expect(result.itemId).toBeUndefined();
    }
  });

  test("missing nested collection referenced by collection item", () => {
    const colItem = {
      id: "item-folder" as TimelineItemId,
      name: "Folder",
      kind: "collection" as const,
      collectionId: "col-missing" as CollectionId,
      itemCount: 0,
      startTimeSeconds: 0,
      durationSeconds: 10,
    } as any;

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        "col-root" as CollectionId,
        {
          id: "col-root" as CollectionId,
          name: "Root",
          items: [colItem],
        },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: ["col-root" as CollectionId],
    });

    expect(result.valid).toBe(false);
    if (!result.valid && result.reason === "missing-collection") {
      expect(result.collectionId).toBe("col-missing");
      expect(result.itemId).toBe("item-folder");
    }
  });

  test("detects cyclic collection dependencies (deep cycle)", () => {
    const colItemB = {
      id: "item-folder-b" as TimelineItemId,
      name: "Folder B Item",
      kind: "collection" as const,
      collectionId: "col-b" as CollectionId,
      itemCount: 0,
      startTimeSeconds: 0,
      durationSeconds: 10,
    } as any;
    const colItemA = {
      id: "item-folder-a" as TimelineItemId,
      name: "Folder A Item",
      kind: "collection" as const,
      collectionId: "col-a" as CollectionId,
      itemCount: 0,
      startTimeSeconds: 0,
      durationSeconds: 10,
    } as any;

    // col-a references col-b; col-b references col-a (Cycle!)
    const collections = new Map<CollectionId, TimelineCollection>([
      [
        "col-a" as CollectionId,
        { id: "col-a" as CollectionId, name: "Folder A", items: [colItemB] },
      ],
      [
        "col-b" as CollectionId,
        { id: "col-b" as CollectionId, name: "Folder B", items: [colItemA] },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: ["col-a" as CollectionId],
    });

    expect(result.valid).toBe(false);
    if (!result.valid && result.reason === "collection-cycle") {
      expect(result.cycle).toContain("col-a");
      expect(result.cycle).toContain("col-b");
    }
  });

  test("detects duplicate global item IDs", () => {
    const itemA2 = { id: "item-a" as TimelineItemId, name: "Item A Duplicate", kind: "video" as const, startTimeSeconds: 0, durationSeconds: 10 } as any;

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        "col-root" as CollectionId,
        {
          id: "col-root" as CollectionId,
          name: "Root",
          items: [itemA, itemA2],
        },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: ["col-root" as CollectionId],
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
        "col-root" as CollectionId,
        { id: "col-root" as CollectionId, name: "Root", items: [itemA] },
      ],
      [
        "col-orphaned" as CollectionId,
        { id: "col-orphaned" as CollectionId, name: "Lost Folder", items: [itemB] },
      ],
    ]);

    const result = validateProjectTimeline({
      collectionsById: collections,
      rootCollectionIds: ["col-root" as CollectionId],
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.orphanedCollectionIds).toEqual(["col-orphaned"]);
    }
  });
});

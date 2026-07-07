import { describe, test, expect } from "vitest";
import {
  type TimelineCollection,
  type TimelineItemId,
  type CollectionId,
  type TimelineItem,
} from "./media-strip.types";
import { applyTimelineItemCommand, syncCollectionItemCounts } from "./media-strip.collection-ops";

describe("applyTimelineItemCommand reducer", () => {
  const itemA = { id: "item-a" as TimelineItemId, name: "Item A", kind: "video" as const } as TimelineItem;
  const itemB = { id: "item-b" as TimelineItemId, name: "Item B", kind: "video" as const } as TimelineItem;
  const itemC = {
    id: "item-col-nested" as TimelineItemId,
    name: "Nested Folder",
    kind: "collection" as const,
    collectionId: "col-nested" as CollectionId,
    itemCount: 0,
  } as TimelineItem;

  const initialCollections = new Map<CollectionId, TimelineCollection>([
    [
      "col-root" as CollectionId,
      {
        id: "col-root" as CollectionId,
        name: "Root",
        items: [itemA, itemB, itemC],
      },
    ],
    [
      "col-nested" as CollectionId,
      {
        id: "col-nested" as CollectionId,
        name: "Nested",
        items: [],
      },
    ],
    [
      "col-other" as CollectionId,
      {
        id: "col-other" as CollectionId,
        name: "Other Strip",
        items: [],
      },
    ],
  ]);

  test("move within same collection", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: "item-a" as TimelineItemId,
        fromCollectionId: "col-root" as CollectionId,
        toCollectionId: "col-root" as CollectionId,
        toIndex: 1,
      },
    });

    const rootCol = result.get("col-root" as CollectionId)!;
    expect(rootCol.items.map((i) => i.id)).toEqual(["item-b", "item-a", "item-col-nested"]);
  });

  test("move across different collections", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: "item-a" as TimelineItemId,
        fromCollectionId: "col-root" as CollectionId,
        toCollectionId: "col-other" as CollectionId,
        toIndex: 0,
      },
    });

    const rootCol = result.get("col-root" as CollectionId)!;
    const otherCol = result.get("col-other" as CollectionId)!;

    expect(rootCol.items.map((i) => i.id)).toEqual(["item-b", "item-col-nested"]);
    expect(otherCol.items.map((i) => i.id)).toEqual(["item-a"]);
  });

  test("nest media into a collection item", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "nest",
        itemId: "item-a" as TimelineItemId,
        fromCollectionId: "col-root" as CollectionId,
        targetCollectionId: "col-nested" as CollectionId,
        toIndex: 0,
      },
    });

    const rootCol = result.get("col-root" as CollectionId)!;
    const nestedCol = result.get("col-nested" as CollectionId)!;

    expect(rootCol.items.map((i) => i.id)).toEqual(["item-b", "item-col-nested"]);
    expect(nestedCol.items.map((i) => i.id)).toEqual(["item-a"]);
    // Also asserts that count sync was triggered on parent
    const nestedItem = rootCol.items.find((i) => i.id === "item-col-nested")!;
    expect((nestedItem as any).itemCount).toBe(1);
  });

  test("nest collection into collection", () => {
    const doubleNestedCol = {
      id: "col-double" as CollectionId,
      name: "Double Folder",
      items: [],
    };
    const doubleNestedItem = {
      id: "item-double" as TimelineItemId,
      name: "Double Folder Item",
      kind: "collection" as const,
      collectionId: "col-double" as CollectionId,
      itemCount: 0,
    } as TimelineItem;

    const collections = new Map(initialCollections);
    collections.set("col-double" as CollectionId, doubleNestedCol);
    collections.set("col-root" as CollectionId, {
      id: "col-root" as CollectionId,
      name: "Root",
      items: [itemA, itemB, itemC, doubleNestedItem],
    });

    const result = applyTimelineItemCommand({
      collectionsById: collections,
      command: {
        type: "nest",
        itemId: "item-double" as TimelineItemId,
        fromCollectionId: "col-root" as CollectionId,
        targetCollectionId: "col-nested" as CollectionId,
      },
    });

    const nestedCol = result.get("col-nested" as CollectionId)!;
    expect(nestedCol.items.map((i) => i.id)).toEqual(["item-double"]);
  });

  test("reject cycle-creating collection nestings", () => {
    // Nested collection col-nested contains a collection col-double
    // If we try to nest col-nested into col-double, it should be rejected.
    const doubleNestedItem = {
      id: "item-double" as TimelineItemId,
      name: "Double Folder Item",
      kind: "collection" as const,
      collectionId: "col-double" as CollectionId,
      itemCount: 0,
    } as TimelineItem;

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        "col-root" as CollectionId,
        { id: "col-root" as CollectionId, name: "Root", items: [itemC] }, // Root contains col-nested
      ],
      [
        "col-nested" as CollectionId,
        { id: "col-nested" as CollectionId, name: "Nested", items: [doubleNestedItem] }, // Nested contains col-double
      ],
      [
        "col-double" as CollectionId,
        { id: "col-double" as CollectionId, name: "Double Folder", items: [] },
      ],
    ]);

    // Attempt to nest itemC (which represents col-nested) into col-double
    const result = applyTimelineItemCommand({
      collectionsById: collections,
      command: {
        type: "nest",
        itemId: "item-col-nested" as TimelineItemId,
        fromCollectionId: "col-root" as CollectionId,
        targetCollectionId: "col-double" as CollectionId,
      },
    });

    // The operation should be aborted/no-oped due to collection cycle prevention
    expect(result).toBe(collections);
  });

  test("syncCollectionItemCounts defensive synchronization", () => {
    const parentItem = {
      id: "item-folder" as TimelineItemId,
      kind: "collection" as const,
      collectionId: "col-folder" as CollectionId,
      itemCount: 99, // Out of sync count
    } as TimelineItem;

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        "col-root" as CollectionId,
        { id: "col-root" as CollectionId, name: "Root", items: [parentItem] },
      ],
      [
        "col-folder" as CollectionId,
        { id: "col-folder" as CollectionId, name: "Folder", items: [itemA, itemB] }, // Contains 2 items
      ],
    ]);

    const synced = syncCollectionItemCounts(collections);
    const updatedParent = synced.get("col-root" as CollectionId)!.items[0];
    expect((updatedParent as any).itemCount).toBe(2);
  });
});

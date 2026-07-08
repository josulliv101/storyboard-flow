import { describe, test, expect } from "vitest";
import {
  asTimelineItemId,
  asCollectionId,
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
import { applyTimelineItemCommand, syncCollectionItemCounts } from "./media-strip.collection-ops";

function unwrap<T, E>(result: TimelineItemResult<T, E>): T {
  if (!result.ok) {
    throw new Error(`Test fixture failed to construct: ${JSON.stringify(result.error)}`);
  }
  return result.value;
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
      asCollectionId("col-root"),
      {
        id: asCollectionId("col-root"),
        name: "Root",
        items: [itemA, itemB, itemC],
      },
    ],
    [
      asCollectionId("col-nested"),
      {
        id: asCollectionId("col-nested"),
        name: "Nested",
        items: [],
      },
    ],
    [
      asCollectionId("col-other"),
      {
        id: asCollectionId("col-other"),
        name: "Other Strip",
        items: [],
      },
    ],
  ]);

  test("move within same collection to the requested final index", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: asTimelineItemId("item-a"),
        fromCollectionId: asCollectionId("col-root"),
        toCollectionId: asCollectionId("col-root"),
        toIndex: 1,
      },
    });

    const rootCol = result.get(asCollectionId("col-root"))!;
    expect(rootCol.items.map((i) => i.id)).toEqual(["item-b", "item-a", "item-col-nested"]);
  });

  test("move backward within same collection to the requested final index", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: asTimelineItemId("item-col-nested"),
        fromCollectionId: asCollectionId("col-root"),
        toCollectionId: asCollectionId("col-root"),
        toIndex: 0,
      },
    });

    const rootCol = result.get(asCollectionId("col-root"))!;
    expect(rootCol.items.map((i) => i.id)).toEqual(["item-col-nested", "item-a", "item-b"]);
  });

  test("returns the original map when same-collection final index is unchanged", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: asTimelineItemId("item-a"),
        fromCollectionId: asCollectionId("col-root"),
        toCollectionId: asCollectionId("col-root"),
        toIndex: 0,
      },
    });

    expect(result).toBe(initialCollections);
  });

  test("move across different collections", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "move",
        itemId: asTimelineItemId("item-a"),
        fromCollectionId: asCollectionId("col-root"),
        toCollectionId: asCollectionId("col-other"),
        toIndex: 0,
      },
    });

    const rootCol = result.get(asCollectionId("col-root"))!;
    const otherCol = result.get(asCollectionId("col-other"))!;

    expect(rootCol.items.map((i) => i.id)).toEqual(["item-b", "item-col-nested"]);
    expect(otherCol.items.map((i) => i.id)).toEqual(["item-a"]);
  });

  test("nest media into a collection item", () => {
    const result = applyTimelineItemCommand({
      collectionsById: initialCollections,
      command: {
        type: "nest",
        itemId: asTimelineItemId("item-a"),
        fromCollectionId: asCollectionId("col-root"),
        targetCollectionId: asCollectionId("col-nested"),
        toIndex: 0,
      },
    });

    const rootCol = result.get(asCollectionId("col-root"))!;
    const nestedCol = result.get(asCollectionId("col-nested"))!;

    expect(rootCol.items.map((i) => i.id)).toEqual(["item-b", "item-col-nested"]);
    expect(nestedCol.items.map((i) => i.id)).toEqual(["item-a"]);
    // Also asserts that count sync was triggered on parent
    const nestedItem = rootCol.items.find((i) => i.id === "item-col-nested")!;
    expect(isCollectionItem(nestedItem) && nestedItem.itemCount).toBe(1);
  });

  test("nest collection into collection", () => {
    const doubleNestedCol: TimelineCollection = {
      id: asCollectionId("col-double"),
      name: "Double Folder",
      items: [],
    };
    const doubleNestedItem = makeCollectionItem("item-double", "Double Folder Item", "col-double");

    const collections = new Map(initialCollections);
    collections.set(asCollectionId("col-double"), doubleNestedCol);
    collections.set(asCollectionId("col-root"), {
      id: asCollectionId("col-root"),
      name: "Root",
      items: [itemA, itemB, itemC, doubleNestedItem],
    });

    const result = applyTimelineItemCommand({
      collectionsById: collections,
      command: {
        type: "nest",
        itemId: asTimelineItemId("item-double"),
        fromCollectionId: asCollectionId("col-root"),
        targetCollectionId: asCollectionId("col-nested"),
      },
    });

    const nestedCol = result.get(asCollectionId("col-nested"))!;
    expect(nestedCol.items.map((i) => i.id)).toEqual(["item-double"]);
  });

  test("reject cycle-creating collection nestings", () => {
    // Nested collection col-nested contains a collection col-double
    // If we try to nest col-nested into col-double, it should be rejected.
    const doubleNestedItem = makeCollectionItem("item-double", "Double Folder Item", "col-double");

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-root"),
        { id: asCollectionId("col-root"), name: "Root", items: [itemC] }, // Root contains col-nested
      ],
      [
        asCollectionId("col-nested"),
        { id: asCollectionId("col-nested"), name: "Nested", items: [doubleNestedItem] }, // Nested contains col-double
      ],
      [
        asCollectionId("col-double"),
        { id: asCollectionId("col-double"), name: "Double Folder", items: [] },
      ],
    ]);

    // Attempt to nest itemC (which represents col-nested) into col-double
    const result = applyTimelineItemCommand({
      collectionsById: collections,
      command: {
        type: "nest",
        itemId: asTimelineItemId("item-col-nested"),
        fromCollectionId: asCollectionId("col-root"),
        targetCollectionId: asCollectionId("col-double"),
      },
    });

    // The operation should be aborted/no-oped due to collection cycle prevention
    expect(result).toBe(collections);
  });

  test("syncCollectionItemCounts defensive synchronization", () => {
    // itemCount deliberately out of sync with the backing collection's 2 items
    const parentItem = makeCollectionItem("item-folder", "Folder", "col-folder", 99);

    const collections = new Map<CollectionId, TimelineCollection>([
      [
        asCollectionId("col-root"),
        { id: asCollectionId("col-root"), name: "Root", items: [parentItem] },
      ],
      [
        asCollectionId("col-folder"),
        { id: asCollectionId("col-folder"), name: "Folder", items: [itemA, itemB] }, // Contains 2 items
      ],
    ]);

    const synced = syncCollectionItemCounts(collections);
    const updatedParent = synced.get(asCollectionId("col-root"))!.items[0];
    expect(isCollectionItem(updatedParent) && updatedParent.itemCount).toBe(2);
  });
});

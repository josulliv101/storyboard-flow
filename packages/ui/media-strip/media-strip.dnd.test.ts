import { describe, test, expect } from "vitest";
import {
  type UniqueIdentifier,
  type Active,
  type ClientRect,
  type DroppableContainer,
} from "@dnd-kit/core";
import {
  type CollectionId,
  type TimelineCollection,
  type TimelineItemId,
  type TimelineItem,
} from "./media-strip.types";
import { resolveDropIntent, detectCollision } from "./media-strip.dnd";

describe("resolveDropIntent helper", () => {
  const itemA = { id: "item-a" as TimelineItemId, name: "Item A" } as TimelineItem;
  const itemB = { id: "item-b" as TimelineItemId, name: "Item B" } as TimelineItem;

  const collections = new Map<CollectionId, TimelineCollection>([
    [
      "col-root" as CollectionId,
      {
        id: "col-root" as CollectionId,
        name: "Root",
        items: [itemA, itemB],
      },
    ],
    [
      "col-empty" as CollectionId,
      {
        id: "col-empty" as CollectionId,
        name: "Empty Folder",
        items: [],
      },
    ],
  ]);

  const itemLookup = new Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>([
    ["item-a" as TimelineItemId, { collectionId: "col-root" as CollectionId, index: 0, item: itemA }],
    ["item-b" as TimelineItemId, { collectionId: "col-root" as CollectionId, index: 1, item: itemB }],
  ]);

  test("drop before item", () => {
    const result = resolveDropIntent({
      overId: "item:item-b",
      activeId: "item:item-a",
      collectionsById: collections,
      itemLookup,
    });

    expect(result).toEqual({
      type: "move",
      itemId: "item-a" as TimelineItemId,
      fromCollectionId: "col-root" as CollectionId,
      toCollectionId: "col-root" as CollectionId,
      toIndex: 1,
    });
  });

  test("drop after last item (pointer is to the right)", () => {
    const result = resolveDropIntent({
      overId: "container:col-root",
      activeId: "item:item-a",
      collectionsById: collections,
      itemLookup,
    });

    expect(result).toEqual({
      type: "move",
      itemId: "item-a" as TimelineItemId,
      fromCollectionId: "col-root" as CollectionId,
      toCollectionId: "col-root" as CollectionId,
      toIndex: 2,
    });
  });

  test("drop into empty collection container", () => {
    const result = resolveDropIntent({
      overId: "container:col-empty",
      activeId: "item:item-a",
      collectionsById: collections,
      itemLookup,
    });

    expect(result).toEqual({
      type: "move",
      itemId: "item-a" as TimelineItemId,
      fromCollectionId: "col-root" as CollectionId,
      toCollectionId: "col-empty" as CollectionId,
      toIndex: 0,
    });
  });
});

describe("detectCollision strategy with hotspots", () => {
  const folderItem = {
    id: "item-folder" as TimelineItemId,
    name: "Holiday Folder",
    kind: "collection" as const,
    collectionId: "col-folder" as CollectionId,
    itemCount: 0,
  } as TimelineItem;

  const itemLookup = new Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>([
    ["item-folder" as TimelineItemId, { collectionId: "col-root" as CollectionId, index: 0, item: folderItem }],
  ]);

  const droppableContainers: DroppableContainer[] = [
    {
      id: "item:item-folder",
      rect: {
        current: {
          width: 200,
          height: 100,
          left: 100,
          top: 100,
          right: 300,
          bottom: 200,
        },
      },
      data: { current: {} },
    } as any,
  ];

  test("detects drop into collection hotspot (pointer in center 20%-80% bounds)", () => {
    const pointerInHotspot = { x: 200, y: 150 };

    const result = detectCollision({
      active: { id: "item:item-a" } as any,
      collisionRect: { width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 } as any,
      droppableRects: new Map([
        [
          "item:item-folder",
          {
            width: 200,
            height: 100,
            left: 100,
            top: 100,
            right: 300,
            bottom: 200,
          },
        ],
      ]) as any,
      pointerCoordinates: pointerInHotspot,
      droppableContainers,
      itemLookup,
    });

    expect(result.nestTargetId).toBe("col-folder");
  });

  test("does not trigger nesting near collection card edges", () => {
    const pointerNearEdge = { x: 110, y: 150 }; // x=110 is less than left+0.2*width (100 + 40 = 140)

    const result = detectCollision({
      active: { id: "item:item-a" } as any,
      collisionRect: { width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 } as any,
      droppableRects: new Map([
        [
          "item:item-folder",
          {
            width: 200,
            height: 100,
            left: 100,
            top: 100,
            right: 300,
            bottom: 200,
          },
        ],
      ]) as any,
      pointerCoordinates: pointerNearEdge,
      droppableContainers,
      itemLookup,
    });

    expect(result.nestTargetId).toBeNull();
  });

  test("rejects nesting self into itself", () => {
    // If the active item is the same collection we are dragging, we should reject nesting it.
    const pointerInHotspot = { x: 200, y: 150 };

    const result = detectCollision({
      active: { id: "item:item-folder" } as any,
      collisionRect: { width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100 } as any,
      droppableRects: new Map([
        [
          "item:item-folder",
          {
            width: 200,
            height: 100,
            left: 100,
            top: 100,
            right: 300,
            bottom: 200,
          },
        ],
      ]) as any,
      pointerCoordinates: pointerInHotspot,
      droppableContainers,
      itemLookup,
    });

    expect(result.nestTargetId).toBeNull();
  });
});

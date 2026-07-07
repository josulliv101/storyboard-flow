import { describe, test, expect } from "vitest";
import {
  type MediaStripDndDroppableContainer,
} from "./media-strip.dnd-adapter";
import {
  asTimelineItemId,
  asCollectionId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemId,
  type TimelineItem,
} from "./media-strip.types";
import {
  resolveDropIntent,
  detectCollision,
  encodeDndTarget,
  decodeDndTarget,
} from "./media-strip.dnd";

describe("resolveDropIntent helper", () => {
  const itemA = { id: asTimelineItemId("item-a"), name: "Item A" } as TimelineItem;
  const itemB = { id: asTimelineItemId("item-b"), name: "Item B" } as TimelineItem;

  const collections = new Map<CollectionId, TimelineCollection>([
    [
      asCollectionId("col-root"),
      {
        id: asCollectionId("col-root"),
        name: "Root",
        items: [itemA, itemB],
      },
    ],
    [
      asCollectionId("col-empty"),
      {
        id: asCollectionId("col-empty"),
        name: "Empty Folder",
        items: [],
      },
    ],
  ]);

  const itemLookup = new Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>([
    [asTimelineItemId("item-a"), { collectionId: asCollectionId("col-root"), index: 0, item: itemA }],
    [asTimelineItemId("item-b"), { collectionId: asCollectionId("col-root"), index: 1, item: itemB }],
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
      itemId: asTimelineItemId("item-a"),
      fromCollectionId: asCollectionId("col-root"),
      toCollectionId: asCollectionId("col-root"),
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
      itemId: asTimelineItemId("item-a"),
      fromCollectionId: asCollectionId("col-root"),
      toCollectionId: asCollectionId("col-root"),
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
      itemId: asTimelineItemId("item-a"),
      fromCollectionId: asCollectionId("col-root"),
      toCollectionId: asCollectionId("col-empty"),
      toIndex: 0,
    });
  });
});

describe("detectCollision strategy with hotspots", () => {
  const folderItem = {
    id: asTimelineItemId("item-folder"),
    name: "Holiday Folder",
    kind: "collection" as const,
    collectionId: asCollectionId("col-folder"),
    itemCount: 0,
  } as TimelineItem;

  const itemLookup = new Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>([
    [asTimelineItemId("item-folder"), { collectionId: asCollectionId("col-root"), index: 0, item: folderItem }],
  ]);

  const droppableContainers: MediaStripDndDroppableContainer[] = [
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

describe("DndTarget encoding/decoding", () => {
  test("round-trips every DndTarget variant", () => {
    const itemTarget = { type: "item" as const, itemId: asTimelineItemId("item-1") };
    const containerTarget = { type: "collection-container" as const, collectionId: asCollectionId("col-1") };
    const nestTarget = { type: "collection-nest-target" as const, collectionId: asCollectionId("col-2") };

    const encodedItem = encodeDndTarget(itemTarget);
    const encodedContainer = encodeDndTarget(containerTarget);
    const encodedNest = encodeDndTarget(nestTarget);

    expect(encodedItem).toBe("item:item-1");
    expect(encodedContainer).toBe("container:col-1");
    expect(encodedNest).toBe("nest:col-2");

    expect(decodeDndTarget(encodedItem)).toEqual(itemTarget);
    expect(decodeDndTarget(encodedContainer)).toEqual(containerTarget);
    expect(decodeDndTarget(encodedNest)).toEqual(nestTarget);
    expect(decodeDndTarget("invalid-prefix:something")).toBeNull();
  });

  test("round-trips IDs that themselves contain the separator", () => {
    const itemTarget = { type: "item" as const, itemId: asTimelineItemId("item:with:colons") };
    expect(decodeDndTarget(encodeDndTarget(itemTarget))).toEqual(itemTarget);
  });
});

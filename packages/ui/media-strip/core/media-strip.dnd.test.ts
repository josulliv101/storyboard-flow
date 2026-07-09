import { describe, test, expect } from "vitest";
import {
  type MediaStripDndDroppableContainer,
} from "./media-strip.dnd-adapter";
import {
  trustedTimelineItemId,
  trustedCollectionId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemId,
  type TimelineItem,
} from "./media-strip.types";
import {
  detectCollision,
  resolveDropTargetInfo,
  resolveTimelineCommandFromDrag,
  encodeDndTarget,
  decodeDndTarget,
} from "./media-strip.dnd";
import { resolveItemDropSide } from "./media-strip.utils";

describe("resolveItemDropSide", () => {
  const rect = { left: 100, top: 0, width: 200, height: 100 };

  test("reference point left of the midpoint is 'before'", () => {
    expect(resolveItemDropSide(rect, 150)).toBe("before");
  });

  test("reference point right of the midpoint is 'after'", () => {
    expect(resolveItemDropSide(rect, 250)).toBe("after");
  });

  test("reference point exactly at the midpoint is 'after'", () => {
    expect(resolveItemDropSide(rect, 200)).toBe("after");
  });
});

describe("resolveDropTargetInfo", () => {
  const folderItem = {
    id: trustedTimelineItemId("item-folder"),
    name: "Holiday Folder",
    kind: "collection" as const,
    collectionId: trustedCollectionId("col-folder"),
    itemCount: 0,
  } as TimelineItem;

  const itemLookup = new Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>([
    [trustedTimelineItemId("item-folder"), { collectionId: trustedCollectionId("col-root"), index: 0, item: folderItem }],
  ]);

  const rect = { left: 100, top: 100, width: 200, height: 100, right: 300, bottom: 200 };

  test("hovering the left half of an item resolves to 'before'", () => {
    const result = resolveDropTargetInfo({
      activeId: "item:item-a",
      decodedOver: { type: "item", itemId: trustedTimelineItemId("item-folder") },
      rect,
      point: { x: 110, y: 150 },
      itemLookup,
    });

    expect(result).toEqual({
      nestTargetId: null,
      placement: { kind: "before", itemId: trustedTimelineItemId("item-folder") },
    });
  });

  test("hovering the right half of an item resolves to 'after'", () => {
    const result = resolveDropTargetInfo({
      activeId: "item:item-a",
      decodedOver: { type: "item", itemId: trustedTimelineItemId("item-folder") },
      rect,
      point: { x: 290, y: 150 },
      itemLookup,
    });

    expect(result).toEqual({
      nestTargetId: null,
      placement: { kind: "after", itemId: trustedTimelineItemId("item-folder") },
    });
  });

  test("hovering the nest hotspot of a collection card collapses placement to 'inside'", () => {
    const result = resolveDropTargetInfo({
      activeId: "item:item-a",
      decodedOver: { type: "item", itemId: trustedTimelineItemId("item-folder") },
      rect,
      point: { x: 200, y: 150 },
      itemLookup,
    });

    expect(result).toEqual({
      nestTargetId: trustedCollectionId("col-folder"),
      placement: { kind: "inside", collectionId: trustedCollectionId("col-folder") },
    });
  });

  test("hovering yourself (left half) resolves to null/null, not 'before' on yourself", () => {
    const result = resolveDropTargetInfo({
      activeId: "item:item-folder",
      decodedOver: { type: "item", itemId: trustedTimelineItemId("item-folder") },
      rect,
      point: { x: 110, y: 150 },
      itemLookup,
    });

    expect(result).toEqual({ nestTargetId: null, placement: null });
  });

  test("hovering yourself (right half) resolves to null/null — this is the case that used to produce a spurious move", () => {
    // Native-drag adapters can legitimately report the dragged item's own
    // element as `over` (the browser still fires `dragover` on the source).
    // Before the self-target guard, this resolved to `{ kind: "after",
    // itemId: self }`, which resolveTimelineCommandFromDrag's same-position
    // check does NOT catch (only "before" on yourself collapses to the same
    // index), so it produced a real one-slot move on a "drop on yourself."
    const result = resolveDropTargetInfo({
      activeId: "item:item-folder",
      decodedOver: { type: "item", itemId: trustedTimelineItemId("item-folder") },
      rect,
      point: { x: 290, y: 150 },
      itemLookup,
    });

    expect(result).toEqual({ nestTargetId: null, placement: null });
  });

  test("hovering your own nest hotspot resolves to null/null, not nesting into yourself", () => {
    const result = resolveDropTargetInfo({
      activeId: "item:item-folder",
      decodedOver: { type: "item", itemId: trustedTimelineItemId("item-folder") },
      rect,
      point: { x: 200, y: 150 },
      itemLookup,
    });

    expect(result).toEqual({ nestTargetId: null, placement: null });
  });

  test("hovering a container background resolves to 'container-end'", () => {
    const result = resolveDropTargetInfo({
      activeId: "item:item-a",
      decodedOver: { type: "collection-container", collectionId: trustedCollectionId("col-root") },
      rect,
      point: { x: 200, y: 150 },
      itemLookup,
    });

    expect(result).toEqual({
      nestTargetId: null,
      placement: { kind: "container-end", collectionId: trustedCollectionId("col-root") },
    });
  });

  test("no over target resolves to null/null", () => {
    const result = resolveDropTargetInfo({
      activeId: "item:item-a",
      decodedOver: null,
      rect,
      point: { x: 200, y: 150 },
      itemLookup,
    });

    expect(result).toEqual({ nestTargetId: null, placement: null });
  });
});

describe("resolveTimelineCommandFromDrag", () => {
  // Fixture: a 4-item same collection [A, B, C, D], plus a second empty
  // collection to exercise cross-collection and container-end paths.
  const itemA = { id: trustedTimelineItemId("item-a"), name: "Item A" } as TimelineItem;
  const itemB = { id: trustedTimelineItemId("item-b"), name: "Item B" } as TimelineItem;
  const itemC = { id: trustedTimelineItemId("item-c"), name: "Item C" } as TimelineItem;
  const itemD = { id: trustedTimelineItemId("item-d"), name: "Item D" } as TimelineItem;

  const collections = new Map<CollectionId, TimelineCollection>([
    [
      trustedCollectionId("col-root"),
      { id: trustedCollectionId("col-root"), name: "Root", items: [itemA, itemB, itemC, itemD] },
    ],
    [
      trustedCollectionId("col-empty"),
      { id: trustedCollectionId("col-empty"), name: "Empty Folder", items: [] },
    ],
  ]);

  const itemLookup = new Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>([
    [trustedTimelineItemId("item-a"), { collectionId: trustedCollectionId("col-root"), index: 0, item: itemA }],
    [trustedTimelineItemId("item-b"), { collectionId: trustedCollectionId("col-root"), index: 1, item: itemB }],
    [trustedTimelineItemId("item-c"), { collectionId: trustedCollectionId("col-root"), index: 2, item: itemC }],
    [trustedTimelineItemId("item-d"), { collectionId: trustedCollectionId("col-root"), index: 3, item: itemD }],
  ]);

  test("dragging forward within the same collection lands 'after' the target, not one slot short", () => {
    // [A, B, C, D], drag A after C -> [B, C, A, D]. Regression test for the
    // bug where a raw (pre-removal) target index was used as a post-removal
    // insertion index, landing one slot too far right.
    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("item-a"),
      placement: { kind: "after", itemId: trustedTimelineItemId("item-c") },
      itemLookup,
      collectionsById: collections,
    });

    expect(result).toEqual({
      ok: true,
      command: {
        type: "move",
        itemId: trustedTimelineItemId("item-a"),
        fromCollectionId: trustedCollectionId("col-root"),
        toCollectionId: trustedCollectionId("col-root"),
        toIndex: 2,
      },
      announcement: 'Dropped "Item A" at position 3.',
    });
  });

  test("dragging forward within the same collection lands 'before' the target", () => {
    // [A, B, C, D], drag A before C -> [B, A, C, D].
    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("item-a"),
      placement: { kind: "before", itemId: trustedTimelineItemId("item-c") },
      itemLookup,
      collectionsById: collections,
    });

    expect(result).toMatchObject({
      ok: true,
      command: { toCollectionId: trustedCollectionId("col-root"), toIndex: 1 },
    });
  });

  test("dragging backward within the same collection lands 'after' the target", () => {
    // [A, B, C, D], drag D after B -> [A, B, D, C].
    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("item-d"),
      placement: { kind: "after", itemId: trustedTimelineItemId("item-b") },
      itemLookup,
      collectionsById: collections,
    });

    expect(result).toMatchObject({
      ok: true,
      command: { toCollectionId: trustedCollectionId("col-root"), toIndex: 2 },
    });
  });

  test("dragging backward within the same collection lands 'before' the target", () => {
    // [A, B, C, D], drag D before B -> [A, D, B, C].
    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("item-d"),
      placement: { kind: "before", itemId: trustedTimelineItemId("item-b") },
      itemLookup,
      collectionsById: collections,
    });

    expect(result).toMatchObject({
      ok: true,
      command: { toCollectionId: trustedCollectionId("col-root"), toIndex: 1 },
    });
  });

  test("dropping immediately after your own predecessor is a same-position no-op", () => {
    // [A, B, C, D], drag B after A -> no-op, B is already right after A.
    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("item-b"),
      placement: { kind: "after", itemId: trustedTimelineItemId("item-a") },
      itemLookup,
      collectionsById: collections,
    });

    expect(result).toEqual({
      ok: false,
      reason: "same-position",
      announcement: 'Dropped "Item B" at position 2.',
    });
  });

  test("same-collection drag to after the last item appends to the end (no double-count)", () => {
    // [A, B, C, D], drag A after D -> [B, C, D, A]. Distinct from the
    // cross-collection append case below: here the pre-removal length (4)
    // must NOT be used directly, since post-removal the collection only has 3 items left.
    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("item-a"),
      placement: { kind: "after", itemId: trustedTimelineItemId("item-d") },
      itemLookup,
      collectionsById: collections,
    });

    expect(result).toMatchObject({
      ok: true,
      command: { toCollectionId: trustedCollectionId("col-root"), toIndex: 3 },
    });
  });

  test("cross-collection drop after an item appends without a same-collection index shift", () => {
    const itemX = { id: trustedTimelineItemId("item-x"), name: "Item X" } as TimelineItem;
    const crossCollections = new Map(collections).set(trustedCollectionId("col-other"), {
      id: trustedCollectionId("col-other"),
      name: "Other",
      items: [itemX],
    });
    const crossLookup = new Map(itemLookup).set(trustedTimelineItemId("item-x"), {
      collectionId: trustedCollectionId("col-other"),
      index: 0,
      item: itemX,
    });

    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("item-a"),
      placement: { kind: "after", itemId: trustedTimelineItemId("item-x") },
      itemLookup: crossLookup,
      collectionsById: crossCollections,
    });

    expect(result).toMatchObject({
      ok: true,
      command: { toCollectionId: trustedCollectionId("col-other"), toIndex: 1 },
    });
  });

  test("drop on empty container background resolves to index 0", () => {
    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("item-a"),
      placement: { kind: "container-end", collectionId: trustedCollectionId("col-empty") },
      itemLookup,
      collectionsById: collections,
    });

    expect(result).toEqual({
      ok: true,
      command: {
        type: "move",
        itemId: trustedTimelineItemId("item-a"),
        fromCollectionId: trustedCollectionId("col-root"),
        toCollectionId: trustedCollectionId("col-empty"),
        toIndex: 0,
      },
      announcement: 'Dropped "Item A" at position 1.',
    });
  });

  test("'inside' placement resolves to a nest command", () => {
    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("item-a"),
      placement: { kind: "inside", collectionId: trustedCollectionId("col-empty") },
      itemLookup,
      collectionsById: collections,
    });

    expect(result).toEqual({
      ok: true,
      command: {
        type: "nest",
        itemId: trustedTimelineItemId("item-a"),
        fromCollectionId: trustedCollectionId("col-root"),
        targetCollectionId: trustedCollectionId("col-empty"),
      },
      announcement: 'Moved "Item A" into collection.',
    });
  });

  test("nesting a collection into its own descendant is rejected as a cycle", () => {
    const folderItem = {
      id: trustedTimelineItemId("card-parent"),
      name: "Parent Folder",
      kind: "collection" as const,
      collectionId: trustedCollectionId("col-parent"),
      itemCount: 1,
    } as TimelineItem;

    const nestedCollections = new Map<CollectionId, TimelineCollection>([
      [trustedCollectionId("col-root"), { id: trustedCollectionId("col-root"), name: "Root", items: [folderItem] }],
      [trustedCollectionId("col-parent"), { id: trustedCollectionId("col-parent"), name: "Parent", items: [] }],
    ]);
    const nestedLookup = new Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>([
      [trustedTimelineItemId("card-parent"), { collectionId: trustedCollectionId("col-root"), index: 0, item: folderItem }],
    ]);

    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("card-parent"),
      placement: { kind: "inside", collectionId: trustedCollectionId("col-parent") },
      itemLookup: nestedLookup,
      collectionsById: nestedCollections,
    });

    expect(result).toEqual({
      ok: false,
      reason: "cycle",
      announcement: "Cannot move a collection into itself or one of its nested collections.",
    });
  });

  test("no placement (released outside any droppable) cancels the drag", () => {
    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("item-a"),
      placement: null,
      itemLookup,
      collectionsById: collections,
    });

    expect(result).toEqual({ ok: false, reason: "cancelled", announcement: "Cancelled drag." });
  });

  test("no active item id cancels the drag", () => {
    const result = resolveTimelineCommandFromDrag({
      itemId: null,
      placement: { kind: "before", itemId: trustedTimelineItemId("item-b") },
      itemLookup,
      collectionsById: collections,
    });

    expect(result).toEqual({ ok: false, reason: "cancelled", announcement: "Cancelled drag." });
  });

  test("a placement referencing an item no longer in the lookup is a missing-target", () => {
    const result = resolveTimelineCommandFromDrag({
      itemId: trustedTimelineItemId("item-a"),
      placement: { kind: "after", itemId: trustedTimelineItemId("item-ghost") },
      itemLookup,
      collectionsById: collections,
    });

    expect(result).toEqual({ ok: false, reason: "missing-target", announcement: "Cancelled drag." });
  });
});

describe("detectCollision strategy with hotspots", () => {
  const folderItem = {
    id: trustedTimelineItemId("item-folder"),
    name: "Holiday Folder",
    kind: "collection" as const,
    collectionId: trustedCollectionId("col-folder"),
    itemCount: 0,
  } as TimelineItem;

  const itemLookup = new Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>([
    [trustedTimelineItemId("item-folder"), { collectionId: trustedCollectionId("col-root"), index: 0, item: folderItem }],
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

describe("detectCollision prioritizes the droppable actually under the pointer", () => {
  // Regression fixture: an item exists elsewhere on the board (item-far),
  // and an empty container (container-empty) is what the pointer is
  // actually hovering. getClosestCenterCollisions has no distance cutoff,
  // so a naive "item pass first, container pass only if item pass found
  // nothing" strategy would always resolve to item-far here, since a
  // closest-center search over a non-empty item list is never empty.
  const farItem = { id: trustedTimelineItemId("item-far"), name: "Far Item" } as TimelineItem;
  const itemLookup = new Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>([
    [trustedTimelineItemId("item-far"), { collectionId: trustedCollectionId("col-far"), index: 0, item: farItem }],
  ]);

  const droppableContainers: MediaStripDndDroppableContainer[] = [
    {
      id: "item:item-far",
      rect: { current: { width: 100, height: 100, left: 2000, top: 2000, right: 2100, bottom: 2100 } },
      data: { current: {} },
    } as any,
    {
      id: "container:col-empty",
      rect: { current: { width: 300, height: 150, left: 0, top: 0, right: 300, bottom: 150 } },
      data: { current: {} },
    } as any,
  ];

  const droppableRects = new Map([
    ["item:item-far", { width: 100, height: 100, left: 2000, top: 2000, right: 2100, bottom: 2100 }],
    ["container:col-empty", { width: 300, height: 150, left: 0, top: 0, right: 300, bottom: 150 }],
  ]) as any;

  test("pointer within an empty container resolves to that container, not the nearest item elsewhere on the board", () => {
    const pointerInEmptyContainer = { x: 150, y: 75 };

    const result = detectCollision({
      active: { id: "item:item-dragged" } as any,
      collisionRect: { width: 50, height: 50, left: 125, top: 50, right: 175, bottom: 100 } as any,
      droppableRects,
      pointerCoordinates: pointerInEmptyContainer,
      droppableContainers,
      itemLookup,
    });

    expect(result.placement).toEqual({ kind: "container-end", collectionId: "col-empty" });
  });

  test("pointer over the item still wins when it's actually the one under the pointer", () => {
    const pointerOnFarItem = { x: 2050, y: 2050 };

    const result = detectCollision({
      active: { id: "item:item-dragged" } as any,
      collisionRect: { width: 50, height: 50, left: 2025, top: 2025, right: 2075, bottom: 2075 } as any,
      droppableRects,
      pointerCoordinates: pointerOnFarItem,
      droppableContainers,
      itemLookup,
    });

    expect(result.placement).toMatchObject({ itemId: "item-far" });
  });
});

describe("DndTarget encoding/decoding", () => {
  test("round-trips every DndTarget variant", () => {
    const itemTarget = { type: "item" as const, itemId: trustedTimelineItemId("item-1") };
    const containerTarget = { type: "collection-container" as const, collectionId: trustedCollectionId("col-1") };
    const nestTarget = { type: "collection-nest-target" as const, collectionId: trustedCollectionId("col-2") };

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
    const itemTarget = { type: "item" as const, itemId: trustedTimelineItemId("item:with:colons") };
    expect(decodeDndTarget(encodeDndTarget(itemTarget))).toEqual(itemTarget);
  });
});

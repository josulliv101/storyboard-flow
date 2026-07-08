import {
  type CollectionId,
  type TimelineCollection,
  type TimelineItemId,
  type TimelineItem,
  type TimelineItemCommand,
  type DndTarget,
  type DropPlacement,
  parseTimelineItemId,
  parseCollectionId,
  isCollectionItem,
} from "./media-strip.types";
import { isPointInNestHotspot, isPointWithinRect, resolveItemDropSide } from "./media-strip.utils";
import { wouldCreateCollectionCycle } from "./media-strip.validation";
import {
  getClosestCenterCollisions,
  type MediaStripDndActive,
  type MediaStripDndClientRect,
  type MediaStripDndCollision,
  type MediaStripDndDroppableContainer,
  type MediaStripDndIdentifier,
} from "./media-strip.dnd-adapter";

type ItemLookup = Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>;

/**
 * Encodes DndTarget options into a unique string ID suitable for DnD context tracking.
 */
export function encodeDndTarget(target: DndTarget): string {
  if (target.type === "item") {
    return `item:${target.itemId}`;
  } else if (target.type === "collection-container") {
    return `container:${target.collectionId}`;
  } else {
    return `nest:${target.collectionId}`;
  }
}

/**
 * Decodes a DnD tracking ID back into a DndTarget structure.
 */
export function decodeDndTarget(id: string): DndTarget | null {
  const parts = id.split(":");
  if (parts.length < 2) return null;
  const prefix = parts[0];
  const value = parts.slice(1).join(":");

  if (prefix === "item") {
    const parsed = parseTimelineItemId(value);
    return parsed.ok ? { type: "item", itemId: parsed.value } : null;
  } else if (prefix === "container") {
    const parsed = parseCollectionId(value);
    return parsed.ok ? { type: "collection-container", collectionId: parsed.value } : null;
  } else if (prefix === "nest") {
    const parsed = parseCollectionId(value);
    return parsed.ok ? { type: "collection-nest-target", collectionId: parsed.value } : null;
  }
  return null;
}

/**
 * Resolves both the nest-hotspot target and the reorder placement for a
 * point hovering over a decoded drop target. Pure and DOM-independent: every
 * adapter (dnd-kit's collision search, and the pointer-driven adapters'
 * direct element/pointer readout) funnels its own rect + reference point
 * through this single function so the "is this a nest or a reorder, and
 * which side?" decision is made exactly once.
 *
 * When the hotspot triggers, `placement` collapses to `{ kind: "inside" }` —
 * nesting always wins over reordering, so a consumer never sees a
 * `DropPlacement` that could be read as both at once.
 */
export function resolveDropTargetInfo({
  activeId,
  decodedOver,
  rect,
  point,
  itemLookup,
}: {
  activeId: MediaStripDndIdentifier;
  decodedOver: DndTarget | null;
  rect: MediaStripDndClientRect | null;
  point: { x: number; y: number };
  itemLookup: ItemLookup;
}): { nestTargetId: CollectionId | null; placement: DropPlacement | null } {
  if (!decodedOver) {
    return { nestTargetId: null, placement: null };
  }

  if (decodedOver.type === "collection-container") {
    return {
      nestTargetId: null,
      placement: { kind: "container-end", collectionId: decodedOver.collectionId },
    };
  }

  if (decodedOver.type === "item" && rect) {
    // dnd-kit's own detectCollision filters the active item out of its
    // candidate list before this function ever sees it, but the
    // pointer-driven adapters (native-html5, pragmatic) report whatever
    // element the browser says is under the pointer, which can legitimately
    // be the dragged item's own element (native `dragover` fires on the
    // source while it's still in the DOM). Without this guard, hovering the
    // right half of your own item resolves to `{ kind: "after", itemId:
    // self }`, which doesn't hit the same-position no-op in
    // resolveTimelineCommandFromDrag (that only catches "before" on
    // yourself) and produces a real spurious one-slot move.
    const activeDecoded = decodeDndTarget(String(activeId));
    const activeItemId = activeDecoded?.type === "item" ? activeDecoded.itemId : activeId;
    if (activeItemId === decodedOver.itemId) {
      return { nestTargetId: null, placement: null };
    }

    const side = resolveItemDropSide(rect, point.x);
    let placement: DropPlacement = { kind: side, itemId: decodedOver.itemId };
    let nestTargetId: CollectionId | null = null;

    const found = itemLookup.get(decodedOver.itemId);
    if (found && found.item.kind === "collection" && isPointInNestHotspot(rect, point)) {
      nestTargetId = found.item.collectionId;
      placement = { kind: "inside", collectionId: found.item.collectionId };
    }

    return { nestTargetId, placement };
  }

  return { nestTargetId: null, placement: null };
}

export type DetectCollisionProps = {
  active: MediaStripDndActive;
  collisionRect: MediaStripDndClientRect;
  droppableRects: ReadonlyMap<MediaStripDndIdentifier, MediaStripDndClientRect>;
  pointerCoordinates: { x: number; y: number } | null;
  droppableContainers: readonly MediaStripDndDroppableContainer[];
  itemLookup: ItemLookup;
};

/**
 * Pure, React-independent collision detection algorithm wrapper.
 * Calculates intersections and resolves the winning target's nest/placement
 * info via `resolveDropTargetInfo`.
 *
 * Priority: whichever item the pointer is literally within, else whichever
 * container background the pointer is literally within, else (only when
 * `pointerCoordinates` is unavailable, or the pointer is genuinely outside
 * every droppable) the closest item anywhere, else the closest container
 * anywhere. The pointer-within checks MUST come first —
 * `getClosestCenterCollisions` has no distance cutoff, so a pure
 * closest-item-anywhere search always returns *some* item as long as any
 * non-active item droppable exists anywhere on the board, even when the
 * pointer is sitting inside an empty container nowhere near it. Without the
 * pointer-within priority, dropping into an empty strip while other items
 * exist in a different strip would silently resolve to "nearest item in
 * that other strip" instead of the empty strip actually under the pointer.
 */
export function detectCollision({
  active,
  collisionRect,
  droppableRects,
  pointerCoordinates,
  droppableContainers,
  itemLookup,
}: DetectCollisionProps): {
  nestTargetId: CollectionId | null;
  placement: DropPlacement | null;
  intersections: MediaStripDndCollision[];
} {
  const activeId = active.id;
  const itemContainers = droppableContainers.filter(
    (c) => decodeDndTarget(String(c.id))?.type === "item" && c.id !== activeId
  );
  const containerBackgrounds = droppableContainers.filter(
    (c) => decodeDndTarget(String(c.id))?.type === "collection-container"
  );

  const withinPointer = (containers: readonly MediaStripDndDroppableContainer[]) =>
    pointerCoordinates
      ? containers.filter((c) => {
        const rect = c.rect.current;
        return rect ? isPointWithinRect(rect, pointerCoordinates) : false;
      })
      : [];

  let intersections: MediaStripDndCollision[] = [];

  const itemsUnderPointer = withinPointer(itemContainers);
  if (itemsUnderPointer.length > 0) {
    intersections = getClosestCenterCollisions({
      active,
      collisionRect,
      droppableRects,
      droppableContainers: itemsUnderPointer,
      pointerCoordinates,
    });
  }

  if (intersections.length === 0) {
    const containersUnderPointer = withinPointer(containerBackgrounds);
    if (containersUnderPointer.length > 0) {
      intersections = getClosestCenterCollisions({
        active,
        collisionRect,
        droppableRects,
        droppableContainers: containersUnderPointer,
        pointerCoordinates,
      });
    }
  }

  if (intersections.length === 0) {
    // Last resort — no pointerCoordinates available, or the pointer is
    // genuinely outside every tracked droppable. Falls back to the
    // pre-fix behavior: nearest item anywhere, else nearest container
    // anywhere.
    intersections = getClosestCenterCollisions({
      active,
      collisionRect,
      droppableRects,
      droppableContainers: itemContainers,
      pointerCoordinates,
    });
  }

  if (intersections.length === 0) {
    intersections = getClosestCenterCollisions({
      active,
      collisionRect,
      droppableRects,
      droppableContainers: containerBackgrounds,
      pointerCoordinates,
    });
  }

  if (intersections.length === 0) {
    return { nestTargetId: null, placement: null, intersections };
  }

  const primaryCollision = intersections[0];
  const decodedOver = decodeDndTarget(String(primaryCollision.id));
  const rect = droppableContainers.find((c) => c.id === primaryCollision.id)?.rect.current ?? null;
  // dnd-kit's pointer sensor always supplies pointerCoordinates during a
  // pointer drag; this fallback only matters for collision-detection calls
  // that omit it (e.g. a future non-pointer sensor), so placement still
  // resolves to something sane instead of silently dropping to null.
  const point = pointerCoordinates ?? {
    x: collisionRect.left + collisionRect.width / 2,
    y: collisionRect.top + collisionRect.height / 2,
  };

  const { nestTargetId, placement } = resolveDropTargetInfo({
    activeId,
    decodedOver,
    rect,
    point,
    itemLookup,
  });

  return { nestTargetId, placement, intersections };
}

/**
 * Result of resolving a completed (or cancelled/rejected) drag into a
 * `TimelineItemCommand`. Every failure path still carries an `announcement`
 * so the caller can always feed the result straight to the aria-live
 * announcer without a parallel switch on `reason`.
 */
export type DragCommandResolution =
  | Readonly<{ ok: true; command: TimelineItemCommand; announcement: string }>
  | Readonly<{
    ok: false;
    reason: "cancelled" | "missing-source" | "missing-target" | "cycle" | "same-position";
    announcement: string;
  }>;

/**
 * The single place a `DropPlacement` (plus which item is being dragged)
 * turns into either a `TimelineItemCommand` or a reason it was rejected.
 * Pure and React-independent, so drag-end correctness — same-collection
 * index math, nest-cycle rejection, no-op detection — is testable without
 * React, Storybook, or browser pointer events.
 */
export function resolveTimelineCommandFromDrag({
  itemId,
  placement,
  itemLookup,
  collectionsById,
}: {
  itemId: TimelineItemId | null;
  placement: DropPlacement | null;
  itemLookup: ItemLookup;
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>;
}): DragCommandResolution {
  if (!itemId) {
    return { ok: false, reason: "cancelled", announcement: "Cancelled drag." };
  }

  const foundSource = itemLookup.get(itemId);
  if (!foundSource) {
    return { ok: false, reason: "missing-source", announcement: "Cancelled drag." };
  }

  if (!placement) {
    return { ok: false, reason: "cancelled", announcement: "Cancelled drag." };
  }

  const itemName = foundSource.item.name;

  if (placement.kind === "inside") {
    const targetCollectionId = placement.collectionId;

    if (!collectionsById.has(targetCollectionId)) {
      return { ok: false, reason: "missing-target", announcement: "Cancelled drag." };
    }

    if (
      isCollectionItem(foundSource.item) &&
      wouldCreateCollectionCycle({
        movingCollectionId: foundSource.item.collectionId,
        targetCollectionId,
        collectionsById,
      })
    ) {
      return {
        ok: false,
        reason: "cycle",
        announcement: "Cannot move a collection into itself or one of its nested collections.",
      };
    }

    return {
      ok: true,
      command: {
        type: "nest",
        itemId,
        fromCollectionId: foundSource.collectionId,
        targetCollectionId,
      },
      announcement: `Moved "${itemName}" into collection.`,
    };
  }

  let toCollectionId: CollectionId;
  let toIndex: number;

  if (placement.kind === "container-end") {
    const col = collectionsById.get(placement.collectionId);
    if (!col) {
      return { ok: false, reason: "missing-target", announcement: "Cancelled drag." };
    }
    toCollectionId = placement.collectionId;
    toIndex = col.items.length;
  } else {
    const foundTarget = itemLookup.get(placement.itemId);
    if (!foundTarget) {
      return { ok: false, reason: "missing-target", announcement: "Cancelled drag." };
    }

    toCollectionId = foundTarget.collectionId;
    let targetIndex = foundTarget.index;

    // Same-collection forward drags: once the source is spliced out of the
    // array, every index after it shifts down by one. Anchor to the
    // target's post-removal index (one less than its current index),
    // not its current one — using the current index here is exactly the
    // off-by-one that used to land same-collection forward drops one slot
    // too far right.
    if (toCollectionId === foundSource.collectionId && foundTarget.index > foundSource.index) {
      targetIndex -= 1;
    }

    toIndex = placement.kind === "after" ? targetIndex + 1 : targetIndex;
  }

  if (
    isCollectionItem(foundSource.item) &&
    wouldCreateCollectionCycle({
      movingCollectionId: foundSource.item.collectionId,
      targetCollectionId: toCollectionId,
      collectionsById,
    })
  ) {
    return {
      ok: false,
      reason: "cycle",
      announcement: "Cannot move a collection into itself or one of its nested collections.",
    };
  }

  if (foundSource.collectionId === toCollectionId && foundSource.index === toIndex) {
    return {
      ok: false,
      reason: "same-position",
      announcement: `Dropped "${itemName}" at position ${foundSource.index + 1}.`,
    };
  }

  return {
    ok: true,
    command: {
      type: "move",
      itemId,
      fromCollectionId: foundSource.collectionId,
      toCollectionId,
      toIndex,
    },
    announcement: `Dropped "${itemName}" at position ${toIndex + 1}.`,
  };
}

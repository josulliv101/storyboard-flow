import { useCallback, useRef, type RefObject } from "react";

import {
  parseCollectionId,
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemCommand,
  type DropPlacement,
} from "./core/media-strip.types";
import { DATA_VALUE_ATTR, VALUE_ATTR, DEFAULT_DRAG_OVERLAY_WIDTH_PX } from "./core/media-strip.utils";
import {
  decodeDndTarget,
  detectCollision,
  resolveDropTargetInfo,
  resolveTimelineCommandFromDrag,
} from "./core/media-strip.dnd";
import {
  type MediaStripDndCollisionDetection,
  type MediaStripDndDragEndEvent,
  type MediaStripDndDragMoveEvent,
  type MediaStripDndDragOverEvent,
  type MediaStripDndDragStartEvent,
  type MediaStripDndIdentifier,
} from "./core/media-strip.dnd-adapter";
import { type MediaStripDndDropTargetInfo } from "./media-strip-dnd.types";

type ItemLookup = Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>;

type UseMediaStripBoardDragControllerProps = {
  containerRef: RefObject<HTMLDivElement | null>;
  itemLookup: ItemLookup;
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>;
  parentByCollectionId: ReadonlyMap<CollectionId, CollectionId>;
  activeDragId: TimelineItemId | null;
  activeDragSourceCollectionId: CollectionId | null;
  startDrag: (itemId: TimelineItemId, collectionId: CollectionId, width: number) => void;
  moveDrag: (nestTargetId: CollectionId | null, placement: DropPlacement | null) => void;
  endDrag: () => void;
  applyCommand: (command: TimelineItemCommand) => void;
  announce: (message: string) => void;
  /** Called with the dragged item's id when a drop is rejected for a
   * reason the user should see, not just hear (currently: nest cycles). */
  flashRejection: (itemId: TimelineItemId) => void;
};

/**
 * Defensive cycle guard for the pointer-move hot path: a corrupt graph
 * must not hang it.
 */
function isAncestorCollection(
  possibleAncestor: CollectionId,
  child: CollectionId,
  parentByCollectionId: ReadonlyMap<CollectionId, CollectionId>
): boolean {
  const seen = new Set<CollectionId>();
  let currentId = parentByCollectionId.get(child);
  while (currentId !== undefined) {
    if (currentId === possibleAncestor) {
      return true;
    }
    if (seen.has(currentId)) {
      return false;
    }
    seen.add(currentId);
    currentId = parentByCollectionId.get(currentId);
  }
  return false;
}

/**
 * Owns the raw pointer-driven drag event handlers for MediaStripBoard:
 * dnd-kit collision detection, drop-target resolution for the
 * pointer/native adapters, the drag lifecycle callbacks (including turning
 * a completed drag into a command via `resolveTimelineCommandFromDrag`),
 * and the autoscroll `canScroll` policy. Extracted out of the board
 * component so the component itself only has to compose providers.
 */
export function useMediaStripBoardDragController({
  containerRef,
  itemLookup,
  collectionsById,
  parentByCollectionId,
  activeDragId,
  activeDragSourceCollectionId,
  startDrag,
  moveDrag,
  endDrag,
  applyCommand,
  announce,
  flashRejection,
}: UseMediaStripBoardDragControllerProps) {
  const activeNestTargetRef = useRef<CollectionId | null>(null);
  const activeDropPlacementRef = useRef<DropPlacement | null>(null);
  const activeOverCollectionIdRef = useRef<CollectionId | null>(null);

  const collisionDetectionStrategy = useCallback<MediaStripDndCollisionDetection>((args) => {
    const { nestTargetId, placement, intersections } = detectCollision({
      active: args.active,
      collisionRect: args.collisionRect,
      droppableRects: args.droppableRects,
      pointerCoordinates: args.pointerCoordinates,
      droppableContainers: args.droppableContainers,
      itemLookup,
    });
    activeNestTargetRef.current = nestTargetId;
    activeDropPlacementRef.current = placement;
    return intersections;
  }, [itemLookup]);

  const handleDragStart = useCallback((event: MediaStripDndDragStartEvent) => {
    const decoded = decodeDndTarget(String(event.active.id));
    if (!decoded || decoded.type !== "item") return;
    const itemId = decoded.itemId;

    let dragWidth = DEFAULT_DRAG_OVERLAY_WIDTH_PX;
    const escapedId = CSS.escape(String(itemId));
    const activeEl = containerRef.current?.querySelector(
      `[${DATA_VALUE_ATTR}="${escapedId}"], [${VALUE_ATTR}="${escapedId}"]`
    );
    if (activeEl) {
      dragWidth = activeEl.getBoundingClientRect().width;
    }

    const found = itemLookup.get(itemId);
    if (found) {
      activeOverCollectionIdRef.current = found.collectionId;
      startDrag(itemId, found.collectionId, dragWidth);
      announce(`Picked up item "${found.item.name}".`);
    }
  }, [containerRef, itemLookup, announce, startDrag]);

  const handleDragMove = useCallback((event?: MediaStripDndDragMoveEvent) => {
    if (event && "nestTargetId" in event) {
      activeNestTargetRef.current = event.nestTargetId ?? null;
    }
    if (event && "placement" in event) {
      activeDropPlacementRef.current = event.placement ?? null;
    }
    moveDrag(activeNestTargetRef.current, activeDropPlacementRef.current);
  }, [moveDrag]);

  const handleDragOver = useCallback((event: MediaStripDndDragOverEvent) => {
    if ("nestTargetId" in event) {
      activeNestTargetRef.current = event.nestTargetId ?? null;
    }
    if ("placement" in event) {
      activeDropPlacementRef.current = event.placement ?? null;
    }
    moveDrag(activeNestTargetRef.current, activeDropPlacementRef.current);
    const { over } = event;
    if (over) {
      const decoded = decodeDndTarget(String(over.id));
      if (decoded) {
        if (decoded.type === "collection-container") {
          activeOverCollectionIdRef.current = decoded.collectionId;
        } else if (decoded.type === "item") {
          const found = itemLookup.get(decoded.itemId);
          if (found) {
            activeOverCollectionIdRef.current = found.collectionId;
          }
        } else if (decoded.type === "collection-nest-target") {
          activeOverCollectionIdRef.current = decoded.collectionId;
        }
      }
    } else {
      activeOverCollectionIdRef.current = null;
    }
  }, [moveDrag, itemLookup]);

  const handleDragEnd = useCallback((event: MediaStripDndDragEndEvent) => {
    const itemId = activeDragId;
    const placement = ("placement" in event ? event.placement : undefined) ?? activeDropPlacementRef.current;

    activeNestTargetRef.current = null;
    activeDropPlacementRef.current = null;
    activeOverCollectionIdRef.current = null;

    const resolution = resolveTimelineCommandFromDrag({
      itemId,
      placement,
      itemLookup,
      collectionsById,
    });

    if (resolution.ok) {
      applyCommand(resolution.command);
    } else if (resolution.reason === "cycle" && itemId) {
      // "cancelled" and "same-position" aren't failures worth a visual cue —
      // the first is the user changing their mind, the second is
      // effectively a no-op success. A cycle rejection is the one case
      // where the user tried something and it didn't work.
      flashRejection(itemId);
    }
    announce(resolution.announcement);

    endDrag();
  }, [
    activeDragId,
    itemLookup,
    collectionsById,
    applyCommand,
    flashRejection,
    announce,
    endDrag,
  ]);

  const getDropTargetInfo = useCallback(({
    activeId,
    element,
    input,
    overId,
  }: {
    activeId: MediaStripDndIdentifier;
    element: Element;
    input: { clientX: number; clientY: number };
    overId: MediaStripDndIdentifier;
  }): MediaStripDndDropTargetInfo => {
    const decodedOver = decodeDndTarget(String(overId));
    const rect = element.getBoundingClientRect();
    return resolveDropTargetInfo({
      activeId,
      decodedOver,
      rect,
      point: { x: input.clientX, y: input.clientY },
      itemLookup,
    });
  }, [itemLookup]);

  const handleDragCancel = useCallback(() => {
    activeNestTargetRef.current = null;
    activeDropPlacementRef.current = null;
    activeOverCollectionIdRef.current = null;
    endDrag();
    announce("Cancelled drag.");
  }, [endDrag, announce]);

  const canScroll = useCallback((element: Element) => {
    if (!activeDragSourceCollectionId) return true;
    const colEl = element.closest("[data-collection-id]");
    if (!colEl) return true;
    const parsedColId = parseCollectionId(colEl.getAttribute("data-collection-id") ?? "");
    // An unparseable id can't match the source or hovered strip.
    if (!parsedColId.ok) return false;
    const colId = parsedColId.value;

    // 1. Always scroll the active drag source container
    if (colId === activeDragSourceCollectionId) return true;

    // 2. Scroll the currently hovered container, unless it is an ancestor of the source container
    if (colId === activeOverCollectionIdRef.current) {
      return !isAncestorCollection(colId, activeDragSourceCollectionId, parentByCollectionId);
    }

    return false;
  }, [activeDragSourceCollectionId, parentByCollectionId]);

  return {
    collisionDetectionStrategy,
    getDropTargetInfo,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    canScroll,
  };
}

import {
  type CollectionId,
  type TimelineCollection,
  type TimelineItemId,
  type TimelineItem,
  type DndTarget,
  parseTimelineItemId,
  parseCollectionId,
} from "./media-strip.types";
import { NEST_HOTSPOT_MIN_OFFSET, NEST_HOTSPOT_MAX_OFFSET } from "./media-strip.utils";
import {
  getClosestCenterCollisions,
  type MediaStripDndActive,
  type MediaStripDndClientRect,
  type MediaStripDndCollision,
  type MediaStripDndDroppableContainer,
  type MediaStripDndIdentifier,
} from "./media-strip.dnd-adapter";

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
 * Pure helper function to resolve drop intent (insert index and target collection) during dragging.
 * Returns a 'move' command payload structure.
 */
export function resolveDropIntent({
  overId,
  activeId,
  collectionsById,
  itemLookup,
}: {
  overId: MediaStripDndIdentifier;
  activeId: MediaStripDndIdentifier;
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>;
  itemLookup: Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>;
}): { type: "move"; itemId: TimelineItemId; fromCollectionId: CollectionId; toCollectionId: CollectionId; toIndex: number } | null {
  const decodedActive = decodeDndTarget(String(activeId));
  if (!decodedActive || decodedActive.type !== "item") return null;
  const itemId = decodedActive.itemId;

  const foundSource = itemLookup.get(itemId);
  if (!foundSource) return null;

  const decodedOver = decodeDndTarget(String(overId));
  if (!decodedOver) return null;

  if (decodedOver.type === "collection-container") {
    const col = collectionsById.get(decodedOver.collectionId);
    return {
      type: "move",
      itemId,
      fromCollectionId: foundSource.collectionId,
      toCollectionId: decodedOver.collectionId,
      toIndex: col ? col.items.length : 0,
    };
  }

  if (decodedOver.type === "item") {
    const foundTarget = itemLookup.get(decodedOver.itemId);
    if (foundTarget) {
      return {
        type: "move",
        itemId,
        fromCollectionId: foundSource.collectionId,
        toCollectionId: foundTarget.collectionId,
        toIndex: foundTarget.index,
      };
    }
  }

  return null;
}

export type DetectCollisionProps = {
  active: MediaStripDndActive;
  collisionRect: MediaStripDndClientRect;
  droppableRects: Map<MediaStripDndIdentifier, MediaStripDndClientRect>;
  pointerCoordinates: { x: number; y: number } | null;
  droppableContainers: MediaStripDndDroppableContainer[];
  itemLookup: Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>;
};

/**
 * Pure, React-independent collision detection algorithm wrapper.
 * Calculates intersections and determines if the active item is hovered over a collection card's hotspot to trigger nesting.
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
  intersections: MediaStripDndCollision[];
} {
  const activeId = active.id;
  const itemContainers = droppableContainers.filter(
    (c) => decodeDndTarget(String(c.id))?.type === "item" && c.id !== activeId
  );
  const containerBackgrounds = droppableContainers.filter(
    (c) => decodeDndTarget(String(c.id))?.type === "collection-container"
  );

  let intersections = getClosestCenterCollisions({
    active,
    collisionRect,
    droppableRects,
    droppableContainers: itemContainers,
    pointerCoordinates,
  });

  if (intersections.length === 0) {
    intersections = getClosestCenterCollisions({
      active,
      collisionRect,
      droppableRects,
      droppableContainers: containerBackgrounds,
      pointerCoordinates,
    });
  }

  let nestTargetId: CollectionId | null = null;
  if (intersections.length > 0 && pointerCoordinates) {
    const primaryCollision = intersections[0];
    const decoded = decodeDndTarget(String(primaryCollision.id));
    if (decoded && decoded.type === "item") {
      const found = itemLookup.get(decoded.itemId);
      if (found && found.item.kind === "collection") {
        const container = droppableContainers.find((c) => c.id === primaryCollision.id);
        const rect = container?.rect.current;
        if (rect) {
          const width = rect.width;
          const height = rect.height;
          const hotspotLeft = rect.left + width * NEST_HOTSPOT_MIN_OFFSET;
          const hotspotRight = rect.left + width * NEST_HOTSPOT_MAX_OFFSET;
          const hotspotTop = rect.top + height * NEST_HOTSPOT_MIN_OFFSET;
          const hotspotBottom = rect.top + height * NEST_HOTSPOT_MAX_OFFSET;

          const px = pointerCoordinates.x;
          const py = pointerCoordinates.y;

          if (px >= hotspotLeft && px <= hotspotRight && py >= hotspotTop && py <= hotspotBottom) {
            const activeDecoded = decodeDndTarget(String(activeId));
            const activeItemId = activeDecoded?.type === "item" ? activeDecoded.itemId : activeId;
            if (activeItemId !== found.item.id) {
              nestTargetId = found.item.collectionId;
            }
          }
        }
      }
    }
  }

  return { nestTargetId, intersections };
}

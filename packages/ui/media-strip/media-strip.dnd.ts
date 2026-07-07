import { type UniqueIdentifier, type Collision, closestCenter } from "@dnd-kit/core";
import {
  type CollectionId,
  type TimelineCollection,
  type TimelineItemId,
  type TimelineItem,
  type DndTarget,
  type TimelineItemCommand,
} from "./media-strip.types";

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
    return { type: "item", itemId: value as TimelineItemId };
  } else if (prefix === "container") {
    return { type: "collection-container", collectionId: value as CollectionId };
  } else if (prefix === "nest") {
    return { type: "collection-nest-target", collectionId: value as CollectionId };
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
  overId: UniqueIdentifier;
  activeId: UniqueIdentifier;
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
  active: { id: UniqueIdentifier; rect: { current: any } };
  collisionRect: any;
  droppableRects: any;
  pointerCoordinates: { x: number; y: number } | null;
  droppableContainers: any[];
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
  intersections: Collision[];
} {
  const activeId = active.id;
  const itemContainers = droppableContainers.filter(
    (c) => decodeDndTarget(String(c.id))?.type === "item" && c.id !== activeId
  );
  const containerBackgrounds = droppableContainers.filter(
    (c) => decodeDndTarget(String(c.id))?.type === "collection-container"
  );

  let intersections = closestCenter({
    active: active as any,
    collisionRect,
    droppableRects,
    droppableContainers: itemContainers,
    pointerCoordinates,
  });

  if (intersections.length === 0) {
    intersections = closestCenter({
      active: active as any,
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
          const hotspotLeft = rect.left + width * 0.2;
          const hotspotRight = rect.left + width * 0.8;
          const hotspotTop = rect.top + height * 0.2;
          const hotspotBottom = rect.top + height * 0.8;

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

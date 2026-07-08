import { type CollectionId } from "./media-strip.types";

export type MediaStripDndAdapterId = "dnd-kit" | "pragmatic" | "native-html5";
export type MediaStripDndIdentifier = string | number;
export type MediaStripDndActive = Readonly<{ id: MediaStripDndIdentifier }>;
export type MediaStripDndClientRect = Readonly<{
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}>;
export type MediaStripDndCollision = Readonly<{
  id: MediaStripDndIdentifier;
  data?: Readonly<{ value?: number }>;
}>;
export type MediaStripDndDroppableContainer = Readonly<{
  id: MediaStripDndIdentifier;
  rect: Readonly<{ current: MediaStripDndClientRect | null }>;
}>;
export type MediaStripDndCollisionDetectionArgs = Readonly<{
  active: MediaStripDndActive;
  collisionRect: MediaStripDndClientRect;
  droppableRects: ReadonlyMap<MediaStripDndIdentifier, MediaStripDndClientRect>;
  pointerCoordinates: Readonly<{ x: number; y: number }> | null;
  droppableContainers: readonly MediaStripDndDroppableContainer[];
}>;
export type MediaStripDndCollisionDetection = (
  args: MediaStripDndCollisionDetectionArgs
) => MediaStripDndCollision[];

export type MediaStripDndAutoScrollOptions = Readonly<{
  canScroll?: (element: Element) => boolean;
  maxSpeed?: number;
  threshold?: number;
}>;

export type MediaStripDndDragStartEvent = {
  active: { id: MediaStripDndIdentifier };
};

export type MediaStripDndNormalizedDragMoveEvent = {
  active: { id: MediaStripDndIdentifier };
  over: { id: MediaStripDndIdentifier } | null;
  nestTargetId?: CollectionId | null;
};

export type MediaStripDndDragMoveEvent = MediaStripDndNormalizedDragMoveEvent;
export type MediaStripDndDragOverEvent = MediaStripDndNormalizedDragMoveEvent;
export type MediaStripDndDragEndEvent = MediaStripDndNormalizedDragMoveEvent;

export function getClosestCenterCollisions({
  collisionRect,
  droppableContainers,
}: MediaStripDndCollisionDetectionArgs): MediaStripDndCollision[] {
  const collisionCenter = getRectCenter(collisionRect);

  return droppableContainers
    .flatMap((container): MediaStripDndCollision[] => {
      const rect = container.rect.current;
      if (!rect) return [];

      const center = getRectCenter(rect);
      const value = Math.hypot(
        collisionCenter.x - center.x,
        collisionCenter.y - center.y
      );

      return [{
        id: container.id,
        data: { value },
      }];
    })
    .sort((a, b) => (a.data?.value ?? 0) - (b.data?.value ?? 0));
}

function getRectCenter(rect: MediaStripDndClientRect): { x: number; y: number } {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

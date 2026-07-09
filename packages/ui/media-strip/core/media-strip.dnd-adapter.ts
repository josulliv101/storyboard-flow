import { type CollectionId, type DropPlacement } from "./media-strip.types";

export type MediaStripDndAdapterId = "dnd-kit" | "pragmatic" | "native-html5";
// Every id in this package is produced by `encodeDndTarget` (`"item:xyz"`,
// `"container:xyz"`, ...) and is always a string. dnd-kit's own
// `UniqueIdentifier` is `string | number`, but that `| number` only exists at
// the dnd-kit adapter boundary — it's coerced to string there (see
// dnd-kit-adapter.tsx) so nothing downstream has to `String(...)` an id or
// worry about a numeric id bypassing the encoded-string protocol.
export type MediaStripDndIdentifier = string;
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

// nestTargetId/placement are required-but-nullable, NOT optional: an
// adapter that doesn't resolve them (dnd-kit — its collision-detection
// callback resolves the same info out-of-band) must say `null` explicitly
// rather than omitting the fields. Optional fields forced consumers into
// `"placement" in event` shape-sniffing to tell "adapter didn't resolve
// this" apart from "adapter resolved it to nothing", and made silently
// forgetting to forward them a type-legal bug.
export type MediaStripDndNormalizedDragMoveEvent = {
  active: { id: MediaStripDndIdentifier };
  over: { id: MediaStripDndIdentifier } | null;
  nestTargetId: CollectionId | null;
  placement: DropPlacement | null;
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

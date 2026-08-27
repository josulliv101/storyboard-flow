import { type NodeId } from "@storyboard/collections-core/graph";

// Droppable `data` contract between virtualized containers and the
// provider's collision detection. A virtualized view can't be resolved
// from card rects (most cards aren't mounted), so the container droppable
// carries a resolver that maps the pointer to a VISIBLE boundary index
// using the view's own virtualizer/layout math. The provider turns that
// into an `insert-at-index` intent; everything downstream (validity
// preview, command resolution, reducer) is the standard pipeline.

export type VirtualInsertTarget = Readonly<{
  collectionId: NodeId;
  /** Viewport-space pointer -> visible boundary index (0..children.length). */
  resolveBoundary: (point: Readonly<{ x: number; y: number }>) => number;
}>;

/** Key under which the target sits in a droppable's `data`. */
export const VIRTUAL_INSERT_DATA_KEY = "virtualInsert";

/**
 * Runtime guard for the payload above. dnd-kit's `data` bag is untyped, so a
 * value read back out of it is `unknown` — narrow it here instead of casting,
 * to reject a malformed or foreign entry at the seam.
 */
export function isVirtualInsertTarget(value: unknown): value is VirtualInsertTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  return (
    typeof target.collectionId === "string" && typeof target.resolveBoundary === "function"
  );
}

/**
 * The other virtualized drop shape: a LANE ROW, which resolves to a lane and a
 * TIME rather than to a boundary index.
 *
 * A row cannot use `VirtualInsertTarget` because an index means nothing on a
 * lane — clips there are positioned by their own start, not by their place in
 * a queue. `resolveTime` maps the pointer to a time on the consumer's clock,
 * with whatever snapping the view applies already done, so the provider only
 * has to route the number.
 *
 * Lane 0 (the picture) registers one too: dropping a layered clip onto it is
 * how the clip rejoins the cut.
 */
export type VirtualPlaceTarget = Readonly<{
  collectionId: NodeId;
  /** 0 is the picture; anything above runs underneath it. */
  lane: number;
  /** Viewport-space pointer -> a start time on the consumer's clock. */
  resolveTime: (point: Readonly<{ x: number; y: number }>) => number;
}>;

/** Key under which the target sits in a droppable's `data`. */
export const VIRTUAL_PLACE_DATA_KEY = "virtualPlace";

/** Runtime guard, for the same reason `isVirtualInsertTarget` has one: dnd-kit's
 *  `data` bag is untyped, so narrow at the seam rather than casting. */
export function isVirtualPlaceTarget(value: unknown): value is VirtualPlaceTarget {
  if (typeof value !== "object" || value === null) return false;
  const target = value as Record<string, unknown>;
  return (
    typeof target.collectionId === "string" &&
    typeof target.lane === "number" &&
    typeof target.resolveTime === "function"
  );
}

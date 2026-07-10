import { type NodeId } from "../core/graph";

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

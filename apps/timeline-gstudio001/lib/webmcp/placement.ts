import { getChildren, type CollectionsGraph, type NodeId } from "@storyboard/ui/dnd-collections";

// Pure placement math for move_clip: turn a SEMANTIC anchor (before/after a
// sibling, or start/end of a collection) into the reducer's `toIndex`. The
// agent never computes indexes — this does, including the reducer's
// post-removal convention (`toIndex` is the target's children index AFTER the
// moved node is removed, so a same-parent reorder past the node shifts down).

export type MovePlacementInput = Readonly<{
  /** The node being moved. */
  nodeId: NodeId;
  /** The collection it should end up in (already resolved from `into` or the current parent). */
  targetId: NodeId;
  before?: NodeId;
  after?: NodeId;
  position?: "start" | "end";
}>;

export type PlacementError =
  | Readonly<{ reason: "conflicting-anchors" }>
  | Readonly<{ reason: "unknown-anchor"; anchor: NodeId }>;

export type PlacementOutcome =
  | Readonly<{ ok: true; toParentId: NodeId; toIndex: number }>
  | Readonly<{ ok: false; error: PlacementError }>;

export function resolveMovePlacement(
  graph: CollectionsGraph,
  input: MovePlacementInput,
): PlacementOutcome {
  const anchorCount =
    (input.before !== undefined ? 1 : 0) +
    (input.after !== undefined ? 1 : 0) +
    (input.position !== undefined ? 1 : 0);
  if (anchorCount > 1) return { ok: false, error: { reason: "conflicting-anchors" } };

  const siblings = getChildren(graph, input.targetId);

  // Pre-removal insertion index within the current sibling order.
  let pre: number;
  if (input.before !== undefined) {
    const at = siblings.indexOf(input.before);
    if (at < 0) return { ok: false, error: { reason: "unknown-anchor", anchor: input.before } };
    pre = at;
  } else if (input.after !== undefined) {
    const at = siblings.indexOf(input.after);
    if (at < 0) return { ok: false, error: { reason: "unknown-anchor", anchor: input.after } };
    pre = at + 1;
  } else if (input.position === "start") {
    pre = 0;
  } else {
    pre = siblings.length;
  }

  // Post-removal adjustment: only when reordering WITHIN the same collection
  // does removing the node shift the target index down by one.
  const currentIndex =
    graph.parentById.get(input.nodeId) === input.targetId ? siblings.indexOf(input.nodeId) : -1;
  const toIndex = currentIndex >= 0 && currentIndex < pre ? pre - 1 : pre;

  return { ok: true, toParentId: input.targetId, toIndex };
}

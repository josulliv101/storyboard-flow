import {
  type CollectionsGraph,
  type NodeId,
  type Result,
  getChildren,
  getDocumentOrder,
  isSameOrAncestor,
} from "./graph";
import { type CollectionsPatch, type NodeMove, applyPatch } from "./patches";

// Commands are the ONLY way graph state changes. `applyCommand` validates,
// constructs a reversible patch, and applies it via `applyPatch` — the same
// code path undo/redo replays, so forward and inverse application can't
// drift apart. One command covers every drag-drop mutation: reorder within a
// collection, move across collections, nest, and multi-node moves are all
// `move-nodes` with different inputs.

export type CollectionsCommand = Readonly<{
  type: "move-nodes";
  /** In any order; descendants of other dragged nodes are pruned (a subtree moves with its root). */
  nodeIds: readonly NodeId[];
  toParentId: NodeId;
  /**
   * Insertion index in the target's children AFTER the dragged nodes have
   * been removed from it (post-removal index). `resolveCommandFromIntent`
   * does that math from on-screen positions — callers constructing commands
   * directly must apply the same convention.
   */
  toIndex: number;
}>;

export type CommandRejection =
  | Readonly<{ reason: "missing-node"; nodeId: NodeId }>
  | Readonly<{ reason: "target-not-collection"; nodeId: NodeId }>
  | Readonly<{ reason: "would-create-cycle"; nodeId: NodeId }>
  | Readonly<{ reason: "cannot-move-root"; nodeId: NodeId }>
  | Readonly<{ reason: "nothing-to-move" }>
  | Readonly<{ reason: "same-position" }>;

export type ApplyCommandSuccess = Readonly<{
  graph: CollectionsGraph;
  patch: CollectionsPatch;
}>;

export function applyCommand(
  graph: CollectionsGraph,
  command: CollectionsCommand
): Result<ApplyCommandSuccess, CommandRejection> {
  const { toParentId, toIndex } = command;

  const target = graph.nodesById.get(toParentId);
  if (!target) return { ok: false, error: { reason: "missing-node", nodeId: toParentId } };
  if (target.kind !== "collection") {
    return { ok: false, error: { reason: "target-not-collection", nodeId: toParentId } };
  }

  // Validate every dragged id AND capture its parent up front. Roots are
  // structurally unmovable: they are the graph's top-level anchors
  // (`rootIds` isn't part of the patch model, so "moving" one would leave
  // it both a root and a child — the exact corruption the invariant checker
  // exists to catch). Rejecting here is what lets the move construction
  // below read parents with no non-null assertions.
  const parentByMovingId = new Map<NodeId, NodeId>();
  for (const id of command.nodeIds) {
    if (!graph.nodesById.has(id)) {
      return { ok: false, error: { reason: "missing-node", nodeId: id } };
    }
    const parentId = graph.parentById.get(id);
    if (parentId === undefined) {
      // Present in nodesById but unindexed — a corrupt graph; treat as missing.
      return { ok: false, error: { reason: "missing-node", nodeId: id } };
    }
    if (parentId === null) {
      return { ok: false, error: { reason: "cannot-move-root", nodeId: id } };
    }
    parentByMovingId.set(id, parentId);
  }

  // Prune descendants of other dragged nodes: moving a collection moves its
  // whole subtree implicitly, so an explicitly-selected descendant would
  // otherwise be ripped out of its (also moving) parent.
  const draggedSet = new Set(command.nodeIds);
  const pruned = command.nodeIds.filter((id) => {
    let parent = graph.parentById.get(id) ?? null;
    while (parent !== null) {
      if (draggedSet.has(parent)) return false;
      parent = graph.parentById.get(parent) ?? null;
    }
    return true;
  });
  if (pruned.length === 0) return { ok: false, error: { reason: "nothing-to-move" } };

  // Cycle guard: a node can't move into itself or its own descendant.
  for (const id of pruned) {
    if (isSameOrAncestor(graph, id, toParentId)) {
      return { ok: false, error: { reason: "would-create-cycle", nodeId: id } };
    }
  }

  // Multi-node moves preserve the dragged nodes' relative document order,
  // regardless of selection order.
  const order = getDocumentOrder(graph);
  const moving = [...pruned].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  const movingSet = new Set(moving);

  // Clamp the post-removal insertion index against the target's children
  // with dragged nodes removed.
  const targetChildren = getChildren(graph, toParentId);
  const baseLength = targetChildren.reduce(
    (count, id) => (movingSet.has(id) ? count : count + 1),
    0
  );
  const insertAt = Math.max(0, Math.min(toIndex, baseLength));

  const moves: NodeMove[] = moving.map((id, k) => {
    // Non-null by construction: `moving` ⊆ `command.nodeIds`, and every one
    // of those was validated (and its parent captured) in the loop above —
    // roots and unindexed ids were rejected there.
    const fromParentId = parentByMovingId.get(id)!;
    return {
      nodeId: id,
      fromParentId,
      fromIndex: getChildren(graph, fromParentId).indexOf(id),
      toParentId,
      toIndex: insertAt + k,
    };
  });

  const nextGraph = applyPatch(graph, { type: "nodes-moved", moves });

  // No-op detection AFTER applying: same-position moves (including
  // multi-node arrangements that happen to land where they started) produce
  // an identical children layout. Cheap check — only affected parents can
  // differ, and applyPatch shares structure for everything else.
  if (graphChildrenEqual(graph, nextGraph)) {
    return { ok: false, error: { reason: "same-position" } };
  }

  return { ok: true, value: { graph: nextGraph, patch: { type: "nodes-moved", moves } } };
}

function graphChildrenEqual(a: CollectionsGraph, b: CollectionsGraph): boolean {
  if (a.childrenById === b.childrenById) return true;
  for (const [id, childrenA] of a.childrenById) {
    const childrenB = b.childrenById.get(id);
    if (childrenA === childrenB) continue;
    if (!childrenB || childrenA.length !== childrenB.length) return false;
    for (let i = 0; i < childrenA.length; i++) {
      if (childrenA[i] !== childrenB[i]) return false;
    }
  }
  return true;
}

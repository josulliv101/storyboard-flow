import {
  type CollectionItemNode,
  type CollectionsGraph,
  type NodeId,
  type Result,
  getChildren,
  getDocumentOrder,
  isSameOrAncestor,
} from "./graph";
import { type CollectionsPatch, type NodeAdd, type NodeMove, applyPatch } from "./patches";

// Commands are the ONLY way graph state changes. `applyCommand` validates,
// constructs a reversible patch, and applies it via `applyPatch` — the same
// code path undo/redo replays, so forward and inverse application can't
// drift apart. One command covers every drag-drop mutation: reorder within a
// collection, move across collections, nest, and multi-node moves are all
// `move-nodes` with different inputs.

export type CollectionsCommand =
  | Readonly<{
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
    }>
  | Readonly<{
      type: "add-nodes";
      /** Brand-new nodes (palette drops); ids must not exist in the graph. New collections start empty. */
      nodes: readonly CollectionItemNode[];
      toParentId: NodeId;
      toIndex: number;
    }>;

export type CommandRejection =
  | Readonly<{ reason: "missing-node"; nodeId: NodeId }>
  | Readonly<{ reason: "target-not-collection"; nodeId: NodeId }>
  | Readonly<{ reason: "would-create-cycle"; nodeId: NodeId }>
  | Readonly<{ reason: "cannot-move-root"; nodeId: NodeId }>
  | Readonly<{ reason: "duplicate-node-id"; nodeId: NodeId }>
  /** An added node's id is empty or whitespace-only — ids are the addressing scheme. */
  | Readonly<{ reason: "invalid-node-id"; nodeId: NodeId }>
  | Readonly<{ reason: "nothing-to-move" }>
  | Readonly<{ reason: "nothing-to-add" }>
  | Readonly<{ reason: "invalid-index" }>
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
  // Only whole numbers index an array. NaN/±Infinity survive Math.min/max and
  // splice at 0; a fraction is recorded verbatim in the patch but truncated
  // by splice, so forward apply and replay would disagree. Reject all three.
  if (!Number.isInteger(toIndex)) {
    return { ok: false, error: { reason: "invalid-index" } };
  }

  if (command.type === "add-nodes") {
    if (command.nodes.length === 0) return { ok: false, error: { reason: "nothing-to-add" } };
    const batchIds = new Set<NodeId>();
    for (const node of command.nodes) {
      // An empty/whitespace id can't be addressed or encoded as a droppable
      // ("node:" decodes to null), so the card could never be a drop target.
      // buildGraph rejects these; the reducer must too — added nodes are
      // consumer-supplied (palette factories).
      if (!node.id || !node.id.trim()) {
        return { ok: false, error: { reason: "invalid-node-id", nodeId: node.id } };
      }
      // A colliding id — with the graph or within the batch — would corrupt
      // every index; ids are the addressing scheme.
      if (graph.nodesById.has(node.id) || batchIds.has(node.id)) {
        return { ok: false, error: { reason: "duplicate-node-id", nodeId: node.id } };
      }
      batchIds.add(node.id);
    }
    const insertAt = Math.max(0, Math.min(toIndex, getChildren(graph, toParentId).length));
    const adds: NodeAdd[] = command.nodes.map((node, k) => ({
      node,
      parentId: toParentId,
      index: insertAt + k,
    }));
    const patch: CollectionsPatch = { type: "nodes-added", adds };
    return { ok: true, value: { graph: applyPatch(graph, patch), patch } };
  }

  // Validate every dragged id AND capture its parent up front. Roots are
  // structurally unmovable: they are the graph's top-level anchors
  // (`rootIds` isn't part of the patch model, so "moving" one would leave
  // it both a root and a child — the exact corruption the invariant checker
  // exists to catch). Rejecting here is what lets the move construction
  // below read parents with no non-null assertions.
  const parentByMovingId = new Map<NodeId, NodeId>();
  for (const id of command.nodeIds) {
    // A duplicated id would survive pruning and yield two moves for one
    // node — applyPatch would remove it once but insert it twice, leaving a
    // duplicate child. Duplicates mean the caller has a bug: reject loudly
    // rather than silently deduping.
    if (parentByMovingId.has(id)) {
      return { ok: false, error: { reason: "duplicate-node-id", nodeId: id } };
    }
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
    // Cycle-guarded like isSameOrAncestor: a corrupt parentById chain would
    // otherwise spin this loop forever. A detected cycle degrades to "keep"
    // (the reducer's other guards reject the resulting move).
    const seen = new Set<NodeId>();
    let parent = graph.parentById.get(id) ?? null;
    while (parent !== null) {
      if (draggedSet.has(parent)) return false;
      if (seen.has(parent)) return true;
      seen.add(parent);
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

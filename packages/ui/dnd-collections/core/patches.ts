import { type CollectionsGraph, type NodeId } from "./graph";

// Patches are the reversible, serializable record of every graph mutation:
// the same primitive backs undo/redo (apply the inverse), persistence
// (replay the log), the consumer onChange payload, and devtools/history
// inspection. `applyCommand` VALIDATES and constructs a patch;
// `applyPatch` is the only code that actually rewrites graph indexes —
// so undo/redo can't drift from forward application.

/**
 * One node's relocation. `fromIndex` is the node's index in the PRE-patch
 * state; `toIndex` is its index in the POST-patch state. Recording both
 * endpoints in their own state's coordinates is what makes the patch
 * trivially invertible: swap from/to and apply the same algorithm.
 */
export type NodeMove = Readonly<{
  nodeId: NodeId;
  fromParentId: NodeId;
  fromIndex: number;
  toParentId: NodeId;
  toIndex: number;
}>;

export type CollectionsPatch = Readonly<{
  type: "nodes-moved";
  moves: readonly NodeMove[];
}>;

/** Swap each move's endpoints — applying the result undoes the original. */
export function invertPatch(patch: CollectionsPatch): CollectionsPatch {
  return {
    type: "nodes-moved",
    moves: patch.moves.map((move) => ({
      nodeId: move.nodeId,
      fromParentId: move.toParentId,
      fromIndex: move.toIndex,
      toParentId: move.fromParentId,
      toIndex: move.fromIndex,
    })),
  };
}

/**
 * Applies a patch to the graph. Two phases: remove every moved node from its
 * current parent, then insert per destination parent in ascending `toIndex`
 * order — ascending insertion into the shrunken arrays lands each node at
 * exactly its recorded post-state index. Structural sharing: only the
 * children arrays of affected parents are re-allocated; `nodesById` is
 * reused untouched — that reference stability is what lets per-node
 * selector subscriptions skip re-renders for uninvolved nodes.
 */
export function applyPatch(
  graph: CollectionsGraph,
  patch: CollectionsPatch
): CollectionsGraph {
  if (patch.moves.length === 0) return graph;

  const nextChildren = new Map(graph.childrenById);
  const nextParent = new Map(graph.parentById);

  // Phase 1: remove from source parents (batch per parent to avoid
  // re-allocating one parent's array once per node).
  const removedByParent = new Map<NodeId, Set<NodeId>>();
  for (const move of patch.moves) {
    let set = removedByParent.get(move.fromParentId);
    if (!set) removedByParent.set(move.fromParentId, (set = new Set()));
    set.add(move.nodeId);
  }
  for (const [parentId, removedIds] of removedByParent) {
    const children = nextChildren.get(parentId) ?? [];
    nextChildren.set(parentId, children.filter((id) => !removedIds.has(id)));
  }

  // Phase 2: insert into destination parents, ascending by toIndex.
  const insertsByParent = new Map<NodeId, NodeMove[]>();
  for (const move of patch.moves) {
    let list = insertsByParent.get(move.toParentId);
    if (!list) insertsByParent.set(move.toParentId, (list = []));
    list.push(move);
  }
  for (const [parentId, inserts] of insertsByParent) {
    const children = [...(nextChildren.get(parentId) ?? [])];
    inserts.sort((a, b) => a.toIndex - b.toIndex);
    for (const move of inserts) {
      const index = Math.max(0, Math.min(move.toIndex, children.length));
      children.splice(index, 0, move.nodeId);
      nextParent.set(move.nodeId, parentId);
    }
    nextChildren.set(parentId, children);
  }

  return {
    nodesById: graph.nodesById,
    childrenById: nextChildren,
    parentById: nextParent,
    rootIds: graph.rootIds,
  };
}

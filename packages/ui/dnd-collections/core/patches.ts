import { type CollectionItemNode, type CollectionsGraph, type NodeId } from "./graph";

// Patches are the reversible, serializable record of every graph mutation:
// the same primitive backs undo/redo (apply the inverse), the consumer
// onChange payload, and devtools/history inspection. Durable/external replay
// goes through the checked versioned envelope in patch-replay.ts.
// `applyCommand` VALIDATES and constructs a patch;
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

/**
 * One node's insertion (palette drops) — or, read in reverse, one node's
 * removal. The SAME payload serves both directions: carrying the full node
 * plus its position is what makes add/remove trivially invertible and a
 * removed node restorable on redo.
 */
export type NodeAdd = Readonly<{
  node: CollectionItemNode;
  parentId: NodeId;
  index: number;
}>;

/**
 * One node's DATA change (media trim/duration) — structure untouched. Carrying
 * the full before/after node makes it trivially invertible: swap the two.
 */
export type NodeUpdate = Readonly<{
  nodeId: NodeId;
  before: CollectionItemNode;
  after: CollectionItemNode;
}>;

export type CollectionsPatch =
  | Readonly<{ type: "nodes-moved"; moves: readonly NodeMove[] }>
  | Readonly<{ type: "nodes-added"; adds: readonly NodeAdd[] }>
  /**
   * Only ever produced by inverting nodes-added. Removed nodes must be
   * childless — linear history guarantees it: any command that filled an
   * added collection came later and is undone first.
   */
  | Readonly<{ type: "nodes-removed"; removals: readonly NodeAdd[] }>
  | Readonly<{ type: "nodes-updated"; updates: readonly NodeUpdate[] }>;

/** Swap each entry's endpoints/direction — applying the result undoes the original. */
export function invertPatch(patch: CollectionsPatch): CollectionsPatch {
  switch (patch.type) {
    case "nodes-moved":
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
    case "nodes-added":
      return { type: "nodes-removed", removals: patch.adds };
    case "nodes-removed":
      return { type: "nodes-added", adds: patch.removals };
    case "nodes-updated":
      return {
        type: "nodes-updated",
        updates: patch.updates.map((u) => ({
          nodeId: u.nodeId,
          before: u.after,
          after: u.before,
        })),
      };
  }
}

/**
 * Unchecked adjacent-state patch application — the single index-rewriting code path
 * (forward apply, undo, and redo all run through it). Structural sharing:
 * moves never re-allocate `nodesById`; adds/removals touch it but leave
 * unaffected children arrays alone. Does not validate: internal undo/redo
 * applies only patches produced for the adjacent state. External callers
 * must use `replayPatchEnvelope`.
 */
export function applyPatch(
  graph: CollectionsGraph,
  patch: CollectionsPatch
): CollectionsGraph {
  switch (patch.type) {
    case "nodes-moved":
      return applyMoves(graph, patch.moves);
    case "nodes-added":
      return applyAdds(graph, patch.adds);
    case "nodes-removed":
      return applyRemovals(graph, patch.removals);
    case "nodes-updated":
      return applyUpdates(graph, patch.updates);
  }
}

// Node DATA changes only: re-allocate `nodesById` with the new node objects;
// childrenById/parentById/rootIds are structurally reused (untouched).
function applyUpdates(graph: CollectionsGraph, updates: readonly NodeUpdate[]): CollectionsGraph {
  if (updates.length === 0) return graph;
  const nextNodes = new Map(graph.nodesById);
  for (const update of updates) nextNodes.set(update.nodeId, update.after);
  return {
    nodesById: nextNodes,
    childrenById: graph.childrenById,
    parentById: graph.parentById,
    rootIds: graph.rootIds,
  };
}

function applyMoves(graph: CollectionsGraph, moves: readonly NodeMove[]): CollectionsGraph {
  if (moves.length === 0) return graph;

  const nextChildren = new Map(graph.childrenById);
  const nextParent = new Map(graph.parentById);

  // Phase 1: remove from source parents (batch per parent to avoid
  // re-allocating one parent's array once per node).
  const removedByParent = new Map<NodeId, Set<NodeId>>();
  for (const move of moves) {
    let set = removedByParent.get(move.fromParentId);
    if (!set) removedByParent.set(move.fromParentId, (set = new Set()));
    set.add(move.nodeId);
  }
  for (const [parentId, removedIds] of removedByParent) {
    const children = nextChildren.get(parentId) ?? [];
    nextChildren.set(parentId, children.filter((id) => !removedIds.has(id)));
  }

  // Phase 2: insert into destination parents, ascending by toIndex —
  // ascending insertion into the shrunken arrays lands each node at
  // exactly its recorded post-state index.
  const insertsByParent = new Map<NodeId, NodeMove[]>();
  for (const move of moves) {
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

function applyAdds(graph: CollectionsGraph, adds: readonly NodeAdd[]): CollectionsGraph {
  if (adds.length === 0) return graph;

  const nextNodes = new Map(graph.nodesById);
  const nextChildren = new Map(graph.childrenById);
  const nextParent = new Map(graph.parentById);

  const insertsByParent = new Map<NodeId, NodeAdd[]>();
  for (const add of adds) {
    nextNodes.set(add.node.id, add.node);
    // Every collection carries a children entry, from birth.
    if (add.node.kind === "collection" && !nextChildren.has(add.node.id)) {
      nextChildren.set(add.node.id, []);
    }
    let list = insertsByParent.get(add.parentId);
    if (!list) insertsByParent.set(add.parentId, (list = []));
    list.push(add);
  }
  for (const [parentId, inserts] of insertsByParent) {
    const children = [...(nextChildren.get(parentId) ?? [])];
    inserts.sort((a, b) => a.index - b.index);
    for (const add of inserts) {
      const index = Math.max(0, Math.min(add.index, children.length));
      children.splice(index, 0, add.node.id);
      nextParent.set(add.node.id, parentId);
    }
    nextChildren.set(parentId, children);
  }

  return {
    nodesById: nextNodes,
    childrenById: nextChildren,
    parentById: nextParent,
    rootIds: graph.rootIds,
  };
}

function applyRemovals(
  graph: CollectionsGraph,
  removals: readonly NodeAdd[]
): CollectionsGraph {
  if (removals.length === 0) return graph;

  const nextNodes = new Map(graph.nodesById);
  const nextChildren = new Map(graph.childrenById);
  const nextParent = new Map(graph.parentById);

  const removedByParent = new Map<NodeId, Set<NodeId>>();
  for (const removal of removals) {
    nextNodes.delete(removal.node.id);
    nextParent.delete(removal.node.id);
    nextChildren.delete(removal.node.id);
    let set = removedByParent.get(removal.parentId);
    if (!set) removedByParent.set(removal.parentId, (set = new Set()));
    set.add(removal.node.id);
  }
  for (const [parentId, removedIds] of removedByParent) {
    const children = nextChildren.get(parentId) ?? [];
    nextChildren.set(parentId, children.filter((id) => !removedIds.has(id)));
  }

  return {
    nodesById: nextNodes,
    childrenById: nextChildren,
    parentById: nextParent,
    rootIds: graph.rootIds,
  };
}

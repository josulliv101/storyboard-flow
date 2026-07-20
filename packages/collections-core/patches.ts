import {
  type CollectionItemNode,
  type CollectionsGraph,
  type NodeId,
  type Result,
} from "./graph";

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

/** Why a historical patch can no longer be applied to the current graph. */
export type ReplayRejection = Readonly<
  | { reason: "add-id-exists"; nodeId: NodeId }
  | { reason: "add-parent-missing"; parentId: NodeId }
  | { reason: "remove-node-missing"; nodeId: NodeId }
  | { reason: "remove-node-not-childless"; nodeId: NodeId }
  | { reason: "move-node-missing"; nodeId: NodeId }
  | { reason: "move-parent-mismatch"; nodeId: NodeId }
  | { reason: "update-node-missing"; nodeId: NodeId }
>;

/**
 * Whether a patch still applies cleanly to THIS graph.
 *
 * History assumed every dormant patch stays applicable — true under pure
 * linear history, and false the moment hydration grows the graph while
 * entries sleep on either stack. Two corruptions both reproduced before this
 * existed:
 *
 * - REDO an add whose id was meanwhile hydrated in: `applyAdds` overwrote
 *   `nodesById` and inserted the id into a second children array — one node
 *   in two collections, `parentById` naming only one (duplicate-child).
 * - UNDO an add of a collection that was hydrated AFTER being added:
 *   `applyRemovals` deleted it children-and-all, orphaning the hydrated
 *   children (missing-node parents).
 *
 * The checks mirror what each apply function assumes and does not verify.
 * `nodes-updated` checks existence only: hydration rejects id collisions
 * with the host graph and cannot remove nodes, so a surviving node is the
 * node the patch was recorded against.
 */
export function verifyPatchApplies(
  graph: CollectionsGraph,
  patch: CollectionsPatch
): Result<void, ReplayRejection> {
  const ok = { ok: true, value: undefined } as const;
  switch (patch.type) {
    case "nodes-added":
      for (const add of patch.adds) {
        if (graph.nodesById.has(add.node.id)) {
          return { ok: false, error: { reason: "add-id-exists", nodeId: add.node.id } };
        }
        if (graph.nodesById.get(add.parentId)?.kind !== "collection") {
          return { ok: false, error: { reason: "add-parent-missing", parentId: add.parentId } };
        }
      }
      return ok;
    case "nodes-removed":
      for (const removal of patch.removals) {
        const id = removal.node.id;
        if (!graph.nodesById.has(id)) {
          return { ok: false, error: { reason: "remove-node-missing", nodeId: id } };
        }
        if ((graph.childrenById.get(id) ?? []).length > 0) {
          return { ok: false, error: { reason: "remove-node-not-childless", nodeId: id } };
        }
      }
      return ok;
    case "nodes-moved":
      for (const move of patch.moves) {
        if (!graph.nodesById.has(move.nodeId)) {
          return { ok: false, error: { reason: "move-node-missing", nodeId: move.nodeId } };
        }
        if (graph.parentById.get(move.nodeId) !== move.fromParentId) {
          return { ok: false, error: { reason: "move-parent-mismatch", nodeId: move.nodeId } };
        }
      }
      return ok;
    case "nodes-updated":
      for (const update of patch.updates) {
        if (!graph.nodesById.has(update.nodeId)) {
          return { ok: false, error: { reason: "update-node-missing", nodeId: update.nodeId } };
        }
      }
      return ok;
  }
}

/**
 * Applies a patch to the graph — the single index-rewriting code path
 * (forward apply, undo, and redo all run through it). Structural sharing:
 * moves never re-allocate `nodesById`; adds/removals touch it but leave
 * unaffected children arrays alone. Does not validate — callers replaying
 * HISTORICAL patches must gate on `verifyPatchApplies` first, because the
 * graph may have grown (hydration) since the patch was recorded.
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
  // A REORDER within one parent leaves every parent link untouched, so the
  // map can be shared instead of copied. This matters because `parentById`
  // holds an entry per NODE — cloning it made the commonest drag in the app
  // (dragging a clip along its own strip) allocate a map the size of the
  // whole graph. `childrenById` is per-collection and genuinely rewritten, so
  // it is still copied.
  // Null when nothing is reparented — the types then make it impossible to
  // write through to the shared map by accident.
  const mutableParent = moves.some((move) => move.fromParentId !== move.toParentId)
    ? new Map(graph.parentById)
    : null;
  const nextParent = mutableParent ?? graph.parentById;

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
      // Only write when the link actually changes. In the shared-map case
      // above there is nothing to write, and writing anyway — even the value
      // it already holds — would be mutating a map the PREVIOUS graph still
      // references.
      if (mutableParent && move.fromParentId !== parentId) {
        mutableParent.set(move.nodeId, parentId);
      }
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

// Graph — the functions that CREATE a graph value.
//
// `emptyGraph` and `buildGraph` produce one from nothing and from already-parsed
// parts; `markMissing` produces the next one after storage says a subtree is
// gone. All three hand back a complete `Graph` with its derived indexes already
// correct, which is why they sit above ./derived-indexes in this folder's order
// rather than beside the queries.
//
// `buildGraph` is NOT re-exported from `./index`: assembling a graph from
// already-parsed nodes is an ingress author's tool, and the sanctioned ingress is
// `deserialize`. `emptyGraph` covers the one case a consumer legitimately needs.

import type {
  ChildrenState,
  WidenedNodeType,
  Graph,
  GraphNode,
  NodeId,
  NodeTypeRegistry,
} from "../types";
import { NO_DEAD_REVS, NO_IDS, NO_OWNERS, NO_PLACEMENTS } from "./internals";
import { rebuildDerivedIndexes } from "./derived-indexes";
import { childrenStateOf } from "./queries";
import { bumpSubtreeRevs } from "./revisions";

export function emptyGraph<Ts extends readonly WidenedNodeType[], S>(
  engineId: symbol,
): Graph<Ts, S> {
  return {
    engineId,
    nodesById: new Map(),
    childrenById: new Map(),
    parentById: new Map(),
    rootIds: NO_IDS,
    subtreeRevById: new Map(),
    deadRevById: NO_DEAD_REVS,
    placementsByContentKey: NO_PLACEMENTS,
    ownerBySourceKey: NO_OWNERS,
  };
}

/**
 * Assemble a graph from an already-parsed node set.
 *
 * Not part of the cross-module signature contract — `deserializeDocument`,
 * `loadChildrenInto` and the tests are the callers. It exists so the two
 * derived facts every ingress path has to get right — `parentById` TOTAL over
 * `nodesById`, and both derived indexes consistent with the node set — are
 * computed in one place instead of being re-derived per ingress. The
 * predecessor re-derived them per path and they drifted.
 *
 * It does NOT validate. `findInvariantViolation` is the audit, and running it
 * here would make every ingress pay for a check the caller may want once at the
 * end, or only under `devChecks`.
 *
 * `subtreeRevs` carries revisions forward when a graph is rebuilt around
 * existing nodes; a node with no carried revision starts at 0.
 */
export function buildGraph<Ts extends readonly WidenedNodeType[], S>(
  args: Readonly<{
    engineId: symbol;
    nodesById: ReadonlyMap<NodeId, GraphNode<Ts, S>>;
    childrenById: ReadonlyMap<NodeId, readonly NodeId[]>;
    rootIds: readonly NodeId[];
    registry: NodeTypeRegistry;
    subtreeRevs?: ReadonlyMap<NodeId, number>;
    /** Carried forward when a graph is rebuilt around existing nodes, so a
     *  rebuild does not forget what has been removed. */
    deadRevs?: ReadonlyMap<NodeId, number>;
  }>,
): Graph<Ts, S> {
  const parentById = new Map<NodeId, NodeId | null>();
  for (const [parentId, childIds] of args.childrenById) {
    for (const childId of childIds) parentById.set(childId, parentId);
  }
  // TOTAL over `nodesById`: anything not claimed as a child is a root, and a
  // root's entry is an explicit `null` rather than an absent key. `has()` and
  // `get()` therefore answer different questions, and check 5 of
  // `findInvariantViolation` is written against the first one.
  const subtreeRevById = new Map<NodeId, number>();
  for (const id of args.nodesById.keys()) {
    if (!parentById.has(id)) parentById.set(id, null);
    subtreeRevById.set(id, args.subtreeRevs?.get(id) ?? 0);
  }

  const skeleton: Graph<Ts, S> = {
    engineId: args.engineId,
    nodesById: args.nodesById,
    childrenById: args.childrenById,
    parentById,
    rootIds: args.rootIds,
    subtreeRevById,
    // Ingress builds a graph from a node set; nothing has been removed from it.
    deadRevById: args.deadRevs ?? NO_DEAD_REVS,
    placementsByContentKey: NO_PLACEMENTS,
    ownerBySourceKey: NO_OWNERS,
  };
  // The indexes are derived from a walk, so they need a walkable graph — the
  // skeleton is exactly that, and the two placeholder maps it carries are never
  // read by `rebuildDerivedIndexes`.
  return { ...skeleton, ...rebuildDerivedIndexes(skeleton, args.registry) };
}

// ---------------------------------------------------------------------------

export function markMissing<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
  reason: string,
): Graph<Ts, S> {
  const node = graph.nodesById.get(id);
  if (node === undefined) return graph;

  const state = childrenStateOf(graph, id);
  if (state === null) return graph;
  if (state.status === "reference" || state.status === "loaded") return graph;
  if (state.status === "missing" && state.reason === reason) return graph;

  const children: ChildrenState = { status: "missing", reason };
  // A spread, not one of the boundary constructors: nothing here came out of
  // the erased registry, so no cast is warranted, and a spread cannot silently
  // drop a field the node type grows later.
  const next: GraphNode<Ts, S> = node.quarantined
    ? { ...node, children }
    : { ...node, children };

  const nodesById = new Map(graph.nodesById);
  nodesById.set(id, next);

  return {
    ...graph,
    nodesById,
    // The node keeps its `ChildrenState` slot and keeps owning its subtree
    // (`unloaded` and `missing` both own), and its `data` is untouched — so
    // neither derived index can have changed, and neither is rebuilt.
    subtreeRevById: bumpSubtreeRevs(graph.subtreeRevById, graph, [id]),
  };
}

// ---------------------------------------------------------------------------

// Incremental hydration: fill an EMPTY collection (a lazy-loaded
// placeholder) with a denormalized subtree, without touching anything else.
//
// This is the missing middle between `initialGraph` (initial-only) and
// `replaceGraph` (wholesale swap that must clear undo history): hydration
// only ADDS nodes under a collection that had none, so every existing patch
// in the history — built against nodes that all still exist, in children
// arrays hydration never rewrites — remains replayable. That is what lets a
// store keep one graph (and one undo stack) alive across drill-in
// navigation while documents load on focus.
//
// Hydration is deliberately NOT a command and produces NO patch: it is IO
// landing (state that already exists in storage), not user intent, so it
// must be invisible to undo/redo and to the persistence change feed —
// undoing "the data loaded" or writing it back to where it came from would
// both be nonsense. See ARCHITECTURE.md § Hydration.

import {
  buildGraph,
  type BuildGraphError,
  type CollectionsGraph,
  type GraphNodeSpec,
  type NodeId,
  type Result,
} from "./graph";

export type HydrateRejection =
  | Readonly<{ reason: "missing-collection"; collectionId: NodeId }>
  | Readonly<{ reason: "not-a-collection"; collectionId: NodeId }>
  /** Hydration fills placeholders; merging into populated collections is a
   *  policy decision the engine refuses to guess at. */
  | Readonly<{ reason: "collection-not-empty"; collectionId: NodeId }>
  /** A spec id collides with an existing node, or repeats within the specs. */
  | Readonly<{ reason: "duplicate-id"; id: string }>
  | Readonly<{ reason: "invalid-spec"; error: BuildGraphError }>;

/**
 * Return a new graph with `children` denormalized under the (empty)
 * collection `collectionId`. Pure: the input graph is untouched, untouched
 * nodes and children arrays keep their identities. Hydrating with an empty
 * spec list is a no-op and returns the SAME graph reference.
 */
export function hydrateCollection(
  graph: CollectionsGraph,
  collectionId: NodeId,
  children: readonly GraphNodeSpec[]
): Result<CollectionsGraph, HydrateRejection> {
  const target = graph.nodesById.get(collectionId);
  if (!target) {
    return { ok: false, error: { reason: "missing-collection", collectionId } };
  }
  if (target.kind !== "collection") {
    return { ok: false, error: { reason: "not-a-collection", collectionId } };
  }
  if ((graph.childrenById.get(collectionId) ?? []).length > 0) {
    return { ok: false, error: { reason: "collection-not-empty", collectionId } };
  }
  if (children.length === 0) return { ok: true, value: graph };

  // Denormalize + validate the subtree by wrapping the specs in the target
  // itself and reusing buildGraph — one spec walker, one validation story.
  // Intra-subtree duplicate ids surface here.
  const built = buildGraph([
    { kind: "collection", id: collectionId, name: target.name, children },
  ]);
  if (!built.ok) {
    return built.error.reason === "duplicate-id"
      ? { ok: false, error: { reason: "duplicate-id", id: built.error.id } }
      : { ok: false, error: { reason: "invalid-spec", error: built.error } };
  }
  const subtree = built.value;

  // Ids are the graph's addressing scheme — a collision with the HOST graph
  // would corrupt every index, so reject before merging anything.
  for (const id of subtree.nodesById.keys()) {
    if (id !== collectionId && graph.nodesById.has(id)) {
      return { ok: false, error: { reason: "duplicate-id", id } };
    }
  }

  const nodesById = new Map(graph.nodesById);
  const childrenById = new Map(graph.childrenById);
  const parentById = new Map(graph.parentById);
  for (const [id, node] of subtree.nodesById) {
    // The target keeps the HOST's node, children entry (overwritten below),
    // and real parent — the subtree wrapper only existed to reuse buildGraph.
    if (id === collectionId) continue;
    nodesById.set(id, node);
    parentById.set(id, subtree.parentById.get(id) ?? null);
  }
  for (const [id, childIds] of subtree.childrenById) {
    childrenById.set(id, childIds);
  }

  return {
    ok: true,
    value: { nodesById, childrenById, parentById, rootIds: graph.rootIds },
  };
}

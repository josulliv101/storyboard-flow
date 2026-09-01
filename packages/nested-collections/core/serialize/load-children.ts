// Graph — loadChildrenInto — the lazy ingress door.
//
// Split out of the former single-file `serialize.ts`; see ./index.ts.

import {
  makeCollectionNode,
  makeSealedNode,
  type GraphNode,
  type EngineContext,
  type Graph,
  type LoadRejection,
  type LoadReport,
  quoteFromWire,
  type NodeId,
  type Result,
  type WidenedNodeType,
} from "../types";

import {
  ancestorChain,
  bumpSubtreeRevs,
  childrenStateOf,
  getNode,
  rebuildDerivedIndexes,
} from "../graph";

import { buildDocument, findDuplicateOwnerAmongArrivals } from "./document";


// 6. loadChildrenInto
// ---------------------------------------------------------------------------

export function loadRejection(error: LoadRejection): Result<never, LoadRejection> {
  return { ok: false, error };
}

/**
 * IO landing for a lazily-loaded subtree.
 *
 * Takes a FULL document rather than a bare children array, so MIGRATIONS RUN
 * ON LAZY PAYLOADS TOO — the predecessor's hydrate path silently skipped them,
 * which meant a subtree loaded on demand was parsed by rules its own document
 * had already outgrown.
 *
 * `doc` is `unknown` because it came from IO, and re-validating here is the
 * difference between a typed claim and a checked one.
 *
 * `Engine.loadChildren` and `Store.load` now say `unknown` too. They used to
 * say `SerializedDocument` while delegating to this — so the public types
 * vouched for an envelope nothing had checked, and this comment existed to
 * apologise for the gap rather than to describe the code. Both doors now agree
 * with `deserialize`, which has always been honest about taking `unknown`.
 *
 * Produces NO patch, NO history entry, NO change-feed event; bumps
 * `subtreeRev` along the target's chain so ancestor rollups re-render.
 *
 * LOADING IS MONOTONE — there is no `unload` in v1. That single property is
 * what makes `verifyPatchApplies` cheap and dormant history sound: a node that
 * existed when a patch was recorded still exists when it replays.
 */
export function loadChildrenIntoUnguarded<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
  doc: unknown,
  ctx: EngineContext<S>,
): Result<
  Readonly<{ graph: Graph<Ts, S>; report: LoadReport }>,
  LoadRejection
> {
  if (graph.engineId !== ctx.engineId) {
    return loadRejection({
      code: "foreign-graph",
      message: "Graph was produced by a different engine instance",
      nodeId: id,
    });
  }

  const target = getNode(graph, id);
  if (target === undefined) {
    return loadRejection({
      code: "unknown-node",
      message: `No node ${quoteFromWire(id)} in this graph`,
      nodeId: id,
    });
  }

  // `childrenStateOf` returns null for a leaf, an unknown node, or a
  // SEALD leaf — which is exactly the set that cannot be loaded into. A
  // sealed CONTAINER can be: its kind failed to parse, but its subtree is
  // still real, still addressable, and refusing to load it would strand every
  // node underneath it.
  const state = childrenStateOf(graph, id);
  if (state === null) {
    return loadRejection({
      code: "not-a-container",
      message: `Node ${quoteFromWire(id)} is not a container`,
      nodeId: id,
    });
  }
  if (state.status !== "unloaded") {
    return loadRejection({
      code: "target-not-unloaded",
      message: `Node ${quoteFromWire(id)} is ${state.status}, not unloaded; only an unloaded owner can be filled`,
      nodeId: id,
    });
  }

  const built = buildDocument<Ts, S>(doc, ctx, {
    rootsMustBeContainers: false,
    existingNodeCount: graph.nodesById.size,
    // The payload's roots become THIS target's children, so they land one level
    // below it. `ancestorChain` excludes `id` itself, hence the +2: one for the
    // target, one for the children about to hang off it.
    existingDepth: ancestorChain(graph, id).length + 2,
  });
  if (!built.ok) {
    return loadRejection({
      code: "malformed-document",
      message: `Payload for ${quoteFromWire(id)} is not a usable document: ${built.error.message}`,
      nodeId: id,
      cause: built.error,
    });
  }
  const payload = built.value;

  const colliding: NodeId[] = [];
  for (const incoming of payload.order) {
    if (graph.nodesById.has(incoming)) colliding.push(incoming);
  }
  if (colliding.length > 0) {
    return loadRejection({
      code: "id-collision",
      message: `Payload for ${quoteFromWire(id)} reuses ${colliding.length} id(s) the graph already holds`,
      nodeId: id,
      collidingIds: colliding,
    });
  }

  const nodesById = new Map(graph.nodesById);
  for (const [incomingId, node] of payload.nodesById) {
    nodesById.set(incomingId, node);
  }
  nodesById.set(id, withLoadedChildren<Ts, S>(target, id));

  const childrenById = new Map(graph.childrenById);
  for (const [incomingId, kids] of payload.childrenById) {
    childrenById.set(incomingId, kids);
  }
  childrenById.set(id, payload.rootIds);

  const parentById = new Map(graph.parentById);
  for (const [incomingId, parent] of payload.parentById) {
    // The payload's own roots become THIS target's children.
    parentById.set(incomingId, parent === null ? id : parent);
  }

  const subtreeRevById = new Map(graph.subtreeRevById);
  // SEEDED AT THE FLOOR, never unconditionally at 0 — the same rule
  // `applyInserted` follows, and for the same reason. `subtreeRevById` is the
  // fold cache's ONLY invalidation mechanism: an entry keyed
  // (foldKey, nodeId, rev) is meant to become unreachable once the rev moves
  // past it, so nothing ever has to evict.
  //
  // Writing 0 here walked a returning id back onto revisions its DEAD lineage
  // had already cached under different data. The `id-collision` guard above
  // does not catch it — that one rejects ids the graph CURRENTLY holds, and a
  // removed id is in neither map. The gesture is: read a clip's rollup, edit it,
  // delete it, then have the server report it inside a not-yet-loaded folder.
  // Measured before that fix: the store answered the dead clip's 4 while the
  // truth was 999, at the clip AND at every ancestor rollup, and it did not
  // self-heal — each later edit landed on the next already-poisoned rev.
  //
  // The floor is at or above every revision this lineage has issued, so seeding
  // here puts every arrival above anything cached under its id, whether or not
  // that id has lived here before. A LOAD ISSUES ONE NEW REVISION for the whole
  // payload rather than one each: they are all new to this graph, so nothing
  // needs to tell them apart by number.
  const arrivalRev = graph.revFloor + 1;
  for (const incomingId of payload.order) {
    subtreeRevById.set(incomingId, arrivalRev);
  }

  const base: Graph<Ts, S> = {
    engineId: graph.engineId,
    nodesById,
    childrenById,
    parentById,
    rootIds: graph.rootIds,
    // Bumped against the PRE-load graph on purpose: the ancestor chain is read
    // from `parentById`, and the target's ancestors are unchanged by loading.
    // The arriving nodes need no bump of their own — the loop above seeded each
    // one at `arrivalRev`, which is already above everything this lineage has
    // issued.
    subtreeRevById: bumpSubtreeRevs(subtreeRevById, graph, [id]),
    // `+ 1` beyond `arrivalRev`, because the bump above moves the target and its
    // ancestors one past whatever they held, and the floor must cover those too.
    revFloor: arrivalRev + 1,
    placementsByContentKey: new Map(),
    ownerBySourceKey: new Map(),
  };

  // The payload may name a sourceKey some other placement already owns — a
  // conflict that only exists once the two documents are in the same graph, and
  // still refused here. Over the ARRIVALS rather than the merged graph: see
  // `findDuplicateOwnerAmongArrivals` for why that is the same answer.
  const arrived = [...payload.nodesById.values()];
  const duplicate = findDuplicateOwnerAmongArrivals<Ts, S>(
    graph.ownerBySourceKey,
    ctx.registry,
    arrived,
  );
  if (duplicate !== null) {
    return loadRejection({
      code: "malformed-document",
      message: duplicate.message,
      nodeId: duplicate.nodeId ?? id,
      cause: duplicate,
    });
  }

  // THE REPORT IS RETURNED, not recomputed and not dropped.
  //
  // `buildDocument` has always produced one — the same one `deserialize`
  // returns — and this door threw it away, so `Store.load` answered
  // `Result<void>` and a lazy page in which EVERY node sealed was
  // indistinguishable from a clean one. The consumer's own retry, telemetry and
  // "some items could not be read" affordances all hang off `report.sealed`
  // on the eager door and had nothing to hang off here, on the door that runs
  // repeatedly against a live document rather than once at startup.
  //
  // Shaped like `deserialize`'s `{ graph, report }` deliberately: the two are
  // the same operation against a different destination, and a consumer handling
  // one should not have to learn a second shape for the other.
  return {
    ok: true,
    value: {
      graph: { ...base, ...rebuildDerivedIndexes(base, ctx.registry) },
      report: payload.report,
    },
  };
}

/**
 * Rebuilds the target with `children: { status: "loaded" }`. Enumerated field
 * by field rather than spread: `SealedNode` carries a `sealed: true`
 * that `makeSealedNode` adds itself, and the boundary constructors are
 * the only sanctioned way to mint a node.
 */
function withLoadedChildren<Ts extends readonly WidenedNodeType[], S>(
  node: GraphNode<Ts, S>,
  id: NodeId,
): GraphNode<Ts, S> {
  if (node.sealed) {
    return makeSealedNode({
      id,
      kind: node.kind,
      container: node.container,
      schemaVersion: node.schemaVersion,
      raw: node.raw,
      reason: node.reason,
      issues: node.issues,
      children: { status: "loaded" },
      summary: node.summary,
    });
  }
  if (node.container) {
    return makeCollectionNode<Ts, S>(
      id,
      node.kind,
      node.data,
      { status: "loaded" },
      node.summary,
    );
  }
  // Unreachable: the caller established a non-null ChildrenState, which a leaf
  // never has.
  return node;
}

// Graph — the four apply arms, and the commit cost rules they obey.
//
// Split out of the former single-file `patches.ts`; see ./index.ts.

import {
  makeCollectionNode,
  makeLeafNode,
  type GraphNode,
  type DataChange,
  type EngineContext,
  type Graph,
  type WidenedNodeType,
  type Move,
  type NodeId,
  type NodeTypeRegistry,
  type Placement,
} from "../types";
import {
  bumpSubtreeRevs,
  placementsAfterInsert,
  ownersAfterInsert,
  bumpSubtreeRevsInto,
  derivedIndexesSurviveDataChange,
  derivedIndexNeed,
  derivedIndexesAfterRemoval,
  rebuildDerivedIndexes,
  rebuildPlacementIndex,
  reindexPlacementsAcrossMove,
  reindexPlacementsWithinSubtree,
  type DerivedIndexes,
} from "../graph";

import { groupArrivalsByParent, groupByParent, spliceInMany, spliceOutMany } from "./splicing";
import { EMPTY_IDS } from "./constants";
import { isLoadedContainer } from "./predicates";

// The commit cost rules, stated once because all four arms obey them
// ---------------------------------------------------------------------------
//
// A commit must not do whole-graph work to express a local change. Every arm
// below therefore SHARES what the patch provably did not touch, and the sharing
// is pinned structurally in ./move-cost.test.ts — a comment is not a guarantee.
//
//   - `nodesById`   — per NODE. Untouched by moves entirely.
//   - `parentById`  — per NODE. Untouched by a same-parent reorder, which is the
//                     commonest drag there is (an item along its own strip), so
//                     it is shared by reference unless something is reparented.
//   - `childrenById`— per COLLECTION, and genuinely rewritten. Copied, but the
//                     untouched collections' ARRAYS are shared.
//   - `subtreeRevById` — per NODE. Copied exactly ONCE per commit; every bump
//                     writes into that one copy via `bumpSubtreeRevsInto`.
//   - the derived indexes — rebuilt only when the patch's shape cannot prove
//                     what stayed put. See ./graph.ts for each argument.

/**
 * The one parent every move stays inside, or `null` when the batch reparents or
 * spans parents.
 *
 * `reindexPlacementsWithinSubtree` needs a subtree it can prove the permutation
 * is confined to, and this is the only shape that yields one cheaply.
 *
 * It is NOT, however, the only shape with a cheap answer, and this comment used
 * to claim it was: a cross-parent scope would be the lowest common ancestor of
 * the two parents — the root, in the shape this engine is built for — so
 * scoping was said to buy nothing, and every cross-parent drag rebuilt the
 * whole index. The LCA reasoning is correct and the conclusion did not follow.
 * A move's scope is what MOVED, and `reindexPlacementsAcrossMove` takes that
 * path for everything this function declines.
 */
function soleReorderParent(moves: readonly Move[]): NodeId | null {
  const first = moves[0];
  if (first === undefined) return null;
  const parentId = first.fromParentId;
  for (const move of moves) {
    if (move.fromParentId !== parentId) return null;
    if (move.toParentId !== parentId) return null;
  }
  return parentId;
}

function placementsAfterMove<Ts extends readonly WidenedNodeType[], S>(
  post: Graph<Ts, S>,
  registry: NodeTypeRegistry,
  previous: ReadonlyMap<string, readonly NodeId[]>,
  moves: readonly Move[],
): ReadonlyMap<string, readonly NodeId[]> {
  // No registered node type defines `contentKey`, so the index is permanently empty
  // and the walk that would rediscover that is pure waste.
  if (!derivedIndexNeed(registry).content) return previous;
  // A patch that moves nothing reorders nothing. Worth stating, because
  // `soleReorderParent` has no parent to name for an empty batch and would
  // otherwise send the emptiest possible patch down the most expensive path.
  if (moves.length === 0) return previous;

  // THE MOVED SET FIRST. Reposition what travelled instead of rediscovering
  // what did not: the scope of a move is the moved subtrees, and every node
  // outside them holds its relative order. `reindexPlacementsAcrossMove` proves
  // that rather than assuming it, and its argument — take any two nodes,
  // neither in a moved subtree — never assumes the parents DIFFER, so it covers
  // a same-parent reorder unchanged.
  //
  // This used to run second, after the scoped path, and the engine therefore
  // declined to use its own conclusion for exactly the gesture that needs it
  // most. MEASURED, counting `contentKey`: a clip reorder inside a strip cost
  // strip-width + 1 (21 for a 20-wide strip, 201 for a 200-wide one) while the
  // same clip moved to ANOTHER strip cost 1 — the same node, the same distance,
  // the same work, two orders of magnitude apart. Worse, reordering a
  // COLLECTION under the root made the scope root the document root, so it
  // walked the ENTIRE graph: 10,501 calls on a 10,501-node board, every drag.
  const repositioned = reindexPlacementsAcrossMove(
    post,
    registry,
    previous,
    moves.map((move) => move.nodeId),
  );
  if (repositioned !== null) return repositioned;

  // The scoped reorder is now the FALLBACK, for a same-parent batch the moved
  // set declined — which it does when `previous` disagrees with the graph, not
  // when the move is unusual. Kept rather than deleted because it answers from
  // a different direction (the subtree that contains the change, rather than
  // the nodes that moved) and can therefore still succeed where the other
  // could not.
  const scopeRootId = soleReorderParent(moves);
  if (scopeRootId !== null) {
    const scoped = reindexPlacementsWithinSubtree(post, registry, previous, scopeRootId);
    // `null` is "declined", not "invalid" — the incremental path found the
    // previous index disagreeing with the graph and refused to guess.
    if (scoped !== null) return scoped;
  }

  return rebuildPlacementIndex(post, registry);
}

export function applyMoved<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  moves: readonly Move[],
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  // A move carries NO content and NO rollups, so `nodesById` is untouched —
  // every node object keeps its identity, which is what lets a selector store
  // skip re-rendering uninvolved cards. It is handed through by the spread
  // below, never copied.
  const children = new Map<NodeId, readonly NodeId[]>(graph.childrenById);

  // A REORDER within one parent leaves every parent link untouched, so
  // `parentById` is shared instead of copied. It holds an entry per NODE, and
  // copying it made the commonest drag in an app — dragging an item along its
  // own strip — allocate a map the size of the whole graph to record that
  // nothing was reparented. `childrenById` is per-COLLECTION and genuinely
  // rewritten, so it is still copied.
  //
  // `null` when nothing is reparented, so the TYPES make it impossible to write
  // through to the shared map by accident.
  const reparents = moves.some((move) => move.fromParentId !== move.toParentId);
  const mutableParents = reparents
    ? new Map<NodeId, NodeId | null>(graph.parentById)
    : null;

  // Remove ALL, then insert ALL. `toIndex` is a POST-REMOVAL index, so the two
  // phases cannot be interleaved.
  // One pass per SOURCE parent. A multi-select drag out of one strip was the
  // same O(K x N) as the delete above.
  spliceOutMany(
    children,
    groupByParent(
      moves.map((move) => ({ parentId: move.fromParentId, nodeId: move.nodeId })),
    ),
  );
  // One pass per DESTINATION parent, mirroring the removal above. A
  // multi-select drag INTO one strip was the same O(K x N) the removal side
  // stopped paying — see `spliceInMany`.
  spliceInMany(
    children,
    groupArrivalsByParent(
      moves.map((move) => ({
        parentId: move.toParentId,
        index: move.toIndex,
        nodeId: move.nodeId,
      })),
    ),
  );
  for (const move of moves) {
    // Only write when the link actually changes. In the shared-map case there
    // is nothing to write, and writing anyway — even the value it already
    // holds — would be mutating a map the PREVIOUS graph still references.
    if (mutableParents !== null && move.fromParentId !== move.toParentId) {
      mutableParents.set(move.nodeId, move.toParentId);
    }
  }
  const parents = mutableParents ?? graph.parentById;

  // ONE rev map allocation, bumped twice into. `revs` is private to this call
  // until the returned graph publishes it, so writing into it after `relocated`
  // is built mutates nothing anyone can observe: `relocated` is a scaffold whose
  // only job is to supply the POST-state `parentById` to the second walk, and
  // the graph that escapes carries this very map in its final state.
  const revs = new Map<NodeId, number>(graph.subtreeRevById);

  // THE TRAP THIS FUNCTION EXISTS TO AVOID: a move has TWO ancestor chains, and
  // the SOURCE chain exists only in the PRE-state `parentById`. Bumping once,
  // against the post-state graph, updates the destination's rollups and leaves
  // the source's silently stale — the node re-renders, the old ancestors never
  // do. Hence two walks against two different graphs.
  bumpSubtreeRevsInto(
    revs,
    graph,
    moves.map((move) => move.fromParentId),
  );
  const relocated: Graph<Ts, S> = {
    ...graph,
    childrenById: children,
    parentById: parents,
    subtreeRevById: revs,
  };
  // THE MOVED NODES THEMSELVES, and not only their parents.
  //
  // `commitGraph` decides whether to wake a node's subscribers by comparing
  // `getSubtreeRev` across the commit, so a node whose revision does not move is
  // a node whose listeners do not fire. Bumping only the two PARENT chains left
  // the moved node out of both — measured through the public store,
  // `subscribeToNode` on the dragged node fired ZERO times across a reorder
  // while its parent's fired once.
  //
  // The same hole `applyRemoved` was fixed for. The rule ./engine states over
  // that loop is "EVERY MUTATION MOVES THE REVISION OF EVERY NODE IT AFFECTS",
  // and a move affects the node it moves. `patchTouchedNodeIds` has always named
  // `move.nodeId` for exactly this reason; the revision did not agree.
  //
  // WHAT GOES STALE WITHOUT IT is not the node's content — folds are
  // graph-blind, so a moved node's own value genuinely does not change, and that
  // is why this survived so long. It is anything rendering its POSITION: a
  // breadcrumb, an inspector naming the parent, the "3 of 7" a consumer reads
  // out of `placementsByContentKey`. A tree view hides it, because the parent
  // re-renders and React reorders the children for free.
  //
  // The cost is one extra increment per moved node, and one refold of that node
  // on the next read — O(its children), not O(its subtree), since the
  // descendants keep their revisions and therefore their cached values.
  //
  // Appended to the DESTINATION walk because that is where the node now lives.
  // Its chain runs straight into `toParentId`, which this same call has already
  // bumped, so `bumpSubtreeRevsInto` short-circuits there and nothing is walked
  // or incremented twice.
  bumpSubtreeRevsInto(revs, relocated, [
    ...moves.map((move) => move.toParentId),
    ...moves.map((move) => move.nodeId),
  ]);

  return {
    ...relocated,
    // `ownerBySourceKey` cannot have moved — see `rebuildPlacementIndex` in
    // ./graph.ts for the argument, which turns on the single-owner invariant
    // that check 8 of the audit enforces ahead of check 9.
    ownerBySourceKey: graph.ownerBySourceKey,
    // `placementsByContentKey` IS in document order, so a pure reorder moves it
    // even though no data did.
    placementsByContentKey: placementsAfterMove(
      relocated,
      ctx.registry,
      graph.placementsByContentKey,
      moves,
    ),
  };
}

export function applyInserted<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  placements: readonly Placement<Ts, S>[],
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  const nodes = new Map<NodeId, GraphNode<Ts, S>>(graph.nodesById);
  const children = new Map<NodeId, readonly NodeId[]>(graph.childrenById);
  const parents = new Map<NodeId, NodeId | null>(graph.parentById);
  const revs = new Map<NodeId, number>(graph.subtreeRevById);

  // FORWARD walk. Document order guarantees a placement's parent was either
  // already in the graph or created by an earlier placement in this same array.
  for (const placement of placements) {
    const { node, parentId } = placement;
    nodes.set(node.id, node);
    parents.set(node.id, parentId);
    // Seeding the entry is what gives this node's own children — which arrive
    // as LATER placements — somewhere to land. An empty loaded collection ends
    // up with `[]`, which is the whole point of the loaded/unloaded split.
    //
    // It happens HERE while the splices happen after the loop, and the order is
    // what makes that safe: every container this patch creates has its entry
    // before any arrival is placed, so a nested insert still finds its parent's
    // array waiting. Each parent's array is independent and each parent's
    // arrivals keep their patch order, so hoisting changes nothing except how
    // many times the array is copied.
    if (isLoadedContainer(node) && !children.has(node.id)) {
      children.set(node.id, EMPTY_IDS);
    }
    // `subtreeRevById` is TOTAL over `nodesById`. Seeding before the bump means
    // this holds regardless of how `bumpSubtreeRevs` treats an absent id.
    // The floor comes from the TOMBSTONE STORE now, not from this map: a
    // removed id's revision moved there, so `revs.has` can no longer answer
    // "has this id lived here before". The rule is unchanged — a returning id
    // resumes strictly above every revision its previous lifetime could have
    // cached — and the bump below carries it the final step.
    if (!revs.has(node.id)) revs.set(node.id, graph.deadRevById.get(node.id) ?? 0);
  }

  // ONE pass per destination parent, after every container this patch creates
  // has been seeded above. This is the half `spliceOutMany` left behind: undo
  // of a bulk delete inverts to exactly this patch shape, and it was paying
  // O(K x N) to restore what the delete removed in O(K + N).
  spliceInMany(
    children,
    groupArrivalsByParent(
      placements.map((placement) => ({
        parentId: placement.parentId,
        index: placement.index,
        nodeId: placement.node.id,
      })),
    ),
  );

  const grown: Graph<Ts, S> = {
    ...graph,
    nodesById: nodes,
    childrenById: children,
    parentById: parents,
    subtreeRevById: revs,
  };

  // Bump from every inserted node, against the POST-state graph: each id's
  // chain runs up through its (possibly also-new) parent to a root, so one call
  // covers every inserted node and every surviving ancestor.
  //
  // A re-inserted id does NOT restart from 0: `applyRemoved` leaves its rev
  // entry behind as a tombstone, so the seed below is a no-op for it and the
  // bump lands it strictly above every rev its previous lifetime ever cached.
  // That is what keeps a stale fold-cache entry unreachable rather than wrong.
  //
  // Written INTO the copy made above rather than through the copying form: the
  // map is private to this call until `grown` escapes, and the alternative
  // copied `subtreeRevById` twice for one insert.
  bumpSubtreeRevsInto(
    revs,
    grown,
    placements.map((placement) => placement.node.id),
  );

  // An insert never reorders what was already there, so when the arriving nodes
  // contribute no key of their own, BOTH indexes are exactly the maps the
  // previous graph published.
  // UPDATED, NOT REBUILT — the same shape `placementsAfterMove` uses, and the
  // same argument `derivedIndexesAfterRemoval` makes in the other direction.
  //
  // An insert cannot REORDER anything already present: splicing an id into a
  // children array shifts later siblings within document order but preserves
  // every pre-existing node's order relative to every other. So each existing
  // bucket stays sorted, and the only new entries are the arrivals' own.
  //
  // This used to fall back to a whole-document rebuild whenever ANY arriving
  // node carried a key — and `derivedIndexesSurviveInsert` short-circuits
  // on the first keyed node, so one keyed seed condemned the whole batch.
  // MEASURED, counting `contentKey`: inserting ONE clip cost 1,002 / 10,002 /
  // 40,002 calls at those board sizes, while removing one cost 1, because the
  // removal side has been incremental since it shipped. Undo of a delete
  // inverts to an `inserted` patch and paid the full 40,001.
  //
  // The keyless case still costs nothing and still hands both maps back by
  // reference — `placementsAfterInsert` returns `previous` by identity when the
  // arrivals contribute no key, which is exactly what the old gate bought.
  const insertedNodes = placements.map((placement) => placement.node);
  const placementsNext = placementsAfterInsert(
    grown,
    ctx.registry,
    graph.placementsByContentKey,
    insertedNodes,
  );
  const derived: DerivedIndexes<Ts, S> =
    placementsNext === null
      ? // Declined — the comparator could not rank two ids, or an arriving id
        // was already in its bucket. Fall back to the authoritative walk rather
        // than guessing, exactly as the move arm does.
        rebuildDerivedIndexes(grown, ctx.registry)
      : {
          placementsByContentKey: placementsNext,
          ownerBySourceKey: ownersAfterInsert<Ts, S>(
            ctx.registry,
            graph.ownerBySourceKey,
            insertedNodes,
          ),
        };

  return { ...grown, ...derived };
}

export function applyRemoved<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  placements: readonly Placement<Ts, S>[],
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  const nodes = new Map<NodeId, GraphNode<Ts, S>>(graph.nodesById);
  const children = new Map<NodeId, readonly NodeId[]>(graph.childrenById);
  const parents = new Map<NodeId, NodeId | null>(graph.parentById);
  const revs = new Map<NodeId, number>(graph.subtreeRevById);

  // Bump BEFORE the structural edit and against the PRE-state graph: a nested
  // placement's parent is itself being removed, so its ancestor chain exists
  // only here. Redundant bumps of soon-to-be-deleted ids are harmless; their
  // entries are dropped below. One copy of the rev map, written into — the
  // copying form would have made a second.
  bumpSubtreeRevsInto(
    revs,
    graph,
    placements.map((placement) => placement.parentId),
  );

  // THE ONE WRITER of the tombstone store, and the only place a graph's
  // `deadRevById` is ever a fresh map. Every other commit shares the previous
  // graph's by reference, which is the whole point of the split: the map that
  // grows with a session's total deletions is no longer inside the map every
  // commit copies.
  //
  // IT IS STILL INSIDE THE MAP EVERY *REMOVAL* COMMIT COPIES, and that is the
  // cost this line owns. The split moved the growth off the other three arms,
  // not off this one. MEASURED, insert-then-remove one node in a loop with the
  // live count pinned at 1:
  //
  //     cycles   live   tombstoned   one removal
  //      1,000      1        1,000      0.045 ms
  //      4,000      1        4,000      0.195 ms
  //      8,000      1        8,000      0.478 ms
  //
  // Linear in the tombstone count, so a session of D separate deletions copies
  // D^2/2 entries in total — 32.0 M for the 8,000 above. Per operation that is
  // still well inside a frame at any size a session realistically reaches; the
  // part that mattered was that NOTHING SAID SO. The interactive-cost warning
  // read `nodesById.size`, which is 1 in the table above, so the one shape where
  // commit cost is invisible from the document was also the one shape the
  // diagnostic could not see. It now counts this map too.
  //
  // EVICTING FROM HERE IS NOT THE FIX, and it is worth writing down because it
  // is the obvious one. A tombstone is what stops a RETURNING id from restarting
  // at 0 and walking back onto revs its dead lineage already cached —
  // `applyInserted` reads `deadRevById.get(node.id) ?? 0` — so dropping an entry
  // reintroduces exactly the staleness this store exists to prevent, silently
  // and permanently, and no eviction policy here can know whether the fold cache
  // still holds an entry under one of those revs. The cache is a different
  // structure with a different limit and no ordering relationship to this one.
  //
  // What WOULD remove the quadratic is replacing per-id tombstones with a single
  // monotonic rev floor on the graph: a returning id starts above every rev ever
  // issued, which is strictly stronger than starting above its own. That is a
  // change to the fold cache's only invalidation mechanism — the one this file
  // notes has shipped wrong twice — and it needs its own round, not a line here.
  const deadRevs = new Map<NodeId, number>(graph.deadRevById);

  const removedIds: NodeId[] = [];
  // BACKWARD walk: children leave before parents, and a later sibling's splice
  // cannot invalidate an earlier one's recorded index.
  for (let i = placements.length - 1; i >= 0; i--) {
    const placement = placements[i];
    // `noUncheckedIndexedAccess` — a real check, not a `!`. The loop bounds make
    // this unreachable; TypeScript cannot see that and neither should a reader.
    if (placement === undefined) continue;
    const id = placement.node.id;
    removedIds.push(id);
    nodes.delete(id);
    parents.delete(id);
    children.delete(id);
    // `revs` KEEPS ITS ENTRY AND MOVES IT. Two separate requirements, and the
    // first version of this tombstone met only the first of them.
    //
    // KEEPING it is a correctness requirement rather than an optimisation.
    //
    // `subtreeRevById` is the fold cache's ONLY invalidation mechanism: an
    // entry keyed (foldKey, nodeId, rev) is meant to become UNREACHABLE once
    // the node's rev moves past it, which is why nothing ever has to evict.
    // Dropping the entry here restarted a re-inserted id at 0, and undo then
    // walked it back up through revs the DEAD lineage had already cached under
    // different data. Measured, through the public store: edit a clip twice,
    // remove it, undo — the ROOT aggregate then answers with the dead
    // lineage's value, and it does not self-heal, because each later edit
    // lands on the next already-poisoned rev.
    //
    // The cost is one number per ever-removed id for the store's lifetime,
    // against ~232 bytes for each of the k fold-cache entries per node it
    // protects. `subtreeRevById` becomes a SUPERSET of `nodesById` rather than
    // exactly total, which invariant check 6 permits: it requires every live
    // node to HAVE a rev, not that every rev has a node.
    //
    // MOVING it is what makes the removal VISIBLE. The store decides whether to
    // wake a node's subscribers by comparing `getSubtreeRev` across the commit,
    // so a tombstone frozen at its last live value compares EQUAL and the card
    // mounted on the node that just disappeared is never told. Insertion had no
    // such hole — `applyInserted` bumps every arriving id — so removal was the
    // one direction that went unannounced. Measured: subscribe to a node,
    // remove it, and its listener fired zero times while its parent's fired
    // once. A tree view hides that (the parent re-renders and React unmounts
    // the child); anything addressing a node directly — a detail pane, an
    // inspector, a flattened list — renders the deleted node forever.
    //
    // `+ 1` rather than a bump through `bumpSubtreeRevsInto`: the ancestors are
    // already bumped above, against the PRE-state graph, and walking again from
    // here would double-count them for no gain. The node's own entry is the
    // only one still standing still.
    //
    // This also STRENGTHENS the high-water mark rather than weakening it: the
    // tombstone now sits strictly above every rev the dead lineage could have
    // cached, which is exactly the property `applyInserted`'s re-insertion bump
    // relies on.
    deadRevs.set(id, (revs.get(id) ?? 0) + 1);
    revs.delete(id);
  }

  // ONE rewrite per affected parent, after the loop rather than inside it. The
  // loop's backward walk is still what makes children leave before parents;
  // removal by identity is order-independent, so hoisting the splice out of it
  // changes nothing except how many times each array is copied.
  spliceOutMany(
    children,
    groupByParent(
      placements.map((placement) => ({
        parentId: placement.parentId,
        nodeId: placement.node.id,
      })),
    ),
  );

  // Updated, not rebuilt: a removal cannot REORDER a survivor, so each affected
  // bucket only needs its dead ids filtered out. Read against the PRE-state
  // graph, which is the only state that still holds the removed nodes.
  const derived = derivedIndexesAfterRemoval(graph, ctx.registry, removedIds);

  return {
    ...graph,
    nodesById: nodes,
    childrenById: children,
    parentById: parents,
    subtreeRevById: revs,
    deadRevById: deadRevs,
    ...derived,
  };
}

export function applyDataChanged<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  changes: readonly DataChange<Ts>[],
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  const nodes = new Map<NodeId, GraphNode<Ts, S>>(graph.nodesById);

  for (const change of changes) {
    const node = nodes.get(change.nodeId);
    // A verified patch never names a missing or sealed node; skipping
    // rather than throwing keeps `applyPatch` total, which is what lets it be
    // the single rewriter.
    if (node === undefined || node.sealed) continue;
    // Structure, `summary` and `children` are preserved verbatim — a
    // "data-changed" patch changes content and nothing else. The boundary
    // constructors are used instead of a spread so this module contains no cast.
    nodes.set(
      change.nodeId,
      node.container
        ? makeCollectionNode<Ts, S>(
            node.id,
            node.kind,
            change.after,
            node.children,
            node.summary,
          )
        : makeLeafNode<Ts>(node.id, node.kind, change.after),
    );
  }

  // The copying form is the right one here: `graph.subtreeRevById` is published,
  // so this call must not write into it, and this arm makes no other copy.
  const bumped = bumpSubtreeRevs(
    graph.subtreeRevById,
    graph,
    changes.map((change) => change.nodeId),
  );

  const changed: Graph<Ts, S> = {
    ...graph,
    nodesById: nodes,
    subtreeRevById: bumped,
  };

  // `contentKey` and `sourceKey` are read off `data`, so both derived indexes
  // CAN move under a pure content edit — but usually do not. The keys a node type
  // exposes are identity ("which asset is this"), and the fields a user edits
  // are not. Asking the node type whether either key actually moved costs two calls
  // per change; rebuilding costs a document-order DFS plus two calls per NODE.
  const movesAKey = changes.some(
    (change) =>
      !derivedIndexesSurviveDataChange(
        ctx.registry,
        change.kind,
        change.before,
        change.after,
      ),
  );
  if (!movesAKey) return changed;
  return { ...changed, ...rebuildDerivedIndexes(changed, ctx.registry) };
}

// ---------------------------------------------------------------------------

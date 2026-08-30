// KEEL graph — the subtree revision bump.
//
// `subtreeRevById` is what tells a subscriber its subtree changed, and it is the
// fold cache's ONLY invalidation mechanism: a cache entry keyed
// (foldKey, nodeId, rev) becomes unreachable once the rev moves past it, which is
// why nothing ever has to evict for correctness.
//
// THE RULE EVERY MUTATION DEPENDS ON, stated once here because three modules
// rely on it without re-checking: every mutation moves the revision of every
// node it affects, INCLUDING a node it affects by deleting.

import type { ErasedNodeType, Graph, NodeId } from "../types";

/**
 * Bump `id` AND every ancestor of it, for each id in `fromIds`.
 *
 * THE TRAP, and it has already been paid for once: `graph` supplies the
 * `parentById` the chain is read from, and A MOVE HAS TWO CHAINS. The source
 * chain exists only in the PRE-state graph. `applyPatch` must therefore call
 * this TWICE for a `"moved"` patch — once against the pre-state graph with
 * `move.fromParentId`, once against the post-state graph with
 * `move.toParentId`. Getting it wrong is invisible in every test that watches
 * the moved node: the node updates, and the OLD ancestors' rollups silently
 * never re-render again.
 *
 * Ids absent from `graph` are bumped anyway, with no chain. That is deliberate:
 * filtering them would turn "caller passed the wrong-state graph" into a
 * SILENTLY DROPPED NOTIFICATION, which is precisely the failure mode above. A
 * stray revision entry for an id that no longer exists is inert by comparison —
 * nothing reads a revision for a node it cannot find.
 */
export function bumpSubtreeRevs<Ts extends readonly ErasedNodeType[], S>(
  revs: ReadonlyMap<NodeId, number>,
  graph: Graph<Ts, S>,
  fromIds: readonly NodeId[],
): ReadonlyMap<NodeId, number> {
  // Identity is preserved on a no-op so a caller can compare maps to decide
  // whether to notify at all.
  if (fromIds.length === 0) return revs;
  const next = new Map(revs);
  bumpSubtreeRevsInto(next, graph, fromIds);
  return next;
}

/**
 * The same bump, written into a map the caller PRIVATELY OWNS.
 *
 * Same contract as `bumpSubtreeRevs` in every other respect — it is the single
 * implementation, and the copying form above is a two-line wrapper over it, so
 * the two cannot drift.
 *
 * It exists because `applyPatch` was paying for the rev map TWICE per commit:
 * every arm cloned `subtreeRevById` to edit it and then handed the clone to
 * `bumpSubtreeRevs`, which cloned it again. A move paid three whole-graph map
 * copies before this split (children, parents, revs x2). The caller must not
 * pass a map that any surviving graph still references — writing into one would
 * retroactively change a value the PREVIOUS graph published, which is the
 * mutation the immutable-graph contract exists to forbid.
 *
 * The walk is INLINE rather than through `ancestorChain`, and that is the second
 * half of the fix: `ancestorChain` materialises the whole chain to the root
 * before the caller can look at it, so a batch of N siblings walked to the root
 * N times and allocated N arrays to discover that all but the first walk was
 * redundant. Breaking at the first already-bumped id makes the cost proportional
 * to the NEW part of each chain.
 */
export function bumpSubtreeRevsInto<Ts extends readonly ErasedNodeType[], S>(
  revs: Map<NodeId, number>,
  graph: Graph<Ts, S>,
  fromIds: readonly NodeId[],
): void {
  if (fromIds.length === 0) return;

  // Scoped to THIS call: `revs` already holds values, so it cannot answer
  // "did I bump this one already". The set is proportional to the touched
  // chains, never to the graph.
  const bumped = new Set<NodeId>();
  const budget = graph.nodesById.size;

  for (const startId of fromIds) {
    let current: NodeId | null = startId;
    let steps = 0;
    while (current !== null) {
      // Ancestor chains are prefix-closed upward: if this one is already
      // collected then so is everything above it, so stopping here is an exact
      // short-circuit rather than an approximation.
      if (bumped.has(current)) break;
      bumped.add(current);
      revs.set(current, (revs.get(current) ?? 0) + 1);
      // The same TERMINATION guard `ancestorChain` carries — a corrupt
      // `parentById` must fail finitely rather than hang a render loop.
      if (steps >= budget) break;
      steps += 1;
      current = graph.parentById.get(current) ?? null;
    }
  }
}


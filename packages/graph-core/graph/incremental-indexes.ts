// Graph — the incremental derived-index updaters.
//
// Every function here is an OPTIMISATION OF `walkDerivedIndexes` in
// ./derived-indexes, which is the one definition of what
// `placementsByContentKey` and `ownerBySourceKey` contain. Each computes the
// same answer that definition would, for one shape of mutation, without walking
// the document.
//
// THE RULE THAT MAKES THAT SAFE, and the reason these two files are a pair:
// AN INCREMENTAL UPDATE THAT DRIFTS FROM THE REBUILD IS A STALE INDEX NOTHING
// DETECTS — not until invariant check 9 fires in a dev build, or a
// rename-everywhere silently misses a placement in a production one. So a change
// to `walkDerivedIndexes` is a change to every function below, and the reverse.
// They were one file for exactly that reason and are now two only because the
// combined 700 lines had stopped being readable; if you are editing either, read
// both.
//
// The shared house style: each returns `null` for "no incremental answer" rather
// than for "invalid". When a precondition does not hold, the function declines
// and the caller rebuilds — none of this is `Result`-shaped, because nothing here
// is a rejection the engine reports.

import type {
  WidenedNodeType,
  Graph,
  GraphNode,
  NodeId,
  NodeTypeRegistry,
} from "../types";
import { documentOrderComparator, subtreeIds } from "./queries";
import { contentKeyOf, KeyHookFailure, ownsItsSubtree, sourceKeyOf } from "./keys";
import { type DerivedIndexes } from "./derived-indexes";

/**
 * Reorder `previous` for a permutation confined to ONE subtree, without walking
 * the graph.
 *
 * PRECONDITION, and the whole reason this is sound: the caller has established
 * that the mutation only permuted nodes INSIDE `subtree(scopeRootId)` — same
 * membership, same `data`, same reachability. Then for any node inside the scope
 * and any node outside it, their relative document order is what it was, so the
 * SLOTS a bucket devotes to scope members are exactly the slots it devoted
 * before. Rewriting those slots in the new intra-scope order is the complete
 * update; every other entry, and every other bucket, is untouched.
 *
 * Returns `previous` BY IDENTITY when no bucket actually reordered — the common
 * case when content keys are per-node unique, where a drag changes the index not
 * at all and must not allocate a map the size of the key space to say so.
 *
 * Returns `null` for "no incremental answer", not for "invalid": if the counts
 * disagree with `previous`, this function's precondition did not hold and it
 * refuses to guess. The caller rebuilds. It is deliberately NOT `Result`-shaped
 * — nothing here is a rejection the engine reports; it is an optimisation
 * declining to apply.
 */
export function reindexPlacementsWithinSubtree<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
  previous: ReadonlyMap<string, readonly NodeId[]>,
  scopeRootId: NodeId,
): ReadonlyMap<string, readonly NodeId[]> | null {
  if (!graph.nodesById.has(scopeRootId)) return null;

  const scopeIds = new Set<NodeId>();
  const runByKey = new Map<string, NodeId[]>();
  // POST-state pre-order of the scope: `subtreeIds` includes the root itself,
  // which is correct — a pre-order root precedes all of its descendants before
  // and after, so its slot is stable and it belongs in its own run.
  for (const id of subtreeIds(graph, scopeRootId)) {
    scopeIds.add(id);
    const node = graph.nodesById.get(id);
    if (node === undefined) continue;
    const contentKey = contentKeyOf(registry, node);
    if (contentKey === null) continue;
    const run = runByKey.get(contentKey);
    if (run === undefined) runByKey.set(contentKey, [id]);
    else run.push(id);
  }
  if (runByKey.size === 0) return previous;

  const rewritten = new Map<string, readonly NodeId[]>();
  for (const [contentKey, run] of runByKey) {
    const bucket = previous.get(contentKey);
    // The scope holds a node with this key but `previous` has no bucket for it:
    // `previous` was not built from this node set. Decline.
    if (bucket === undefined) return null;

    let cursor = 0;
    let differs = false;
    for (const id of bucket) {
      if (!scopeIds.has(id)) continue;
      const replacement = run[cursor];
      cursor += 1;
      if (replacement === undefined) return null;
      if (replacement !== id) differs = true;
    }
    // Fewer scope members in the bucket than the walk found: same conclusion.
    if (cursor !== run.length) return null;
    if (!differs) continue;

    const nextBucket = bucket.slice();
    let write = 0;
    for (let i = 0; i < nextBucket.length; i += 1) {
      const id = nextBucket[i];
      // `noUncheckedIndexedAccess` — a real check, not a `!`. The loop bounds
      // make this unreachable; TypeScript cannot see that and neither should a
      // reader.
      if (id === undefined || !scopeIds.has(id)) continue;
      const replacement = run[write];
      write += 1;
      if (replacement !== undefined) nextBucket[i] = replacement;
    }
    rewritten.set(contentKey, nextBucket);
  }

  // Nothing moved. Hand the map back by reference rather than allocating a copy
  // of the whole key space to express "no change".
  if (rewritten.size === 0) return previous;

  const next = new Map(previous);
  for (const [contentKey, bucket] of rewritten) next.set(contentKey, bucket);
  return next;
}

/**
 * Compare two ids by document order, amortised across many comparisons.
 *
 * Returns `null` for "cannot say" rather than a guess: a node absent from its
 * own parent's children means `parentById` and `childrenById` disagree, and the
 * one thing an ordering primitive must never do in that state is invent an
 * answer that reads as authoritative. Callers decline and rebuild.
 *
 * Two caches, both scoped to one call. Paths are built once per id — the
 * comparison itself allocates nothing — and slot maps once per parent, which is
 * what keeps a merge over a bucket from turning into `indexOf` per comparison
 * over a wide collection. The slot maps are the honest bound here: a bucket
 * whose members are spread across many parents pays each parent's width once,
 * so the pathological shape — one content key placed in EVERY collection —
 * costs the same order as the rebuild it replaces. It is never worse than the
 * rebuild, and for every realistic bucket it is not close.
 */

export function reindexPlacementsAcrossMove<Ts extends readonly WidenedNodeType[], S>(
  post: Graph<Ts, S>,
  registry: NodeTypeRegistry,
  previous: ReadonlyMap<string, readonly NodeId[]>,
  movedIds: readonly NodeId[],
): ReadonlyMap<string, readonly NodeId[]> | null {
  // A move carries whole subtrees, so a descendant travelled exactly as far as
  // the node the patch names. POST-state, because that is where the moved node
  // now lives and its subtree membership is what the move left behind.
  const travelled = new Set<NodeId>();
  for (const id of movedIds) {
    if (!post.nodesById.has(id)) return null;
    for (const descendant of subtreeIds(post, id)) travelled.add(descendant);
  }
  if (travelled.size === 0) return previous;

  // The ONLY node-type calls this function makes: one per node that actually
  // travelled. Every other node's key is not merely unchanged but irrelevant —
  // `contentKey` reads `data`, and a move does not touch `data`.
  const moversByKey = new Map<string, NodeId[]>();
  for (const id of travelled) {
    const node = post.nodesById.get(id);
    if (node === undefined) return null;
    const contentKey = contentKeyOf(registry, node);
    if (contentKey === null) continue;
    const movers = moversByKey.get(contentKey);
    if (movers === undefined) moversByKey.set(contentKey, [id]);
    else movers.push(id);
  }
  if (moversByKey.size === 0) return previous;

  const compare = documentOrderComparator(post);
  const rewritten = new Map<string, readonly NodeId[]>();

  for (const [contentKey, movers] of moversByKey) {
    const bucket = previous.get(contentKey);
    // The graph holds a node with this key and `previous` has no bucket for it:
    // `previous` was not built from this node set. Decline.
    if (bucket === undefined) return null;
    // A bucket of one cannot be out of order with itself. Worth its own line
    // rather than falling out of the merge below, because it is the common case
    // — a content key names an asset, and most assets are placed once — and
    // this is the line where that case costs nothing at all.
    if (bucket.length <= 1) continue;

    const moved = new Set(movers);
    const survivors: NodeId[] = [];
    let found = 0;
    for (const id of bucket) {
      if (moved.has(id)) found += 1;
      else survivors.push(id);
    }
    // Fewer of this key's movers in the bucket than the graph holds: the same
    // disagreement as above, and the same answer.
    if (found !== movers.length) return null;

    // Survivors are already in order and stay that way; the movers are sorted
    // among themselves and merged back in. Both facts come from the argument
    // above, and a batch that moves several subtrees is why the movers need
    // sorting at all rather than being appended in walk order.
    let declined = false;
    const ordered = movers.slice().sort((a, b) => {
      const verdict = compare(a, b);
      if (verdict === null) {
        declined = true;
        return 0;
      }
      return verdict;
    });
    if (declined) return null;

    const merged: NodeId[] = [];
    let left = 0;
    let right = 0;
    while (left < survivors.length && right < ordered.length) {
      const survivor = survivors[left];
      const mover = ordered[right];
      if (survivor === undefined || mover === undefined) return null;
      const verdict = compare(survivor, mover);
      if (verdict === null) return null;
      if (verdict <= 0) {
        merged.push(survivor);
        left += 1;
      } else {
        merged.push(mover);
        right += 1;
      }
    }
    for (; left < survivors.length; left += 1) {
      const survivor = survivors[left];
      if (survivor !== undefined) merged.push(survivor);
    }
    for (; right < ordered.length; right += 1) {
      const mover = ordered[right];
      if (mover !== undefined) merged.push(mover);
    }

    let differs = merged.length !== bucket.length;
    for (let i = 0; !differs && i < merged.length; i += 1) {
      if (merged[i] !== bucket[i]) differs = true;
    }
    if (differs) rewritten.set(contentKey, merged);
  }

  // Nothing reordered. Hand the map back by reference rather than allocating a
  // copy of the whole key space to say so.
  if (rewritten.size === 0) return previous;

  const next = new Map(previous);
  for (const [contentKey, bucket] of rewritten) next.set(contentKey, bucket);
  return next;
}

/**
 * `placementsByContentKey` after an INSERT, updated rather than rebuilt.
 *
 * The mirror of `reindexPlacementsAcrossMove`, minus its lift-out step: an
 * arriving node is not in `previous` at all, so there are no survivors to
 * separate from movers — only arrivals to merge into buckets that are already
 * in order.
 *
 * Sound for the same reason the move case is: an insert cannot REORDER anything
 * that was already there. Splicing an id into a children array shifts later
 * siblings within document order but preserves every pre-existing node's order
 * relative to every other, so each existing bucket stays sorted and the only
 * new entries are the arrivals' own.
 *
 * ONE DIFFERENCE FROM THE MOVE CASE, and it is the only place the two diverge:
 * an absent bucket here means a brand-new key, which is ordinary and gets set.
 * There, an absent bucket meant `previous` disagreed with the graph, and the
 * answer was to decline.
 *
 * `null` is "declined", on the same terms as its neighbours — a comparator that
 * cannot rank two ids, or an arriving id already sitting in the bucket, which
 * would mean this was not an insert of new nodes.
 */
export function placementsAfterInsert<Ts extends readonly WidenedNodeType[], S>(
  post: Graph<Ts, S>,
  registry: NodeTypeRegistry,
  previous: ReadonlyMap<string, readonly NodeId[]>,
  arrived: readonly GraphNode<Ts, S>[],
): ReadonlyMap<string, readonly NodeId[]> | null {
  // THE ONLY node-type calls this function makes: one per ARRIVING node. Every
  // other node's key is not merely unchanged but irrelevant — `contentKey`
  // reads `data`, and an insert does not touch anybody else's.
  const arrivalsByKey = new Map<string, NodeId[]>();
  for (const node of arrived) {
    const contentKey = contentKeyOf(registry, node);
    if (contentKey === null) continue;
    const bucket = arrivalsByKey.get(contentKey);
    if (bucket === undefined) arrivalsByKey.set(contentKey, [node.id]);
    else bucket.push(node.id);
  }
  // Nothing arriving carries a key, so the index is exactly what it was. By
  // reference, which is what `derivedIndexesSurviveInsert` bought before
  // this function existed and is worth keeping.
  if (arrivalsByKey.size === 0) return previous;

  const compare = documentOrderComparator(post);
  const rewritten = new Map<string, readonly NodeId[]>();

  for (const [contentKey, arrivals] of arrivalsByKey) {
    let declined = false;
    const ordered = arrivals.slice().sort((a, b) => {
      const verdict = compare(a, b);
      if (verdict === null) {
        declined = true;
        return 0;
      }
      return verdict;
    });
    if (declined) return null;

    const bucket = previous.get(contentKey);
    if (bucket === undefined) {
      // A key nothing held before. Ordinary for an insert.
      rewritten.set(contentKey, ordered);
      continue;
    }

    const merged: NodeId[] = [];
    let left = 0;
    let right = 0;
    while (left < bucket.length && right < ordered.length) {
      const incumbent = bucket[left];
      const arrival = ordered[right];
      if (incumbent === undefined || arrival === undefined) break;
      // An arriving id already in the bucket means this was not an insert of
      // new nodes, and merging would duplicate it.
      if (incumbent === arrival) return null;
      const verdict = compare(incumbent, arrival);
      if (verdict === null) return null;
      if (verdict <= 0) {
        merged.push(incumbent);
        left += 1;
      } else {
        merged.push(arrival);
        right += 1;
      }
    }
    // A SET, not `ordered.includes`. This tail runs once per surviving
    // incumbent and the scan inside it is proportional to the arrivals, so the
    // pair was O(incumbents x arrivals) — and it is the tail that carries the
    // whole bucket whenever the arrivals sort first, which is what inserting at
    // index 0 does. Invisible to the cost suite because every fixture there
    // gives each clip a unique `assetId`, so every bucket has length 1 and this
    // loop never runs more than once.
    //
    // The membership question is the same one the merge above answers with
    // `incumbent === arrival`: an arriving id already in the bucket means this
    // was not an insert of new nodes. Built once per key rather than rescanned
    // per incumbent.
    const arriving = new Set(ordered);
    for (; left < bucket.length; left += 1) {
      const incumbent = bucket[left];
      if (incumbent === undefined) continue;
      if (arriving.has(incumbent)) return null;
      merged.push(incumbent);
    }
    for (; right < ordered.length; right += 1) {
      const arrival = ordered[right];
      if (arrival !== undefined) merged.push(arrival);
    }
    rewritten.set(contentKey, merged);
  }

  const next = new Map(previous);
  for (const [contentKey, bucket] of rewritten) next.set(contentKey, bucket);
  return next;
}

/**
 * `ownerBySourceKey` after an INSERT, updated rather than rebuilt.
 *
 * The mirror of `derivedIndexesAfterRemoval`'s owner half. Only a node that
 * OWNS its subtree can claim a key — the same `ownsItsSubtree` predicate
 * `walkDerivedIndexes` applies, so the incremental answer and the from-scratch
 * one cannot disagree about who counts.
 *
 * An arrival colliding with an incumbent owner is `duplicate-owner`, which
 * invariant check 8 refuses AHEAD of check 9's index comparison — the identical
 * reprieve `rebuildPlacementIndex` and `derivedIndexesAfterRemoval` already
 * take. So on any graph where carrying the map forward could disagree with a
 * rebuild, the audit already names the real defect rather than a stale-index
 * symptom of it.
 */
export function ownersAfterInsert<Ts extends readonly WidenedNodeType[], S>(
  registry: NodeTypeRegistry,
  previous: ReadonlyMap<string, NodeId>,
  arrived: readonly GraphNode<Ts, S>[],
): ReadonlyMap<string, NodeId> {
  let next: Map<string, NodeId> | null = null;
  for (const node of arrived) {
    if (!ownsItsSubtree<Ts, S>(node)) continue;
    const sourceKey = sourceKeyOf<Ts, S>(registry, node);
    if (sourceKey === null) continue;
    if (previous.has(sourceKey)) continue;
    if (next === null) next = new Map(previous);
    if (!next.has(sourceKey)) next.set(sourceKey, node.id);
  }
  // Nothing claimed, so the map is what it was — by reference.
  return next ?? previous;
}

/**
 * Both indexes after a removal, updated rather than rebuilt.
 *
 * Sound because a removal cannot REORDER anything: dropping ids leaves every
 * survivor's document position relative to every other survivor exactly as it
 * was, so each affected bucket only needs its dead ids filtered out. Ownership
 * transfers are impossible for the same reason moves cannot change ownership —
 * a key with a second owner waiting to inherit is `duplicate-owner`, refused by
 * check 8.
 *
 * Takes the PRE-state graph and reads each key off the LIVE node, never off the
 * patch's recorded copy: `applyNonUndoableWrite` is a non-undoable content write, so a
 * dormant removal patch can carry a `node` whose `data` — and therefore whose
 * `contentKey` — is no longer what the graph holds. Deleting under the recorded
 * key would leave the real bucket holding a dead id.
 */
export function derivedIndexesAfterRemoval<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
  removedIds: readonly NodeId[],
): DerivedIndexes<Ts, S> {
  const previous: DerivedIndexes<Ts, S> = {
    placementsByContentKey: graph.placementsByContentKey,
    ownerBySourceKey: graph.ownerBySourceKey,
  };
  if (removedIds.length === 0) return previous;

  const removed = new Set<NodeId>(removedIds);
  const touchedContentKeys = new Set<string>();
  const orphanedSourceKeys = new Set<string>();
  for (const id of removed) {
    const node = graph.nodesById.get(id);
    if (node === undefined) continue;
    const contentKey = contentKeyOf(registry, node);
    if (contentKey !== null) touchedContentKeys.add(contentKey);
    const sourceKey = sourceKeyOf(registry, node);
    // Only the node that actually HOLDS the key vacates it. A `reference`
    // placement of the same key never owned it and its removal changes nothing.
    if (sourceKey !== null && graph.ownerBySourceKey.get(sourceKey) === id) {
      orphanedSourceKeys.add(sourceKey);
    }
  }
  if (touchedContentKeys.size === 0 && orphanedSourceKeys.size === 0) {
    return previous;
  }

  let placementsByContentKey = graph.placementsByContentKey;
  if (touchedContentKeys.size > 0) {
    const next = new Map(graph.placementsByContentKey);
    for (const contentKey of touchedContentKeys) {
      const bucket = next.get(contentKey);
      if (bucket === undefined) continue;
      const kept = bucket.filter((id) => !removed.has(id));
      if (kept.length === bucket.length) continue;
      // An emptied bucket must be DELETED, not left as `[]` — check 9 compares
      // key COUNTS against a fresh rebuild, and a rebuild never mints an empty
      // one.
      if (kept.length === 0) next.delete(contentKey);
      else next.set(contentKey, kept);
    }
    placementsByContentKey = next;
  }

  let ownerBySourceKey = graph.ownerBySourceKey;
  if (orphanedSourceKeys.size > 0) {
    const next = new Map(graph.ownerBySourceKey);
    for (const sourceKey of orphanedSourceKeys) next.delete(sourceKey);
    ownerBySourceKey = next;
  }

  return { placementsByContentKey, ownerBySourceKey };
}

/**
 * True when inserting exactly these nodes cannot move EITHER derived index.
 *
 * An insert never reorders anything that was already there — splicing an id into
 * a children array shifts later siblings within the document order but preserves
 * the relative order of every pre-existing node — so the only entries a new node
 * can disturb are the ones it would contribute itself. A batch that contributes
 * no key at all (a new folder, in a registry where only clips carry keys) leaves
 * both maps exactly as they were, and both can be handed on by reference.
 *
 * "SURVIVE", not the "leaves ... intact" this and its data-change sibling used
 * to be called. `insertLeavesDerivedIndexesIntact` meant "leaves" as the verb,
 * but this package has `LeafNode`, `leaf-seed-with-children`, and a comment
 * titled "a leaf owns nothing" — leaf is a NOUN here, so the name parsed as
 * "insert leaves" before it parsed as "insert leaves them intact". A word that
 * garden-paths in the one codebase it lives in is the wrong word, however
 * correct its grammar.
 */
export function derivedIndexesSurviveInsert<Ts extends readonly WidenedNodeType[], S>(
  registry: NodeTypeRegistry,
  nodes: readonly GraphNode<Ts, S>[],
): boolean {
  for (const node of nodes) {
    if (contentKeyOf(registry, node) !== null) return false;
    if (sourceKeyOf(registry, node) !== null) return false;
  }
  return true;
}

/**
 * True when one node's data change cannot move EITHER derived index.
 *
 * Asks the node type rather than the registry shape, because the high-value case is
 * a kind that DOES define `contentKey` and whose key does not depend on the
 * field being edited — retitling a clip whose `contentKey` is its asset id. The
 * cheap structural case (a kind defining neither function) falls out of the same
 * two calls, both of which return `null` for it.
 *
 * `data-changed` cannot move a node, so document order is untouched and equal
 * keys really do mean an untouched index.
 */
export function derivedIndexesSurviveDataChange(
  registry: NodeTypeRegistry,
  kind: string,
  before: unknown,
  after: unknown,
): boolean {
  const nodeType = registry.get(kind);
  if (nodeType === undefined) return true;
  // TAGGED like the two key accessors above, because these are the same two
  // consumer hooks and this was the ONE place that called them directly rather
  // than through `contentKeyOf`/`sourceKeyForData`. That is exactly why it
  // was still leaking after those were wrapped: measured, a throwing
  // `contentKey` reached here from `applyPatch` and escaped BOTH `dispatch` and
  // `undo` — the two doors review3 names — while every other door was already
  // refusing cleanly.
  //
  // No `nodeId`: this predicate is handed a kind and two data values by a
  // caller comparing a `data-changed` patch, and the node it belongs to is not
  // in scope. The kind and the hook name are what the consumer needs.
  const compare = (
    hook: "contentKey" | "sourceKey",
    read: (data: unknown) => string | null,
  ): boolean => {
    try {
      return read(before) === read(after);
    } catch (thrown) {
      throw new KeyHookFailure(kind, hook, null, thrown);
    }
  };
  if (nodeType.contentKey !== undefined && !compare("contentKey", nodeType.contentKey)) {
    return false;
  }
  if (nodeType.sourceKey !== undefined && !compare("sourceKey", nodeType.sourceKey)) {
    return false;
  }
  return true;
}

/**
 * IO landing for "storage says this subtree is gone".
 *
 * TOTAL and NO-OP SAFE, because it races real structure changes: the fetch that
 * 404'd was issued a while ago, and the node may have moved, been removed or
 * been loaded since. Returning `graph` unchanged is always a correct response
 * to a stale answer.
 *
 * The no-op cases, each for its own reason:
 *   - unknown id              — the node is already gone.
 *   - leaf / quarantined leaf — no subtree to be missing.
 *   - `reference`             — this placement never owned the subtree; the
 *                               owner is the one entitled to hear a 404 about
 *                               it.
 *   - `loaded`                — LOADING IS MONOTONE IN V1. Demoting a loaded
 *                               collection to `missing` is an unload: it would
 *                               discard resident nodes with no patch, and break
 *                               the property `verifyPatchApplies` rests on —
 *                               that a surviving node is the node the dormant
 *                               patch was recorded against.
 *   - `missing`, same reason  — already said.
 *
 * Produces NO patch, NO history entry and NO change-feed event; the consumer
 * performed the IO and already knows. It DOES bump `subtreeRev` along the
 * chain, because every ancestor's rollup just changed meaning.
 */

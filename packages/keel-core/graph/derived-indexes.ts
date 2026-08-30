// KEEL graph — the derived indexes, and every updater that touches them.
//
// `placementsByContentKey` and `ownerBySourceKey` are derived: they hold nothing
// the nodes do not already say, and exist so a repeated asset or a duplicate
// owner is an O(1) question instead of a document walk.
//
// `walkDerivedIndexes` below is THE ONE DEFINITION of what those maps contain,
// so `applyPatch` and `findInvariantViolation` cannot hold two different
// opinions about it.
//
// READ THIS WITH ./incremental-indexes. Every function there computes the same
// answer this definition would, for one shape of mutation, without walking the
// document — and an incremental update that drifts from this rebuild is a stale
// index NOTHING DETECTS until invariant check 9 fires in a dev build, or a
// rename-everywhere silently misses a placement in a production one. A change
// here is a change to every function there, and the reverse.
//
// The two were one file for exactly that reason, and are now a pair only because
// the combined 700 lines had stopped being readable. The rule did not change with
// the file boundary.

import type {
  ErasedNodeType,
  Graph,
  NodeId,
  NodeTypeRegistry,
} from "../types";
import { NO_OWNERS, NO_PLACEMENTS } from "./internals";
import { documentOrder } from "./queries";
import { contentKeyOf, ownsItsSubtree, sourceKeyOf } from "./keys";

/** The derived pair, as `applyPatch` splices it onto a graph. */
export type DerivedIndexes<Ts extends readonly ErasedNodeType[], S> = Pick<
  Graph<Ts, S>,
  "placementsByContentKey" | "ownerBySourceKey"
>;

/** Which halves of the derived pair the registered node types can populate AT ALL. */
export type DerivedIndexNeed = Readonly<{ content: boolean; source: boolean }>;

/**
 * Ask the REGISTRY, once per commit, whether either index can hold anything.
 *
 * `contentKey` and `sourceKey` are both optional on `ConsumerDefinedNodeType`, so a consumer
 * that opts into neither has two permanently empty maps — and used to pay a
 * full document-order DFS, plus a registry lookup per node, to rediscover that
 * on every single mutation. The cost of asking is proportional to the number of
 * registered KINDS, which is a handful; the cost it replaces is proportional to
 * the graph.
 */
export function derivedIndexNeed(registry: NodeTypeRegistry): DerivedIndexNeed {
  let content = false;
  let source = false;
  for (const nodeType of registry.values()) {
    if (nodeType.contentKey !== undefined) content = true;
    if (nodeType.sourceKey !== undefined) source = true;
    if (content && source) break;
  }
  return { content, source };
}

/**
 * The one walk both rebuild entry points share, so "what is in these indexes"
 * still has exactly one definition.
 *
 * `want` narrows the work, never the meaning: a half that is not wanted comes
 * back as the SHARED empty map, so a caller that carries the other half forward
 * by reference is splicing in a value that is both correct and identity-stable.
 *
 * Only REACHABLE nodes are indexed. In a valid graph that is every node; in an
 * invalid one, indexing an orphan would give a detached subtree a vote on
 * ownership.
 */
function walkDerivedIndexes<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
  want: DerivedIndexNeed,
): DerivedIndexes<Ts, S> {
  if (!want.content && !want.source) {
    // The whole DFS is dead work. Returning the shared empties (rather than two
    // fresh Maps) also keeps the graph's derived fields reference-stable across
    // commits, so a consumer memoising on them sees no churn.
    return { placementsByContentKey: NO_PLACEMENTS, ownerBySourceKey: NO_OWNERS };
  }

  const placementsByContentKey = want.content ? new Map<string, NodeId[]>() : null;
  const ownerBySourceKey = want.source ? new Map<string, NodeId>() : null;

  for (const id of documentOrder(graph)) {
    const node = graph.nodesById.get(id);
    if (node === undefined) continue;

    if (placementsByContentKey !== null) {
      const contentKey = contentKeyOf(registry, node);
      if (contentKey !== null) {
        const bucket = placementsByContentKey.get(contentKey);
        if (bucket === undefined) placementsByContentKey.set(contentKey, [id]);
        else bucket.push(id);
      }
    }

    if (ownerBySourceKey === null) continue;
    const sourceKey = sourceKeyOf(registry, node);
    if (sourceKey === null) continue;
    if (!ownsItsSubtree(node)) continue;
    // FIRST owner in document order wins, deterministically. A second one is a
    // violation, but saying so is `findInvariantViolation`'s job — this
    // function runs on every mutation and must not have an opinion it could
    // impose mid-command.
    if (!ownerBySourceKey.has(sourceKey)) ownerBySourceKey.set(sourceKey, id);
  }

  return {
    placementsByContentKey: placementsByContentKey ?? NO_PLACEMENTS,
    ownerBySourceKey: ownerBySourceKey ?? NO_OWNERS,
  };
}

/**
 * Recompute both derived indexes from scratch, in DOCUMENT order.
 *
 * The fallback, not the default path. `applyPatch` reaches for it only when the
 * cheaper answers below decline — an insert or an edit that really can move a
 * key, or a move too general to scope. Every ingress (`buildGraph`,
 * `deserializeDocument`) still uses it, because there is no previous index to
 * update from.
 *
 * Incremental IS possible for the arms that update instead, and each one carries
 * the argument for why. What is NOT possible is incremental in general: one
 * `edit-nodes` command can change `contentKey` on any node in the batch, and a
 * stale placement index is invisible until a rename-everywhere silently misses a
 * placement. So the rule is: update only where the patch's own shape PROVES what
 * cannot have moved, and rebuild otherwise.
 */
export function rebuildDerivedIndexes<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
): DerivedIndexes<Ts, S> {
  return walkDerivedIndexes(graph, registry, derivedIndexNeed(registry));
}

/**
 * `placementsByContentKey` alone, from scratch — the fallback for a move.
 *
 * WHY A MOVE NEEDS ONLY THIS HALF. A move rewrites `childrenById` and
 * `parentById` and NOTHING else: no node's `data` changes, so no node's
 * `sourceKey` changes; no node's `ChildrenState` changes, so `isOwningPlacement`
 * is identical for every node; and no node leaves the forest, so the reachable
 * set is identical. The SET of owning placements per key is therefore the set it
 * already was, and `applyPatch` hands `ownerBySourceKey` straight through.
 *
 * Only the tie-break could differ — a rebuild awards a key to the FIRST owner in
 * document order — and a key with two owners to choose between is
 * `duplicate-owner`, which `findInvariantViolation` refuses at check 8, BEFORE
 * check 9 ever compares this index. So on any graph where carrying the map
 * forward could disagree with a rebuild, the audit already names the real defect
 * rather than a derived-index-stale symptom of it.
 *
 * `placementsByContentKey` gets no such reprieve: its values are in DOCUMENT
 * order, so a pure reorder moves it even though no data did.
 */
export function rebuildPlacementIndex<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
): ReadonlyMap<string, readonly NodeId[]> {
  const need = derivedIndexNeed(registry);
  return walkDerivedIndexes(graph, registry, { content: need.content, source: false })
    .placementsByContentKey;
}


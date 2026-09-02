// Graph — list splicing — how children arrive at and leave an index.
//
// Split out of the former `patches/internals.ts`; see ./index.ts.

import {
  type NodeId,
} from "../types";

import { EMPTY_IDS } from "./constants";

/** Group arrivals by destination parent, PRESERVING patch order within each
 *  parent — which is the order their indices are expressed in. */
export function groupArrivalsByParent(
  entries: readonly Readonly<{ parentId: NodeId; index: number; nodeId: NodeId }>[],
): ReadonlyMap<NodeId, readonly Arrival[]> {
  const byParent = new Map<NodeId, Arrival[]>();
  for (const { parentId, index, nodeId } of entries) {
    const bucket = byParent.get(parentId);
    if (bucket === undefined) byParent.set(parentId, [{ index, nodeId }]);
    else bucket.push({ index, nodeId });
  }
  return byParent;
}
/** Group ids by the parent they are leaving, so each parent is rewritten once. */
export function groupByParent(
  entries: readonly Readonly<{ parentId: NodeId; nodeId: NodeId }>[],
): ReadonlyMap<NodeId, ReadonlySet<NodeId>> {
  const byParent = new Map<NodeId, Set<NodeId>>();
  for (const { parentId, nodeId } of entries) {
    const bucket = byParent.get(parentId);
    if (bucket === undefined) byParent.set(parentId, new Set([nodeId]));
    else bucket.add(nodeId);
  }
  return byParent;
}
/**
 * Copy-on-write insertion of MANY ids into one parent — ONE pass per parent
 * instead of one per arriving node.
 *
 * THE MIRROR OF `spliceOutMany`, and it should have shipped with it. That one
 * fixed removal, which was three O(siblings) passes per id; insertion kept
 * doing exactly the same thing — `slice()` the whole destination array, splice
 * one id in, store it — once per node. So the removal half went linear and the
 * insertion half stayed O(K x N), and undo of a bulk delete inverts to an
 * `inserted` patch and paid in full the cost the delete no longer did.
 *
 * MEASURED, with a registry declaring neither key so the derived-index paths
 * short-circuit and this is purely structural:
 *
 *      k        delete      undo of that delete      move k into one parent
 *   4,000      12.6 ms              44 ms                    60 ms
 *   8,000      19.3 ms             152 ms                   464 ms
 *  16,000      88.2 ms           1,050 ms                 2,978 ms
 *  32,000      76.3 ms           6,759 ms                10,018 ms
 *
 * Delete grows 6x for 8x the nodes. Undo of the same delete grows 152x. At
 * 32,000 a select-all/Delete costs 76 ms and Ctrl-Z on it costs 6.8 SECONDS —
 * the same nodes, the same parent, 89x apart.
 *
 * WHY INSERTION CANNOT JUST BE GROUPED AND SORTED, which is what makes this
 * longer than its removal twin. Removal by identity is order-independent, so
 * `spliceOutMany` can take a Set and make one pass. Insertion is not: each
 * `index` is expressed in the coordinates of the array as it stands at that
 * moment, so entry N's position depends on entries 0..N-1 having already
 * landed. Applying them in another order, or all at once against the original
 * array, gives a different answer.
 *
 * The single pass below reproduces the sequential result exactly, by building
 * the output left to right and emitting an arrival the moment the output length
 * REACHES its index. That is equivalent to sequential splicing whenever a
 * parent's indices are strictly ascending and in range — which is every patch
 * this engine builds: `buildSeedPlacements` and `buildMoves` both emit
 * `toIndex + offset`, and a removal patch records document order, so inverting
 * one yields ascending indices too.
 *
 * It DECLINES rather than guessing when it cannot reach an index — equal
 * indices (where sequential splicing puts the LATER arrival first), descending
 * indices, or an index out of range. None of those are reachable from the
 * reducer; a hand-built patch can produce all three. The caller then falls back
 * to the per-id `spliceIn` loop, whose behaviour is the definition rather than
 * an approximation of it. A wrong children array costs far more than the
 * microseconds this saves, so the fast path runs only where it is provably
 * identical.
 */
export function spliceInMany(
  children: Map<NodeId, readonly NodeId[]>,
  byParent: ReadonlyMap<NodeId, readonly Arrival[]>,
): void {
  for (const [parentId, arrivals] of byParent) {
    // `?? EMPTY_IDS` cannot fire for a verified patch — the parent is either a
    // loaded container in the graph or one this patch seeded earlier. It is
    // here so a hand-built patch produces a wrong array rather than a crash,
    // exactly as `spliceIn` does.
    const current = children.get(parentId) ?? EMPTY_IDS;
    const next: NodeId[] = [];
    let read = 0;
    let placed = 0;

    for (const arrival of arrivals) {
      // Copy originals until the output is exactly as long as this arrival's
      // index. If the index is behind us, or past what the originals can
      // supply, this shape is not reproducible in one pass.
      while (next.length < arrival.index && read < current.length) {
        const id = current[read];
        read += 1;
        // `noUncheckedIndexedAccess` — a real check, not a `!`. The loop bounds
        // make this unreachable; TypeScript cannot see that and neither should
        // a reader.
        if (id !== undefined) next.push(id);
      }
      if (next.length !== arrival.index) break;
      next.push(arrival.nodeId);
      placed += 1;
    }

    if (placed !== arrivals.length) {
      // DECLINED — nothing written yet, so the fallback starts from the
      // untouched array and the two paths cannot interleave.
      for (const arrival of arrivals) {
        spliceIn(children, parentId, arrival.index, arrival.nodeId);
      }
      continue;
    }

    for (; read < current.length; read += 1) {
      const id = current[read];
      if (id !== undefined) next.push(id);
    }
    children.set(parentId, next);
  }
}
/**
 * Copy-on-write removal for MANY ids at once — ONE pass per parent instead of
 * one per removed node.
 *
 * WHAT THIS REPLACED, because the reasoning is the whole justification for the
 * shape. The per-id predecessor was three O(siblings) passes — `indexOf`,
 * `slice`, `splice` — allocating a fresh array every call, so removing K of N
 * siblings cost O(K x N). The constant is a memcpy, which is why it stayed
 * invisible: free below a thousand siblings, and 5.2 SECONDS measured for
 * select-all-then-Delete on a 40,000-item strip. Both arms that remove in bulk
 * — `applyRemoved` and `applyMoved` — go through here.
 *
 * That predecessor, `spliceOut`, SAT HERE UNREFERENCED until lint reached this
 * package for the first time and reported it. Two of the sentences above used
 * to name it in the present tense, which is how it survived: prose describing
 * a function nobody calls reads exactly like prose describing one everybody
 * does. Recovered from `801c286^` if it is ever wanted again.
 *
 * `remaining.delete(id)` rather than `ids.has(id)` is deliberate and preserves
 * the replaced semantics exactly: `splice(at, 1)` removes AT MOST ONE
 * occurrence of an id, and a `has` filter would remove every copy. That can
 * only differ on a graph already violating "one id in two children arrays", and
 * a bulk removal is not the place to start quietly repairing a corruption the
 * audit exists to report.
 */
export function spliceOutMany(
  children: Map<NodeId, readonly NodeId[]>,
  byParent: ReadonlyMap<NodeId, ReadonlySet<NodeId>>,
): void {
  for (const [parentId, ids] of byParent) {
    const current = children.get(parentId);
    // Absent when the parent is itself being removed in this same patch — its
    // whole entry is gone, so there is no array left to maintain.
    if (current === undefined) continue;
    const remaining = new Set<NodeId>(ids);
    const next: NodeId[] = [];
    for (const id of current) {
      if (remaining.delete(id)) continue;
      next.push(id);
    }
    if (next.length !== current.length) children.set(parentId, next);
  }
}

/** One id arriving at one position. `index` is in the coordinates of the array
 *  AS IT STANDS when this entry is applied — the same contract `spliceIn` has,
 *  and the reason these cannot simply be sorted. */
export type Arrival = Readonly<{ index: number; nodeId: NodeId }>;
/** Copy-on-write splice into a parent's children array. */
export function spliceIn(
  children: Map<NodeId, readonly NodeId[]>,
  parentId: NodeId,
  index: number,
  id: NodeId,
): void {
  // `?? EMPTY_IDS` cannot fire for a verified patch — the parent is either a
  // loaded container in the graph or a loaded container this patch seeded two
  // steps earlier. It is here so a hand-built patch produces a wrong array
  // rather than a crash.
  const next = (children.get(parentId) ?? EMPTY_IDS).slice();
  const at = index < 0 ? 0 : index > next.length ? next.length : index;
  next.splice(at, 0, id);
  children.set(parentId, next);
}

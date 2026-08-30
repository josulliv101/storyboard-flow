// KEEL — patches: the reversible record of a mutation, and the ONE index rewriter.
//
// PURE. No React, no DOM, no "use client".
//
// Three functions carry the weight of this module and it is worth naming what
// each one is defending against:
//
//  - `applyPatch` is the ONLY code in keel that rewrites `childrenById`,
//    `parentById` or `subtreeRevById`. Forward application, undo and redo all
//    route through it, so they cannot drift. The predecessor engine had a
//    separate undo path and it drifted.
//  - `invertPatch` swaps before/after, flips inserted<->removed PRESERVING
//    ARRAY ORDER, and swaps move endpoints. Nothing else. Every extra thing an
//    inverter does is a thing that can be wrong N undos later, silently.
//  - `verifyPatchApplies` gates every DORMANT patch before replay. Loading
//    grows the graph while history entries sleep; omitting this check
//    reproduced two real corruptions in the predecessor.
//
// THE ORDER CONTRACT, stated once because three functions depend on it:
//
//   "inserted"  — DOCUMENT ORDER, parents before children. Walked FORWARD.
//   "removed"   — the EXACT mirror: same array, same order, same indices.
//                 Walked BACKWARD, so children leave before parents and a later
//                 sibling's splice cannot invalidate an earlier one's index.
//   "moved"     — remove ALL, then insert ALL; `toIndex` is POST-REMOVAL.
//
// `invertPatch` preserving array order is what makes the mirror hold: removing
// [A@1, B@2] backward (B, then A) and re-inserting forward (A@1, then B@2)
// lands both nodes exactly where they were.
//
// A removal patch MUST record the WHOLE SUBTREE, not just the named node.
// Recording only the named node loses every descendant on undo, and
// `verifyPatchApplies` refuses such a patch with "node-not-empty" rather than
// letting it corrupt quietly. Building the patch is commands.ts's job; refusing
// a bad one is this module's.

import {
  describeThrown,
  makeCollectionNode,
  makeDataChange,
  makeLeafNode,
  type GraphNode,
  type ChildrenState,
  type DataChange,
  type EngineContext,
  type Graph,
  type ErasedNodeType,
  type Move,
  type NodeId,
  type NodeTypeRegistry,
  type Patch,
  type Placement,
  type ReplayRejection,
  type ReplayRejectionCode,
  type Result,
} from "./types";
import {
  bumpSubtreeRevs,
  placementsAfterInsert,
  ownersAfterInsert,
  ownsItsSubtree,
  sourceKeyOf,
  sourceKeyOfKindData,
  KeyHookFailure,
  keyHookMessage,
  bumpSubtreeRevsInto,
  dataChangeLeavesDerivedIndexesIntact,
  derivedIndexNeed,
  derivedIndexesAfterRemoval,
  rebuildDerivedIndexes,
  rebuildPlacementIndex,
  reindexPlacementsAcrossMove,
  reindexPlacementsWithinSubtree,
  type DerivedIndexes,
} from "./graph";

/** Shared empty array. Frozen because it is handed out from several readers and
 *  a caller mutating it would corrupt every other reader's view. */
const EMPTY_IDS: readonly NodeId[] = Object.freeze([]);

const VERIFY_OK: Result<void, ReplayRejection> = { ok: true, value: undefined };

function replayError(
  code: ReplayRejectionCode,
  message: string,
  // Derived from `ReplayRejection` rather than re-spelled: this used to list
  // the three fields by hand, so adding `limit`/`actual` to the rejection made
  // the type that CONSTRUCTS it reject them. One shape, one place.
  detail?: Omit<ReplayRejection, "code" | "message">,
): Result<void, ReplayRejection> {
  return { ok: false, error: { code, message, ...detail } };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/**
 * The node's `ChildrenState`, or `null` when it has none (a leaf, or a
 * quarantined leaf).
 *
 * Discriminates on `quarantined` FIRST and `container` second, which is the
 * only order that works: `container` is plain `boolean` on the quarantined arm
 * (it comes off the wire), so it is not disjoint from the `true` / `false`
 * literals on the other two and cannot discriminate on its own.
 */
function containerChildrenState<Ts extends readonly ErasedNodeType[], S>(
  node: GraphNode<Ts, S>,
): ChildrenState | null {
  if (node.quarantined) return node.children;
  if (node.container) return node.children;
  return null;
}

/** `true` when this node owns a `childrenById` entry — i.e. it is a `loaded`
 *  container. Exactly one state has an entry; the other three have none. */
function isLoadedContainer<Ts extends readonly ErasedNodeType[], S>(
  node: GraphNode<Ts, S>,
): boolean {
  const state = containerChildrenState(node);
  return state !== null && state.status === "loaded";
}

/**
 * Structural equality over a SERIALIZED value.
 *
 * Explicit stack, never recursion: `data` is consumer-shaped and arrives from
 * the wire, so its nesting depth is hostile input. This is the same rule the
 * graph walks follow, applied to content.
 *
 * Object.is (not ===) so a node type that legitimately stores NaN compares equal to
 * itself; otherwise a `data-changed` undo of a NaN-bearing node would be
 * refused forever with "data-mismatch".
 */
function deepEqual(a: unknown, b: unknown): boolean {
  const stack: Readonly<{ left: unknown; right: unknown }>[] = [
    { left: a, right: b },
  ];
  /**
   * Object pairs this walk has already taken on, so a cyclic value terminates.
   *
   * WITHOUT THIS THE PROCESS DIES, and not slowly. Two DISTINCT values that
   * each hold a back-reference — `out.self = out` from either side of the
   * comparison below — make the walk push two frames for every one it pops, so
   * the stack grows without bound. Measured: heap exhaustion at 4 GB and a
   * killed process in 23 seconds. `Object.is` is no help, because the two
   * `serialize` calls return two different objects.
   *
   * A PARSED value may legitimately hold a back-pointer, and this compares
   * `serialize` OUTPUT rather than parsed data — so reaching it takes a node
   * type whose `serialize` returns a cycle, which is a consumer bug on the same
   * footing as the throwing `serialize` the caller already wraps. Wire data
   * cannot carry one; an in-memory `raw` handed to `deserialize` can.
   *
   * NOT A STEP BUDGET, and that distinction is the whole design. ./types argues
   * that `verifyPatchApplies` needs a comparator that CANNOT abstain, because a
   * budget bail surfaces as a spurious `data-mismatch` — a legitimate undo
   * refused for being large. That argument is right, and a budget would have
   * broken exactly the case it was meant to protect: a clip with a few hundred
   * keyframes is big, not cyclic. A memo changes no verdict on any acyclic
   * value; it only makes the cyclic ones finish.
   *
   * CO-INDUCTIVE, which is the standard rule and the only one that stays
   * definite: a pair already under comparison is ASSUMED equal. The assumption
   * costs nothing, because any concrete disagreement anywhere in the walk
   * returns `false` immediately, and `true` is only reached once every pair has
   * been discharged. `a.self = a` against `b.self = b` compares equal — which is
   * correct, they are structurally identical — while `a.self = a` against
   * `b.self = {}` still returns `false` on the key-count check.
   *
   * Allocated lazily and only for object-vs-object pairs, so a comparison that
   * never reaches two objects never builds one. The residual bound is the
   * number of DISTINCT pairs the walk reaches, which for the wire-shaped values
   * this shares with the rest of the package is the size of the value.
   */
  let seen: Map<object, Set<object>> | null = null;

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { left, right } = frame;
    if (Object.is(left, right)) continue;

    // Both sides are objects, so this pair can recur. Record it before
    // descending, which is what makes a cycle terminate rather than repeat.
    if (
      typeof left === "object" &&
      left !== null &&
      typeof right === "object" &&
      right !== null
    ) {
      if (seen === null) seen = new Map<object, Set<object>>();
      let against = seen.get(left);
      if (against === undefined) {
        against = new Set<object>();
        seen.set(left, against);
      }
      // Already taken on higher in the walk: assume equal and stop descending.
      if (against.has(right)) continue;
      against.add(right);
    }

    const leftIsArray = Array.isArray(left);
    if (leftIsArray || Array.isArray(right)) {
      if (!leftIsArray || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i++) {
        stack.push({ left: left[i], right: right[i] });
      }
      continue;
    }

    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    for (const key of leftKeys) {
      // An own-key check, not just `right[key] !== undefined`: `{a: undefined}`
      // and `{}` have different serialized shapes and a node type is entitled to
      // care about the difference.
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
      stack.push({ left: left[key], right: right[key] });
    }
  }
  return true;
}

/** A type predicate rather than a cast — keel-core's only sanctioned casts live
 *  in the four boundary constructors in ./types, and this needs none. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// invertPatch
// ---------------------------------------------------------------------------

/**
 * Swaps before/after, flips inserted<->removed PRESERVING ARRAY ORDER, and
 * swaps move endpoints. Nothing else. Pure, total, never fails.
 *
 * Why array order survives untouched, when the two directions walk it in
 * opposite directions: `applyPatch` owns the walk direction ("inserted" forward,
 * "removed" backward), so the inverter does not have to reverse anything — and
 * must not, or the two would reverse it twice.
 *
 * Why moves invert by swapping endpoints per move, with the array order kept:
 * `fromIndex` is each node's position in the PRE-state array, and re-inserting
 * a removed set at its original indices in ascending order restores the array
 * exactly. `applyCommand` emits moves in document order, which is that
 * ascending order, so the same forward walk serves both directions.
 */
export function invertPatch<Ts extends readonly ErasedNodeType[], S>(
  patch: Patch<Ts, S>,
): Patch<Ts, S> {
  switch (patch.type) {
    case "moved": {
      const moves: Move[] = patch.moves.map((move) => ({
        nodeId: move.nodeId,
        fromParentId: move.toParentId,
        fromIndex: move.toIndex,
        toParentId: move.fromParentId,
        toIndex: move.fromIndex,
      }));
      return { type: "moved", moves };
    }
    case "inserted":
      return { type: "removed", placements: patch.placements };
    case "removed":
      return { type: "inserted", placements: patch.placements };
    case "data-changed": {
      const changes = patch.changes.map((change) =>
        makeDataChange<Ts>(
          change.nodeId,
          change.kind,
          change.after,
          change.before,
        ),
      );
      return { type: "data-changed", changes };
    }
  }
}

// ---------------------------------------------------------------------------
// applyPatch — THE ONLY index rewriter
// ---------------------------------------------------------------------------

/**
 * PRECONDITION: `verifyPatchApplies` returned ok. This function assumes the
 * patch applies and does not re-check — re-checking here would either duplicate
 * verify (and drift from it) or tempt a caller to skip verify because "apply
 * validates anyway", which is exactly how the dormant-patch corruptions
 * happened.
 */
export function applyPatch<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  patch: Patch<Ts, S>,
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  switch (patch.type) {
    case "moved":
      return applyMoved(graph, patch.moves, ctx);
    case "inserted":
      return applyInserted(graph, patch.placements, ctx);
    case "removed":
      return applyRemoved(graph, patch.placements, ctx);
    case "data-changed":
      return applyDataChanged(graph, patch.changes, ctx);
  }
}

/** Copy-on-write splice into a parent's children array. */
function spliceIn(
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

/**
 * Copy-on-write removal BY IDENTITY, not by index.
 *
 * Deliberate: a "moved" patch removes several nodes before inserting any, and
 * index-based removal would need every subsequent index rebased. Identity
 * removal is order-independent, so the recorded `fromIndex` is needed only by
 * the inverse — which is precisely what makes swapping endpoints a complete
 * inversion.
 */
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
function spliceOutMany(
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
type Arrival = Readonly<{ index: number; nodeId: NodeId }>;

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
function spliceInMany(
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

/** Group arrivals by destination parent, PRESERVING patch order within each
 *  parent — which is the order their indices are expressed in. */
function groupArrivalsByParent(
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
function groupByParent(
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

// ---------------------------------------------------------------------------
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

function placementsAfterMove<Ts extends readonly ErasedNodeType[], S>(
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

function applyMoved<Ts extends readonly ErasedNodeType[], S>(
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

function applyInserted<Ts extends readonly ErasedNodeType[], S>(
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
  // node carried a key — and `insertLeavesDerivedIndexesIntact` short-circuits
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

function applyRemoved<Ts extends readonly ErasedNodeType[], S>(
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

function applyDataChanged<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  changes: readonly DataChange<Ts>[],
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  const nodes = new Map<NodeId, GraphNode<Ts, S>>(graph.nodesById);

  for (const change of changes) {
    const node = nodes.get(change.nodeId);
    // A verified patch never names a missing or quarantined node; skipping
    // rather than throwing keeps `applyPatch` total, which is what lets it be
    // the single rewriter.
    if (node === undefined || node.quarantined) continue;
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
      !dataChangeLeavesDerivedIndexesIntact(
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
// verifyPatchApplies — the gate in front of every dormant patch
// ---------------------------------------------------------------------------

/**
 * A validation-only overlay on `graph.childrenById`.
 *
 * Required, not an optimisation: a subtree insert's later placements land
 * inside its earlier ones, so checking every placement against the UNMODIFIED
 * graph would reject a perfectly good restore for a "missing" parent that the
 * same patch creates two entries earlier. The removal side needs the same
 * overlay to answer "is this node empty yet".
 */
function createChildrenOverlay<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
) {
  // OWNED AND MUTABLE, copied once per parent on first write — not
  // copy-on-write per operation.
  //
  // This overlay is scratch: it is created inside a verify function, read only
  // by that function, and discarded when it returns. Nothing it holds is ever
  // published, so there is no immutability to preserve here — and paying for
  // one anyway was the whole cost.
  //
  // MEASURED, undo of a select-all delete, verification alone:
  //     k = 8,000     54.1 ms
  //     k = 16,000   437.5 ms
  //     k = 32,000 2,858.5 ms      <- 6.5x per doubling
  //
  // Three O(siblings) operations ran per call — `slice`, `splice`, and
  // `indexOf` on the removal side — so verifying K placements against one
  // parent cost O(K x N), the identical shape `spliceOutMany` and
  // `spliceInMany` fix on the applying side. `applyPatch` had already been made
  // linear and verification had not, which is why undo stayed slow after the
  // apply-side fix: at k = 32,000 the split was 2,858 ms verifying against
  // 16.6 ms applying.
  //
  // Owning the array removes the per-call allocation entirely and leaves one
  // `splice`. For the shape that actually hurts — undo of a bulk delete, where
  // the inverted patch inserts at 0, 1, 2, ... into an emptied array — every
  // one of those splices is an APPEND, so the pass becomes linear rather than
  // merely cheaper.
  //
  // WHICH ARM IS WHICH, because this comment listed `indexOf` among the costs
  // it had removed while `indexOf` was still running, and that reading cost a
  // later round a second look at an already-"fixed" quadratic:
  //
  //   removed  ->  `removeAt`, by the index `verifyRemoved` just proved. LINEAR.
  //   inserted ->  `insert`, appending into an emptied array.        LINEAR.
  //   moved    ->  `remove`, which still SCANS with `indexOf`.
  //
  // The move arm is deliberate, not missed. Its `fromIndex` is a PRE-state
  // index checked against the untouched graph (see `verifyMoved`), so it is not
  // an index into the overlay and cannot be spliced by. Making that arm linear
  // means grouping by source parent and doing one filtering pass each, mirroring
  // `spliceOutMany` — worth doing if a patch is ever measured moving thousands
  // of nodes out of ONE parent, which no gesture produces today: a multi-select
  // drag is bounded by what is on screen, where a select-all delete is not.
  const owned = new Map<NodeId, NodeId[]>();
  const read = (id: NodeId): readonly NodeId[] => {
    const local = owned.get(id);
    if (local !== undefined) return local;
    return graph.childrenById.get(id) ?? EMPTY_IDS;
  };
  /** The overlay's own copy, made once. The graph's array is never touched. */
  const mutable = (id: NodeId): NodeId[] => {
    const local = owned.get(id);
    if (local !== undefined) return local;
    const copy = [...(graph.childrenById.get(id) ?? EMPTY_IDS)];
    owned.set(id, copy);
    return copy;
  };
  return {
    read,
    hasEntry: (id: NodeId): boolean =>
      owned.has(id) || graph.childrenById.has(id),
    seedLoaded: (id: NodeId): void => {
      // A FRESH array, never `EMPTY_IDS`. That constant is frozen and shared by
      // every reader in this module, so seeding it here and splicing into it
      // later would throw in strict mode — and would be a process-wide
      // corruption if it did not.
      if (!owned.has(id)) owned.set(id, []);
    },
    insert: (parentId: NodeId, index: number, id: NodeId): void => {
      mutable(parentId).splice(index, 0, id);
    },
    /**
     * By KNOWN index — the fourth O(siblings) operation, and the one the block
     * comment above missed when it listed the three it had removed.
     *
     * `verifyRemoved` proves the exact slot two lines before it removes
     * (`siblings[index] !== node.id`, against this same overlay), so the
     * `indexOf` in `remove` below was re-deriving an index the caller already
     * held. Removal placements are built in ascending document order and
     * `verifyRemoved` walks them BACKWARD, so each target sat at the tail of a
     * shrinking array and `indexOf` rescanned it front-to-back: K^2/2, the
     * exact quadratic `spliceOutMany` fixes on the applying side.
     *
     * MEASURED, undo of a bulk insert through `store.undo()`:
     *     k =  4,000     19.8 ms  ->   1.1 ms
     *     k =  8,000    134.5 ms  ->   1.9 ms
     *     k = 16,000    319.4 ms  ->   2.4 ms
     *     k = 32,000  1,580.3 ms  ->   4.3 ms
     * Redo, which takes the `insert` path that was already linear, was 17.5 ms
     * at k = 32,000 throughout — the 90x gap between the two directions is what
     * said the removal side had been missed.
     *
     * For the backward document-order walk this splice is a `pop`.
     */
    removeAt: (parentId: NodeId, index: number): void => {
      mutable(parentId).splice(index, 1);
    },
    remove: (parentId: NodeId, id: NodeId): void => {
      const current = mutable(parentId);
      const at = current.indexOf(id);
      if (at === -1) return;
      current.splice(at, 1);
    },
  };
}

/**
 * Gates every DORMANT patch before replay.
 *
 * Loading grows the graph while history entries sleep, `markMissing` can empty
 * a container out from under one, and a node can gain children after the insert
 * that created it. Each of those turns a stored patch into a corruption if
 * applied blind.
 *
 * Checks: engineId; node existence (removal, move, edit) or absence (insert);
 * parent existence AND loaded-ness; index bounds; the recorded index still
 * naming the recorded node; kind agreement; `before` still matching on the
 * SERIALIZED form; and that a node about to be un-inserted is childless.
 */
function verifyPatchAppliesUnguarded<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  patch: Patch<Ts, S>,
  ctx: EngineContext<S>,
): Result<void, ReplayRejection> {
  if (graph.engineId !== ctx.engineId) {
    return replayError(
      "foreign-graph",
      "This graph was produced by a different engine instance.",
    );
  }
  switch (patch.type) {
    case "moved":
      return verifyMoved(graph, patch.moves);
    case "inserted":
      return verifyInserted(graph, patch.placements, ctx);
    case "removed":
      return verifyRemoved(graph, patch.placements);
    case "data-changed":
      return verifyDataChanged(graph, patch.changes, ctx);
  }
}

function verifyMoved<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  moves: readonly Move[],
): Result<void, ReplayRejection> {
  const overlay = createChildrenOverlay(graph);
  const seen = new Set<NodeId>();

  // Phase 1: validate every source and take every node out. `fromIndex` is a
  // PRE-state index, so it is checked against the untouched graph before any
  // simulated removal.
  for (const move of moves) {
    if (seen.has(move.nodeId)) {
      // One removal, two insertions — the node lands in two children arrays
      // with `parentById` naming one. A blind retry did exactly this in
      // production.
      return replayError(
        "node-exists",
        `Node ${move.nodeId} is moved twice by one patch.`,
        { nodeId: move.nodeId },
      );
    }
    seen.add(move.nodeId);

    if (!graph.nodesById.has(move.nodeId)) {
      return replayError("node-missing", `Node ${move.nodeId} is gone.`, {
        nodeId: move.nodeId,
      });
    }
    const sourceCheck = requireLoadedParent(graph, move.fromParentId);
    if (!sourceCheck.ok) return sourceCheck;

    const sourceChildren = graph.childrenById.get(move.fromParentId) ?? EMPTY_IDS;
    // Exact position, not merely in-bounds. An index that is wrong but in range
    // silently relocates the node when the inverse re-inserts it, and that
    // shows up as "undo moved my clip somewhere else" many steps later.
    if (sourceChildren[move.fromIndex] !== move.nodeId) {
      return replayError(
        "index-out-of-range",
        `Node ${move.nodeId} is no longer at index ${move.fromIndex} of ${move.fromParentId}.`,
        { nodeId: move.nodeId, parentId: move.fromParentId, index: move.fromIndex },
      );
    }
    overlay.remove(move.fromParentId, move.nodeId);
  }

  // Phase 2: validate every destination against the POST-REMOVAL arrays, which
  // is the coordinate system `toIndex` is recorded in.
  for (const move of moves) {
    const targetCheck = requireLoadedParent(graph, move.toParentId);
    if (!targetCheck.ok) return targetCheck;
    const target = overlay.read(move.toParentId);
    if (move.toIndex < 0 || move.toIndex > target.length) {
      return replayError(
        "index-out-of-range",
        `Post-removal index ${move.toIndex} is outside [0, ${target.length}] of ${move.toParentId}.`,
        { nodeId: move.nodeId, parentId: move.toParentId, index: move.toIndex },
      );
    }
    overlay.insert(move.toParentId, move.toIndex, move.nodeId);
  }

  // Phase 3: no node may become its own ancestor.
  //
  // The forward door has this as `isSameOrAncestor` (./commands), and the
  // replay door had no twin for it. `applyPatch` is documented above as
  // deliberately re-checking nothing, so there was no second line of defence:
  // an accepted cyclic move detaches the ring from every root, `serializeGraph`
  // emits unreachable nodes rather than dropping them, and the saved document
  // then fails `deserialize` with `unreachable-node` for good.
  //
  // AGAINST THE POST-STATE, not the graph. The reachable case is a converging
  // swap — A moves Y into X while B moves X into Y — and there neither node is
  // the other's ancestor BEFORE the patch. A check against `graph.parentById`
  // answers "no cycle" and waves it through. So this walks the parent map the
  // whole patch would produce, which is also why it runs once at the end
  // rather than per move: the moves are atomic, and an intermediate state that
  // rings is fine as long as the result does not.
  const nextParent = new Map<NodeId, NodeId | null>(graph.parentById);
  for (const move of moves) nextParent.set(move.nodeId, move.toParentId);

  for (const move of moves) {
    // Bounded by the map rather than trusted to terminate: a pre-state cycle
    // would already be an invariant violation, but a verify door that can hang
    // on a malformed graph is worse than one that refuses it.
    let steps = 0;
    let cursor: NodeId | null | undefined = move.toParentId;
    while (cursor !== null && cursor !== undefined) {
      if (cursor === move.nodeId) {
        return replayError(
          "would-create-cycle",
          `Moving ${move.nodeId} into ${move.toParentId} would make it its own ancestor.`,
          { nodeId: move.nodeId, parentId: move.toParentId },
        );
      }
      if (++steps > nextParent.size) {
        return replayError(
          "would-create-cycle",
          `The parent chain above ${move.toParentId} does not terminate.`,
          { nodeId: move.nodeId, parentId: move.toParentId },
        );
      }
      cursor = nextParent.get(cursor);
    }
  }

  return VERIFY_OK;
}

function requireLoadedParent<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  parentId: NodeId,
): Result<void, ReplayRejection> {
  const parent = graph.nodesById.get(parentId);
  if (parent === undefined) {
    return replayError("parent-missing", `Parent ${parentId} is gone.`, {
      parentId,
    });
  }
  if (!graph.childrenById.has(parentId)) {
    // `markMissing` can turn a loaded container into a confirmed-empty one
    // while a patch sleeps; replaying into it would resurrect children the
    // storage says are gone.
    return replayError(
      "parent-not-loaded",
      `Parent ${parentId} no longer has loaded children.`,
      { parentId },
    );
  }
  return VERIFY_OK;
}

/**
 * Would replaying these ownership claims leave two placements on one
 * `sourceKey`?
 *
 * THE REPLAY DOOR'S HALF OF THE SINGLE-OWNER RULE. The reducer enforces it on
 * the forward path and `findInvariantViolation` audits it, but verification —
 * the one door whose entire job is refusing patches whose world has moved — did
 * not ask. `applyNonUndoableWrite` is what makes that reachable: it is a non-undoable
 * server write, so it can move a live node onto a key a sleeping patch still
 * carries, and the replay then re-installs the original owner beside it.
 *
 * NO `vacating` EXEMPTION, and the reason is worth recording because the first
 * version had one. The case it covered was a single patch re-keying two nodes
 * that swap keys, where the pre-state owner is itself moving off the key it
 * holds. That patch cannot exist: `planEdits` refuses a same-command swap with
 * `duplicate-owner` before any patch is built (measured), so nothing on either
 * history stack can carry one. The exemption cost a second `ReadonlyMap` and a
 * `sourceKey` call per changed node on the undo path — the same path the last
 * round worked to get down to zero node-type calls for a common replay — to guard a
 * state the reducer will not produce. Mutation testing is what surfaced it:
 * deleting the exemption failed no test, which is the signature of code that
 * defends nothing.
 *
 * A hand-built patch could still reach it, and would be refused rather than
 * applied. A refusal on an exotic hand-built patch is the safe direction.
 */
function ownershipConflict<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  claims: ReadonlyMap<NodeId, string | null>,
): ReplayRejection | null {
  const claimedHere = new Map<string, NodeId>();
  for (const [nodeId, key] of claims) {
    if (key === null) continue;

    // BELT AND BRACES, and labelled as such rather than claimed as live: the
    // reducer refuses a command whose own nodes claim one key twice, so no
    // patch on either stack carries this shape and mutation testing correctly
    // reports that deleting these lines fails nothing.
    //
    // Kept anyway, where the `vacating` exemption was deleted, because the two
    // fail in opposite directions. Removing `vacating` made the check STRICTER,
    // and a refusal is the safe answer for a patch nobody can build. Removing
    // this one makes it fail OPEN — neither node is in `ownerBySourceKey` yet,
    // so a hand-built patch claiming one key twice would sail through and
    // install exactly the duplicate owner this function exists to prevent.
    const alreadyHere = claimedHere.get(key);
    if (alreadyHere !== undefined && alreadyHere !== nodeId) {
      return {
        code: "duplicate-owner",
        message: `Replaying this patch would give sourceKey ${JSON.stringify(key)} two owners (${alreadyHere} and ${nodeId}).`,
        nodeId,
      };
    }
    claimedHere.set(key, nodeId);

    const existing = graph.ownerBySourceKey.get(key);
    if (existing === undefined || existing === nodeId) continue;
    return {
      code: "duplicate-owner",
      message: `Replaying this patch would put ${nodeId} on sourceKey ${JSON.stringify(key)}, which ${existing} now owns.`,
      nodeId,
    };
  }
  return null;
}

function verifyInserted<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  placements: readonly Placement<Ts, S>[],
  ctx: EngineContext<S>,
): Result<void, ReplayRejection> {
  // THE CEILING, before the per-placement work — the same position and the
  // same reason as ./serialize's, which calls it "the EARLIEST honest point".
  //
  // This is the third growth door and it was the one without the check. The
  // reducer refuses at `would-exceed-max-nodes`, ingress folds
  // `existingNodeCount` into the same comparison, and replay counted nothing.
  // `Store.load` does not touch history, so a lazy page can legitimately spend
  // the headroom a delete just freed while that removal patch sleeps on the
  // undo stack; undoing it then walked a `maxNodes: 12` graph to 14, 16, 18 —
  // the "no single call is ever the one that is too big" shape ingress already
  // closed. The result is a graph the audit calls valid, `serializeGraph`
  // writes happily, and `deserialize` refuses at that config forever.
  //
  // Refusing the undo is the safe direction and matches the other three doors.
  // Bounding `loadChildren` more tightly instead would make the ceiling depend
  // on how deep the undo stack happens to be, which is worse.
  const wouldHold = graph.nodesById.size + placements.length;
  if (wouldHold > ctx.maxNodes) {
    return replayError(
      "would-exceed-max-nodes",
      `Replaying this insert would take the graph to ${wouldHold} nodes, past the ${ctx.maxNodes} ceiling.`,
      { limit: ctx.maxNodes, actual: wouldHold },
    );
  }

  const overlay = createChildrenOverlay(graph);
  const willExist = new Set<NodeId>();

  for (const placement of placements) {
    const { node, parentId, index } = placement;
    if (graph.nodesById.has(node.id) || willExist.has(node.id)) {
      return replayError(
        "node-exists",
        `Node ${node.id} already exists; re-inserting it would duplicate the id.`,
        { nodeId: node.id },
      );
    }
    // The parent is either already in the graph, or an EARLIER placement in
    // this same patch — document order, parents first, is what makes that true.
    const parentIsNew = willExist.has(parentId);
    if (!parentIsNew && !graph.nodesById.has(parentId)) {
      return replayError("parent-missing", `Parent ${parentId} is gone.`, {
        nodeId: node.id,
        parentId,
      });
    }
    if (!overlay.hasEntry(parentId)) {
      return replayError(
        "parent-not-loaded",
        `Parent ${parentId} does not have loaded children to insert into.`,
        { nodeId: node.id, parentId },
      );
    }
    const siblings = overlay.read(parentId);
    if (index < 0 || index > siblings.length) {
      return replayError(
        "index-out-of-range",
        `Index ${index} is outside [0, ${siblings.length}] of ${parentId}.`,
        { nodeId: node.id, parentId, index },
      );
    }
    overlay.insert(parentId, index, node.id);
    willExist.add(node.id);
    if (isLoadedContainer(node)) overlay.seedLoaded(node.id);
  }

  // Checked AFTER the structural pass, so a patch that is structurally
  // impossible reports that rather than an ownership complaint about a node it
  // could never have placed. Nothing is vacating a key here — an insert only
  // adds — so the second argument is null.
  // Gated on the registry, not on the patch: when no node type declares
  // `sourceKey` at all, `ownerBySourceKey` is permanently empty and this check
  // could never fire, so the whole pass — including a `sourceKey` call per
  // arriving node — is skipped rather than run to reach a foregone answer.
  if (derivedIndexNeed(ctx.registry).source) {
    const claims = new Map<NodeId, string | null>();
    for (const { node } of placements) {
      if (!ownsItsSubtree<Ts, S>(node)) continue;
      claims.set(node.id, sourceKeyOf<Ts, S>(ctx.registry, node));
    }
    const conflict = ownershipConflict(graph, claims);
    if (conflict !== null) return { ok: false, error: conflict };
  }

  return VERIFY_OK;
}

function verifyRemoved<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  placements: readonly Placement<Ts, S>[],
): Result<void, ReplayRejection> {
  const overlay = createChildrenOverlay(graph);
  const removed = new Set<NodeId>();

  // BACKWARD, matching the application order: deepest placements first, so a
  // parent's own recorded children are already gone when we ask whether it is
  // empty.
  for (let i = placements.length - 1; i >= 0; i--) {
    const placement = placements[i];
    if (placement === undefined) continue;
    const { node, parentId, index } = placement;

    const live = graph.nodesById.get(node.id);
    if (live === undefined || removed.has(node.id)) {
      return replayError("node-missing", `Node ${node.id} is gone.`, {
        nodeId: node.id,
      });
    }
    if (live.kind !== node.kind) {
      return replayError(
        "kind-mismatch",
        `Node ${node.id} is a "${live.kind}"; the patch recorded a "${node.kind}".`,
        { nodeId: node.id },
      );
    }
    if (removed.has(parentId)) {
      // A parent removed before its child means the placements are not in
      // document order, and the mirror with "inserted" is broken.
      //
      // This is the ONLY check that catches it once the parent is an EMPTY
      // loaded container: the "node-not-empty" check below sails through an
      // empty one, and the child then names a parent that no longer exists.
      // With a non-empty parent, "node-not-empty" gets there first.
      return replayError(
        "parent-missing",
        `Parent ${parentId} is removed before its child ${node.id}; placements are out of document order.`,
        { nodeId: node.id, parentId },
      );
    }
    const parentCheck = requireLoadedParent(graph, parentId);
    if (!parentCheck.ok) return parentCheck;

    const siblings = overlay.read(parentId);
    if (siblings[index] !== node.id) {
      return replayError(
        "index-out-of-range",
        `Node ${node.id} is no longer at index ${index} of ${parentId}.`,
        { nodeId: node.id, parentId, index },
      );
    }

    // THE SUBTREE CHECK. Two distinct failures land here:
    //  - the node gained children after the insert this patch would un-do, so
    //    removing it would orphan them;
    //  - the patch recorded only the named node instead of its whole subtree,
    //    so its descendants were never in `placements` and are still present.
    // Both are "removing this would strand nodes", and both must refuse.
    if (isLoadedContainer(live)) {
      const remaining = overlay.read(node.id);
      if (remaining.length > 0) {
        return replayError(
          "node-not-empty",
          `Node ${node.id} still has ${remaining.length} child(ren) the patch does not account for.`,
          { nodeId: node.id },
        );
      }
    }

    // BY INDEX — `siblings[index] === node.id` was just proved against this
    // same overlay, so scanning for the id again is pure re-derivation, and a
    // quadratic one on the shape this arm exists to serve.
    overlay.removeAt(parentId, index);
    removed.add(node.id);
  }

  return VERIFY_OK;
}

function verifyDataChanged<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  changes: readonly DataChange<Ts>[],
  ctx: EngineContext<S>,
): Result<void, ReplayRejection> {
  for (const change of changes) {
    const node = graph.nodesById.get(change.nodeId);
    if (node === undefined) {
      return replayError("node-missing", `Node ${change.nodeId} is gone.`, {
        nodeId: change.nodeId,
      });
    }
    if (node.quarantined) {
      // A quarantined node holds `raw`, not parsed data: there is nothing the
      // recorded `before` could match, and writing `after` into it would
      // destroy the byte-exact re-emit quarantine exists to guarantee.
      return replayError(
        "data-mismatch",
        `Node ${change.nodeId} is quarantined and holds no parsed data.`,
        { nodeId: change.nodeId },
      );
    }
    if (node.kind !== change.kind) {
      return replayError(
        "kind-mismatch",
        `Node ${change.nodeId} is a "${node.kind}"; the patch recorded a "${change.kind}".`,
        { nodeId: change.nodeId },
      );
    }
    const nodeType = ctx.registry.get(change.kind);
    if (nodeType === undefined) {
      return replayError(
        "kind-mismatch",
        `Kind "${change.kind}" is not registered, so its recorded value cannot be compared.`,
        { nodeId: change.nodeId },
      );
    }
    // Compare on the SERIALIZED form. Parsed values may carry identity a node type
    // does not consider meaningful (a normalized copy, a cached derivation), and
    // comparing those would refuse valid undos; the wire form is the node type's own
    // statement of what its value IS.
    // IDENTITY FIRST. `change.before` and the node's live data are usually the
    // very same object — the reducer stores exactly what `applyEdit` returned
    // and the patch records that reference — so the common replay is settled
    // without calling the consumer's `serialize` at all. Sound because same
    // reference implies same serialization for any deterministic node type, and a
    // non-deterministic one already fails the slow path.
    //
    // Worth doing for the same reason the cross-parent move stopped asking for
    // `contentKey`: `serialize` is consumer code of unknown cost, and undo runs
    // it once per changed node per verification.
    if (Object.is(change.before, node.data)) continue;

    // WRAPPED. `serialize` is consumer code, and this function is contracted to
    // return a `Result` — a throw here escaped `verifyPatchApplies` and took
    // `undo` and `redo` with it. A node type that cannot serialize its own value
    // cannot prove the recorded `before` still stands, so the honest verdict is
    // the same one a genuine difference produces: this patch no longer applies.
    // Refusing is safe (the entry stays on the stack, the graph is untouched);
    // proceeding on an unverifiable comparison is not.
    let matches: boolean;
    try {
      matches = deepEqual(
        nodeType.serialize(change.before),
        nodeType.serialize(node.data),
      );
    } catch (thrown) {
      return replayError(
        "data-mismatch",
        `Node ${change.nodeId} could not be compared against this patch's recorded "before": ${JSON.stringify(change.kind)}.serialize threw (${describeThrown(thrown)}).`,
        { nodeId: change.nodeId },
      );
    }
    if (!matches) {
      return replayError(
        "data-mismatch",
        `Node ${change.nodeId} no longer holds the value this patch recorded as "before".`,
        { nodeId: change.nodeId },
      );
    }
  }

  // THE SAME OWNERSHIP HOLE AS `verifyInserted`, through the data path. A
  // `sourceKey` is computed FROM data, so restoring an old value re-claims an
  // old key — and `applyNonUndoableWrite` may have moved another node onto it meanwhile.
  // The original review named only the insert arm; this one reproduces
  // identically (edit a box off its key, let the server move a sibling onto it,
  // then Ctrl-Z) and a fix that guarded one arm would have left the other open.
  //
  // Both maps are keyed by the same node set, so a patch that re-keys several
  // nodes at once — including two swapping keys — is judged on where they all
  // END UP rather than on one intermediate state that never exists.
  // Gated for the same reason as the insert arm, and it matters more here: undo
  // runs this per changed node, and the last round spent real effort getting a
  // common replay down to zero consumer node-type calls.
  if (derivedIndexNeed(ctx.registry).source) {
    const claims = new Map<NodeId, string | null>();
    for (const change of changes) {
      const node = graph.nodesById.get(change.nodeId);
      // Ownership is a property of the node's SHAPE, which a data change cannot
      // alter — so the live node answers it even though its data is about to be
      // replaced.
      //
      // A COST FILTER, not a correctness one, and mutation testing says so:
      // deleting `ownsItsSubtree` here fails nothing, because `ownsItsSubtree`
      // is also what decides who gets INTO `ownerBySourceKey`, so a non-owner's
      // key is never found there anyway. It stays because it is the cheaper of
      // the two ways to reach that answer — a shape check instead of a consumer
      // `sourceKey` call per changed node — and because reading the same
      // predicate the index was built from is what keeps the two in step.
      if (node === undefined || !ownsItsSubtree<Ts, S>(node)) continue;
      claims.set(
        change.nodeId,
        sourceKeyOfKindData(ctx.registry, change.kind, change.after),
      );
    }
    const conflict = ownershipConflict(graph, claims);
    if (conflict !== null) return { ok: false, error: conflict };
  }

  return VERIFY_OK;
}

// ---------------------------------------------------------------------------
// Patch queries
// ---------------------------------------------------------------------------

/** Every node id the patch mentions, deduped, in first-seen order. Parents are
 *  included: a move's endpoints and a placement's parent are nodes whose
 *  rollups changed, and a caller notifying only the named nodes reproduces the
 *  "deep move never re-renders any ancestor" hole. */
export function patchTouchedNodeIds<Ts extends readonly ErasedNodeType[], S>(
  patch: Patch<Ts, S>,
): readonly NodeId[] {
  const seen = new Set<NodeId>();
  const ordered: NodeId[] = [];
  const add = (id: NodeId): void => {
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  };
  switch (patch.type) {
    case "moved":
      for (const move of patch.moves) {
        add(move.nodeId);
        add(move.fromParentId);
        add(move.toParentId);
      }
      break;
    case "inserted":
    case "removed":
      for (const placement of patch.placements) {
        add(placement.node.id);
        add(placement.parentId);
      }
      break;
    case "data-changed":
      for (const change of patch.changes) add(change.nodeId);
      break;
  }
  return ordered;
}

/**
 * Removed containers whose `ChildrenState` was not `loaded` — the ids the change
 * feed reports so a consumer can defer the hard delete instead of orphaning
 * storage it never read.
 *
 * CAVEAT the consumer must honour, because this list cannot express it: a
 * `reference` placement does NOT own its subtree, and a `missing` one is already
 * confirmed gone. Both appear here (they are not `loaded`), and hard-deleting
 * either is wrong — the only id in this list that names storage worth deleting
 * is an `unloaded` owner. Read the node's state before acting on the id.
 */
export function patchDetachedSubtrees<Ts extends readonly ErasedNodeType[], S>(
  patch: Patch<Ts, S>,
): readonly NodeId[] {
  if (patch.type !== "removed") return EMPTY_IDS;
  const detached: NodeId[] = [];
  for (const placement of patch.placements) {
    const state = containerChildrenState(placement.node);
    if (state !== null && state.status !== "loaded") {
      detached.push(placement.node.id);
    }
  }
  return detached;
}

export function isEmptyPatch<Ts extends readonly ErasedNodeType[], S>(
  patch: Patch<Ts, S>,
): boolean {
  switch (patch.type) {
    case "moved":
      return patch.moves.length === 0;
    case "inserted":
    case "removed":
      return patch.placements.length === 0;
    case "data-changed":
      return patch.changes.length === 0;
  }
}

// ---------------------------------------------------------------------------
// The non-undoable write scrubbing
// ---------------------------------------------------------------------------

/**
 * Surgical scrubbing of ONE patch, for a non-undoable write.
 *
 * `applyNonUndoableWrite` is the non-undoable content write: a server stamped a field, a
 * thumbnail arrived. The user must not be able to Ctrl-Z it, and — more
 * importantly — a DORMANT `before` from an older entry must not be able to
 * clobber it later. So for every written node:
 *
 *   - "data-changed": DROP that node's entry. Content changes are per-node
 *     independent within a patch, so every other change in the entry stays
 *     perfectly invertible. The user loses undo of their own edit to that one
 *     node, which is correct — the server has since overwritten it.
 *   - "inserted"/"removed": REWRITE that node's captured `data` to the
 *     replacement, so a dormant restore cannot resurrect stale content.
 *   - "moved": untouched. Structural patches carry no content at all.
 *
 * The alternative shipped in a predecessor design — a version stamp that
 * invalidates the whole entry — means every remote write destroys undo from
 * that entry down. This costs O(entries x changes), where `historyLimit` bounds `entries` only
 * when a consumer set one, and destroys one node's
 * worth.
 *
 * Returns null when the patch is left empty, and the caller drops the entry.
 */
/**
 * The ids `scrubPatchForWrite` can actually touch in this patch.
 *
 * THE COMPANION TO THAT FUNCTION, and it lives here so the two cannot drift.
 * A caller reporting which ids a scrub affected has to ask the same question
 * the scrub answers, and ./commands was asking a different one — it used
 * `patchTouchedNodeIds`, which for an `inserted` or `removed` patch also names
 * every placement's PARENT. A parent is a node whose rollup changed, which is
 * the right answer for notification and the wrong one here: the scrub rewrites
 * a placement's captured `data`, and a parent's data is not in the patch at
 * all. So `Store.applyNonUndoableWrite` reported ids whose history it had not
 * touched, and a consumer using that list to tell a user "undo is gone for
 * these" showed warnings that were not true.
 *
 * "moved" yields nothing: structural patches carry no content, which is exactly
 * why `scrubPatchForWrite` returns them untouched.
 */
export function scrubbableNodeIds<Ts extends readonly ErasedNodeType[], S>(
  patch: Patch<Ts, S>,
): readonly NodeId[] {
  switch (patch.type) {
    case "moved":
      return EMPTY_IDS;
    case "data-changed":
      return patch.changes.map((change) => change.nodeId);
    case "inserted":
    case "removed":
      // The placement's own node, never its parent.
      return patch.placements.map((placement) => placement.node.id);
  }
}

export function scrubPatchForWrite<Ts extends readonly ErasedNodeType[], S>(
  patch: Patch<Ts, S>,
  replacements: ReadonlyMap<NodeId, unknown>,
): Patch<Ts, S> | null {
  if (replacements.size === 0) return patch;

  switch (patch.type) {
    case "moved":
      return patch;

    case "data-changed": {
      const kept = patch.changes.filter(
        (change) => !replacements.has(change.nodeId),
      );
      if (kept.length === 0) return null;
      // Identity is preserved when nothing was dropped, so an untouched history
      // entry stays reference-equal and a consumer diffing the stacks sees no
      // churn.
      if (kept.length === patch.changes.length) return patch;
      return { type: "data-changed", changes: kept };
    }

    case "inserted":
    case "removed": {
      let rewrote = false;
      const next = patch.placements.map((placement): Placement<Ts, S> => {
        const node = placement.node;
        if (!replacements.has(node.id)) return placement;
        // A quarantined node carries `raw`, not parsed data, and it is not
        // editable — so it can never be a non-undoable write target and its bytes must
        // survive untouched.
        if (node.quarantined) return placement;
        const replacement = replacements.get(node.id);
        rewrote = true;
        const rebuilt: GraphNode<Ts, S> = node.container
          ? makeCollectionNode<Ts, S>(
              node.id,
              node.kind,
              replacement,
              node.children,
              node.summary,
            )
          : makeLeafNode<Ts>(node.id, node.kind, replacement);
        return { node: rebuilt, parentId: placement.parentId, index: placement.index };
      });
      if (!rewrote) return patch;
      return patch.type === "inserted"
        ? { type: "inserted", placements: next }
        : { type: "removed", placements: next };
    }
  }
}

/**
 * The key-hook guard, for the same reason ./commands has one and with the same
 * `instanceof` discipline — see `guardKeyHooks` there.
 *
 * This door in particular: undo runs the consumer's key hooks to prove a
 * recorded `before` still stands, so a throwing `contentKey` took out undo
 * exactly the way it took out `dispatch`. review3 names both by name.
 */
export function verifyPatchApplies<Ts extends readonly ErasedNodeType[], S>(
  graph: Graph<Ts, S>,
  patch: Patch<Ts, S>,
  ctx: EngineContext<S>,
): Result<void, ReplayRejection> {
  try {
    return verifyPatchAppliesUnguarded<Ts, S>(graph, patch, ctx);
  } catch (thrown) {
    if (thrown instanceof KeyHookFailure) {
      return replayError(
        "node-type-threw",
        keyHookMessage(thrown),
        thrown.nodeId === null ? undefined : { nodeId: thrown.nodeId },
      );
    }
    throw thrown;
  }
}

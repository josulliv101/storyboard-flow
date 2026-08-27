// KEEL — derived aggregates.
//
// PURE. Imports ./types and ./graph and nothing else. No React, no DOM, no
// "use client": a route handler imports this as readily as a browser bundle.
//
// A fold answers ONE question about a subtree ("how long is it", "what are the
// first three frames"). It is deliberately NOT a monoid — see the block comment
// on `foldMonoid` for the three verified reasons — and it is deliberately
// GRAPH-BLIND: `collection` receives its own node and its children's already
// folded values, and nothing else.
//
// That blindness is the load-bearing invariant of this module, not a
// convenience. A node's value depends only on its own data and its children's
// values, so "invalidate the changed nodes and their ancestor chains" is
// PROVABLY sufficient. A fold handed the graph could read anything, and then
// the only correct invalidation would be "drop everything" — which is how a
// memo table stops being worth having.
//
// Layout:
//   1. Certainty          — constructors and the weakest-wins combinator
//   2. summaryFrom        — the persistence gate
//   3. foldMonoid         — ergonomics for the easy 90%
//   4. createFoldCache    — the LRU that lives BESIDE the graph
//   5. computeFold        — bottom-up evaluation with an explicit stack

import { getChildren, getNode, getSubtreeRev } from "./graph";
import type {
  AnyNode,
  Certainty,
  CollectionNode,
  ExactFolded,
  Fold,
  FoldCache,
  Folded,
  FoldedChild,
  Graph,
  LeafNode,
  NodeId,
} from "./types";

// ---------------------------------------------------------------------------
// 1. Certainty
// ---------------------------------------------------------------------------

/**
 * Wrap a value with a certainty.
 *
 * `Folded<A>` is a three-member UNION, not a flat `{ value; certainty }`, so
 * that `summaryFrom` can demand the `"exact"` member. This still compiles with
 * a `Certainty`-typed argument because TypeScript normalizes an object whose
 * discriminant property is a union of unit types against a discriminated-union
 * target — verified by compiling both this form and the pre-typed-variable form
 * before relying on it.
 */
export function folded<A>(value: A, certainty: Certainty): Folded<A> {
  return { value, certainty };
}

/** The `"exact"` member specifically — the only thing `summaryFrom` accepts. */
export function foldedExact<A>(value: A): ExactFolded<A> {
  return { value, certainty: "exact" };
}

/**
 * Ordered weakest-first. A plain object literal, not a Map: the key type is a
 * finite union of string literals, so this is a mapped type with three real
 * properties rather than an index signature — which is why indexing it yields
 * `number` and not `number | undefined` under `noUncheckedIndexedAccess`, and
 * why no `!` or fallback is needed below.
 */
const CERTAINTY_RANK: Readonly<Record<Certainty, number>> = {
  partial: 0,
  estimated: 1,
  exact: 2,
};

/**
 * partial < estimated < exact. An EMPTY input is `"exact"` — an aggregate over
 * nothing is not uncertain, it is a known-empty answer, and the alternative
 * would make every leaf-only collection permanently unpersistable.
 *
 * Weakest-wins is correct for a sum. It is NOT correct in general: the rule for
 * a first-frame preview is position-sensitive (a hole AFTER the first hit
 * changes nothing), which is exactly why `Fold.collection` returns `Folded<A>`
 * itself and is free to ignore this helper.
 */
export function weakestCertainty(certainties: readonly Certainty[]): Certainty {
  let weakest: Certainty = "exact";
  for (const certainty of certainties) {
    if (CERTAINTY_RANK[certainty] < CERTAINTY_RANK[weakest]) {
      weakest = certainty;
      // Nothing ranks below "partial", so the rest of the list cannot lower it.
      if (weakest === "partial") return weakest;
    }
  }
  return weakest;
}

// ---------------------------------------------------------------------------
// 2. The persistence gate
// ---------------------------------------------------------------------------

/**
 * THE PERSISTENCE GATE. Only an `"exact"` fold may be written back into a
 * stored summary, and the type — not a runtime check a caller can forget — is
 * what enforces it.
 *
 * Aimed at a measured bug: a duration accumulator starting at zero made an
 * empty collection persist `0` where the model's floor was 3, the write path
 * persisted documents THROUGH that projection, and every downstream reader then
 * had to defend against a number that was never a measurement. Persisting an
 * estimate is worse than not persisting: it compounds on every save, and the
 * next reader cannot tell the estimate from a measurement.
 */
export function summaryFrom<A>(folded: ExactFolded<A>): A {
  return folded.value;
}

// ---------------------------------------------------------------------------
// 3. foldMonoid — ergonomics for the easy 90%
// ---------------------------------------------------------------------------

/**
 * Build a `Fold` from a monoid plus weakest-wins certainty.
 *
 * USE IT FOR SUMS AND COUNTS. It CANNOT express:
 *
 *  - a subtree VETO (a container's own `disabled` flag dropping its whole
 *    subtree) — by the time `concat` runs, the vetoed subtree is already summed
 *    in and indistinguishable;
 *  - an empty-collection FLOOR — `collection([])` here is `empty`, and `empty`
 *    is also the identity, so the two cannot differ;
 *  - POSITION-SENSITIVE certainty — weakest-wins is position-blind, and the
 *    real first-frame rule is not: an unloaded branch AFTER the first media
 *    leaves the answer correct, so the live result still wins. Weakest-wins
 *    would demote it and send the reader back to the stored summary, discarding
 *    a just-made edit.
 *
 * Those three are why `Fold` is the primitive and this is the convenience.
 * Write `Fold` by hand when you need any of them.
 */
export function foldMonoid<Ts extends readonly unknown[], S, A>(
  m: Readonly<{
    key: string;
    empty: A;
    leaf(node: LeafNode<Ts>): A;
    concat(a: A, b: A): A;
    own?(node: CollectionNode<Ts, S>): A;
    placeholder?(node: CollectionNode<Ts, S>): A | undefined;
  }>,
): Fold<Ts, S, A> {
  return {
    key: m.key,
    leaf(node) {
      return m.leaf(node);
    },
    collection(node, children) {
      // NOT `m.own?.(node) ?? m.empty`: an optional call yields `A | undefined`
      // and `??` would then substitute `empty` for an `own` that legitimately
      // returned `undefined` when `A` itself admits it. The explicit check
      // distinguishes "no own step" from "own returned undefined".
      let value = m.own === undefined ? m.empty : m.own(node);
      const certainties: Certainty[] = [];
      for (const child of children) {
        value = m.concat(value, child.value);
        certainties.push(child.certainty);
      }
      return { value, certainty: weakestCertainty(certainties) };
    },
    placeholder(node) {
      // Here `undefined` IS the declared sentinel — "this monoid has no stored
      // stand-in for that node" — so both "no placeholder step" and "step
      // returned undefined" collapse to the same honest answer: nothing is
      // known about the subtree, so `empty` at `"partial"`.
      const supplied = m.placeholder === undefined ? undefined : m.placeholder(node);
      if (supplied === undefined) return { value: m.empty, certainty: "partial" };
      return { value: supplied, certainty: "estimated" };
    },
    missing() {
      // Confirmed-gone is KNOWLEDGE, not a gap: a subtree whose only holes are
      // `missing` folds to "exact". The predecessor treated it as absence and
      // held a 133-document branch at "no duration" indefinitely.
      return { value: m.empty, certainty: "exact" };
    },
    quarantined() {
      return { value: m.empty, certainty: "partial" };
    },
  };
}

// ---------------------------------------------------------------------------
// 4. The memo table
// ---------------------------------------------------------------------------

export const DEFAULT_FOLD_CACHE_LIMIT = 2048;

/**
 * Length-prefixed, NOT `[foldKey, nodeId, rev].join(":")`.
 *
 * A `NodeId` may contain ANY character except whitespace-only — ids like
 * `scene/a` and `timeline-e2e,comma` are legal and have shipped. A naive
 * separator makes `("a", "b:c")` and `("a:b", "c")` the same key, and the
 * failure is a fold silently answering with another node's value, which is
 * about as hard to diagnose as bugs get. Prefixing each variable-length part
 * with its length makes the encoding injective for every input.
 */
function cacheKey(foldKey: string, nodeId: NodeId, subtreeRev: number): string {
  return `${foldKey.length}:${foldKey}${nodeId.length}:${nodeId}:${subtreeRev}`;
}

/**
 * Plain LRU keyed by `(foldKey, nodeId, subtreeRev)`.
 *
 * Including the rev is what lets this live BESIDE the store while `Graph` stays
 * a pure value: an entry for a stale rev is UNREACHABLE rather than wrong, so
 * nothing has to invalidate it — eviction is a memory concern only, never a
 * correctness one.
 *
 * `limit` of zero or less disables caching entirely (every `set` is a no-op),
 * which is what a cold shadow-refold check wants; a non-finite `limit` falls
 * back to the default rather than growing without bound.
 */
export function createFoldCache(limit: number = DEFAULT_FOLD_CACHE_LIMIT): FoldCache {
  const max = Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_FOLD_CACHE_LIMIT;
  // Map iteration order is insertion order, which is the whole LRU mechanism:
  // re-inserting on read moves an entry to the back, so the front is the least
  // recently used.
  const entries = new Map<string, unknown>();

  return {
    get(foldKey, nodeId, subtreeRev) {
      const key = cacheKey(foldKey, nodeId, subtreeRev);
      // `has`, not `get() !== undefined`. The hit/miss union exists precisely
      // so a legitimately cached `undefined` is a hit; testing the value would
      // throw that away and silently recompute forever.
      if (!entries.has(key)) return { hit: false };
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      return { hit: true, value };
    },
    set(foldKey, nodeId, subtreeRev, value) {
      if (max <= 0) return;
      const key = cacheKey(foldKey, nodeId, subtreeRev);
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > max) {
        const oldestKey: string | undefined = entries.keys().next().value;
        // Keys are never `undefined` (every one starts with a length digit), so
        // this only fires on an exhausted iterator — impossible while size > 0,
        // but it is what keeps the loop provably terminating without a `!`.
        if (oldestKey === undefined) break;
        entries.delete(oldestKey);
      }
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

// ---------------------------------------------------------------------------
// 5. computeFold
// ---------------------------------------------------------------------------

type Frame = Readonly<{ id: NodeId; expanded: boolean }>;

/**
 * THE ONLY cast in this module, and the erasure it crosses is intrinsic to
 * `FoldCache`: one cache serves every registered fold, those folds have
 * different `A`s, so the slot type has to be `unknown`.
 *
 * The soundness argument is the same as the boundary constructors in ./types —
 * this value was written by THIS function, under THIS `fold.key`, so it is a
 * `Folded<A>`. `fold.key` is what makes the argument hold, which is why the key
 * is part of the cache key and not a decorative label. Two folds registered
 * with the SAME `key` and different `A` would break it; that is a duplicate and
 * belongs in `createEngine`'s registry check, not here.
 *
 * `undefined` unambiguously means "miss" because `Folded<A>` is always an
 * object, never `undefined`, for every `A`.
 */
function readCachedFold<A>(
  cache: FoldCache,
  foldKey: string,
  nodeId: NodeId,
  subtreeRev: number,
): Folded<A> | undefined {
  const hit = cache.get(foldKey, nodeId, subtreeRev);
  if (!hit.hit) return undefined;
  return hit.value as Folded<A>;
}

/**
 * Did this child's value come out of `fold.placeholder` — i.e. is it a stand-in
 * for a subtree nobody has read?
 *
 * TRUE for `unloaded` and `reference` ONLY. A quarantined node is deliberately
 * NOT a placeholder even when its own children state says `unloaded`: it was
 * answered by `fold.quarantined`, whose returned certainty is the fold author's
 * own signal about forward-incompatible data. Folding the two together would
 * make `placeholder` mean two different things at once and leave neither
 * recoverable from the flag.
 */
function isPlaceholderNode<Ts extends readonly unknown[], S>(
  node: AnyNode<Ts, S>,
): boolean {
  // Discriminate on `quarantined` FIRST: `container` is plain `boolean` on the
  // quarantined arm (it comes off the wire), so it cannot separate the three.
  if (node.quarantined) return false;
  if (!node.container) return false;
  const status = node.children.status;
  return status === "unloaded" || status === "reference";
}

/**
 * Evaluate `fold` at `nodeId`, bottom-up, with an EXPLICIT STACK — never
 * recursion. Depth is hostile input: a document can nest as deeply as whoever
 * wrote it liked, and a `RangeError` thrown out of a React render is not
 * recoverable.
 *
 * Dispatch, in order:
 *   quarantined         -> fold.quarantined(node)     (children NOT visited)
 *   leaf                -> { fold.leaf(node), "exact" }
 *   collection missing  -> fold.missing(node)
 *   collection unloaded
 *     | reference       -> fold.placeholder(node)
 *   collection loaded   -> fold.collection(node, children)
 *
 * A quarantined CONTAINER's children stay addressable and movable in the graph,
 * but they are not folded: quarantine is answered once, by the one hook that
 * exists for it, and a fold that walked into data the engine could not parse
 * would be reporting on values nobody validated.
 *
 * Returns `undefined` when `nodeId` is unknown. That is routine, not
 * exceptional — in React a card outlives its node by a frame on every removal.
 *
 * Pass `cache` to memoize; results are keyed by `(fold.key, id, subtreeRev)`,
 * so passing a cache can never change the answer, only the work.
 */
export function computeFold<Ts extends readonly unknown[], S, A>(
  graph: Graph<Ts, S>,
  fold: Fold<Ts, S, A>,
  nodeId: NodeId,
  cache?: FoldCache,
): Folded<A> | undefined {
  if (getNode(graph, nodeId) === undefined) return undefined;

  const results = new Map<NodeId, Folded<A>>();
  /**
   * Loaded collections that have already had their `expanded` frame pushed.
   *
   * This is NOT the predecessor's `visiting` guard — that one existed because
   * following a duplicate's pointer could revisit a node already on the stack,
   * and it is gone for good: references are leaves, so the placement forest is
   * a genuine tree and a correct graph never needs this.
   *
   * It is here because a cycle is an INVARIANT VIOLATION (the reducer refuses
   * to create one, `deserialize` refuses to load one, `findInvariantViolation`
   * reports one) and this is a read path. On a hand-corrupted graph the choice
   * is between an unbounded loop inside a render and a dropped child; a dropped
   * child is recoverable and a hung tab is not.
   */
  const opened = new Set<NodeId>();
  const stack: Frame[] = [{ id: nodeId, expanded: false }];

  const commit = (id: NodeId, value: Folded<A>): void => {
    results.set(id, value);
    if (cache !== undefined) {
      cache.set(fold.key, id, getSubtreeRev(graph, id), value);
    }
  };

  while (stack.length > 0) {
    const frame = stack.pop();
    // `pop` is typed `Frame | undefined` regardless of the length guard, and
    // this repo does not paper over that with `!`.
    if (frame === undefined) break;
    if (results.has(frame.id)) continue;

    const node = getNode(graph, frame.id);
    // A child id that resolves to nothing is a `dangling-child` violation.
    // `findInvariantViolation` is where that gets reported; here it is simply
    // dropped, because the fold has no hook for "a node that is not there" and
    // inventing a value would be worse than omitting one.
    if (node === undefined) continue;

    if (!frame.expanded && cache !== undefined) {
      const cached = readCachedFold<A>(
        cache,
        fold.key,
        frame.id,
        getSubtreeRev(graph, frame.id),
      );
      if (cached !== undefined) {
        // A hit skips the entire subtree — that is the point of a bottom-up
        // walk over a rev-keyed cache.
        results.set(frame.id, cached);
        continue;
      }
    }

    if (node.quarantined) {
      commit(node.id, fold.quarantined(node));
      continue;
    }

    if (!node.container) {
      // A leaf is always exact; only placeholders, quarantine and a fold's own
      // judgement introduce uncertainty, so the evaluator wraps without asking.
      commit(node.id, { value: fold.leaf(node), certainty: "exact" });
      continue;
    }

    const state = node.children;
    if (state.status === "missing") {
      commit(node.id, fold.missing(node));
      continue;
    }
    if (state.status === "unloaded" || state.status === "reference") {
      commit(node.id, fold.placeholder(node));
      continue;
    }

    const childIds = getChildren(graph, node.id);

    if (!frame.expanded) {
      if (opened.has(node.id)) continue;
      opened.add(node.id);
      // Parent first so it pops LAST, after every child has landed in
      // `results`. Children pushed in reverse so they pop in document order —
      // the order does not change the answer (each child is folded
      // independently) but it keeps a fold's own side effects, and a debugger's
      // step order, matching the list the user sees.
      stack.push({ id: node.id, expanded: true });
      for (let i = childIds.length - 1; i >= 0; i -= 1) {
        const childId = childIds[i];
        if (childId === undefined) continue;
        stack.push({ id: childId, expanded: false });
      }
      continue;
    }

    const children: FoldedChild<A>[] = [];
    for (const childId of childIds) {
      const childFolded = results.get(childId);
      if (childFolded === undefined) continue;
      const childNode = getNode(graph, childId);
      if (childNode === undefined) continue;
      children.push({
        ...childFolded,
        id: childId,
        placeholder: isPlaceholderNode(childNode),
      });
    }
    commit(node.id, fold.collection(node, children));
  }

  return results.get(nodeId);
}

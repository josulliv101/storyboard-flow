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
  GraphNode,
  Certainty,
  CollectionNode,
  ExactFolded,
  ConsumerDefinedFold,
  FoldCache,
  Folded,
  FoldedChild,
  Graph,
  LeafNode,
  NodeId,
  ErasedNodeType,
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
 * changes nothing), which is exactly why `ConsumerDefinedFold.collection` returns `Folded<A>`
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
 * Build a `ConsumerDefinedFold` from a monoid plus weakest-wins certainty.
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
 * Those three are why `ConsumerDefinedFold` is the primitive and this is the convenience.
 * Write `ConsumerDefinedFold` by hand when you need any of them.
 */
export function foldMonoid<Ts extends readonly ErasedNodeType[], S, A>(
  m: Readonly<{
    key: string;
    empty: A;
    leaf(node: LeafNode<Ts>): A;
    concat(a: A, b: A): A;
    own?(node: CollectionNode<Ts, S>): A;
    placeholder?(node: CollectionNode<Ts, S>): A | undefined;
  }>,
): ConsumerDefinedFold<Ts, S, A> {
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

/**
 * The default ceiling, written as FOLDS x NODES because that is the shape of
 * the working set. A round number is how the first version of this got it
 * wrong: 2048 reads as "plenty" and is one fold over 2k nodes.
 *
 * `computeFold` commits an entry for EVERY node it walks, so one root-level
 * read of ONE fold over an n-node document occupies n slots, and the k folds a
 * consumer registered all share their store's single cache — k x n.
 *
 * THAT IS THE FLOOR, NOT THE STEADY STATE, and an earlier version of this
 * comment said "at steady state" and was wrong. There is no steady state at
 * k x n. Every edit bumps the edited node's ancestor chain, so the next root
 * read mints k x DEPTH new keys and strands k x depth old ones, and occupancy
 * grows with the session's EDIT COUNT until the limit bites:
 *
 *     occupancy  ~=  k x n  +  k x depth x edits
 *
 * MEASURED, and the fit is exact rather than approximate — at n=1,111, k=4,
 * depth=4 the dead entries came to `16E + 384` to the entry at E = 1, 100, 500,
 * 1,000, 2,000 and 4,000. At E=4,000 that is 15.5x the k x n this comment used
 * to name as the resting size.
 *
 * The stranded entries are NOT a leak, and this is the part that keeps the
 * design sound: a dead-rev entry is never touched again, so the LRU ages it out
 * first — GIVEN HEADROOM. Measured against the ideal of k x depth fold calls
 * per post-edit root read (16 for that fixture):
 *
 *     limit 1.0x k x n   ->  30.4 calls   (1.90x ideal)
 *     limit 1.25x        ->  23.2
 *     limit 2.0x         ->  20.3         (1.27x)
 *     limit 4.0x         ->  16.0         (1.00x, with 131,052 evictions costing nothing)
 *
 * So the cliff is not at k x n, it is just below it. A dead entry is always
 * NEWER than a cold live one — a leaf is only re-touched when a sibling is
 * edited — so at exactly k x n there is no room and every dead admission evicts
 * a live one. Size the table with headroom over the product, not to it;
 * `createStore` warns using the same multiple.
 *
 * Below the product the LRU does not degrade gracefully, it INVERTS:
 * fold k's walk evicts fold 1's entries, fold 1's next read misses at the root,
 * and every mounted card refolds its whole subtree from scratch. That is
 * precisely the un-memoized behaviour this table exists to beat, so the cap
 * being too low does not cost a little speed — it costs the entire mechanism,
 * silently, at exactly the graph size it was built for. `stats()` exists
 * because that failure has no other symptom.
 *
 * 8 x 16384. Eight is a realistic registry (duration, first frame, child count,
 * byte size, a disabled rollup, a missing rollup, and room for two more).
 * 16384 nodes is chosen to clear a ten-thousand-node document — the size this
 * package's own performance fixtures treat as realistic — with headroom, so
 * that what a consumer meets first is their graph's memory cost, not this
 * ceiling silently turning their memo table off.
 *
 * A generous ceiling is cheap because the Map is DEMAND-FILLED: a 200-node
 * document holds 200 x k entries no matter what this number says. The limit
 * only decides when eviction starts. MEASURED on node 22 with `--expose-gc`
 * (200k entries, this module's own `cacheKey`, a `Folded` wrapping a number):
 * ~232 bytes an entry, stable to the byte across three runs, so a table at FULL
 * occupancy is ~30 MB — reachable only by a 16k-node graph that is itself the
 * same order of magnitude in memory.
 *
 * Read that as a FLOOR, not a total. The entry is the key plus the `Folded`,
 * and `Folded<A>`'s `A` is whatever the consumer's fold returns — a duration is
 * a number, a preview-items rollup is an array of objects, and this package
 * cannot know which. A consumer whose folds accumulate anything larger than a
 * scalar should size `foldCacheLimit` against their own `A`, not against this.
 *
 * Still not a universal answer, which is why it is not the only door:
 * `EngineConfig.foldCacheLimit` is how a consumer with 40 folds or 100k nodes
 * raises it without editing this package.
 */
export const DEFAULT_FOLD_CACHE_LIMIT = 8 * 16384;

/**
 * Counters for the one question a cache cannot answer by working: IS it
 * working? A memo table that has silently stopped helping behaves exactly like
 * one that never helped — same answers, more work — so an undersized `limit`
 * has no symptom a consumer can see from the outside. `evictions` climbing
 * while `hits` stays flat is that symptom, and it is the signal to raise
 * `EngineConfig.foldCacheLimit`.
 *
 * `hits` / `misses` / `evictions` are LIFETIME counts and survive `clear()`;
 * `size` is current occupancy.
 *
 * Structurally duplicated by `EngineConfig.onFoldCacheStats`'s parameter in
 * ./types — that module is the base of the package and imports nothing, so a
 * types -> folds edge would be a cycle. The two must stay identical.
 */
export type FoldCacheStats = Readonly<{
  /** Lifetime `get` calls answered from the table. */
  hits: number;
  /** Lifetime `get` calls that had to fold. */
  misses: number;
  /**
   * Entries dropped FOR CAPACITY, and only for capacity. `clear()` is not
   * counted: conflating a deliberate reset with cache pressure would destroy
   * the only number that says the limit is too low.
   */
  evictions: number;
  /** Entries held right now. */
  size: number;
  /** The EFFECTIVE ceiling after flooring and the non-finite fallback, not the
   *  raw constructor argument. */
  limit: number;
}>;

/**
 * A `FoldCache` that can also be measured. `createFoldCache` always returns
 * one; the plain `FoldCache` in ./types stays the parameter type everywhere a
 * cache is CONSUMED, because `computeFold` has no business reading counters.
 */
export type ObservableFoldCache = FoldCache &
  Readonly<{
    stats(): FoldCacheStats;
    /**
     * Is this slot occupied? WITHOUT counting a hit or a miss, and without
     * moving the entry in the LRU order.
     *
     * For a diagnostic that needs to know whether an answer CAME from the table
     * — the shadow cold refold in ./engine is the only one — and must not
     * change the table or the numbers by asking. `get` cannot serve that: it
     * counts, and `FoldCacheStats` is the one instrument a consumer has for
     * telling a memo table that has silently stopped helping from one that
     * never helped. A probe that inflates `hits` on every read, or `misses` on
     * every read, is a diagnostic corrupting the diagnostic.
     *
     * Deliberately NOT on `FoldCache`. That type is what `computeFold` consumes,
     * and folding has no business asking a question it cannot act on.
     */
    peek(foldKey: string, nodeId: NodeId, subtreeRev: number): boolean;
  }>;

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
 * `limit` of zero or less disables caching entirely (every `set` is a no-op);
 * a non-finite `limit` falls back to the default rather than growing without
 * bound.
 *
 * NOT what the shadow-refold check uses, which this comment used to recommend.
 * That check wants ONE cold fold beside a cached one, so it omits
 * `computeFold`'s cache argument entirely — a whole disabled cache would also
 * disable the memoisation it exists to audit.
 *
 * Because the key carries the rev, the limit is a COST dial and nothing else —
 * evicting an entry can only make the next read do work it already did, never
 * change what it answers. That is the property `EngineConfig.foldCacheLimit`
 * relies on to be safe to expose, and it is covered by test rather than left as
 * an assertion.
 */
export function createFoldCache(
  limit: number = DEFAULT_FOLD_CACHE_LIMIT,
): ObservableFoldCache {
  const max = Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_FOLD_CACHE_LIMIT;
  // Map iteration order is insertion order, which is the whole LRU mechanism:
  // re-inserting on read moves an entry to the back, so the front is the least
  // recently used.
  const entries = new Map<string, unknown>();

  // Lifetime counters, deliberately NOT reset by `clear()` — a consumer that
  // clears on every document swap would otherwise see a permanently healthy
  // cache no matter how badly the limit was thrashing between swaps.
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  return {
    get(foldKey, nodeId, subtreeRev) {
      const key = cacheKey(foldKey, nodeId, subtreeRev);
      // `has`, not `get() !== undefined`. The hit/miss union exists precisely
      // so a legitimately cached `undefined` is a hit; testing the value would
      // throw that away and silently recompute forever.
      if (!entries.has(key)) {
        misses += 1;
        return { hit: false };
      }
      const value = entries.get(key);
      entries.delete(key);
      entries.set(key, value);
      hits += 1;
      return { hit: true, value };
    },
    set(foldKey, nodeId, subtreeRev, value) {
      // A disabled cache records no eviction: nothing was ever admitted, and
      // counting these would read as capacity pressure a bigger limit fixes.
      // `stats().limit` is what explains a zero hit rate here.
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
        evictions += 1;
      }
    },
    peek(foldKey, nodeId, subtreeRev) {
      // `has`, and nothing else. No counter, no re-insertion — see the doc on
      // `ObservableFoldCache`.
      return entries.has(cacheKey(foldKey, nodeId, subtreeRev));
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
    stats() {
      return { hits, misses, evictions, size: entries.size, limit: max };
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
 * with the SAME `key` and different `A` would break it; `createEngine` refuses
 * that at construction, which is what lets this cast stand. That check was
 * missing when this comment first claimed it — the argument was sound and the
 * premise was not.
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
function isPlaceholderNode<Ts extends readonly ErasedNodeType[], S>(
  node: GraphNode<Ts, S>,
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
export function computeFold<Ts extends readonly ErasedNodeType[], S, A>(
  graph: Graph<Ts, S>,
  fold: ConsumerDefinedFold<Ts, S, A>,
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

// Graph — derived aggregates.
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

// ---------------------------------------------------------------------------
// This file was 661 lines. Four modules, at the sections it already declared:
//
//   certainty   Folded values, and the persistence gate that reads them
//   monoid      foldMonoid — ergonomics for the easy 90%
//   cache       the memo table
//   compute     computeFold, the traversal
//
// The first two are pure algebra, `cache` is the one stateful thing, and
// `compute` is what walks the graph — which is why they were worth prising
// apart rather than left as one file about "folds".
// ---------------------------------------------------------------------------

export { folded, foldedExact, weakestCertainty, summaryFrom } from "./certainty";
export { foldMonoid } from "./monoid";
export {
  DEFAULT_FOLD_CACHE_LIMIT,
  createFoldCache,
  type FoldCacheStats,
  type ObservableFoldCache,
} from "./cache";
export { computeFold } from "./compute";

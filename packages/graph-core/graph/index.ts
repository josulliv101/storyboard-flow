// Graph — graph structure, queries, derived indexes and invariants.
//
// PURE. Imports `../types` and nothing else — not even a sibling graph module.
// This is the bottom of the dependency order: patches, commands, folds and
// serialize all sit on top of it, so anything imported here is imported by every
// one of them.
//
// This was one 1,799-line file. It is now a folder, and the split follows the
// sections that file already had rather than inventing new ones. The order below
// IS the dependency order — each module may import the ones above it and none of
// the ones below, which is what keeps the folder acyclic:
//
//   internals        frozen empties, folder-private
//   registry         `buildRegistry` — the only function in graph-core that throws
//   queries          every query, all TOTAL, plus the document-order comparator
//   keys             `contentKey` / `sourceKey`, and the one ownership predicate
//   revisions        the subtree-revision bump
//   derived-indexes  the ONE definition of what the indexes contain, and the
//                    full rebuild from it
//   incremental-indexes  every cheaper updater OF that definition — read as a
//                    pair with the file above, see its header for why
//   construction     the functions that create a Graph
//   invariants       the structural audit
//
// CURATED, not `export *`. Two things are deliberately not re-exported:
//
//   - `buildGraph` (./construction) — assembling a graph from already-parsed
//     nodes is an ingress author's tool, and the sanctioned ingress is
//     `deserialize`. This mirrors the package barrel's own note about it.
//   - `NO_IDS` / `NO_PLACEMENTS` / `NO_OWNERS` (./internals) — shared frozen
//     singletons. A consumer holding one by reference and mutating it would
//     corrupt every empty answer the graph gives. `NO_DEAD_REVS` IS exported,
//     because ./serialize needs it to build a graph that has removed nothing.

export { NO_DEAD_REVS } from "./constants";

export { buildRegistry } from "./registry";

export {
  ancestorChain,
  childrenStateOf,
  documentOrder,
  documentOrderComparator,
  getChildren,
  getNode,
  getParent,
  getSubtreeRev,
  isCollection,
  isLoaded,
  isSameOrAncestor,
  nodeCount,
  stateOwnsSubtree,
  subtreeHeight,
  subtreeIds,
} from "./queries";

export {
  contentKeyOf,
  KeyHookFailure,
  keyHookMessage,
  ownsItsSubtree,
  sourceKeyOf,
  sourceKeyForData,
} from "./keys";

export { bumpSubtreeRevs, bumpSubtreeRevsInto } from "./revisions";

export {
  derivedIndexNeed,
  rebuildDerivedIndexes,
  rebuildPlacementIndex,
  type DerivedIndexNeed,
  type DerivedIndexes,
} from "./derived-indexes";

export {
  derivedIndexesSurviveDataChange,
  derivedIndexesAfterRemoval,
  derivedIndexesSurviveInsert,
  ownersAfterInsert,
  placementsAfterInsert,
  reindexPlacementsAcrossMove,
  reindexPlacementsWithinSubtree,
} from "./incremental-indexes";

export { emptyGraph, markMissing } from "./construction";

export { findInvariantViolation } from "./invariants";

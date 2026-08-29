// KEEL core — the public surface.
//
// CURATED, not `export *`. A barrel that re-exports everything makes every
// internal helper part of the contract the moment someone imports it, and this
// repo has already paid for that: an `export *` in a UI barrel made a reachable
// -looking module out of four dead ones, and grep could not tell a barrel from
// a consumer. Everything named here is something a consumer is meant to call.
//
// PURE. No React, no DOM, no "use client" anywhere below this file. The React
// bindings are `@storyboard/keel-react`, and they take a finished engine —
// keeping them apart is what lets a route handler call `engine.deserialize`
// without importing a client module that typechecks clean and 500s at request
// time.
//
// Not exported on purpose:
//   - `buildGraph` (./graph) — assembling a graph from already-parsed nodes is
//     an ingress author's tool, and the sanctioned ingress is `deserialize`.
//     `emptyGraph` covers the one case a consumer legitimately needs.
//   - every module-local helper, which is the rest of the six modules.

// ---------------------------------------------------------------------------
// Types, the id door, the node type factory, and the boundary constructors
// ---------------------------------------------------------------------------

export {
  defineNodeType,
  makeCollectionNode,
  makeDataChange,
  makeFolded,
  makeLeafNode,
  makeQuarantinedNode,
  parseNodeId,
  tryParseNodeId,
  type GraphNode,
  type Certainty,
  type Change,
  type ChildrenState,
  type CollectionNode,
  type Command,
  type DataChange,
  type DataForKind,
  type DropIntent,
  type EditForKind,
  type EditOf,
  type EditRejection,
  type Engine,
  type EngineConfig,
  type EngineContext,
  type ExactFolded,
  type ConsumerDefinedFold,
  type FoldCache,
  type Folded,
  type FoldedChild,
  type FoldRegistry,
  type FoldValue,
  type Graph,
  type History,
  type HistoryEntry,
  type IngressError,
  type Issue,
  type KindOf,
  type LeafNode,
  type LoadRejection,
  type LoadRejectionCode,
  type LoadReport,
  type Move,
  type NodeId,
  type ConsumerDefinedNodeType,
  type NodeTypeRegistry,
  type ParseCtx,
  type Patch,
  type PhantomTypes,
  type Placement,
  type QuarantinedNode,
  type QuarantineReason,
  type Rejection,
  type RejectionCode,
  type ReplayRejection,
  type ReplayRejectionCode,
  type Result,
  type Seed,
  type SelectionSlice,
  type SerializedDocument,
  type SerializedGraph,
  type SerializedNode,
  type ErasedFold,
  type ErasedNodeType,
  type Store,
  type StructuralError,
  type StructuralErrorCode,
  type ConsumerDefinedSummaryType,
  type ValueOf,
  type Violation,
  type ViolationCode,
} from "./types";

// ---------------------------------------------------------------------------
// Graph — structure, queries, invariants, derived indexes
// ---------------------------------------------------------------------------

export {
  ancestorChain,
  buildRegistry,
  bumpSubtreeRevs,
  childrenStateOf,
  contentKeyOf,
  documentOrder,
  emptyGraph,
  findInvariantViolation,
  getChildren,
  getNode,
  getParent,
  getSubtreeRev,
  isCollection,
  isLoaded,
  isSameOrAncestor,
  markMissing,
  nodeCount,
  ownsSubtree,
  rebuildDerivedIndexes,
  sourceKeyOf,
  subtreeIds,
} from "./graph";

// ---------------------------------------------------------------------------
// Patches — the reversible record, and the one index rewriter
// ---------------------------------------------------------------------------

export {
  applyPatch,
  invertPatch,
  isEmptyPatch,
  patchDetachedSubtrees,
  patchTouchedNodeIds,
  scrubPatchForIngest,
  verifyPatchApplies,
} from "./patches";

// ---------------------------------------------------------------------------
// Commands — the reducer, drop resolution, the ingest door
// ---------------------------------------------------------------------------

export { applyCommand, applyIngestEdits, resolveDrop } from "./commands";

// ---------------------------------------------------------------------------
// Folds — derived aggregates and the persistence gate
// ---------------------------------------------------------------------------

export {
  computeFold,
  createFoldCache,
  DEFAULT_FOLD_CACHE_LIMIT,
  foldMonoid,
  folded,
  foldedExact,
  summaryFrom,
  weakestCertainty,
  // `createFoldCache` RETURNS an `ObservableFoldCache`, and `stats()` returns a
  // `FoldCacheStats`. Leaving both unnamed here is the curation rule misfiring:
  // a consumer sizing `EngineConfig.foldCacheLimit` off the eviction counter
  // could call the function but could not write down the type of what it handed
  // back, and would have to reach past the barrel into ./folds to do it.
  type FoldCacheStats,
  type ObservableFoldCache,
} from "./folds";

// ---------------------------------------------------------------------------
// Serialization — the wire, migrations, and the ingress trust boundary
// ---------------------------------------------------------------------------

export {
  // Named here for the same reason `DEFAULT_FOLD_CACHE_LIMIT` is: a consumer
  // deciding whether to raise `EngineConfig.maxNodes` needs to be able to see
  // what they are raising it FROM without reaching past the barrel.
  DEFAULT_MAX_NODES,
  deserializeDocument,
  loadChildrenInto,
  parseNodeData,
  parseSerializedDocument,
  serializeGraph,
} from "./serialize";

// ---------------------------------------------------------------------------
// History — pure undo/redo values
// ---------------------------------------------------------------------------

export {
  canRedo,
  canUndo,
  clearFuture,
  clearHistory,
  clearPast,
  coalesceEntries,
  commitRedo,
  commitUndo,
  createHistory,
  peekRedo,
  peekUndo,
  pushHistory,
  scrubHistoryForIngest,
} from "./history";

// ---------------------------------------------------------------------------
// The assembled engine
// ---------------------------------------------------------------------------

export {
  createEngine,
  // Named for the same reason the other two defaults are: a consumer deciding
  // whether to raise `EngineConfig.interactiveNodeBudget` needs to see what
  // they are raising it from, and the measurement that set it.
  DEFAULT_INTERACTIVE_NODE_BUDGET,
} from "./engine";

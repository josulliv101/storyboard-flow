// @storyboard/timeline-domain — the storage/hydration seam between the app's
// TimelineDocument model and the collections graph engine, per
// docs/storyboard-graph-architecture.md. Framework-free.

export {
  buildFocusedGraph,
  buildHydrationSpecs,
  collectAffectedCollectionIds,
  collectUnhydratedDropTargets,
  graphChildrenToClips,
  // The adapter MINTS these ids, so it is the only honest place to ask whether
  // one is synthetic — the hydration path decides whether to fetch on it.
  isDuplicateNodeId,
  DUPLICATE_NODE_ID_PREFIX,
  hydratedCollectionDuration,
  hydratedCollectionPlayableDuration,
  hydratedCollectionPreviews,
  resolveCollectionPreviews,
  type BuildFocusedGraphResult,
  type BuildHydrationSpecsResult,
  type ClipDetail,
  type CollectionPreviewFrame,
  type CollectionPreviewsResult,
  type DetailsById,
  type DocumentsById,
  type FocusedGraph,
  type HydrationSpecs,
} from "./src/adapter";
export {
  compilePlaybackManifest,
  manifestToClips,
  type PlaybackLeaf,
  type PlaybackManifest,
} from "./src/playback-manifest";
export {
  flattenMediaOrder,
  resolveFlatDropTarget,
  type FlatItem,
} from "./src/flat-order";

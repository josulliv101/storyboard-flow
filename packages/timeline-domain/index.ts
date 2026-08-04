// @storyboard/timeline-domain — the storage/hydration seam between the app's
// TimelineDocument model and the collections graph engine, per
// docs/storyboard-graph-architecture.md. Framework-free.

export {
  buildFocusedGraph,
  buildHydrationSpecs,
  collectAffectedCollectionIds,
  collectUnhydratedDropTargets,
  graphChildrenToClips,
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

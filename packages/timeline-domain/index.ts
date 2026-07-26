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
  type BuildFocusedGraphResult,
  type BuildHydrationSpecsResult,
  type ClipDetail,
  type CollectionPreviewFrame,
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

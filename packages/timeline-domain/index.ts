// @storyboard/timeline-domain — the storage/hydration seam between the app's
// TimelineDocument model and the collections graph engine, per
// docs/storyboard-graph-architecture.md. Framework-free.

export {
  buildFocusedGraph,
  buildHydrationSpecs,
  collectAffectedCollectionIds,
  graphChildrenToClips,
  type BuildFocusedGraphResult,
  type BuildHydrationSpecsResult,
  type ClipDetail,
  type DetailsById,
  type DocumentsById,
  type FocusedGraph,
  type HydrationSpecs,
} from "./src/adapter";

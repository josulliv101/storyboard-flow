// @storyboard/timeline-domain — the storage/hydration seam between the app's
// TimelineDocument model and the collections graph engine, per
// docs/storyboard-graph-architecture.md. Framework-free.

export {
  buildFocusedGraph,
  collectAffectedCollectionIds,
  graphChildrenToClips,
  type BuildFocusedGraphResult,
  type ClipDetail,
  type DetailsById,
  type DocumentsById,
  type FocusedGraph,
} from "./src/adapter";

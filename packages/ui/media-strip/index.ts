export * from "./media-strip";
export * from "./media-strip-board";

// Deliberately curated exports below: internal helpers (DOM attribute
// constants, memo comparators, layout constants, dnd encoders) stay private
// so they can change without breaking consumers.

export {
  // `parse*` return a Result for untrusted input; `as*` parse-or-throw for
  // authoring-time-trusted IDs (literals, framework-generated ids).
  parseTimelineItemId,
  parseCollectionId,
  asTimelineItemId,
  asCollectionId,
  isImageItem,
  isVideoItem,
  isMediaItem,
  isCollectionItem,
  assertNever,
  type TimelineItemId,
  type CollectionId,
  type ImageTimelineItem,
  type VideoTimelineItem,
  type MediaTimelineItem,
  type CollectionTimelineItem,
  type TimelineItem,
  type TimelineItemKind,
  type TimelineItemResult,
  type TimelineCollection,
  type TimelineCollectionsById,
  type TimelineItemCommand,
} from "./core/media-strip.types";

export {
  EPSILON_SECONDS,
  validateTimelineItemBase,
  validateMediaItemStrings,
  validateImageTimelineItem,
  validateVideoTimelineItem,
  validateCollectionTimelineItem,
  validateTimelineItem,
  validateTimelineCollection,
  wouldCreateCollectionCycle,
  createImageTimelineItem,
  createVideoTimelineItem,
  createCollectionTimelineItem,
  updateImageTimelineItem,
  updateVideoTimelineItem,
  updateCollectionTimelineItem,
  type TimelineItemBaseValidationResult,
  type TimelineItemBaseValidationFailure,
  type MediaTimelineItemValidationResult,
  type MediaTimelineItemValidationFailure,
  type CollectionTimelineItemValidationResult,
  type CollectionTimelineItemValidationFailure,
  type VideoTimelineItemValidationResult,
  type VideoTimelineItemValidationFailure,
  type TimelineItemValidationResult,
  type TimelineCollectionValidationResult,
  type ValidationResultOf,
  type CreateImageTimelineItemInput,
  type CreateVideoTimelineItemInput,
  type CreateCollectionTimelineItemInput,
  type ImageTimelineItemPatch,
  type VideoTimelineItemPatch,
  type CollectionTimelineItemPatch,
} from "./core/media-strip.validation";

export {
  formatDuration,
  getItemWidth,
  getTimelineItemEndTimeSeconds,
  getVideoVisibleDurationSeconds,
} from "./core/media-strip.utils";

export {
  applyTimelineItemCommand,
  syncCollectionItemCounts,
} from "./core/media-strip.collection-ops";

export type {
  MediaStripDndAdapter,
  MediaStripDndAdapterComponents,
} from "./media-strip-dnd.types";

export {
  validateProjectTimeline,
  type ProjectValidationResult,
} from "./core/media-strip.project-validation";

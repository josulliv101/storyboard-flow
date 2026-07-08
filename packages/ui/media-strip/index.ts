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
  type DropPlacement,
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

// The ingestion boundary for genuinely untrusted `unknown` data (an API
// response, a parsed JSON file). `validate*`/`create*` above assume the
// input already has a valid discriminated-union shape — an invalid `kind`
// crashes their dispatch instead of failing gracefully. These never throw.
export {
  parseTimelineItem,
  parseTimelineCollection,
  parseTimelineCollectionsById,
  type TimelineItemFieldShapeError,
  type TimelineItemParseError,
  type TimelineCollectionParseError,
  type TimelineCollectionsByIdParseError,
} from "./core/media-strip.parse";

export {
  applyTimelineItemCommand,
  syncCollectionItemCounts,
  type ApplyTimelineItemCommandResult,
} from "./core/media-strip.collection-ops";

export type {
  MediaStripDndAdapter,
  MediaStripDndAdapterComponents,
  MediaStripDndCapabilities,
} from "./media-strip-dnd.types";

// The three DnD adapter instances are deliberately NOT re-exported here.
// Each one pulls in a different optional peer dependency (@dnd-kit/*,
// @atlaskit/pragmatic-drag-and-drop) — barrel-exporting all three from this
// root module would force every consumer to have all three resolvable just
// to import a type or the plain MediaStrip component. `MediaStripBoard`
// takes its adapter as a prop for exactly this reason: import only the one
// you use, directly from its own module:
//   import { dndKitMediaStripDndAdapter } from "@storyboard/ui/media-strip/adapters/dnd-kit-adapter";
//   import { nativeHtml5MediaStripDndAdapter } from "@storyboard/ui/media-strip/adapters/native-html5-adapter";
//   import { pragmaticMediaStripDndAdapter } from "@storyboard/ui/media-strip/adapters/pragmatic-adapter"; // see its doc comment for a test-coverage caveat

export {
  validateProjectTimeline,
  type ProjectValidationResult,
} from "./core/media-strip.project-validation";

// The stored timeline model: a TimelineDocument is a flat TimelineClip[]
// where a collection clip references its child document by childTimelineId —
// semantically a containment forest. These types are the persistence
// contract shared by the server routes, the graph adapter, and every view;
// they live here (framework-free) so domain and server code can depend on
// them without pulling a UI package. View-transient fields (the view*
// family) ride along on TimelineItemBase because stored clips round-trip
// through view state in the legacy pipeline.

export type MediaKind = "image" | "video";
export type CollectionEndpoint = "first" | "last";

export type TimelineItemBase = {
  id: string;
  index: number;
  alt: string;
  aspect: number;
  trackIndex: number;

  /** Absolute timeline position. */
  startTime: number;
  /** Visible duration after trimming. */
  duration: number;
  /** Total source duration available for this clip. */
  sourceDuration: number;
  /** Amount trimmed from the source beginning. */
  trimIn: number;
  /** Amount trimmed from the source end. */
  trimOut: number;
  /** Optional unscaled timeline position used when visual width differs from playback time. */
  playbackStartTime?: number;
  /** Optional unscaled playback duration used when visual width differs from playback time. */
  playbackDuration?: number;
  /** Transient view key used when a collection endpoint is exposed inline. */
  viewExpansionKey?: string;
  /** Transient source timeline for inline collection endpoint clips. */
  viewSourceTimelineId?: string;
  /** Transient source clip id for inline collection endpoint clips. */
  viewSourceClipId?: string;
  /** Transient nesting depth for inline collection endpoint views. */
  viewDepth?: number;
  /** Transient endpoint exposed from a collection preview. */
  viewEndpoint?: CollectionEndpoint;
  /** Transient parent collection key for exposed endpoint clips. */
  viewParentCollectionKey?: string;
  /** Transient role for synthetic inline collection endpoint cards. */
  viewRole?: "collection-endpoint";
  /** Transient accent index for sibling collection styling. */
  viewCollectionAccentIndex?: number;
};

export type ImageTimelineClip = TimelineItemBase & {
  kind: "image";
  src: string;
  poster?: string;
};

export type VideoTimelineClip = TimelineItemBase & {
  kind: "video";
  src: string;
  poster?: string;
};

export type MediaTimelineClip = ImageTimelineClip | VideoTimelineClip;

export type CollectionTimelineClip = TimelineItemBase & {
  kind: "collection";
  title: string;
  childTimelineId: string;
  itemCount: number;
  previewItems?: Array<{
    id: string;
    kind: MediaKind;
    src: string;
    poster?: string;
    alt: string;
  }>;
};

export type TimelineClip = MediaTimelineClip | CollectionTimelineClip;

export type TimelineDocument = {
  id: string;
  title: string;
  description?: string;
  clips: TimelineClip[];
};

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
  /**
   * Skipped: excluded from playback and from every count and duration total,
   * along with its whole subtree when this is a collection clip. It KEEPS its
   * slot in the stored document — same index, same startTime, same duration —
   * because disabling is not deleting: the board still shows the clip in
   * place, and only the read models (the playback manifest and the
   * collection-summary derivation) drop it and repack around it.
   *
   * Absent means enabled; enabling removes the key rather than writing
   * `false`, so documents that never use the feature never grow the field.
   */
  disabled?: boolean;
  /** ISO instant this clip was moved to trash. Absent on every live clip —
   *  its presence IS the record that a clip is in the bin, which is why it is
   *  cleared on restore rather than left as stale metadata. */
  trashedAt?: string;
  /** Which timeline this clip was deleted from. See {@link TrashOrigin}. */
  trashedFrom?: TrashOrigin;
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

/** Where a media clip's file came from: the asset provider that owns it and
 *  that provider's own id for it. Recorded when a clip is minted from the
 *  asset panel so the file stays identifiable across URL changes, provider
 *  re-configuration, and future re-linking — `src` is how the clip RENDERS,
 *  this is what the clip IS. Absent on clips that predate it and on media
 *  that never came through a provider (direct OS drops). */
export type AssetSourceRef = {
  providerId: string;
  assetId: string;
};

/** Where a clip was deleted FROM, and when. Written when a clip moves to
 *  trash; cleared when it is restored.
 *
 *  The title is a SNAPSHOT, not a lookup key: it is what the trash drawer
 *  prints, and it has to keep printing after the origin timeline is renamed or
 *  itself deleted — which is exactly when someone is digging through the trash.
 *  The id rides along for re-linking later (restore-to-origin), the same
 *  division of labour as `sourceAsset`: the id is what it IS, the snapshot is
 *  how it READS. */
export type TrashOrigin = {
  timelineId: string;
  title: string;
};

export type ImageTimelineClip = TimelineItemBase & {
  kind: "image";
  src: string;
  poster?: string;
  sourceAsset?: AssetSourceRef;
};

export type VideoTimelineClip = TimelineItemBase & {
  kind: "video";
  src: string;
  poster?: string;
  sourceAsset?: AssetSourceRef;
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

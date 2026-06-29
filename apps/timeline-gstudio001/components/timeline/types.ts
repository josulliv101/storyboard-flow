export type MediaKind = "image" | "video";

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

export type TrimScrubPreview = {
  clipIndex: number;
  time: number;
};

export type VideoSourceWindowEditMode = "move" | "center" | "left" | "right";

export type MediaSpec =
  | { kind: "image"; aspect: number }
  | { kind: "video"; aspect: number; src: string; duration?: number };

export type MediaKind = "image" | "video";

export type TimelineClip = {
  id: string;
  index: number;
  kind: MediaKind;
  src: string;
  alt: string;
  poster?: string;
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
};

export type TrimScrubPreview = {
  clipIndex: number;
  time: number;
};

export type VideoSourceWindowEditMode = "move" | "center" | "left" | "right";

export type MediaSpec =
  | { kind: "image"; aspect: number }
  | { kind: "video"; aspect: number; src: string; duration?: number };

// Runtime validation of the stored model at API boundaries. The shallow
// checks the routes used before (id/title strings, clips is SOME array)
// let a malformed client persist arbitrary values under a TimelineClip
// assertion — which then broke graph hydration and packing math at read
// time. These guards mirror the types exactly, with one deliberate
// leniency: OPTIONAL fields tolerate null as well as undefined (Firestore
// round-trips and legacy writers produce nulls), while every REQUIRED
// numeric must be a finite number (NaN/Infinity poison packing).

import type { TimelineClip, TimelineDocument } from "./types";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalString(value: unknown): boolean {
  return value == null || typeof value === "string";
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value == null || isFiniteNumber(value);
}

/** Same null leniency as every optional field; when present, BOTH halves of
 *  the ref must be non-empty strings — a half-recorded source is worse than
 *  none, since re-resolution would query the wrong provider. */
function isOptionalAssetSourceRef(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "object") return false;
  const ref = value as Record<string, unknown>;
  return (
    typeof ref.providerId === "string" &&
    ref.providerId.length > 0 &&
    typeof ref.assetId === "string" &&
    ref.assetId.length > 0
  );
}

/** Same null leniency as every optional field; when present BOTH halves must
 *  be non-empty strings — a half-recorded origin prints as "from " in the
 *  drawer, which is worse than printing nothing. */
function isOptionalTrashOrigin(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "object") return false;
  const origin = value as Record<string, unknown>;
  return (
    typeof origin.timelineId === "string" &&
    origin.timelineId.length > 0 &&
    typeof origin.title === "string" &&
    origin.title.length > 0
  );
}

function hasClipBase(clip: Record<string, unknown>): boolean {
  return (
    typeof clip.id === "string" &&
    clip.id.length > 0 &&
    isFiniteNumber(clip.index) &&
    typeof clip.alt === "string" &&
    isFiniteNumber(clip.aspect) &&
    isFiniteNumber(clip.trackIndex) &&
    isFiniteNumber(clip.startTime) &&
    isFiniteNumber(clip.duration) &&
    isFiniteNumber(clip.sourceDuration) &&
    isFiniteNumber(clip.trimIn) &&
    isFiniteNumber(clip.trimOut) &&
    isOptionalFiniteNumber(clip.playbackStartTime) &&
    isOptionalFiniteNumber(clip.playbackDuration) &&
    // Strictly boolean-or-absent. This gate guards the WRITE path, and a
    // truthy non-boolean would be read as "skip this clip" by the playback
    // and summary passes — a stored string "false" would silently drop a
    // clip from the timeline.
    (clip.disabled === undefined || typeof clip.disabled === "boolean") &&
    isOptionalString(clip.trashedAt) &&
    isOptionalTrashOrigin(clip.trashedFrom)
  );
}

export function isTimelineClip(value: unknown): value is TimelineClip {
  if (!value || typeof value !== "object") return false;
  const clip = value as Record<string, unknown>;
  if (!hasClipBase(clip)) return false;

  if (clip.kind === "image" || clip.kind === "video") {
    return (
      typeof clip.src === "string" &&
      isOptionalString(clip.poster) &&
      isOptionalAssetSourceRef(clip.sourceAsset)
    );
  }

  if (clip.kind === "collection") {
    if (typeof clip.title !== "string") return false;
    if (typeof clip.childTimelineId !== "string" || clip.childTimelineId.length === 0) {
      return false;
    }
    if (!isFiniteNumber(clip.itemCount)) return false;
    if (clip.previewItems == null) return true;
    if (!Array.isArray(clip.previewItems)) return false;
    return clip.previewItems.every((item) => {
      if (!item || typeof item !== "object") return false;
      const preview = item as Record<string, unknown>;
      return (
        typeof preview.id === "string" &&
        (preview.kind === "image" || preview.kind === "video") &&
        typeof preview.src === "string" &&
        typeof preview.alt === "string" &&
        isOptionalString(preview.poster)
      );
    });
  }

  return false;
}

/** The API-boundary document guard: shape AND every clip validated. */
export function isStoredTimelineDocument(value: unknown): value is TimelineDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Record<string, unknown>;
  return (
    typeof document.id === "string" &&
    document.id.length > 0 &&
    typeof document.title === "string" &&
    isOptionalString(document.description) &&
    Array.isArray(document.clips) &&
    document.clips.every(isTimelineClip)
  );
}

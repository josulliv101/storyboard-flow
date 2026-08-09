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

// Finiteness alone let a payload satisfy the guard and still violate the model
// it claims to be: negative durations, a negative trim, a fractional array
// index, a zero aspect. Each of those is accepted today and only fails LATER —
// in packing math or graph hydration, where the cause is a long way from the
// write that caused it.
//
// The rules below are deliberately the ones that cannot be argued with, and
// stop short of two the app's own writer would trip over:
//
//   - `duration` may be ZERO. An empty hydrated collection genuinely has no
//     span (`hydratedCollectionDuration` over no children), so "> 0" would
//     refuse a legitimate save.
//   - `trackIndex` is left as any finite number. It should be a non-negative
//     integer, but a legacy stored detail carrying a float would then be
//     unable to write itself back, and the value is inert until multi-track
//     lands.

/** Times, spans and counts: a negative one is not a value, it is corruption. */
function isNonNegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isOptionalNonNegative(value: unknown): boolean {
  return value == null || isNonNegative(value);
}

/** Array positions and counts. Fractional ones index nothing. */
function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegative(value) && Number.isInteger(value);
}

/**
 * Trims must leave something behind.
 *
 * The tolerance is not slack, it is float arithmetic: trims are accumulated
 * from pointer deltas and a legitimate full-length clip lands on
 * `trimIn + trimOut` a few ulps past `sourceDuration`. Rejecting that would
 * refuse a save the user can produce by dragging a handle to the end.
 */
const TRIM_EPSILON_SECONDS = 1e-6;

function trimsFitInSource(clip: Record<string, unknown>): boolean {
  const { trimIn, trimOut, sourceDuration } = clip;
  if (!isFiniteNumber(trimIn) || !isFiniteNumber(trimOut) || !isFiniteNumber(sourceDuration)) {
    return false;
  }
  return trimIn + trimOut <= sourceDuration + TRIM_EPSILON_SECONDS;
}

function isOptionalString(value: unknown): boolean {
  return value == null || typeof value === "string";
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
    // An array position, so an integer — and the writer derives it from
    // `.map((child, index) =>`, which cannot produce anything else.
    isNonNegativeInteger(clip.index) &&
    typeof clip.alt === "string" &&
    // Strictly positive: the ratio is a DIVISOR in layout, so zero is an
    // infinity waiting to happen and a negative one inverts the box.
    isFiniteNumber(clip.aspect) &&
    clip.aspect > 0 &&
    isFiniteNumber(clip.trackIndex) &&
    isNonNegative(clip.startTime) &&
    // Zero is legal here — see the note above `isNonNegative`.
    isNonNegative(clip.duration) &&
    isNonNegative(clip.sourceDuration) &&
    isNonNegative(clip.trimIn) &&
    isNonNegative(clip.trimOut) &&
    trimsFitInSource(clip) &&
    isOptionalNonNegative(clip.playbackStartTime) &&
    isOptionalNonNegative(clip.playbackDuration) &&
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

  if (clip.kind === "image" || clip.kind === "video" || clip.kind === "audio") {
    return (
      typeof clip.src === "string" &&
      // Audio must not carry a poster: one minted for an audio asset is a
      // broken image URL, and it would surface as a thumbnail in the
      // recently-deleted list. Absent is the only legal value.
      (clip.kind === "audio" ? clip.poster === undefined : isOptionalString(clip.poster)) &&
      isOptionalAssetSourceRef(clip.sourceAsset)
    );
  }

  if (clip.kind === "collection") {
    if (typeof clip.title !== "string") return false;
    if (typeof clip.childTimelineId !== "string" || clip.childTimelineId.length === 0) {
      return false;
    }
    // A count of children: integral and never negative.
    if (!isNonNegativeInteger(clip.itemCount)) return false;
    // The playable half of a collection's span. Optional, and never longer
    // than the layout span it is derived from — it counts the ENABLED subset.
    if (!isOptionalNonNegative(clip.playableDuration)) return false;
    if (
      isFiniteNumber(clip.playableDuration) &&
      isFiniteNumber(clip.duration) &&
      clip.playableDuration > clip.duration + TRIM_EPSILON_SECONDS
    ) {
      return false;
    }
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
        isOptionalString(preview.poster) &&
        // A source offset, so the same rule its clip-level twin follows.
        isOptionalNonNegative(preview.trimIn)
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

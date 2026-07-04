export type MediaKind = "image" | "video";

// --- Branded IDs -----------------------------------------------------------
// `id` and `collectionId` are both plain strings but refer to different
// entities. Branding prevents accidentally passing one where the other is
// expected (e.g. `getCollection(item.id)` when `item.collectionId` was meant).

// A `unique symbol` key guarantees this brand can never collide with a real
// property, or with an identically-named brand declared in another module —
// unlike a plain string key. The property is required, not optional: an
// optional `__brand?` would let a plain `string` satisfy the type with no
// cast at all, silently defeating the whole point of branding.
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type TimelineItemId = Brand<string, "TimelineItemId">;
export type CollectionId = Brand<string, "CollectionId">;

const IS_DEV = typeof process !== "undefined" && process.env?.NODE_ENV !== "production";

export const asTimelineItemId = (id: string): TimelineItemId => {
  if (!id && IS_DEV) {
    console.warn("Warning: Creating an empty TimelineItemId");
  }
  return id as TimelineItemId;
};

export const asCollectionId = (id: string): CollectionId => {
  if (!id && IS_DEV) {
    console.warn("Warning: Creating an empty CollectionId");
  }
  return id as CollectionId;
};

// --- Core types --------------------------------------------------------------

export type TimelineItemBase = Readonly<{
  id: TimelineItemId;
  name: string;

  /** Seconds from the start of the timeline. */
  startTimeSeconds: number;
  /** Visible duration on the timeline, in seconds. */
  durationSeconds: number;
}>;

type MediaTimelineItemBase = TimelineItemBase &
  Readonly<{
    /** Source media URL/path. */
    src: string;
    /** Optional thumbnail/poster override. */
    posterSrc?: string;
  }>;

export type ImageTimelineItem = MediaTimelineItemBase &
  Readonly<{
    kind: Extract<MediaKind, "image">;
  }>;

export type VideoTimelineItem = MediaTimelineItemBase &
  Readonly<{
    kind: Extract<MediaKind, "video">;
    /** Total source media duration in seconds. */
    sourceDurationSeconds: number;
    /** Seconds trimmed from the beginning of the source media. */
    trimInSeconds: number;
    /** Seconds trimmed from the end of the source media. */
    trimOutSeconds: number;
  }>;

export type MediaTimelineItem = ImageTimelineItem | VideoTimelineItem;

export type CollectionTimelineItem = TimelineItemBase &
  Readonly<{
    kind: "collection";
    /** Backing collection/media group id, used to fetch its items. */
    collectionId: CollectionId;
    itemCount: number;
  }>;

export type TimelineItem = MediaTimelineItem | CollectionTimelineItem;

/** Derived from `TimelineItem` so it can't drift if a variant is added/removed. */
export type TimelineItemKind = TimelineItem["kind"];

// --- Type guards -------------------------------------------------------------

export const isImageItem = (item: TimelineItem): item is ImageTimelineItem =>
  item.kind === "image";

export const isVideoItem = (item: TimelineItem): item is VideoTimelineItem =>
  item.kind === "video";

export const isMediaItem = (item: TimelineItem): item is MediaTimelineItem =>
  item.kind === "image" || item.kind === "video";

export const isCollectionItem = (
  item: TimelineItem
): item is CollectionTimelineItem => item.kind === "collection";

// --- Exhaustiveness ----------------------------------------------------------

/**
 * Use in the `default` case of a `switch (item.kind)`. If a new `TimelineItem`
 * variant is added later without updating that switch, this becomes a
 * compile error instead of a silent runtime gap.
 *
 * Tries `JSON.stringify` for a readable message, but falls back to `String`
 * if the runtime value (e.g. something that bypassed the type system, like
 * unvalidated API data) turns out to be circular — `JSON.stringify` throws
 * on circular structures, which would otherwise mask the original bug
 * behind an unrelated "Converting circular structure to JSON" error.
 */
export const assertNever = (value: never): never => {
  let serialized: string;

  try {
    serialized = JSON.stringify(value) ?? String(value);
  } catch {
    serialized = String(value);
  }

  throw new Error(`Unexpected value: ${serialized}`);
};

// --- Derived values ------------------------------------------------------------

export const getTimelineItemEndTimeSeconds = (item: TimelineItem): number =>
  item.startTimeSeconds + item.durationSeconds;

/** Derives visible duration from the source trim points, independent of `durationSeconds`. */
export const getVideoVisibleDurationSeconds = (
  item: Pick<
    VideoTimelineItem,
    "sourceDurationSeconds" | "trimInSeconds" | "trimOutSeconds"
  >
): number =>
  item.sourceDurationSeconds - item.trimInSeconds - item.trimOutSeconds;

// --- TimelineItemResult ---------------------------------------------------------

/**
 * Shared success/failure envelope so every factory below returns the same
 * shape regardless of kind. Without this, a caller can't tell a valid
 * `VideoTimelineItem` apart from a failed `VideoTimelineItemValidationResult`
 * without an awkward structural check (e.g. `"kind" in result`) — `ok` makes
 * that explicit and lets every factory be handled the same way:
 *
 *   const result = createImageTimelineItem(input);
 *   if (!result.ok) { report(result.error); return; }
 *   use(result.value);
 */
export type TimelineItemResult<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

// --- Validation ----------------------------------------------------------------

// Trim/timing values are typically produced by upstream arithmetic (UI drag
// deltas, frame-rate conversions), so exact equality/comparison on floats is
// unsafe — e.g. 0.1 + 0.2 !== 0.3 in JS. All boundary checks on these go
// through an epsilon rather than strict `<`/`!==`. Exported so other modules
// working with the same trim/timing values (e.g. a UI trim slider) can reuse
// the same tolerance instead of inventing their own.
export const EPSILON_SECONDS = 1e-6;

const isEffectivelyNegativeSeconds = (value: number): boolean =>
  value < -EPSILON_SECONDS;

const normalizeTinyNegativeSeconds = (value: number): number =>
  value < 0 && value > -EPSILON_SECONDS ? 0 : value;

const isApproximatelyEqual = (a: number, b: number): boolean =>
  Math.abs(a - b) < EPSILON_SECONDS;

const isApproximatelyLessThanOrEqual = (a: number, b: number): boolean =>
  a - b < EPSILON_SECONDS;

/**
 * Timing invariants that apply to EVERY `TimelineItem` variant, not just
 * video — an image or collection card can just as easily end up with a
 * negative `startTimeSeconds`/`durationSeconds` from a bad drag or an
 * upstream calculation bug.
 */
export type TimelineItemTimingValidationResult =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; reason: "non-finite-start-time" }>
  | Readonly<{ valid: false; reason: "non-finite-duration" }>
  | Readonly<{ valid: false; reason: "negative-start-time" }>
  | Readonly<{ valid: false; reason: "negative-duration" }>;

/** Failure-only slice, so `TimelineItemResult`'s error generic can't include `{ valid: true }`. */
export type TimelineItemTimingValidationFailure = Extract<
  TimelineItemTimingValidationResult,
  { valid: false }
>;

export const validateTimelineItemTiming = (
  item: TimelineItemBase
): TimelineItemTimingValidationResult => {
  if (!Number.isFinite(item.startTimeSeconds)) {
    return { valid: false, reason: "non-finite-start-time" };
  }

  if (!Number.isFinite(item.durationSeconds)) {
    return { valid: false, reason: "non-finite-duration" };
  }

  if (isEffectivelyNegativeSeconds(item.startTimeSeconds)) {
    return { valid: false, reason: "negative-start-time" };
  }

  if (isEffectivelyNegativeSeconds(item.durationSeconds)) {
    return { valid: false, reason: "negative-duration" };
  }

  return { valid: true };
};

export type CollectionTimelineItemValidationResult =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; reason: "non-finite-start-time" }>
  | Readonly<{ valid: false; reason: "non-finite-duration" }>
  | Readonly<{ valid: false; reason: "negative-start-time" }>
  | Readonly<{ valid: false; reason: "negative-duration" }>
  | Readonly<{ valid: false; reason: "non-finite-item-count" }>
  | Readonly<{ valid: false; reason: "non-integer-item-count" }>
  | Readonly<{ valid: false; reason: "negative-item-count" }>;

/** Failure-only slice, so `TimelineItemResult`'s error generic can't include `{ valid: true }`. */
export type CollectionTimelineItemValidationFailure = Extract<
  CollectionTimelineItemValidationResult,
  { valid: false }
>;

export const validateCollectionTimelineItem = (
  item: CollectionTimelineItem
): CollectionTimelineItemValidationResult => {
  const timingResult = validateTimelineItemTiming(item);
  if (!timingResult.valid) {
    return timingResult;
  }

  // itemCount is a plain integer count, not derived from time arithmetic —
  // unlike start/duration/trim, it doesn't need epsilon tolerance.
  if (!Number.isFinite(item.itemCount)) {
    return { valid: false, reason: "non-finite-item-count" };
  }

  if (!Number.isInteger(item.itemCount)) {
    return { valid: false, reason: "non-integer-item-count" };
  }

  if (item.itemCount < 0) {
    return { valid: false, reason: "negative-item-count" };
  }

  return { valid: true };
};

// Each failure reason is its own union member (rather than one member with a
// flat `reason: A | B | C` string) so that checking `reason === "..."` also
// narrows any reason-specific fields, like `expectedDurationSeconds` below.
export type VideoTimelineItemValidationResult =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; reason: "non-finite-start-time" }>
  | Readonly<{ valid: false; reason: "non-finite-duration" }>
  | Readonly<{ valid: false; reason: "negative-start-time" }>
  | Readonly<{ valid: false; reason: "negative-duration" }>
  | Readonly<{ valid: false; reason: "non-finite-source-duration" }>
  | Readonly<{ valid: false; reason: "non-finite-trim-in" }>
  | Readonly<{ valid: false; reason: "non-finite-trim-out" }>
  | Readonly<{ valid: false; reason: "negative-source-duration" }>
  | Readonly<{ valid: false; reason: "negative-trim-in" }>
  | Readonly<{ valid: false; reason: "negative-trim-out" }>
  | Readonly<{ valid: false; reason: "trim-exceeds-source" }>
  | Readonly<{
    valid: false;
    reason: "duration-mismatch";
    /** What `durationSeconds` should be. Required here — a "duration-mismatch"
     *  result can no longer be constructed without it, unlike a flat optional field. */
    expectedDurationSeconds: number;
  }>;

/** Failure-only slice, so `TimelineItemResult`'s error generic can't include `{ valid: true }`. */
export type VideoTimelineItemValidationFailure = Extract<
  VideoTimelineItemValidationResult,
  { valid: false }
>;

/**
 * Validates base timing, trim bounds, AND that `durationSeconds` hasn't
 * drifted from what the trim points imply. `durationSeconds` is stored
 * separately (e.g. for timeline scaling), so this guards against the two
 * silently disagreeing.
 *
 * Reports the first problem found, not all problems — checks run roughly in
 * order of "most actionable to surface first."
 */
export const validateVideoTimelineItem = (
  item: VideoTimelineItem
): VideoTimelineItemValidationResult => {
  const timingResult = validateTimelineItemTiming(item);
  if (!timingResult.valid) {
    return timingResult;
  }

  if (!Number.isFinite(item.sourceDurationSeconds)) {
    return { valid: false, reason: "non-finite-source-duration" };
  }

  if (!Number.isFinite(item.trimInSeconds)) {
    return { valid: false, reason: "non-finite-trim-in" };
  }

  if (!Number.isFinite(item.trimOutSeconds)) {
    return { valid: false, reason: "non-finite-trim-out" };
  }

  if (isEffectivelyNegativeSeconds(item.sourceDurationSeconds)) {
    return { valid: false, reason: "negative-source-duration" };
  }

  if (isEffectivelyNegativeSeconds(item.trimInSeconds)) {
    return { valid: false, reason: "negative-trim-in" };
  }

  if (isEffectivelyNegativeSeconds(item.trimOutSeconds)) {
    return { valid: false, reason: "negative-trim-out" };
  }

  if (
    !isApproximatelyLessThanOrEqual(
      item.trimInSeconds + item.trimOutSeconds,
      item.sourceDurationSeconds
    )
  ) {
    return { valid: false, reason: "trim-exceeds-source" };
  }

  const expectedDurationSeconds = getVideoVisibleDurationSeconds(item);
  if (!isApproximatelyEqual(item.durationSeconds, expectedDurationSeconds)) {
    return {
      valid: false,
      reason: "duration-mismatch",
      expectedDurationSeconds,
    };
  }

  return { valid: true };
};

// --- Smart constructors ------------------------------------------------------
// Every variant gets a factory that validates at construction time rather
// than leaving invariants to be checked (or forgotten) later. All three
// return the same `TimelineItemResult<T, E>` envelope so calling code doesn't need a
// different shape per kind.

export type CreateImageTimelineItemInput = Omit<ImageTimelineItem, "kind">;

export type CreateCollectionTimelineItemInput = Omit<
  CollectionTimelineItem,
  "kind"
>;

/**
 * `durationSeconds` is derived from `sourceDurationSeconds`, `trimInSeconds`,
 * and `trimOutSeconds` so callers can't accidentally create mismatched video
 * state. If trim values change later, use `updateVideoTimelineItem`; it will
 * recompute the duration through this same constructor.
 */
export type CreateVideoTimelineItemInput = Omit<
  VideoTimelineItem,
  "kind" | "durationSeconds"
>;

export const createImageTimelineItem = (
  input: CreateImageTimelineItemInput
): TimelineItemResult<ImageTimelineItem, TimelineItemTimingValidationFailure> => {
  const candidate: ImageTimelineItem = {
    ...input,
    startTimeSeconds: normalizeTinyNegativeSeconds(input.startTimeSeconds),
    durationSeconds: normalizeTinyNegativeSeconds(input.durationSeconds),
    kind: "image",
  };

  const result = validateTimelineItemTiming(candidate);

  return result.valid
    ? { ok: true, value: candidate }
    : { ok: false, error: result };
};

export const createCollectionTimelineItem = (
  input: CreateCollectionTimelineItemInput
): TimelineItemResult<
  CollectionTimelineItem,
  CollectionTimelineItemValidationFailure
> => {
  const candidate: CollectionTimelineItem = {
    ...input,
    startTimeSeconds: normalizeTinyNegativeSeconds(input.startTimeSeconds),
    durationSeconds: normalizeTinyNegativeSeconds(input.durationSeconds),
    kind: "collection",
  };

  const result = validateCollectionTimelineItem(candidate);

  return result.valid
    ? { ok: true, value: candidate }
    : { ok: false, error: result };
};

export const createVideoTimelineItem = (
  input: CreateVideoTimelineItemInput
): TimelineItemResult<VideoTimelineItem, VideoTimelineItemValidationFailure> => {
  const sourceDurationSeconds = normalizeTinyNegativeSeconds(
    input.sourceDurationSeconds
  );
  const trimInSeconds = normalizeTinyNegativeSeconds(input.trimInSeconds);
  const trimOutSeconds = normalizeTinyNegativeSeconds(input.trimOutSeconds);

  const durationSeconds = normalizeTinyNegativeSeconds(
    getVideoVisibleDurationSeconds({
      sourceDurationSeconds,
      trimInSeconds,
      trimOutSeconds,
    })
  );

  const candidate: VideoTimelineItem = {
    ...input,
    startTimeSeconds: normalizeTinyNegativeSeconds(input.startTimeSeconds),
    sourceDurationSeconds,
    trimInSeconds,
    trimOutSeconds,
    durationSeconds,
    kind: "video",
  };

  const result = validateVideoTimelineItem(candidate);

  return result.valid
    ? { ok: true, value: candidate }
    : { ok: false, error: result };
};

// --- Updates -------------------------------------------------------------
// Items are immutable, so an "update" doesn't mutate — it merges a patch
// into the existing item and reconstructs through the same factory used at
// creation. This means every edit (e.g. a trim drag) gets the identical
// validation a fresh item would, through the same `TimelineItemResult` shape
// creation does, rather than a separate, easy-to-forget update-time check.
//
// Patches intentionally do not allow changing `id`. Identity changes should be
// modeled as creating/replacing an item, not silently patching an existing one.
//
// Video patches also do not allow changing `durationSeconds` directly because
// video duration is derived from `sourceDurationSeconds`, `trimInSeconds`, and
// `trimOutSeconds`.

export type ImageTimelineItemPatch = Partial<
  Omit<ImageTimelineItem, "kind" | "id">
>;

export type CollectionTimelineItemPatch = Partial<
  Omit<CollectionTimelineItem, "kind" | "id">
>;

export type VideoTimelineItemPatch = Partial<
  Omit<VideoTimelineItem, "kind" | "id" | "durationSeconds">
>;

export const updateImageTimelineItem = (
  item: ImageTimelineItem,
  patch: ImageTimelineItemPatch
): TimelineItemResult<ImageTimelineItem, TimelineItemTimingValidationFailure> =>
  createImageTimelineItem({ ...item, ...patch });

export const updateCollectionTimelineItem = (
  item: CollectionTimelineItem,
  patch: CollectionTimelineItemPatch
): TimelineItemResult<
  CollectionTimelineItem,
  CollectionTimelineItemValidationFailure
> => createCollectionTimelineItem({ ...item, ...patch });

export const updateVideoTimelineItem = (
  item: VideoTimelineItem,
  patch: VideoTimelineItemPatch
): TimelineItemResult<VideoTimelineItem, VideoTimelineItemValidationFailure> =>
  createVideoTimelineItem({ ...item, ...patch });
import {
  type TimelineItemBase,
  type CollectionTimelineItem,
  type VideoTimelineItem,
  type ImageTimelineItem,
  type TimelineItemResult,
  type TimelineItem,
  type TimelineItemKind,
  parseTimelineItemId,
  parseCollectionId,
  assertNever,
  isCollectionItem,
  type CollectionId,
  type TimelineItemId,
  type TimelineCollection,
} from "./media-strip.types";
import { getVideoVisibleDurationSeconds } from "./media-strip.utils";

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
 * Base invariants (identity + timing) that apply to EVERY `TimelineItem`
 * variant, not just video — an image or collection card can just as easily
 * end up with a negative `startTimeSeconds`/`durationSeconds` from a bad
 * drag or an upstream calculation bug.
 */
export type TimelineItemBaseValidationResult =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; reason: "empty-id" }>
  | Readonly<{ valid: false; reason: "empty-name" }>
  | Readonly<{ valid: false; reason: "non-finite-start-time" }>
  | Readonly<{ valid: false; reason: "non-finite-duration" }>
  | Readonly<{ valid: false; reason: "negative-start-time" }>
  | Readonly<{ valid: false; reason: "negative-duration" }>;

/** Failure-only slice, so `TimelineItemResult`'s error generic can't include `{ valid: true }`. */
export type TimelineItemBaseValidationFailure = Extract<
  TimelineItemBaseValidationResult,
  { valid: false }
>;

// The base invariants are split into two halves because
// `validateVideoTimelineItem` must run the identity/start checks first but
// defer the duration checks until trim bounds are known. Sharing the halves
// (instead of the video validator re-implementing them inline) means a new
// base invariant automatically applies to every variant.

const findIdentityAndStartFailure = (
  item: TimelineItemBase
): TimelineItemBaseValidationFailure | null => {
  // Validate TimelineItemId at runtime to guarantee nominal safety
  const idResult = parseTimelineItemId(item.id);
  if (!idResult.ok) {
    return { valid: false, reason: "empty-id" };
  }

  if (typeof item.name !== "string" || item.name.trim() === "") {
    return { valid: false, reason: "empty-name" };
  }

  if (!Number.isFinite(item.startTimeSeconds)) {
    return { valid: false, reason: "non-finite-start-time" };
  }

  if (isEffectivelyNegativeSeconds(item.startTimeSeconds)) {
    return { valid: false, reason: "negative-start-time" };
  }

  return null;
};

const findDurationFailure = (
  item: TimelineItemBase
): TimelineItemBaseValidationFailure | null => {
  if (!Number.isFinite(item.durationSeconds)) {
    return { valid: false, reason: "non-finite-duration" };
  }

  if (isEffectivelyNegativeSeconds(item.durationSeconds)) {
    return { valid: false, reason: "negative-duration" };
  }

  return null;
};

export const validateTimelineItemBase = (
  item: TimelineItemBase
): TimelineItemBaseValidationResult =>
  findIdentityAndStartFailure(item) ??
  findDurationFailure(item) ?? { valid: true };

export type MediaTimelineItemValidationResult =
  | TimelineItemBaseValidationResult
  | Readonly<{ valid: false; reason: "invalid-src" }>
  | Readonly<{ valid: false; reason: "invalid-poster-srcs" }>;

export type MediaTimelineItemValidationFailure = Extract<
  MediaTimelineItemValidationResult,
  { valid: false }
>;

export type MediaItemStrings = {
  src: string;
  posterSrcs?: readonly string[];
};

export const validateMediaItemStrings = (
  item: MediaItemStrings
): MediaTimelineItemValidationResult => {
  if (typeof item.src !== "string" || item.src.trim() === "") {
    return { valid: false, reason: "invalid-src" };
  }

  if (item.posterSrcs !== undefined) {
    if (
      !Array.isArray(item.posterSrcs) ||
      item.posterSrcs.some((url) => typeof url !== "string" || url.trim() === "")
    ) {
      return { valid: false, reason: "invalid-poster-srcs" };
    }
  }

  return { valid: true };
};

export const validateImageTimelineItem = (
  item: ImageTimelineItem
): MediaTimelineItemValidationResult => {
  const baseResult = validateTimelineItemBase(item);
  if (!baseResult.valid) {
    return baseResult;
  }
  return validateMediaItemStrings(item);
};

export type CollectionTimelineItemValidationResult =
  | TimelineItemBaseValidationResult
  | Readonly<{ valid: false; reason: "empty-collection-id" }>
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
  const baseResult = validateTimelineItemBase(item);
  if (!baseResult.valid) {
    return baseResult;
  }

  // Validate CollectionId at runtime to guarantee nominal safety. Distinct
  // reason from "empty-id" so callers can tell which of the two ID fields
  // failed.
  const collectionIdResult = parseCollectionId(item.collectionId);
  if (!collectionIdResult.ok) {
    return { valid: false, reason: "empty-collection-id" };
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
  | MediaTimelineItemValidationResult
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
  // 1. Identity/start checks — the duration half of the base validation is
  // deferred to step 5, after trim bounds are known.
  const identityFailure = findIdentityAndStartFailure(item);
  if (identityFailure) {
    return identityFailure;
  }

  const mediaStringsResult = validateMediaItemStrings(item);
  if (!mediaStringsResult.valid) {
    return mediaStringsResult;
  }

  // 2. Finite checks on video-specific props
  if (!Number.isFinite(item.sourceDurationSeconds)) {
    return { valid: false, reason: "non-finite-source-duration" };
  }
  if (!Number.isFinite(item.trimInSeconds)) {
    return { valid: false, reason: "non-finite-trim-in" };
  }
  if (!Number.isFinite(item.trimOutSeconds)) {
    return { valid: false, reason: "non-finite-trim-out" };
  }

  // 3. Non-negative checks on video-specific props
  if (isEffectivelyNegativeSeconds(item.sourceDurationSeconds)) {
    return { valid: false, reason: "negative-source-duration" };
  }
  if (isEffectivelyNegativeSeconds(item.trimInSeconds)) {
    return { valid: false, reason: "negative-trim-in" };
  }
  if (isEffectivelyNegativeSeconds(item.trimOutSeconds)) {
    return { valid: false, reason: "negative-trim-out" };
  }

  // 4. Trim exceeds check
  if (
    !isApproximatelyLessThanOrEqual(
      item.trimInSeconds + item.trimOutSeconds,
      item.sourceDurationSeconds
    )
  ) {
    return { valid: false, reason: "trim-exceeds-source" };
  }

  // 5. General duration check (now safe, since we know trim <= source)
  const durationFailure = findDurationFailure(item);
  if (durationFailure) {
    return durationFailure;
  }

  // 6. Check that duration matches derived value
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

export type ValidationResultOf<T extends TimelineItem> = T extends { kind: "image" }
  ? MediaTimelineItemValidationResult
  : T extends { kind: "video" }
  ? VideoTimelineItemValidationResult
  : T extends { kind: "collection" }
  ? CollectionTimelineItemValidationResult
  : TimelineItemValidationResult;

export type TimelineItemValidationResult =
  | TimelineItemBaseValidationResult
  | MediaTimelineItemValidationResult
  | CollectionTimelineItemValidationResult
  | VideoTimelineItemValidationResult;

const validators: {
  [K in TimelineItemKind]: (item: Extract<TimelineItem, { kind: K }>) => TimelineItemValidationResult;
} = {
  image: validateImageTimelineItem,
  video: validateVideoTimelineItem,
  collection: validateCollectionTimelineItem,
};

/**
 * Validates any TimelineItem variant dynamically by dispatching to its
 * corresponding kind-specific validation logic.
 */
export function validateTimelineItem<T extends TimelineItem>(
  item: T
): ValidationResultOf<T> {
  // Safe type assertion: indexing the validators record by item.kind guarantees a match.
  // The validators map covers every K in TimelineItemKind exhaustively, and T's kind is K.
  const validator = validators[item.kind] as
    | ((item: T) => ValidationResultOf<T>)
    | undefined;
  if (!validator) {
    // Only reachable when `item` isn't really a TimelineItem (an invalid
    // `kind` from a bad cast or `unknown` data that skipped the parse
    // boundary). Throwing here is the documented behavior — parse* is the
    // safe ingestion path; see media-strip.parse.ts — but assertNever gives
    // a readable message instead of a raw "validator is not a function".
    return assertNever(item.kind as never);
  }
  return validator(item);
}

// --- Smart constructors ------------------------------------------------------
// Every variant gets a factory that validates at construction time rather
// than leaving invariants to be checked (or forgotten) later. All three
// return the same `TimelineItemResult<T, E>` envelope so calling code doesn't need a
// different shape per kind.
//
// Accept plain strings for ID properties at the factory boundary to allow callers
// to supply unbranded values, which are branded internally after successful runtime checks.

export type CreateImageTimelineItemInput = Omit<ImageTimelineItem, "kind" | "id"> & { id: string };

export type CreateCollectionTimelineItemInput = Omit<
  CollectionTimelineItem,
  "kind" | "id" | "collectionId"
> & { id: string; collectionId: string };

/**
 * `durationSeconds` is derived from `sourceDurationSeconds`, `trimInSeconds`,
 * and `trimOutSeconds` so callers can't accidentally create mismatched video
 * state. If trim values change later, use `updateVideoTimelineItem`; it will
 * recompute the duration through this same constructor.
 */
export type CreateVideoTimelineItemInput = Omit<
  VideoTimelineItem,
  "kind" | "id" | "durationSeconds"
> & { id: string };

export const createImageTimelineItem = (
  input: CreateImageTimelineItemInput
): TimelineItemResult<ImageTimelineItem, MediaTimelineItemValidationFailure> => {
  const idResult = parseTimelineItemId(input.id);
  if (!idResult.ok) {
    return { ok: false, error: { valid: false, reason: "empty-id" } };
  }

  const candidate: ImageTimelineItem = {
    ...input,
    id: idResult.value,
    startTimeSeconds: normalizeTinyNegativeSeconds(input.startTimeSeconds),
    durationSeconds: normalizeTinyNegativeSeconds(input.durationSeconds),
    kind: "image",
  };

  const result = validateImageTimelineItem(candidate);

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
  const idResult = parseTimelineItemId(input.id);
  if (!idResult.ok) {
    return { ok: false, error: { valid: false, reason: "empty-id" } };
  }

  const collectionIdResult = parseCollectionId(input.collectionId);
  if (!collectionIdResult.ok) {
    return { ok: false, error: { valid: false, reason: "empty-collection-id" } };
  }

  const candidate: CollectionTimelineItem = {
    ...input,
    id: idResult.value,
    collectionId: collectionIdResult.value,
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
  const idResult = parseTimelineItemId(input.id);
  if (!idResult.ok) {
    return { ok: false, error: { valid: false, reason: "empty-id" } };
  }

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
    id: idResult.value,
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
): TimelineItemResult<ImageTimelineItem, MediaTimelineItemValidationFailure> =>
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

export type TimelineCollectionValidationResult =
  | Readonly<{ valid: true }>
  | Readonly<{ valid: false; reason: "empty-id" }>
  | Readonly<{ valid: false; reason: "empty-name" }>
  | Readonly<{ valid: false; reason: "items-not-array" }>
  | Readonly<{ valid: false; reason: "invalid-item"; item: TimelineItem; error: TimelineItemValidationResult }>
  | Readonly<{ valid: false; reason: "duplicate-item-ids" }>;

export function validateTimelineCollection(
  collection: TimelineCollection
): TimelineCollectionValidationResult {
  const collectionIdResult = parseCollectionId(collection.id);
  if (!collectionIdResult.ok) {
    return { valid: false, reason: "empty-id" };
  }
  if (typeof collection.name !== "string" || collection.name.trim() === "") {
    return { valid: false, reason: "empty-name" };
  }
  if (!Array.isArray(collection.items)) {
    return { valid: false, reason: "items-not-array" };
  }

  const seenIds = new Set<TimelineItemId>();
  for (const item of collection.items) {
    const itemValidation = validateTimelineItem(item);
    if (!itemValidation.valid) {
      return { valid: false, reason: "invalid-item", item, error: itemValidation };
    }
    if (seenIds.has(item.id)) {
      return { valid: false, reason: "duplicate-item-ids" };
    }
    seenIds.add(item.id);
  }

  return { valid: true };
}



export function wouldCreateCollectionCycle({
  movingCollectionId,
  targetCollectionId,
  collectionsById,
}: {
  movingCollectionId: CollectionId;
  targetCollectionId: CollectionId;
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>;
}): boolean {
  if (movingCollectionId === targetCollectionId) {
    return true;
  }

  // Iterative DFS (explicit stack) rather than recursion: this ingests
  // externally-supplied graphs, and a pathologically deep collection chain
  // would blow the call stack before the visited-set could stop it.
  const visited = new Set<CollectionId>();
  const stack: CollectionId[] = [movingCollectionId];

  while (stack.length > 0) {
    const currentId = stack.pop()!;
    if (currentId === targetCollectionId) {
      return true;
    }
    if (visited.has(currentId)) {
      continue;
    }
    visited.add(currentId);

    const col = collectionsById.get(currentId);
    if (!col) continue;

    for (const item of col.items) {
      if (isCollectionItem(item)) {
        stack.push(item.collectionId);
      }
    }
  }

  return false;
}


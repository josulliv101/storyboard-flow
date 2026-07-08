import {
  type TimelineItem,
  type TimelineCollection,
  type TimelineCollectionsById,
  type CollectionId,
  type TimelineItemResult,
  parseCollectionId,
} from "./media-strip.types";
import {
  createImageTimelineItem,
  createVideoTimelineItem,
  createCollectionTimelineItem,
  validateTimelineCollection,
  type MediaTimelineItemValidationFailure,
  type VideoTimelineItemValidationFailure,
  type CollectionTimelineItemValidationFailure,
  type TimelineCollectionValidationResult,
} from "./media-strip.validation";

// This module is the boundary for genuinely untrusted `unknown` data (an API
// response, a parsed JSON file, anything not already known to be shaped like
// a TimelineItem). `validateTimelineItem` and friends in
// media-strip.validation.ts are NOT that boundary: they check field *values*
// (empty strings, negative durations, mismatched trim math) but assume the
// object already has a valid discriminated-union shape. Concretely,
// `validateTimelineItem` dispatches via `validators[item.kind]` — if `kind`
// is missing or isn't one of the three valid strings, that dispatch throws a
// raw TypeError instead of returning a validation failure. The functions
// here never throw regardless of input shape; that's the whole point.
//
// Two-phase design per function: cheap structural/type checks first (is this
// even an object, does `kind` exist and match, are the fields the right
// primitive JS type), each with its own error reason — THEN, only once the
// shape is safe to read, delegate to the existing smart constructors /
// validateTimelineCollection for the value-level checks (empty/negative/
// mismatched-trim/etc.), so that logic isn't duplicated.

// --- Shape-check helpers -----------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type TimelineItemFieldShapeError = Readonly<{
  reason: "invalid-field";
  field: string;
  expected: "string" | "number" | "string[]";
}>;

function requireStringField(
  obj: Record<string, unknown>,
  field: string
): TimelineItemFieldShapeError | null {
  return typeof obj[field] === "string" ? null : { reason: "invalid-field", field, expected: "string" };
}

function requireNumberField(
  obj: Record<string, unknown>,
  field: string
): TimelineItemFieldShapeError | null {
  return typeof obj[field] === "number" ? null : { reason: "invalid-field", field, expected: "number" };
}

function requireOptionalStringArrayField(
  obj: Record<string, unknown>,
  field: string
): TimelineItemFieldShapeError | null {
  const value = obj[field];
  if (value === undefined) return null;
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return { reason: "invalid-field", field, expected: "string[]" };
  }
  return null;
}

// --- parseTimelineItem --------------------------------------------------------

export type TimelineItemParseError =
  | Readonly<{ reason: "not-an-object" }>
  | Readonly<{ reason: "missing-kind" }>
  | Readonly<{ reason: "invalid-kind"; kind: unknown }>
  | TimelineItemFieldShapeError
  | Readonly<{
    reason: "invalid-value";
    error: MediaTimelineItemValidationFailure | VideoTimelineItemValidationFailure | CollectionTimelineItemValidationFailure;
  }>;

/**
 * Parses genuinely `unknown` input into a `TimelineItem`. Never throws — a
 * malformed or missing `kind`, wrong-typed fields, or failed value
 * validation all come back as a typed `TimelineItemParseError`, not an
 * exception. Use this (not `validateTimelineItem`) at the actual ingestion
 * boundary — where you don't yet know the data is shaped correctly.
 */
export function parseTimelineItem(input: unknown): TimelineItemResult<TimelineItem, TimelineItemParseError> {
  if (!isPlainObject(input)) {
    return { ok: false, error: { reason: "not-an-object" } };
  }

  if (!("kind" in input)) {
    return { ok: false, error: { reason: "missing-kind" } };
  }

  const kind = input.kind;
  if (kind !== "image" && kind !== "video" && kind !== "collection") {
    return { ok: false, error: { reason: "invalid-kind", kind } };
  }

  const idErr = requireStringField(input, "id");
  if (idErr) return { ok: false, error: idErr };
  const nameErr = requireStringField(input, "name");
  if (nameErr) return { ok: false, error: nameErr };
  const startErr = requireNumberField(input, "startTimeSeconds");
  if (startErr) return { ok: false, error: startErr };

  if (kind === "collection") {
    const collectionIdErr = requireStringField(input, "collectionId");
    if (collectionIdErr) return { ok: false, error: collectionIdErr };
    const itemCountErr = requireNumberField(input, "itemCount");
    if (itemCountErr) return { ok: false, error: itemCountErr };
    const durationErr = requireNumberField(input, "durationSeconds");
    if (durationErr) return { ok: false, error: durationErr };

    const result = createCollectionTimelineItem({
      id: input.id as string,
      name: input.name as string,
      collectionId: input.collectionId as string,
      itemCount: input.itemCount as number,
      startTimeSeconds: input.startTimeSeconds as number,
      durationSeconds: input.durationSeconds as number,
    });
    return result.ok ? result : { ok: false, error: { reason: "invalid-value", error: result.error } };
  }

  // image and video share the media fields (src, optional posterSrcs).
  const srcErr = requireStringField(input, "src");
  if (srcErr) return { ok: false, error: srcErr };
  const posterSrcsErr = requireOptionalStringArrayField(input, "posterSrcs");
  if (posterSrcsErr) return { ok: false, error: posterSrcsErr };

  if (kind === "image") {
    const durationErr = requireNumberField(input, "durationSeconds");
    if (durationErr) return { ok: false, error: durationErr };

    const result = createImageTimelineItem({
      id: input.id as string,
      name: input.name as string,
      src: input.src as string,
      posterSrcs: input.posterSrcs as readonly string[] | undefined,
      startTimeSeconds: input.startTimeSeconds as number,
      durationSeconds: input.durationSeconds as number,
    });
    return result.ok ? result : { ok: false, error: { reason: "invalid-value", error: result.error } };
  }

  // kind === "video"
  const sourceDurationErr = requireNumberField(input, "sourceDurationSeconds");
  if (sourceDurationErr) return { ok: false, error: sourceDurationErr };
  const trimInErr = requireNumberField(input, "trimInSeconds");
  if (trimInErr) return { ok: false, error: trimInErr };
  const trimOutErr = requireNumberField(input, "trimOutSeconds");
  if (trimOutErr) return { ok: false, error: trimOutErr };

  const result = createVideoTimelineItem({
    id: input.id as string,
    name: input.name as string,
    src: input.src as string,
    posterSrcs: input.posterSrcs as readonly string[] | undefined,
    startTimeSeconds: input.startTimeSeconds as number,
    sourceDurationSeconds: input.sourceDurationSeconds as number,
    trimInSeconds: input.trimInSeconds as number,
    trimOutSeconds: input.trimOutSeconds as number,
  });
  return result.ok ? result : { ok: false, error: { reason: "invalid-value", error: result.error } };
}

// --- parseTimelineCollection ---------------------------------------------------

export type TimelineCollectionParseError =
  | Readonly<{ reason: "not-an-object" }>
  | TimelineItemFieldShapeError
  | Readonly<{ reason: "items-not-an-array" }>
  | Readonly<{ reason: "invalid-item"; index: number; error: TimelineItemParseError }>
  | Readonly<{ reason: "invalid-value"; validation: TimelineCollectionValidationResult }>;

/**
 * Parses genuinely `unknown` input into a `TimelineCollection`, parsing
 * every entry in `items` through `parseTimelineItem` and then running the
 * whole candidate through `validateTimelineCollection` (duplicate item ids,
 * per-item value validation) before accepting it. Never throws.
 */
export function parseTimelineCollection(
  input: unknown
): TimelineItemResult<TimelineCollection, TimelineCollectionParseError> {
  if (!isPlainObject(input)) {
    return { ok: false, error: { reason: "not-an-object" } };
  }

  const idErr = requireStringField(input, "id");
  if (idErr) return { ok: false, error: idErr };
  const nameErr = requireStringField(input, "name");
  if (nameErr) return { ok: false, error: nameErr };

  if (!Array.isArray(input.items)) {
    return { ok: false, error: { reason: "items-not-an-array" } };
  }

  const parsedItems: TimelineItem[] = [];
  for (let index = 0; index < input.items.length; index++) {
    const itemResult = parseTimelineItem(input.items[index]);
    if (!itemResult.ok) {
      return { ok: false, error: { reason: "invalid-item", index, error: itemResult.error } };
    }
    parsedItems.push(itemResult.value);
  }

  const idParsed = parseCollectionId(input.id as string);
  if (!idParsed.ok) {
    return { ok: false, error: { reason: "invalid-value", validation: { valid: false, reason: "empty-id" } } };
  }

  const candidate: TimelineCollection = {
    id: idParsed.value,
    name: input.name as string,
    items: parsedItems,
  };

  const validation = validateTimelineCollection(candidate);
  if (!validation.valid) {
    return { ok: false, error: { reason: "invalid-value", validation } };
  }

  return { ok: true, value: candidate };
}

// --- parseTimelineCollectionsById ----------------------------------------------

export type TimelineCollectionsByIdParseError =
  | Readonly<{ reason: "not-an-object" }>
  | Readonly<{ reason: "invalid-collection"; key: string; error: TimelineCollectionParseError }>;

/**
 * Parses genuinely `unknown` input into a `TimelineCollectionsById`. Expects
 * the wire format a `Map` naturally serializes to as plain JSON: an object
 * keyed by collection id, each value a raw (unparsed) collection —
 * `{ "col-a": { id: "col-a", name: "...", items: [...] }, ... }`. This is a
 * deliberate format choice for this parser, not dictated by anything else in
 * the codebase; adjust here if your wire format differs (e.g. an array of
 * `[id, collection]` entries).
 */
export function parseTimelineCollectionsById(
  input: unknown
): TimelineItemResult<TimelineCollectionsById, TimelineCollectionsByIdParseError> {
  if (!isPlainObject(input)) {
    return { ok: false, error: { reason: "not-an-object" } };
  }

  const result = new Map<CollectionId, TimelineCollection>();
  for (const [key, rawCollection] of Object.entries(input)) {
    const parsed = parseTimelineCollection(rawCollection);
    if (!parsed.ok) {
      return { ok: false, error: { reason: "invalid-collection", key, error: parsed.error } };
    }
    result.set(parsed.value.id, parsed.value);
  }

  return { ok: true, value: result };
}

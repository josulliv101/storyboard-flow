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

// The field helpers return the *narrowed* value on success rather than
// error-or-null, so a caller reads `result.value` (typed) instead of
// re-asserting `input.id as string` after the check — the "checked,
// therefore this type" relationship is enforced by TS, not by a cast at
// every call site.
type FieldResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: TimelineItemFieldShapeError }>;

function getStringField(obj: Record<string, unknown>, field: string): FieldResult<string> {
  const value = obj[field];
  return typeof value === "string"
    ? { ok: true, value }
    : { ok: false, error: { reason: "invalid-field", field, expected: "string" } };
}

function getNumberField(obj: Record<string, unknown>, field: string): FieldResult<number> {
  const value = obj[field];
  return typeof value === "number"
    ? { ok: true, value }
    : { ok: false, error: { reason: "invalid-field", field, expected: "number" } };
}

function getOptionalStringArrayField(
  obj: Record<string, unknown>,
  field: string
): FieldResult<readonly string[] | undefined> {
  const value = obj[field];
  if (value === undefined) return { ok: true, value: undefined };
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    return { ok: false, error: { reason: "invalid-field", field, expected: "string[]" } };
  }
  // The `every` check above establishes this at runtime; TS can't narrow an
  // `unknown[]` from a predicate, so this one cast is unavoidable — but it's
  // localized to the helper, right next to the check that proves it.
  return { ok: true, value: value as readonly string[] };
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

  const id = getStringField(input, "id");
  if (!id.ok) return id;
  const name = getStringField(input, "name");
  if (!name.ok) return name;
  const startTimeSeconds = getNumberField(input, "startTimeSeconds");
  if (!startTimeSeconds.ok) return startTimeSeconds;

  if (kind === "collection") {
    const collectionId = getStringField(input, "collectionId");
    if (!collectionId.ok) return collectionId;
    const itemCount = getNumberField(input, "itemCount");
    if (!itemCount.ok) return itemCount;
    const durationSeconds = getNumberField(input, "durationSeconds");
    if (!durationSeconds.ok) return durationSeconds;

    const result = createCollectionTimelineItem({
      id: id.value,
      name: name.value,
      collectionId: collectionId.value,
      itemCount: itemCount.value,
      startTimeSeconds: startTimeSeconds.value,
      durationSeconds: durationSeconds.value,
    });
    return result.ok ? result : { ok: false, error: { reason: "invalid-value", error: result.error } };
  }

  // image and video share the media fields (src, optional posterSrcs).
  const src = getStringField(input, "src");
  if (!src.ok) return src;
  const posterSrcs = getOptionalStringArrayField(input, "posterSrcs");
  if (!posterSrcs.ok) return posterSrcs;

  if (kind === "image") {
    const durationSeconds = getNumberField(input, "durationSeconds");
    if (!durationSeconds.ok) return durationSeconds;

    const result = createImageTimelineItem({
      id: id.value,
      name: name.value,
      src: src.value,
      posterSrcs: posterSrcs.value,
      startTimeSeconds: startTimeSeconds.value,
      durationSeconds: durationSeconds.value,
    });
    return result.ok ? result : { ok: false, error: { reason: "invalid-value", error: result.error } };
  }

  // kind === "video"
  const sourceDurationSeconds = getNumberField(input, "sourceDurationSeconds");
  if (!sourceDurationSeconds.ok) return sourceDurationSeconds;
  const trimInSeconds = getNumberField(input, "trimInSeconds");
  if (!trimInSeconds.ok) return trimInSeconds;
  const trimOutSeconds = getNumberField(input, "trimOutSeconds");
  if (!trimOutSeconds.ok) return trimOutSeconds;

  const result = createVideoTimelineItem({
    id: id.value,
    name: name.value,
    src: src.value,
    posterSrcs: posterSrcs.value,
    startTimeSeconds: startTimeSeconds.value,
    sourceDurationSeconds: sourceDurationSeconds.value,
    trimInSeconds: trimInSeconds.value,
    trimOutSeconds: trimOutSeconds.value,
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

  const id = getStringField(input, "id");
  if (!id.ok) return id;
  const name = getStringField(input, "name");
  if (!name.ok) return name;

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

  const idParsed = parseCollectionId(id.value);
  if (!idParsed.ok) {
    return { ok: false, error: { reason: "invalid-value", validation: { valid: false, reason: "empty-id" } } };
  }

  const candidate: TimelineCollection = {
    id: idParsed.value,
    name: name.value,
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
  | Readonly<{ reason: "invalid-collection"; key: string; error: TimelineCollectionParseError }>
  | Readonly<{ reason: "collection-id-key-mismatch"; key: string; collectionId: CollectionId }>;

/**
 * Parses genuinely `unknown` input into a `TimelineCollectionsById`. Expects
 * the wire format a `Map` naturally serializes to as plain JSON: an object
 * keyed by collection id, each value a raw (unparsed) collection —
 * `{ "col-a": { id: "col-a", name: "...", items: [...] }, ... }`. This is a
 * deliberate format choice for this parser, not dictated by anything else in
 * the codebase; adjust here if your wire format differs (e.g. an array of
 * `[id, collection]` entries).
 *
 * The result map is keyed by the *parsed* collection's `id`, so the object
 * key must agree with it — otherwise the entry would silently land under a
 * different key than the caller wrote (`{ "col-a": { id: "col-b" } }` keying
 * under `col-b`). That's rejected rather than papered over: this is a
 * genuinely-untrusted boundary, and a key/id disagreement means the source
 * data is already inconsistent. Enforcing key===id also rules out the
 * silent-overwrite-on-duplicate-id hazard for free: object keys are unique,
 * so once every id must equal its (unique) key, no two entries can share an
 * id — a duplicate id can only arrive as a key mismatch, caught below.
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

    // Branded CollectionId is a string at runtime; compare structurally.
    if (parsed.value.id !== key) {
      return { ok: false, error: { reason: "collection-id-key-mismatch", key, collectionId: parsed.value.id } };
    }

    result.set(parsed.value.id, parsed.value);
  }

  return { ok: true, value: result };
}

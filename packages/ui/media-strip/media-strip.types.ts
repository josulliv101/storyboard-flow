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
declare const timelineItemIdBrand: unique symbol;
declare const collectionIdBrand: unique symbol;

export type TimelineItemId = string & {
  readonly [timelineItemIdBrand]: true;
};

export type CollectionId = string & {
  readonly [collectionIdBrand]: true;
};

export const asTimelineItemId = (
  id: string
): TimelineItemResult<TimelineItemId, "empty-id"> => {
  if (!id || !id.trim()) {
    return { ok: false, error: "empty-id" };
  }
  return { ok: true, value: id as TimelineItemId };
};

export const asCollectionId = (
  id: string
): TimelineItemResult<CollectionId, "empty-id"> => {
  if (!id || !id.trim()) {
    return { ok: false, error: "empty-id" };
  }
  return { ok: true, value: id as CollectionId };
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
    /** Optional sequence of thumbnail/poster overrides. */
    posterSrcs?: readonly string[];
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

// --- TimelineItemResult ---------------------------------------------------------

/**
 * Shared success/failure envelope so every factory returns the same
 * shape regardless of kind. Without this, a caller can't tell a valid
 * `VideoTimelineItem` apart from a failed `VideoTimelineItemValidationResult`
 * without an awkward structural check (e.g. `"kind" in result`) — `ok` makes
 * that explicit and lets every factory be handled the same way:
 *
 *   const result = createImageTimelineItem(input);
 *   if (!result.ok) { report(result.error); return; }
 *   use(result.value);
 *
 * Note on `__itemResult`: This is a phantom field (a type-level nominal marker)
 * present on both union branches. It prevents structural TypeScript collapse
 * between the success and failure shapes in cases where T and E might structurally
 * overlap (e.g. if both are objects with similar optional fields or empty interfaces).
 */
export type TimelineItemResult<T, E> =
  | Readonly<{ ok: true; value: T; readonly __itemResult?: never }>
  | Readonly<{ ok: false; error: E; readonly __itemResult?: never }>;

/**
 * Represents a drag-and-drop or keyboard-triggered movement of a timeline item
 * from one media strip to another (or within the same strip).
 */
export type MediaStripMove = {
  /** The unique identifier of the timeline item being moved. */
  itemId: TimelineItemId;
  /**
   * The identifier of the source strip. This is a plain string because strip IDs
   * are caller-supplied container keys (e.g., dictionary keys in the host application)
   * rather than domain data managed/validated directly by this package.
   */
  fromStripId: string;
  /**
   * The identifier of the destination strip. Like `fromStripId`, this is a plain
   * string representing a caller-supplied container key.
   */
  toStripId: string;
  /** The 0-based index of the item within the source strip before the move. */
  fromIndex: number;
  /** The 0-based index of the item within the destination strip after the move. */
  toIndex: number;
};
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

type BrandedString<TBrand extends symbol> = string & {
  readonly [K in TBrand]: true;
};

export type TimelineItemId = BrandedString<typeof timelineItemIdBrand>;
export type CollectionId = BrandedString<typeof collectionIdBrand>;

// The runtime check is intentionally just "non-empty": IDs have no further
// format guarantees. The nominal distinction between the two ID types is
// enforced at compile time only — any non-empty string parses as either.
const isNonEmptyString = (value: string): boolean => !!value && !!value.trim();

const isValidTimelineId = (id: string): id is TimelineItemId =>
  isNonEmptyString(id);

const isValidCollectionId = (id: string): id is CollectionId =>
  isNonEmptyString(id);

export const parseTimelineItemId = (
  id: string
): TimelineItemResult<TimelineItemId, "empty-id"> => {
  if (isValidTimelineId(id)) {
    return { ok: true, value: id };
  }
  return { ok: false, error: "empty-id" };
};

export const parseCollectionId = (
  id: string
): TimelineItemResult<CollectionId, "empty-id"> => {
  if (isValidCollectionId(id)) {
    return { ok: true, value: id };
  }
  return { ok: false, error: "empty-id" };
};

// Parse-or-throw conveniences for IDs that are trusted at authoring time
// (string literals in stories/tests, framework-generated ids). These exist so
// call sites never need an `as TimelineItemId` / `as CollectionId` cast — use
// the `parse*` variants instead when the input is genuinely untrusted and the
// caller can handle failure.

export const asTimelineItemId = (id: string): TimelineItemId => {
  const result = parseTimelineItemId(id);
  if (!result.ok) {
    throw new Error(`Invalid TimelineItemId: ${JSON.stringify(id)} (${result.error})`);
  }
  return result.value;
};

export const asCollectionId = (id: string): CollectionId => {
  const result = parseCollectionId(id);
  if (!result.ok) {
    throw new Error(`Invalid CollectionId: ${JSON.stringify(id)} (${result.error})`);
  }
  return result.value;
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
    /**
     * Display-only fallback count for when the backing collection isn't
     * loaded. The backing collection's `items.length` is the source of
     * truth — derive from it whenever it's available (see
     * `MediaStripThumbnail`), and use `syncCollectionItemCounts` to refresh
     * this snapshot after collection ops.
     */
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
 * The `ok` literal is the discriminant; narrowing on it fully separates the
 * two branches regardless of whether T and E structurally overlap.
 */
export type TimelineItemResult<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;



export type TimelineCollection = Readonly<{
  id: CollectionId;
  name: string;
  items: readonly TimelineItem[];
}>;

export type TimelineCollectionsById = ReadonlyMap<CollectionId, TimelineCollection>;

export type TimelineItemCommand =
  | Readonly<{
    type: "move";
    itemId: TimelineItemId;
    fromCollectionId: CollectionId;
    toCollectionId: CollectionId;
    /**
     * Final insertion index after the source item has been removed. For
     * cross-collection moves this is the destination collection insertion
     * index; for same-collection moves it is the resulting item index.
     */
    toIndex: number;
  }>
  | Readonly<{
    type: "nest";
    itemId: TimelineItemId;
    fromCollectionId: CollectionId;
    targetCollectionId: CollectionId;
    toIndex?: number;
  }>;

export type DndTarget =
  | Readonly<{ type: "item"; itemId: TimelineItemId }>
  | Readonly<{ type: "collection-container"; collectionId: CollectionId }>
  | Readonly<{ type: "collection-nest-target"; collectionId: CollectionId }>;

/**
 * Where a drop will land, resolved unambiguously from raw pointer/collision
 * data during a drag. Every adapter funnels through this same union so a
 * consumer (the command resolver today, a future "drop here" visual
 * indicator eventually) never has to re-derive "before, after, or inside?"
 * from an item id and a hotspot flag — the type itself rules out the
 * confusion between "insert next to this item" and "nest into this item".
 */
export type DropPlacement =
  | Readonly<{ kind: "before"; itemId: TimelineItemId }>
  | Readonly<{ kind: "after"; itemId: TimelineItemId }>
  | Readonly<{ kind: "inside"; collectionId: CollectionId }>
  | Readonly<{ kind: "container-end"; collectionId: CollectionId }>;

export type KeyboardReorderAction =
  | "move-left"
  | "move-right"
  | "move-up"
  | "move-down"
  | "move-home"
  | "move-end"
  | "nest"
  | "move-to-parent"
  | "confirm"
  | "cancel";

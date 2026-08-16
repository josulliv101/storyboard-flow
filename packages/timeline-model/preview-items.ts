// THE FRAMES A COLLECTION CARD BORROWS, defended rather than trusted.
//
// A collection has no art of its own, so it stores up to three frames taken
// from its media descendants. Both writers that DERIVE those frames already
// refuse audio — `previewItemsFrom` filters to `isVisualClip`, and the graph
// adapter's live walk skips `mediaKind === "audio"` — because an audio source
// has a `src` and would otherwise be painted as an <img> pointing at a .flac.
//
// Neither of those guards helps a document that already contains one. An
// UNHYDRATED collection's stored frames are carried through to the next write
// verbatim (nobody has loaded its children, so there is nothing to re-derive
// from), and the write gate rejects a preview item whose kind is not a picture.
// So one legacy audio frame, written before those guards existed, made every
// batch containing that collection fail:
//
//   POST /api/timelines/batch -> 400 Every batch write needs a valid timeline
//                                    document.
//
// The collection in question sat in the TRASH BIN, which every delete rewrites.
// The delete applied to the board, the save 400ed, and the whole batch — the
// source collection, the project, the bin — rolled back. Deleting anything was
// impossible, and the reason was one unpaintable frame on an unrelated item
// nobody had opened in weeks.
//
// A stored value that the write gate will reject must never be carried forward
// untouched. So the predicate lives HERE and is shared: `validate` refuses a
// document that contains a bad frame (a writer that produced one skipped a
// step, and waving it through is how it spreads), while `previewItemsOf` drops
// it on the way through, so the next write self-heals the document instead of
// failing forever.

/**
 * Mirrors `MediaKind`, declared here rather than imported so this module stays
 * a leaf that `types.ts` can depend on — the shape `layer-frame.ts` and
 * `render-format.ts` already follow.
 *
 * Restating it is also the point: a preview item is a PICTURE. If `MediaKind`
 * ever grows a third kind, that kind has to be admitted here deliberately
 * rather than inherited into a slot that gets painted as an image. The test
 * pins the two together so the restatement cannot silently drift.
 */
export type PreviewItemKind = "image" | "video";

/** One borrowed frame: exactly the fields a collection card paints. */
export type CollectionPreviewItem = {
  id: string;
  kind: PreviewItemKind;
  src: string;
  poster?: string;
  /** Source-time offset represented by a video preview. Absent means 0. */
  trimIn?: number;
  alt: string;
};

/**
 * Whether one stored entry is a frame this app can paint.
 *
 * The rules are exactly the ones the write gate applied before this module
 * existed — deliberately not tightened. `id`, `src` and `alt` may be empty
 * strings here; refusing those would start rejecting documents that save fine
 * today, which is a separate decision from the one this file exists to make.
 */
export function isPreviewItem(value: unknown): value is CollectionPreviewItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    (item.kind === "image" || item.kind === "video") &&
    typeof item.src === "string" &&
    typeof item.alt === "string" &&
    (item.poster == null || typeof item.poster === "string") &&
    (item.trimIn == null ||
      (typeof item.trimIn === "number" && Number.isFinite(item.trimIn) && item.trimIn >= 0))
  );
}

/**
 * Stored preview frames with anything unpaintable removed.
 *
 * ABSENT AND EMPTY STAY DIFFERENT. `resolveCollectionPreviews` chooses between
 * the stored frames and a live walk with `stored ?? live`, so collapsing an
 * empty list to `undefined` would change which one wins for a collection that
 * genuinely stores none. A list that loses every entry therefore returns `[]`
 * — it is still a stored answer, and the honest one for a collection whose
 * only frame was a sound file: the card goes blank, which is what an audio
 * collection looks like.
 *
 * Returns the ORIGINAL array when nothing was dropped, so the common path
 * neither allocates nor changes identity.
 */
export function previewItemsOf(value: unknown): CollectionPreviewItem[] | undefined {
  // Not a list at all — including null/undefined — is the same as having none.
  if (!Array.isArray(value)) return undefined;
  const kept = value.filter(isPreviewItem);
  return kept.length === value.length ? (value as CollectionPreviewItem[]) : kept;
}

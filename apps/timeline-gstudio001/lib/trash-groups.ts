import type { TimelineClip } from "@storyboard/timeline-model/types";

export type TrashGroup = Readonly<{
  /** Stable identity for the group — a React key and nothing more. */
  key: string;
  /** Every trashed clip that is the same underlying asset, in bin order. */
  clips: readonly TimelineClip[];
}>;

/**
 * What makes two trashed clips "the same image".
 *
 * `sourceAsset` first, because that is the provenance the asset panel records
 * and it survives a URL changing — it is what the clip IS. `src` is the
 * fallback for clips minted before that was tracked, and for media that never
 * came through a provider (a direct OS drop). Everything else falls back to
 * the clip's own id, which groups nothing: a collection is not a duplicate of
 * another collection just because neither has a src.
 */
function assetIdentity(clip: TimelineClip): string {
  // Narrowed rather than cast: `sourceAsset` and `src` live on the MEDIA
  // variants, and a collection clip has neither.
  const ref = clip.kind === "collection" ? undefined : clip.sourceAsset;
  if (ref) return `asset:${ref.providerId}:${ref.assetId}`;
  const src = clip.kind === "collection" ? undefined : clip.src;
  if (src) return `src:${src}`;
  return `clip:${clip.id}`;
}

/** The title a collection is minted with (graph-native-drop seeds both the node
 *  name and the child document with it). A collection still wearing it has
 *  never been named by anyone. */
const UNTOUCHED_COLLECTION_TITLE = "New Timeline";

/**
 * A collection nobody ever did anything to: no items, never renamed (PL14-008).
 *
 * The bin exists to give work back, and one of these is not work — it is what
 * you get from mis-clicking the Collection tool. Filling the drawer with shells
 * makes it worse at the one job it has, so they are not shown.
 *
 * Deliberately CONSERVATIVE, because the cost of the two mistakes is not
 * symmetric: hiding something the user wanted back is unrecoverable from the
 * drawer, while showing one extra shell is merely untidy. So both conditions
 * must hold, and anything else is treated as real work —
 *
 * - a RENAMED empty collection is shown (the name is the work), and
 * - a collection that once held content is shown, because its children travel
 *   into the bin with it, so `itemCount > 0` still reads true in there.
 *
 * This hides them from the DRAWER only. They are still ordinary trashed nodes
 * in the document, undo still restores them, and emptying the bin still takes
 * them — nothing about the delete path changed, which is the whole reason this
 * is a display rule and not a new engine command.
 */
export function isUntouchedEmptyCollection(clip: TimelineClip): boolean {
  return (
    clip.kind === "collection" &&
    clip.itemCount === 0 &&
    clip.title.trim() === UNTOUCHED_COLLECTION_TITLE
  );
}

/**
 * What the drawer should treat as its contents — everything trashed except the
 * shells above.
 *
 * Applied once, to the whole list, so the row count, the empty state and the
 * rows themselves cannot disagree. Filtering only the rendered list would have
 * left the header counting items the user cannot see.
 */
export function visibleTrashClips(
  clips: readonly TimelineClip[],
): readonly TimelineClip[] {
  return clips.filter((clip) => !isUntouchedEmptyCollection(clip));
}

/**
 * Collapse repeats of one asset into a single row.
 *
 * Placing the same image twice is ordinary, and duplicating a clip copies its
 * `src` verbatim — so deleting a clip and its copy puts two entries in the bin
 * that are identical in every field the drawer paints. Two indistinguishable
 * rows with two identical Restore buttons is a worse answer than one row and
 * one button.
 *
 * Grouping is for DISPLAY only — the document still holds every entry, and
 * restoring the row restores all of them. That is what keeps this from being
 * the data loss that actually deduplicating would be: a bin gives back what
 * you put in.
 *
 * First-appearance order is preserved, so the bin still reads chronologically.
 */
export function groupTrashClips(clips: readonly TimelineClip[]): readonly TrashGroup[] {
  const byIdentity = new Map<string, TimelineClip[]>();
  for (const clip of clips) {
    const key = assetIdentity(clip);
    const existing = byIdentity.get(key);
    if (existing) existing.push(clip);
    else byIdentity.set(key, [clip]);
  }
  return [...byIdentity].map(([key, group]) => ({ key, clips: group }));
}

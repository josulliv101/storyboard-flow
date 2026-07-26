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

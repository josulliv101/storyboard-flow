import {
  CLIP_GAP_SECONDS,
  TIMELINE_LEADING_PADDING_SECONDS,
} from "@storyboard/timeline-model/constants";
import {
  collectionSpanSeconds,
  effectiveDocument,
  enabledClips,
  packTimelineClips,
  previewItemsFrom,
} from "@storyboard/timeline-model";
import type {
  CollectionTimelineClip,
  TimelineDocument,
} from "@storyboard/timeline-model/types";

// Read-time derivation of collection-clip summaries (review finding: stale
// parents). A collection clip stores DENORMALIZED child facts — title,
// itemCount, previewItems, duration — and the graph view's patch-scoped
// writes only touch the directly edited document, so a child edit leaves
// every referring parent's stored summary stale. Rather than maintaining a
// reverse-reference index and widening every write, the summaries are
// recomputed when a document is SERVED: every view loads through the same
// GET route, so no reader ever sees a stale summary, and the stored fields
// become a cache that regenerates on read.
//
// The recompute mirrors the legacy store's own
// `syncParentCollectionsInState` exactly (same previewItemsFrom, same
// duration formula, same repack) so the two write paths can't drift apart.
//
// Served, not persisted: writing back on every GET would add load and
// races for a value the next GET rederives anyway.

/**
 * The playable span of a document — leading padding, each enabled clip's
 * playable length, one gap between neighbours.
 *
 * Not simply `collectionSpanSeconds(enabledClips(...))`: a nested COLLECTION
 * child is enabled yet may itself contain disabled descendants, and its
 * `duration` is the layout span that counts them. Reading its own
 * `playableDuration` is what carries a deep disable up through every ancestor
 * — `deriveClosureSummaries` derives children first, so by the time a parent
 * is summarized its collection children already carry the right number.
 */
function playableSpanOf(document: TimelineDocument): number {
  const enabled = enabledClips(document.clips);
  if (enabled.length === 0) return 3;
  const content = enabled.reduce(
    (total, clip) =>
      total +
      (clip.kind === "collection" ? (clip.playableDuration ?? clip.duration) : clip.duration),
    0,
  );
  return (
    TIMELINE_LEADING_PADDING_SECONDS + content + CLIP_GAP_SECONDS * (enabled.length - 1)
  );
}

/**
 * Preview media in playback order, including summaries carried by nested
 * collection clips. The closure pass derives children before parents, so a
 * grandchild video poster can bubble all the way to the root without loading
 * that branch again when the root card is later rendered.
 */
function nestedPreviewItemsFrom(clips: readonly TimelineDocument["clips"][number][]) {
  const nested = clips.flatMap((clip) =>
    clip.kind === "collection"
      ? (clip.previewItems ?? [])
      : previewItemsFrom([clip]),
  );
  if (nested.length <= 3) return nested;
  // Indices then a bounds check, matching `previewItemsFrom` and
  // `hydratedCollectionPreviews` — this projection is PERSISTED, so a hole
  // would write a summary entry with undefined fields.
  return [0, Math.floor(nested.length / 2), nested.length - 1].flatMap(
    (index) => nested[index] ?? [],
  );
}

export function deriveCollectionSummaries(
  document: TimelineDocument,
  childDocuments: ReadonlyMap<string, TimelineDocument | null>,
): { document: TimelineDocument; changed: boolean } {
  let changed = false;

  const clips = document.clips.map((clip) => {
    if (clip.kind !== "collection") return clip;
    const child = childDocuments.get(clip.childTimelineId);
    // Unknown child (not fetched, missing, or someone else's): leave the
    // stored summary — stale beats blank.
    if (!child) return clip;

    const title = child.title || clip.title;
    // GEOMETRY vs READOUT — the one distinction this derivation carries.
    //
    // `duration` is the collection's LAYOUT span, so it counts every child
    // including disabled ones. It has to: the manifest maps a parent's output
    // span onto the child's local time range, so a duration that excluded a
    // disabled grandchild would window the child's full content into a
    // too-short span and play it fast. It is also the card's slot on the
    // board, which is what the playhead jumps over.
    //
    // The READOUTS — itemCount, previewItems, playableDuration — describe what
    // actually plays, so they come from the ENABLED projection. Because
    // `deriveClosureSummaries` runs bottom-up, disabling something three levels
    // down shrinks every ancestor's playable time automatically, with no
    // reverse index.
    const effectiveChild = effectiveDocument(child);
    const itemCount = effectiveChild.clips.length;
    const previewItems = nestedPreviewItemsFrom(effectiveChild.clips);
    const duration = collectionSpanSeconds(child.clips);
    const playable = playableSpanOf(child);
    // Omitted when nothing under the collection is disabled — `duration` is
    // already the playable time then, and documents that never use the feature
    // never grow the field (same convention as `disabled` itself).
    const playableDuration = playable === duration ? undefined : playable;

    if (
      clip.title === title &&
      clip.itemCount === itemCount &&
      clip.duration === duration &&
      clip.sourceDuration === duration &&
      clip.playableDuration === playableDuration &&
      JSON.stringify(clip.previewItems ?? []) === JSON.stringify(previewItems)
    ) {
      return clip;
    }

    changed = true;
    const next: CollectionTimelineClip = {
      ...clip,
      title,
      alt: `${title} collection`,
      itemCount,
      previewItems,
      duration,
      sourceDuration: duration,
    };
    // Assign-or-DELETE, not a spread of `undefined`: a collection that had a
    // disabled child and no longer does must lose the key outright, or the
    // spread above would carry the stale playable time forward.
    if (playableDuration === undefined) delete next.playableDuration;
    else next.playableDuration = playableDuration;
    return next;
  });

  if (!changed) return { document, changed: false };
  // A duration change moves every following clip — repack, exactly as the
  // legacy sync does.
  return { document: { ...document, clips: packTimelineClips(clips) }, changed: true };
}

/**
 * Derive summaries across a whole loaded closure, BOTTOM-UP: a document is
 * summarized from its already-derived children, so a change deep in the
 * tree propagates up every level in one pass. `deriveCollectionSummaries`
 * on its own is one level deep — it reads STORED children — which is enough
 * for the single-document serve path but not for a reader that flattens the
 * whole closure (the playback manifest): there, a stale grandchild would
 * still window its parent's content out of the timeline.
 *
 * `unresolved` are the ids the loader could not actually read (missing, or
 * another user's). They are typically substituted with EMPTY documents so a
 * dangling branch falls silent — deriving from those would rewrite a real
 * stored summary to "empty collection", so they are treated as absent and
 * the stored summary stands ("stale beats blank").
 *
 * A reference CYCLE resolves to the stored document rather than looping;
 * detecting it stays the manifest compiler's job, which reports it honestly
 * instead of serving a half-derived closure.
 */
export function deriveClosureSummaries(
  documents: Readonly<Record<string, TimelineDocument>>,
  unresolved: ReadonlySet<string> = new Set(),
): Record<string, TimelineDocument> {
  const derived: Record<string, TimelineDocument> = {};
  const visiting = new Set<string>();

  const resolve = (id: string): TimelineDocument | null => {
    const stored = documents[id];
    if (!stored || unresolved.has(id)) return null;
    const settled = derived[id];
    if (settled) return settled;
    if (visiting.has(id)) return stored;

    visiting.add(id);
    const children = new Map<string, TimelineDocument | null>(
      collectionChildIds(stored).map((childId) => [childId, resolve(childId)]),
    );
    visiting.delete(id);

    const result = deriveCollectionSummaries(stored, children).document;
    derived[id] = result;
    return result;
  };

  const closure: Record<string, TimelineDocument> = { ...documents };
  for (const id of Object.keys(documents)) {
    const result = resolve(id);
    if (result) closure[id] = result;
  }
  return closure;
}

/** The child ids a derivation pass for this document would want loaded. */
export function collectionChildIds(document: TimelineDocument): string[] {
  const ids = new Set<string>();
  for (const clip of document.clips) {
    if (clip.kind === "collection" && clip.childTimelineId) ids.add(clip.childTimelineId);
  }
  return [...ids];
}

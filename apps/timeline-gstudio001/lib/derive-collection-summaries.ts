import { TIMELINE_LEADING_PADDING_SECONDS } from "@storyboard/timeline-model/constants";
import {
  effectiveDocument,
  packTimelineClips,
  previewItemsFrom,
} from "@storyboard/timeline-model";
import type { TimelineDocument } from "@storyboard/timeline-model/types";

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
    // Summaries describe what the collection CONTRIBUTES, so they are derived
    // from the child's ENABLED clips, repacked. That is what makes a disabled
    // clip vanish from counts and time totals — and because
    // `deriveClosureSummaries` runs bottom-up, disabling something three
    // levels down shrinks every ancestor automatically, with no reverse index.
    //
    // A collection whose children are ALL disabled falls to the same
    // `duration = 3` an empty collection already gets: all-disabled and empty
    // are the same thing to a reader, and inventing a zero-width case here
    // would be new behaviour, not consistency.
    const effectiveChild = effectiveDocument(child);
    const itemCount = effectiveChild.clips.length;
    const previewItems = previewItemsFrom(effectiveChild.clips);
    let duration = 3;
    if (effectiveChild.clips.length > 0) {
      const last = effectiveChild.clips[effectiveChild.clips.length - 1];
      duration = last.startTime + last.duration + TIMELINE_LEADING_PADDING_SECONDS;
    }

    if (
      clip.title === title &&
      clip.itemCount === itemCount &&
      clip.duration === duration &&
      clip.sourceDuration === duration &&
      JSON.stringify(clip.previewItems ?? []) === JSON.stringify(previewItems)
    ) {
      return clip;
    }

    changed = true;
    return {
      ...clip,
      title,
      alt: `${title} collection`,
      itemCount,
      previewItems,
      duration,
      sourceDuration: duration,
    };
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

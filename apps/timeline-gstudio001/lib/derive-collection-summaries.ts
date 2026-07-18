import { TIMELINE_LEADING_PADDING_SECONDS } from "@storyboard/timeline-model/constants";
import {
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
    const itemCount = child.clips.length;
    const previewItems = previewItemsFrom(child.clips);
    let duration = 3;
    if (child.clips.length > 0) {
      const last = child.clips[child.clips.length - 1];
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

/** The child ids a derivation pass for this document would want loaded. */
export function collectionChildIds(document: TimelineDocument): string[] {
  const ids = new Set<string>();
  for (const clip of document.clips) {
    if (clip.kind === "collection" && clip.childTimelineId) ids.add(clip.childTimelineId);
  }
  return [...ids];
}

import type { TimelineDocument } from "@storyboard/timeline-model/types";

/** How many clips the summary names before eliding. */
const LISTED_CLIPS = 8;

/**
 * The human-readable first block of `read_timeline`'s result.
 *
 * This is what a model actually READS — the JSON payload beside it is for the
 * widget — so anything that changes what the timeline DOES has to appear here,
 * not only in the structured data. Disabled clips are the case in point: they
 * still occupy the document (they keep their slot and their duration), so a
 * caller told only "12 clips" would reasonably assume all twelve play.
 *
 * The count is called out separately from the per-clip markers because the
 * list elides after eight: with a disabled clip in position nine, the markers
 * alone would say nothing at all.
 *
 * Pure and total — it runs against persisted data and must degrade rather than
 * throw, so a document with no `clips` reads as empty.
 */
export function describeTimelineForAgent(document: TimelineDocument): string {
  const clips = document.clips ?? [];
  const skipped = clips.filter((clip) => clip.disabled === true).length;
  const plural = clips.length === 1 ? "" : "s";
  const skippedNote =
    skipped > 0 ? ` (${skipped} disabled, skipped in playback and totals)` : "";
  const listed =
    clips
      .slice(0, LISTED_CLIPS)
      .map((clip) => {
        const label = clip.kind === "collection" ? `${clip.title} (collection)` : clip.kind;
        return clip.disabled === true ? `${label} [disabled]` : label;
      })
      .join(", ") || "(empty)";
  const elision = clips.length > LISTED_CLIPS ? "…" : "";

  return `"${document.title}" — ${clips.length} clip${plural}${skippedNote}: ${listed}${elision}`;
}

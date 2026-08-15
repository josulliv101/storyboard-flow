import { renderFormatOf, type RenderFormat } from "@storyboard/timeline-model/render-format";
import "server-only";

import { compilePlaybackManifest, type PlaybackManifest } from "@storyboard/timeline-domain";

import { deriveClosureSummaries } from "./derive-collection-summaries";
// Aliased deliberately, not relative: the no-restricted-imports guard on this
// function only matches the alias, so a relative import silently escapes it.
// This file is allowlisted in eslint.config.mjs with its reason instead.
import { readStoredTimelineEntry } from "@/lib/firebase-timeline-store";
import { loadTimelineClosure } from "./load-timeline-closure";

/**
 * Compile a timeline's playback manifest from STORED documents.
 *
 * Extracted when export became the second caller. The preview route had this
 * as four steps in sequence, and the third one is the trap: stored collection
 * summaries go stale BY DESIGN, because the graph view's writes are
 * patch-scoped and editing a child never rewrites the parents referencing it.
 * Every read path repairs that at read time; the preview route once did not,
 * and reported a different total than the board while windowing a grown
 * child's newest clips out of playback entirely.
 *
 * A second caller copying three of the four steps would have reproduced
 * exactly that bug in export — where it would have been worse, because a wrong
 * manifest there is a wrong FILE rather than a wrong preview.
 */
export async function compileTimelineManifest(
  timelineId: string,
  uid: string,
): Promise<Readonly<{
  manifest: PlaybackManifest;
  missing: readonly string[];
  /** The project's own output shape, when it has set one. Returned here
   *  because both render entry points already call this and would otherwise
   *  re-read the root document just to learn the size. */
  renderFormat?: RenderFormat;
}> | null> {
  const entry = await readStoredTimelineEntry(timelineId, uid);
  if (!entry) return null;

  // The root was just read, so hand it to the walker rather than making it
  // fetch the same document again.
  const { documents, missing, revisions } = await loadTimelineClosure(timelineId, uid, {
    rootEntry: entry,
  });

  const summarized = deriveClosureSummaries(documents, new Set(missing));

  const manifest = compilePlaybackManifest(
    summarized,
    timelineId,
    entry.revision,
    new Date().toISOString(),
    revisions,
  );
  // Defended, not trusted — a stored format that is not a usable one falls
  // back to the default rather than reaching ffmpeg.
  const renderFormat = renderFormatOf(documents[timelineId]?.renderFormat);
  return { manifest, missing, ...(renderFormat === undefined ? {} : { renderFormat }) };
}

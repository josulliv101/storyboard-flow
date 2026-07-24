import { clipPosterUrl } from "@storyboard/timeline-model";
import type { TimelineClip } from "@storyboard/timeline-model/types";

/**
 * The frame a project card shows: the first one ANY clip in the document can
 * supply, scanning in timeline order.
 *
 * A collection clip contributes a preview item. That branch is the whole point:
 * once a project's top level is organised into scenes it holds no media clip at
 * all, only collections — so a plain `kind === "image" | "video"` scan found
 * nothing and the card fell through to the empty placeholder, even though every
 * collection card in the strip below was rendering thumbnails from exactly the
 * `previewItems` this now reads.
 *
 * Per-clip frame selection lives in `clipPosterUrl` so the project card, the
 * timeline strip, and the MCP widget can't drift apart on what a clip looks
 * like — they had, and the widget was the one that was wrong.
 *
 * Deliberately does NOT descend into child timeline documents: `previewItems`
 * is the summary the write path already denormalised onto the clip, so this
 * stays a pure function of one document and adds no reads to the list query.
 */
export function firstFrameUrl(clips: readonly TimelineClip[]): string | undefined {
  for (const clip of clips) {
    const frame = clipPosterUrl(clip);
    if (frame) return frame;
  }
  return undefined;
}

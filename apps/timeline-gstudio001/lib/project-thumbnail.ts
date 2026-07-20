import type { TimelineClip } from "@storyboard/timeline-model/types";

/**
 * The frame a project card shows: the first one ANY clip in the document can
 * supply, scanning in timeline order.
 *
 * A collection clip contributes its own first preview item. That branch is the
 * whole point: once a project's top level is organised into scenes it holds no
 * media clip at all, only collections — so a plain `kind === "image" | "video"`
 * scan found nothing and the card fell through to the empty placeholder, even
 * though every collection card in the strip below was rendering thumbnails from
 * exactly the `previewItems` this now reads.
 *
 * Deliberately does NOT descend into child timeline documents: `previewItems`
 * is the summary the write path already denormalised onto the clip, so this
 * stays a pure function of one document and adds no reads to the list query.
 */
export function firstFrameUrl(clips: readonly TimelineClip[]): string | undefined {
  for (const clip of clips) {
    if (clip.kind === "image") {
      if (clip.src) return clip.src;
      continue;
    }
    if (clip.kind === "video") {
      const url = clip.poster || clip.src;
      if (url) return url;
      continue;
    }
    if (clip.kind === "collection") {
      for (const item of clip.previewItems ?? []) {
        const url = item.kind === "video" ? item.poster || item.src : item.src;
        if (url) return url;
      }
    }
  }
  return undefined;
}

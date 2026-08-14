import type { CollectionPreviewFrame } from "@storyboard/timeline-domain";

/**
 * Pure frame-selection rules for the drag ghost and the trim overview.
 *
 * Extracted from `graph-item-content.tsx` (#281). All three were already pure
 * — they were simply unreachable by a test, because the app's vitest cannot
 * parse `.tsx`. `mediaGhostSrc` in particular encodes a bug class this repo
 * has now hit twice (a `.flac` handed to an `<img>`), which is exactly the
 * kind of rule that should be pinned.
 */

/** Width of one square frame in the trim overview, px. */
export const OVERVIEW_FRAME_SIZE = 44;
/** Ceiling on frames, so a long source cannot mount hundreds of `<img>`. */
export const OVERVIEW_FRAME_CAP = 40;

/** A media node, narrowed to what these rules actually read. */
export type GhostMediaNode = Readonly<{
  kind: string;
  mediaKind?: string;
  src?: string;
  posterSrcs?: readonly string[];
}>;

/**
 * The single frame a media drag ghost shows, or null to fall back to the
 * labelled name+duration tile.
 *
 * AUDIO IS NULL, deliberately. An audio node has a `src`, so every
 * "does it have a source?" test waves it through — and the result is a `.flac`
 * URL in an `<img>`, drawing a broken-image ghost. The same omission shipped in
 * the package's `NodeThumbnail` and had to be fixed separately, which is why
 * this rule is worth a test rather than a comment.
 *
 * A VIDEO uses its first poster, never `src`: `src` is the movie file, and an
 * `<img>` pointing at an mp4 is the same broken tile by another route.
 */
export function mediaGhostSrc(node: GhostMediaNode): string | null {
  if (node.kind !== "media") return null;
  if (node.mediaKind === "audio") return null;
  return node.mediaKind === "video" ? (node.posterSrcs?.[0] ?? null) : (node.src ?? null);
}

/**
 * The two frames a COLLECTION ghost shows: first and last.
 *
 * Not first/middle/last — the ghost is a small square and three slices of a
 * composition read as noise. Built by index pair rather than as a literal of
 * two reads, so the result can never contain a hole for the renderer to paint.
 */
export function ghostPreviewFrames(
  all: readonly CollectionPreviewFrame[],
): readonly CollectionPreviewFrame[] {
  if (all.length <= 1) return all;
  return [0, all.length - 1].flatMap((index) => all[index] ?? []);
}

/**
 * How many square frames the trim overview draws across `fullWidth`.
 *
 * CEIL so the row fills its strip (the container clips the overflow) rather
 * than leaving a gap at the right edge; CAPPED so a long source stays bounded;
 * and never below one, because a zero-frame overview is an empty band that
 * reads as a failed load.
 */
export function overviewFrameCount(fullWidth: number): number {
  if (!Number.isFinite(fullWidth)) return 1;
  return Math.max(1, Math.min(OVERVIEW_FRAME_CAP, Math.ceil(fullWidth / OVERVIEW_FRAME_SIZE)));
}

// WHERE THE BAR'S BOXES SIT, in absolute timeline pixels.
//
// Pure and framework-free (a .ts, not a .tsx) so the app's vitest can parse
// it. Every question here is arithmetic over a running total, and the ways it
// goes wrong — a clip that is not in the strip, a centre with nothing either
// side of it, a container wider than the whole timeline — are all answerable
// without a DOM.
//
// ── WHY ABSOLUTE, AND NOT RELATIVE TO THE VISIBLE WINDOW ──────────────────
//
// The bar used to be laid out across the clock's own window: three clips and
// two leads, stretched to the container. That makes every box's position a
// function of what else is on screen, so advancing one clip moved ALL of them
// — the strip was rebuilt, not slid, and the clips that stayed jumped to new
// coordinates while the transform tried to animate.
//
// Laying out in absolute coordinates — every clip at the sum of the durations
// before it — makes a box's position a property of the CLIP. Advancing then
// changes exactly one number, the translate, and every box travels the same
// distance because none of their own positions moved. That is what lets new
// clips slide in at the edges instead of appearing there.

export type SeamStripClip = Readonly<{
  id: string;
  /** The trimmed length — what the clip actually contributes to playback. */
  showingSeconds: number;
  posterSrc?: string;
}>;

export type SeamStripSegment = Readonly<{
  clipId: string;
  leftPx: number;
  widthPx: number;
  posterSrc?: string;
}>;

export type SeamStrip = Readonly<{
  segments: readonly SeamStripSegment[];
  totalPx: number;
  pxPerSecond: number;
}>;

const EMPTY: SeamStrip = { segments: [], totalPx: 0, pxPerSecond: 0 };

/**
 * Lay every clip out end to end at a fixed scale.
 *
 * ZERO-LENGTH CLIPS ARE KEPT, not filtered. They contribute nothing to the
 * running total, so they cost nothing, but dropping them would make the
 * segment list disagree with the id list the caller indexes by — and a clip
 * trimmed to nothing is still a clip you can advance onto.
 */
export function buildSeamStrip(
  clips: readonly SeamStripClip[],
  pxPerSecond: number,
): SeamStrip {
  if (clips.length === 0 || !Number.isFinite(pxPerSecond) || pxPerSecond <= 0) return EMPTY;
  const segments: SeamStripSegment[] = [];
  let cursor = 0;
  for (const clip of clips) {
    const widthPx = Math.max(0, clip.showingSeconds) * pxPerSecond;
    segments.push({
      clipId: clip.id,
      leftPx: cursor,
      widthPx,
      ...(clip.posterSrc === undefined ? {} : { posterSrc: clip.posterSrc }),
    });
    cursor += widthPx;
  }
  return { segments, totalPx: cursor, pxPerSecond };
}

export function segmentFor(strip: SeamStrip, clipId: string): SeamStripSegment | null {
  return strip.segments.find((segment) => segment.clipId === clipId) ?? null;
}

/**
 * How far to translate the strip so `clipId` sits centred in `containerPx`.
 *
 * Returned as the value to put in `translateX`, so it is NEGATIVE for a clip
 * past the halfway mark — the strip moves left to bring a later clip into the
 * middle, the same direction and sign as the row of cards below it.
 *
 * DELIBERATELY UNCLAMPED. The first clip's centre is half its own width from
 * the start, so centring it means translating the strip RIGHT, leaving empty
 * space at the left edge — and that space is the truth: there is nothing
 * before the first clip. Clamping to zero would centre the first clip's box
 * over the wrong card, which is the one thing this function exists to prevent.
 */
export function stripCentreOffset(
  strip: SeamStrip,
  clipId: string,
  containerPx: number,
): number {
  const segment = segmentFor(strip, clipId);
  if (segment === null) return 0;
  const centre = segment.leftPx + segment.widthPx / 2;
  return containerPx / 2 - centre;
}

/**
 * Where the playhead goes for a position the CLOCK reported.
 *
 * The clock and the strip are two views of the same clips: the clock knows
 * "clip X, 3.2 seconds in", and the strip knows where clip X begins. Reading
 * across is what keeps one playhead honest against two models — and why the
 * strip never has to be the thing that plays.
 */
export function stripXFor(
  strip: SeamStrip,
  clipId: string,
  secondsIntoClip: number,
): number | null {
  const segment = segmentFor(strip, clipId);
  if (segment === null) return null;
  const into = Math.max(0, secondsIntoClip) * strip.pxPerSecond;
  return segment.leftPx + Math.min(into, segment.widthPx);
}

/**
 * The clip under `x`, and how far into it — the inverse of `stripXFor`.
 *
 * Used for scrubbing: a press lands on a pixel, and the caller has to turn
 * that into a clip and an offset before it can ask the clock to move. Returns
 * null past either end rather than clamping to the nearest clip, because the
 * caller's answer to "you pressed outside the timeline" is to do nothing, not
 * to jump to the last frame.
 */
export function stripPositionAt(
  strip: SeamStrip,
  x: number,
): { clipId: string; secondsIntoClip: number } | null {
  if (!Number.isFinite(x) || x < 0 || x > strip.totalPx) return null;
  for (const segment of strip.segments) {
    if (segment.widthPx <= 0) continue;
    if (x >= segment.leftPx && x < segment.leftPx + segment.widthPx) {
      return {
        clipId: segment.clipId,
        secondsIntoClip: (x - segment.leftPx) / strip.pxPerSecond,
      };
    }
  }
  // Exactly on the end of the last non-empty segment.
  const last = [...strip.segments].reverse().find((segment) => segment.widthPx > 0);
  if (last === undefined) return null;
  return { clipId: last.clipId, secondsIntoClip: last.widthPx / strip.pxPerSecond };
}

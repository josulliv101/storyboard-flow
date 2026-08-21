// THE BAR'S ARITHMETIC: zoom, cut-snapping, collection seams, ruler ticks.
//
// Pure and framework-free (a .ts, not a .tsx) so the app's vitest can parse
// it, and separate from `graph-seam-strip` because that module answers "where
// does each clip sit" and this one answers "what does the bar draw around
// them". Both are arithmetic over the same running total; neither needs a DOM.

import { segmentFor, type SeamStrip } from "./graph-seam-strip";

/**
 * A clip as the BAR sees it — its length, and which collection it came from.
 *
 * The collection is not decoration. The bar spans the whole project in
 * playback order, so it crosses collection edges, and those edges are the
 * only landmarks on an otherwise uniform run of boxes: they are where the
 * dividers go and what the ruler labels.
 */
export type SeamBarClip = Readonly<{
  id: string;
  /** For the hover preview — the only place the bar can say what a box IS. */
  name: string;
  /** The trimmed length — what the clip contributes to playback. */
  showingSeconds: number;
  collectionId: string | null;
  collectionName: string | null;
  posterSrc?: string;
}>;

/**
 * How far the bar can be zoomed, in pixels per second of footage.
 *
 * The floor is set by legibility of the WHOLE: at 2.5px a second a ten-minute
 * project is 1500px, which is a bar you can see the shape of. The ceiling is
 * set by the other end of the same question — past 40px a second a two-second
 * clip is wider than the track and the bar has stopped being a map.
 */
export const PPS_MIN = 2.5;
export const PPS_MAX = 40;

/** How hard a wheel notch moves the zoom. Exponential, so a notch is a RATIO
 *  and zooming feels the same at either end of the range. */
export const ZOOM_WHEEL_GAIN = 0.0016;

/** How near a cut a scrub has to land before it is taken to mean that cut. */
export const SNAP_TOLERANCE_PX = 7;

export function clampPixelsPerSecond(value: number): number {
  if (!Number.isFinite(value)) return PPS_MIN;
  return Math.min(PPS_MAX, Math.max(PPS_MIN, value));
}

export function zoomByWheel(current: number, deltaY: number): number {
  return clampPixelsPerSecond(current * Math.exp(-deltaY * ZOOM_WHEEL_GAIN));
}

/**
 * The scale that lays `seconds` of footage across `overflow` × the track.
 *
 * Deliberately MORE than one trackful. Opening at exactly fit-to-width says
 * "this is all of it" about a bar whose whole point is that there is more
 * either side; opening a little over says "there is more, and it is that
 * way", which is the thing a first glance has to get right.
 */
export function fitPixelsPerSecond(
  seconds: number,
  trackPx: number,
  overflow = 1.65,
): number {
  if (seconds <= 0 || trackPx <= 0) return clampPixelsPerSecond(9);
  return clampPixelsPerSecond((trackPx * overflow) / seconds);
}

/**
 * Where the strip crosses from one collection into the next.
 *
 * Indexes into `clips`, naming the FIRST clip of each new collection — the
 * clip a divider is drawn before, and the clip whose collection the ruler
 * labels. Index 0 is included: the run has to be named where it starts, or
 * the first collection on the bar is the only one without a label.
 */
export function collectionSeams(clips: readonly SeamBarClip[]): readonly number[] {
  const seams: number[] = [];
  for (let index = 0; index < clips.length; index += 1) {
    if (index === 0 || clips[index]!.collectionId !== clips[index - 1]!.collectionId) {
      seams.push(index);
    }
  }
  return seams;
}

/**
 * Pull `x` onto a cut if there is one within `tolerancePx`.
 *
 * Returns the snapped x, or the x it was given when nothing is near. Cuts are
 * where a clip STARTS, plus the very end of the timeline — the two ends of
 * the run are positions you aim for as much as any interior seam.
 *
 * TOLERANCE IS IN PIXELS, NOT SECONDS, which is the whole reason this is not
 * a fixed number of frames: the bar zooms, and at 2.5px a second a snap
 * measured in seconds would swallow whole clips while at 40 it would be
 * unreachable. Seven pixels is seven pixels at every scale.
 */
export function snapToCut(
  strip: SeamStrip,
  x: number,
  tolerancePx = SNAP_TOLERANCE_PX,
): number {
  let best: number | null = null;
  let bestDistance = tolerancePx;
  const consider = (candidate: number) => {
    const distance = Math.abs(candidate - x);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  };
  for (const segment of strip.segments) {
    if (segment.widthPx <= 0) continue;
    consider(segment.leftPx);
  }
  consider(strip.totalPx);
  return best ?? x;
}

/**
 * The offset that keeps the time under the cursor under the cursor.
 *
 * Zooming about a point is the difference between a control and a lurch: the
 * clip you were looking at when you started is the clip you want to still be
 * looking at when you stop. All coordinates are LOCAL to the track (client x
 * minus the track's left edge), so this never has to know where on the page
 * the bar is.
 */
export function offsetAfterZoom(params: {
  anchorLocalX: number;
  offset: number;
  from: number;
  to: number;
}): number {
  const { anchorLocalX, offset, from, to } = params;
  if (from <= 0 || !Number.isFinite(from)) return offset;
  const seconds = (anchorLocalX - offset) / from;
  return anchorLocalX - seconds * to;
}

export type SeamTick = Readonly<{
  /** Absolute strip pixels — the same space the boxes are laid out in. */
  x: number;
  label: string;
  kind: "time" | "collection";
}>;

/**
 * The rungs of the ladder the ruler may step by, in seconds.
 *
 * The smallest whose spacing clears `MIN_TICK_GAP_PX` wins, so the ruler
 * carries about as many labels at every zoom instead of thinning to nothing
 * when you pull back and crowding into a smear when you push in.
 */
const TICK_LADDER = [1, 2, 5, 10, 15, 30, 60, 120, 300] as const;
const MIN_TICK_GAP_PX = 46;
/** How close a time tick may come to a collection label before it gives way. */
const TICK_CLASH_PX = 26;

export function tickStepSeconds(pxPerSecond: number): number {
  if (!Number.isFinite(pxPerSecond) || pxPerSecond <= 0) return TICK_LADDER.at(-1)!;
  const found = TICK_LADDER.find((step) => step * pxPerSecond >= MIN_TICK_GAP_PX);
  return found ?? TICK_LADDER.at(-1)!;
}

/**
 * Every mark the ruler draws, in one pass.
 *
 * COLLECTION TICKS WIN TIES. A time tick says "ninety seconds", which you can
 * work out; a collection tick says "Van Interior starts here", which you
 * cannot. When they land within `TICK_CLASH_PX` of each other the time tick
 * is dropped, rather than both being drawn into the same smudge.
 */
export function seamRulerTicks(params: {
  strip: SeamStrip;
  clips: readonly SeamBarClip[];
}): readonly SeamTick[] {
  const { strip, clips } = params;
  if (strip.pxPerSecond <= 0 || strip.totalPx <= 0) return [];

  const collectionTicks: SeamTick[] = [];
  for (const index of collectionSeams(clips)) {
    const clip = clips[index];
    if (clip === undefined || clip.collectionName === null) continue;
    const segment = segmentFor(strip, clip.id);
    if (segment === null) continue;
    collectionTicks.push({ x: segment.leftPx, label: clip.collectionName, kind: "collection" });
  }

  const step = tickStepSeconds(strip.pxPerSecond);
  const timeTicks: SeamTick[] = [];
  for (let seconds = step; seconds * strip.pxPerSecond <= strip.totalPx; seconds += step) {
    const x = seconds * strip.pxPerSecond;
    if (collectionTicks.some((tick) => Math.abs(tick.x - x) < TICK_CLASH_PX)) continue;
    timeTicks.push({ x, label: `${Math.round(seconds)}s`, kind: "time" });
  }

  return [...timeTicks, ...collectionTicks];
}

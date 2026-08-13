// Pure geometry for the horizontal virtual strip, split out of VirtualStrip so
// the boundary/indicator/anchor arithmetic can be unit tested without a
// virtualizer, DOM, or rAF loop. VirtualStrip owns the measurements, refs, and
// scrolling; this owns the numbers.

import {
  getChildren,
  mediaDurationSeconds,
  type CollectionsGraph,
  type NodeId,
} from "../core/graph";

/**
 * A fully trimmed clip can derive a 0px width from its duration. The slot
 * still needs to be visible and clickable: NodeCard's `w-full` fills the slot
 * (overriding its own `w-32` default), so a 0px slot renders an invisible,
 * unselectable card. Applied by BOTH the committed layout (`widthForIndex` in
 * VirtualStrip) and the live preview (`slotSizeFor`) — they must agree, or the
 * commit re-measure snaps the card by the floor delta on release. The node's
 * semantic duration/trim is left untouched; only the rendered slot is floored.
 */
export const MIN_ITEM_WIDTH = 12;

/**
 * The visible boundary index for a pointer at content-x `contentX`, given the
 * strip's measured `totalSize` and item `count`. Before the first item -> 0;
 * at/past the end, or with no measured item under the pointer -> `count`;
 * otherwise the pointer's item rounded to the nearer edge by its midpoint.
 * `item` is the virtualizer's measured item under `contentX` (null when out of
 * range or unmeasured).
 */
export function resolveBoundaryIndex(
  contentX: number,
  totalSize: number,
  count: number,
  item: Readonly<{ start: number; size: number; index: number }> | null
): number {
  if (contentX <= 0) return 0;
  if (contentX >= totalSize) return count;
  if (!item) return count;
  return contentX < item.start + item.size / 2 ? item.index : item.index + 1;
}

/**
 * Left offset (content coords) for the drop indicator at a boundary whose gap
 * begins at `edgeStart` — half a gap back at the line's geometric centre, and
 * never negative. `edgeStart` is the following item's `start`, or the strip's
 * total size when appending at the far end.
 */
export function indicatorLeftOffset(edgeStart: number, gap: number): number {
  return Math.max(0, edgeStart - gap / 2);
}

/**
 * THE duration → width conversion — the single sizing invariant every layer
 * shares: committed layout (`VirtualStrip pixelsPerSecond`), the live trim
 * preview (`slotSizeFor`), and virtualizer measurement all run through this
 * one function, so they cannot drift. Consumers use it too (playhead math,
 * or an `itemWidthFor` that must agree with the trim scale). Non-finite
 * inputs and short durations floor at `minimumWidth` — the clickable slot
 * minimum.
 */
export function durationToWidth(
  durationSeconds: number,
  pixelsPerSecond: number,
  minimumWidth: number = MIN_ITEM_WIDTH
): number {
  const width = durationSeconds * pixelsPerSecond;
  return Number.isFinite(width) ? Math.max(minimumWidth, width) : minimumWidth;
}

/**
 * Slot width (px) a clip of `effectiveSeconds` occupies at `pixelsPerSecond`,
 * plus its trailing `gap` — the size handed to the virtualizer's `resizeItem`.
 * Floored (via `durationToWidth`) like the committed layout, so the last
 * preview of a near-fully-trimmed clip already matches the post-commit
 * reconciliation (no resize snap on release, no invisible mid-drag sliver).
 */
export function slotSizeFor(effectiveSeconds: number, pixelsPerSecond: number, gap: number): number {
  return durationToWidth(effectiveSeconds, pixelsPerSecond) + gap;
}

/**
 * The "grows left" anchor transform (px) for a left-handle trim: `resizeItem`
 * grew the slot rightward from `baselineSize` to `liveSlotSize`, so translate
 * the content layer by the negated growth to pin the clip's RIGHT edge (a
 * shrink yields a positive shift; no change yields 0).
 */
export function leftAnchorShift(liveSlotSize: number, baselineSize: number): number {
  // baseline − live == −(growth); written this way so no change yields +0
  // rather than −0 (behaviorally identical, but tidier).
  return baselineSize - liveSlotSize;
}

export type TimeToOffsetConfig = Readonly<{
  graph: CollectionsGraph;
  collectionId: NodeId;
  pixelsPerSecond: number;
  /** Match the strip's props: gap default 8, itemWidth default 128. */
  gap?: number;
  itemWidth?: number;
  minimumWidth?: number;
}>;

export type TimeToOffsetLookup = Readonly<{
  /** Content-x for an arbitrary time — O(log n) binary search. */
  at: (timeSeconds: number) => number;
  /**
   * A stateful cursor for MONOTONIC consumption — the per-frame playhead:
   * O(1) per call while time stays in or hops to the adjacent segment
   * (which is every frame of normal playback), O(log n) for a seek. Create
   * one cursor per consumer loop; it never mutates the lookup.
   */
  cursor: () => Readonly<{ at: (timeSeconds: number) => number }>;
  /** Total played duration (media only; collections carry no time). */
  totalDurationSeconds: number;
  /** Content-x of the last media item's right edge — the overflow clamp. */
  endOffset: number;
}>;

/**
 * Build a timeline-time → content-x lookup for overlay math (a playhead)
 * over a `pixelsPerSecond`-sized strip. Prefix sums are built ONCE (O(n));
 * rebuild at commit/config cadence (`onChange` / `subscribeToChanges` — a
 * playhead's per-frame path should be `lookup.cursor().at(t)`, ideally
 * writing a transform imperatively rather than re-rendering React per
 * frame).
 *
 * Mapping semantics: media items advance the clock by their EFFECTIVE
 * duration and the x by their slot width (`durationToWidth` + gap — the
 * same conversion the strip lays out with); non-media items (collections)
 * occupy width but no time. Inside a FLOORED clip x advances at `pps` and
 * caps at the clip's right edge (the clip is wider than its time). Times
 * past the total clamp to `endOffset`; negative times clamp to the first
 * clip's left edge. The result is CONTENT coordinates (what the `overlay`
 * slot renders in) and excludes `VirtualStrip`'s transient first-item
 * gutter. Assumes `pixelsPerSecond` sizing; strips sized by a custom
 * `itemWidthFor` need their own mapping against that same function.
 */
export function createTimeToOffset(config: TimeToOffsetConfig): TimeToOffsetLookup {
  const { graph, collectionId, pixelsPerSecond } = config;
  const gap = config.gap ?? 8;
  const itemWidth = config.itemWidth ?? 128;
  const minimumWidth = config.minimumWidth ?? MIN_ITEM_WIDTH;

  // Time segments: media with duration > 0. Zero-duration media and
  // collections occupy width but never own a time slice, so they only
  // advance x. Segments are contiguous in time by construction.
  const timeStarts: number[] = [];
  const xStarts: number[] = [];
  const widths: number[] = [];
  const durations: number[] = [];
  let x = 0;
  let clock = 0;
  let lastMediaRight = 0;
  for (const childId of getChildren(graph, collectionId)) {
    const node = graph.nodesById.get(childId);
    if (!node) continue;
    if (node.kind !== "media") {
      x += Math.max(minimumWidth, itemWidth) + gap;
      continue;
    }
    const duration = mediaDurationSeconds(node);
    const width = durationToWidth(duration, pixelsPerSecond, minimumWidth);
    if (duration > 0) {
      timeStarts.push(clock);
      xStarts.push(x);
      widths.push(width);
      durations.push(duration);
      clock += duration;
    }
    x += width + gap;
    lastMediaRight = x - gap;
  }
  const count = timeStarts.length;
  const endOffset = lastMediaRight;

  /**
   * Read one of the four parallel arrays.
   *
   * They are built together in the walk above and never grow again, and every
   * index below is either produced by `locate()` (bounded by `count - 1`) or
   * guarded by `< count`. This states that invariant ONCE instead of putting a
   * bounds check on every access in a per-frame scrub path.
   *
   * It throws rather than falling back to 0: a fallback would silently distort
   * the geometry — a clip drawn at the wrong offset, a playhead that drifts —
   * which is far harder to trace than a stop that names the index.
   */
  const readAt = (values: readonly number[], index: number): number => {
    const value = values[index];
    if (value === undefined) {
      throw new RangeError(`strip geometry: index ${index} outside 0..${count - 1}`);
    }
    return value;
  };

  /** Index of the last segment whose start time is <= t (t must be >= 0). */
  const locate = (t: number): number => {
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (readAt(timeStarts, mid) <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const offsetWithin = (index: number, t: number): number => {
    const within = Math.max(0, t - readAt(timeStarts, index)) * pixelsPerSecond;
    return readAt(xStarts, index) + Math.min(within, readAt(widths, index));
  };

  const at = (timeSeconds: number): number => {
    if (count === 0) return endOffset;
    if (timeSeconds <= readAt(timeStarts, 0)) return readAt(xStarts, 0);
    if (timeSeconds >= clock) return endOffset;
    return offsetWithin(locate(timeSeconds), timeSeconds);
  };

  return {
    at,
    cursor: () => {
      let index = 0;
      return {
        at: (timeSeconds: number): number => {
          if (count === 0) return endOffset;
          if (timeSeconds <= readAt(timeStarts, 0)) return readAt(xStarts, 0);
          if (timeSeconds >= clock) return endOffset;
          if (timeSeconds < readAt(timeStarts, index)) {
            // Backward seek: re-anchor.
            index = locate(timeSeconds);
          } else if (timeSeconds >= readAt(timeStarts, index) + readAt(durations, index)) {
            // Forward: the adjacent segment is the common playback hop (O(1));
            // anything farther is a seek (O(log n)).
            if (
              index + 1 < count &&
              timeSeconds < readAt(timeStarts, index + 1) + readAt(durations, index + 1)
            ) {
              index += 1;
            } else {
              index = locate(timeSeconds);
            }
          }
          return offsetWithin(index, timeSeconds);
        },
      };
    },
    totalDurationSeconds: clock,
    endOffset,
  };
}

/**
 * One-shot convenience over `createTimeToOffset` — fine for occasional
 * lookups; for a per-frame playhead build the lookup once and use a cursor.
 */
export function timeToOffset(
  args: TimeToOffsetConfig & { timeSeconds: number }
): number {
  return createTimeToOffset(args).at(args.timeSeconds);
}

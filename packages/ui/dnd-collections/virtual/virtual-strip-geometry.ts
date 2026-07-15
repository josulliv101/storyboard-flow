// Pure geometry for the horizontal virtual strip, split out of VirtualStrip so
// the boundary/indicator/anchor arithmetic can be unit tested without a
// virtualizer, DOM, or rAF loop. VirtualStrip owns the measurements, refs, and
// scrolling; this owns the numbers.

/** Half the drop-indicator line's width (px) — used to center it in a gap. */
const INDICATOR_HALF_WIDTH = 2;

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
 * begins at `edgeStart` — half a gap back, centered on the indicator line, and
 * never negative. `edgeStart` is the following item's `start`, or the strip's
 * total size when appending at the far end.
 */
export function indicatorLeftOffset(edgeStart: number, gap: number): number {
  return Math.max(0, edgeStart - gap / 2 - INDICATOR_HALF_WIDTH);
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

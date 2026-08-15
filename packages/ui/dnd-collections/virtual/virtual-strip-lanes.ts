// Pure geometry for the strip's LANE ROWS — the layers that run *alongside*
// the picture rather than after it (a music bed, a voiceover). Split out of
// VirtualStrip for the same reason virtual-strip-geometry is: the arithmetic
// is testable without a virtualizer, DOM, or rAF loop.
//
// The picture row keeps the virtualizer. Layers do not get one: they are FEW
// and LONG where shots are many and short, so the thing virtualization exists
// for does not apply to them, and skipping it keeps one virtualizer's index
// space intact.

import { MIN_ITEM_WIDTH } from "./virtual-strip-geometry";

/**
 * One laid-out slot on the PICTURE row, pairing what the strip measured with
 * what the consumer's clock says about it.
 *
 * The pairing is the whole point. The x half (`left`/`width`) is the strip's —
 * it comes from the same width resolution the cards are drawn with, so it
 * survives an `itemWidthFor` override and a live trim. The time half is the
 * CONSUMER'S, because the strip cannot derive it: its own notion of duration
 * knows nothing about the inter-clip gap a document packs with (0.12s here),
 * nor about the span a collection card stands for. Deriving time from widths
 * would drift by one gap per gutter — a few pixels per card, and a lane row
 * visibly sliding off the shots it covers by the tenth one.
 */
export type LanePictureSlot = Readonly<{
  /** Measured content-x of the slot's left edge. */
  left: number;
  /** Measured slot width, EXCLUDING the trailing gap. */
  width: number;
  startSeconds: number;
  durationSeconds: number;
}>;

export type LaneTimeMap = Readonly<{
  /** Content-x for a time on the picture's clock — O(log n). */
  at: (timeSeconds: number) => number;
}>;

/**
 * Build the picture row's time → content-x map: piecewise linear, anchored on
 * the card edges the strip actually drew.
 *
 * A strip is NOT a linear time axis. Card width is duration·pps, but the
 * gutter between two cards absorbs the pack gap at no fixed rate, a collection
 * card is a fixed width holding an arbitrary span, and a fully-trimmed clip
 * floors at `MIN_ITEM_WIDTH` while owning almost no time. Anchoring on
 * measured edges makes every one of those exact instead of approximated: at a
 * card's start time the map returns that card's left edge, full stop.
 *
 * Interpolating ACROSS the gutter (rather than snapping to the next card)
 * matters for the playhead-adjacent case a lane row shares: a bed whose window
 * ends between two shots should draw its right edge in the gutter, where that
 * moment actually is, not jumped forward to the next shot's edge.
 *
 * Times BEFORE the first card clamp to its left edge; times past the last one
 * extrapolate at that card's rate, because a lane can outlast the picture.
 *
 * `slots` must be ordered by `startSeconds` — the binary search assumes it.
 * That holds by construction for a packed document; this does not re-sort per
 * render to prove it. Note the LAYER items placed through this map carry no
 * such requirement: a lane's cards may start anywhere, in any order, and need
 * not touch each other or line up with anything on another row.
 */
export function createLaneTimeMap(slots: readonly LanePictureSlot[]): LaneTimeMap {
  const count = slots.length;

  // Stated once rather than bounds-checking every access on a path that runs
  // per layer card per render. Throws rather than falling back to 0, which
  // would silently draw a lane card at the strip's origin — far harder to
  // trace than a stop that names the index.
  const slotAt = (index: number): LanePictureSlot => {
    const slot = slots[index];
    if (slot === undefined) {
      throw new RangeError(`lane geometry: slot ${index} outside 0..${count - 1}`);
    }
    return slot;
  };

  /** Index of the last slot starting at or before `t`. */
  const locate = (t: number): number => {
    let lo = 0;
    let hi = count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (slotAt(mid).startSeconds <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const at = (timeSeconds: number): number => {
    if (count === 0) return 0;
    const first = slotAt(0);
    if (!Number.isFinite(timeSeconds) || timeSeconds <= first.startSeconds) return first.left;
    // PAST THE PICTURE. A lane is not bounded by the cut — music can outlast
    // the last shot — so this extrapolates at the final card's own rate
    // rather than clamping. Clamping drew a 30s bed under a 12s sequence as
    // 12s long, which reads as a bed that stops when it does not.
    //
    // The rate is the last card's px-per-second, which on a uniformly scaled
    // strip IS `pixelsPerSecond`; taking it from the card keeps this honest
    // under an `itemWidthFor` override too. A zero-duration last card offers
    // no rate, so there it still clamps.
    const last = slotAt(count - 1);
    const lastEnd = last.startSeconds + last.durationSeconds;
    if (timeSeconds >= lastEnd) {
      const rate = last.durationSeconds > 0 ? last.width / last.durationSeconds : 0;
      return last.left + last.width + (timeSeconds - lastEnd) * rate;
    }

    const index = locate(timeSeconds);
    const slot = slotAt(index);
    const slotEnd = slot.startSeconds + slot.durationSeconds;
    // Inside the card. A zero-duration card owns no interval to interpolate
    // across, so every time that lands on it resolves to its left edge.
    if (timeSeconds <= slotEnd) {
      if (slot.durationSeconds <= 0) return slot.left;
      const within = (timeSeconds - slot.startSeconds) / slot.durationSeconds;
      return slot.left + within * slot.width;
    }
    // In the gutter after it. `locate` only returns the last index when the
    // time is past its end, and that case already clamped above, so a next
    // slot always exists here.
    const next = slotAt(index + 1);
    const gutterSeconds = next.startSeconds - slotEnd;
    const from = slot.left + slot.width;
    if (gutterSeconds <= 0) return next.left;
    return from + ((timeSeconds - slotEnd) / gutterSeconds) * (next.left - from);
  };

  return { at };
}

/**
 * Where a layer card sits and how wide it draws: both edges through the map,
 * so the card spans exactly the picture the consumer says it covers. A bed
 * over shots 1-3 lines up with those three cards AND the two gutters between
 * them, at any zoom.
 *
 * Width is deliberately NOT `durationToWidth(duration)`. That is only right on
 * a linear axis; here it would leave a bed short by one gap per shot it spans.
 *
 * Floored at `minimumWidth` for the same reason the picture's slots are: a
 * near-zero card is invisible and unclickable.
 */
export function laneItemPlacement(
  map: LaneTimeMap,
  item: Readonly<{ startSeconds: number; durationSeconds: number }>,
  minimumWidth: number = MIN_ITEM_WIDTH,
): Readonly<{ left: number; width: number }> {
  const left = map.at(item.startSeconds);
  const right = map.at(item.startSeconds + Math.max(0, item.durationSeconds));
  return { left, width: Math.max(minimumWidth, right - left) };
}

/**
 * Top offset of a row within the strip's content layer. Row 0 is the picture
 * and sits at the top; layer rows stack under it, each preceded by its gap.
 */
export function laneRowTop(
  rowIndex: number,
  itemHeight: number,
  layerHeight: number,
  layerGap: number,
): number {
  if (rowIndex <= 0) return 0;
  return itemHeight + layerGap + (rowIndex - 1) * (layerHeight + layerGap);
}

/**
 * Total height of the picture row plus every layer row under it — what the
 * content spacer grows to.
 *
 * Growing the SPACER is what carries the overlay slot along for free: it
 * renders at `inset: 0` inside this box, so a playhead drawn `bottom-0`
 * crosses every lane without knowing lanes exist.
 */
export function laneStackHeight(
  itemHeight: number,
  layerHeight: number,
  layerGap: number,
  layerCount: number,
): number {
  if (layerCount <= 0) return itemHeight;
  return itemHeight + layerCount * (layerGap + layerHeight);
}

// --- roving focus across rows ------------------------------------------------

/** A row entry as the roving resolver needs to see it: just its time window. */
export type LaneRowItem = Readonly<{ startSeconds: number; durationSeconds: number }>;

/** Row 0 is the picture; the rest are layers, in the order they are drawn. */
export type LaneRowLayout = readonly (readonly LaneRowItem[])[];

/**
 * The flat list the roving-focus hook navigates is every row's ids
 * concatenated (picture first). These two convert between that index and a
 * (row, column) pair, which is what the arrow keys actually reason about.
 */
export function laneRowPosition(
  flatIndex: number,
  rows: LaneRowLayout,
): Readonly<{ row: number; column: number }> | null {
  if (!Number.isInteger(flatIndex) || flatIndex < 0) return null;
  let remaining = flatIndex;
  for (let row = 0; row < rows.length; row += 1) {
    const size = rows[row]?.length ?? 0;
    if (remaining < size) return { row, column: remaining };
    remaining -= size;
  }
  return null;
}

export function laneFlatIndex(row: number, column: number, rows: LaneRowLayout): number | null {
  const items = rows[row];
  if (!items || column < 0 || column >= items.length) return null;
  let base = 0;
  for (let r = 0; r < row; r += 1) base += rows[r]?.length ?? 0;
  return base + column;
}

/**
 * The column in `items` whose time window is nearest `timeSeconds` — the
 * vertical anchor for an up/down move, so pressing Down on shot 2 lands on
 * the bed that is actually playing under shot 2.
 *
 * Distance is zero for a window that CONTAINS the time, which is what makes a
 * row of back-to-back beds resolve correctly; nearest-start alone would pick
 * the following bed for any time past its midpoint. Ties go to the earlier
 * column.
 */
function nearestColumn(items: readonly LaneRowItem[], timeSeconds: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let column = 0; column < items.length; column += 1) {
    const item = items[column];
    if (!item) continue;
    const end = item.startSeconds + Math.max(0, item.durationSeconds);
    const distance = Math.max(0, item.startSeconds - timeSeconds, timeSeconds - end);
    if (distance < bestDistance) {
      best = column;
      bestDistance = distance;
    }
  }
  return best;
}

/** The next non-empty row in `direction`, or null when there is none. */
function stepRow(row: number, direction: 1 | -1, rows: LaneRowLayout): number | null {
  for (let next = row + direction; next >= 0 && next < rows.length; next += direction) {
    if ((rows[next]?.length ?? 0) > 0) return next;
  }
  return null;
}

/**
 * 2D roving navigation over the lane stack: Left/Right step within a row,
 * Home/End jump to that row's ends, Up/Down cross to the adjacent row at the
 * nearest time.
 *
 * Returns a flat index into the concatenated list, already valid — the hook's
 * own clamp is a no-op on it. That is deliberate: the hook clamps GLOBALLY, so
 * an unclamped `current + 1` at the end of the picture row would spill into
 * the first layer and Right would silently change rows.
 *
 * Up/Down return null rather than the current index when there is no row to
 * move to, which is every plain single-row strip. Returning the current index
 * would have the hook preventDefault a key it did nothing with, and vertical
 * arrows are how the page scrolls when the pointer is over a strip.
 */
export function resolveLaneStripIndex(
  key: string,
  currentFlatIndex: number,
  rows: LaneRowLayout,
): number | null {
  const position = laneRowPosition(currentFlatIndex, rows);
  if (!position) return null;
  const items = rows[position.row];
  if (!items || items.length === 0) return null;

  switch (key) {
    case "ArrowRight":
      return laneFlatIndex(position.row, Math.min(position.column + 1, items.length - 1), rows);
    case "ArrowLeft":
      return laneFlatIndex(position.row, Math.max(position.column - 1, 0), rows);
    case "Home":
      return laneFlatIndex(position.row, 0, rows);
    case "End":
      return laneFlatIndex(position.row, items.length - 1, rows);
    case "ArrowDown":
    case "ArrowUp": {
      const targetRow = stepRow(position.row, key === "ArrowDown" ? 1 : -1, rows);
      if (targetRow === null) return null;
      const target = rows[targetRow];
      if (!target || target.length === 0) return null;
      const from = items[position.column];
      return laneFlatIndex(targetRow, nearestColumn(target, from?.startSeconds ?? 0), rows);
    }
    default:
      return null;
  }
}

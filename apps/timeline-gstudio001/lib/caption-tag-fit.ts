/**
 * How many tag chips fit on a caption's second row.
 *
 * Extracted from `CaptionTagRow` (#281). The app's vitest cannot parse `.tsx`,
 * so while this lived inside the component it could not be tested at all — and
 * it is the part with the interesting rules, not the JSX around it. The
 * component keeps the measuring (a ruler element, a ResizeObserver); this owns
 * the arithmetic.
 */

/** Gap between chips, in px. Must match the row's `gap-1` in the component. */
export const CAPTION_TAG_GAP_PX = 4;

/**
 * The count to show, given each chip's measured width and the row's budget.
 *
 * TWO PASSES, and the order matters. Pass one asks whether everything fits with
 * NO counter, because when nothing folds there is no "+N" to leave room for.
 * Only if that fails does pass two reserve the counter's width and re-fit.
 *
 * Written this way so the answer is ONE-WAY: the reserve depends on pass one's
 * outcome and never on its own, so the fold cannot oscillate between "fits" and
 * "does not fit" as the counter appears and disappears.
 *
 * AT LEAST ONE CHIP, always. A row reading only "+4" says there are tags
 * without showing any, which is strictly worse than one chip and "+3".
 *
 * A budget of 0 means the row is not laid out yet (the caption is
 * `display:none` while the strip is showing). The caller keeps its previous
 * answer rather than folding everything for a frame, so this reports `null` —
 * "no opinion" — instead of a count that would be wrong.
 */
export function fittedTagCount({
  widths,
  budget,
  counterWidth,
  gap = CAPTION_TAG_GAP_PX,
}: Readonly<{
  widths: readonly number[];
  budget: number;
  counterWidth: number;
  gap?: number;
}>): number | null {
  if (budget <= 0) return null;
  if (widths.length === 0) return 0;

  const whole = widths.reduce(
    (total, width, index) => total + width + (index > 0 ? gap : 0),
    0,
  );
  if (whole <= budget) return widths.length;

  const reduced = budget - Math.ceil(counterWidth) - gap;
  let used = 0;
  let count = 0;
  for (const width of widths) {
    const next = used + width + (count > 0 ? gap : 0);
    if (next > reduced) break;
    used = next;
    count += 1;
  }
  return Math.max(1, count);
}

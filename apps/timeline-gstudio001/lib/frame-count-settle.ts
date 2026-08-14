/**
 * When a video card's filmstrip may re-sample its frame count.
 *
 * Extracted from `useSettledFrameCount` in `graph-item-content.tsx` (#281).
 * The hook keeps the state and the timer; this owns the decision, which is a
 * small state machine with a sentinel that means two different things.
 */

/**
 * How long a CHANGED measurement must hold before the filmstrip re-samples.
 *
 * A continuous px/s drag sweeps a card's width→count ratio through several
 * integers, and adopting each crossing re-times every frame slot — swapping
 * every `<img>` src on the card (a fresh CDN URL per slot) several times per
 * drag, per video card. Generous on purpose: the drag's layout already tracks
 * live (widths are CSS); only the frame REFINEMENT waits for the size to hold
 * still.
 */
export const FRAME_COUNT_SETTLE_MS = 400;

/** What the hook should do with a new measurement. */
export type FrameCountStep =
  /** Take it immediately — a freshly (re)mounted card must not wait out the
   *  delay before it shows a filmstrip at all. */
  | "adopt-now"
  /** Start (or restart) the settle timer; the value is a refinement. */
  | "debounce"
  /** Nothing to do. */
  | "hold";

/**
 * `settled === 0` IS THE SENTINEL, and it carries two readings that this
 * function deliberately collapses into one answer:
 *
 *   Nothing has been adopted yet, so the first real measurement should be
 *   taken at once rather than after 400ms of blank card.
 *
 *   The render-time adoption is already in flight — so the effect must NOT
 *   also start a timer for the same value, or a remount would double-schedule.
 *
 * Both mean "do not debounce", which is why one branch covers them.
 *
 * Ordering matters: the equality check comes FIRST, so a genuinely unmeasured
 * card (`settled === 0`, `measured === 0`) holds rather than adopting a zero
 * that would render an empty filmstrip.
 */
export function settleFrameCountStep({
  settled,
  measured,
}: Readonly<{ settled: number; measured: number }>): FrameCountStep {
  if (measured === settled) return "hold";
  if (settled === 0) return "adopt-now";
  return "debounce";
}

/**
 * What to render this pass.
 *
 * While nothing is settled the MEASURED value shows through, so the card
 * paints its filmstrip on the first frame it can rather than after the
 * adoption round-trips through state.
 */
export function visibleFrameCount({
  settled,
  measured,
}: Readonly<{ settled: number; measured: number }>): number {
  return settled === 0 ? measured : settled;
}

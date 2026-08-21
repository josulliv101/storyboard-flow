// A hold remains eligible only inside normal pointer jitter. The very next
// pixel qualifies as a pan, so one movement can never start panning while a
// delayed hold-to-drag activation is still pending.
export const HOLD_DRAG_TOLERANCE_PX = 4;
export const PAN_START_SLOP_PX = HOLD_DRAG_TOLERANCE_PX + 1;

/**
 * Marks a scroll container whose surface PANS on a plain press.
 *
 * Written by the view that installs the pan hook (VirtualStrip, when
 * `panToScroll` is on) and read by the trim gesture, which needs the dwell
 * below on exactly the surfaces where a press is ambiguous. One marker, set by
 * the same condition that enables panning, so the two cannot drift apart —
 * a strip with panning off keeps instant trims because there is nothing to
 * arbitrate against.
 */
export const PAN_SURFACE_ATTR = "data-pan-surface";

/**
 * How long a press on a trim handle must SETTLE before it becomes a trim, on a
 * surface that pans.
 *
 * The strip's law is that everything pans and anything else declares itself:
 * a card body in hold mode is an item drag only after a still press, and a
 * fast move hands it back to the pan. Trim handles were the one surface exempt
 * from that — they committed on the raw pointerdown — so an 8px band at every
 * clip edge (16px at every cut, where two clips sit flush) silently turned a
 * pan into an edit. The cursor was the only warning, and touch does not have
 * one.
 *
 * The bail-out is what makes this safe rather than merely slower: a press that
 * moves past `HOLD_DRAG_TOLERANCE_PX` before this elapses drops the trim
 * entirely, and the pan commits at `PAN_START_SLOP_PX` — one pixel later, by
 * construction — so the handoff can never leave both live or neither.
 *
 * Shorter than hold-to-drag's 250ms on purpose. That delay guards picking a
 * card UP, a bigger commitment than arming an edge, and trimming is the more
 * frequent act of the two — the dwell is a tax on every deliberate trim, so it
 * buys separation at the lowest price that still reads as a settle rather than
 * a stutter. Tried at 1000ms by hand first, which made the two outcomes
 * unmistakable and the gesture tiring; 200 is the value that keeps the
 * separation without charging for it.
 *
 * This is the ONLY place the number lives — the story and e2e settles derive
 * from it (`TRIM_ARM_SETTLE_MS` in stories-helpers, `pressTrimHandle` in
 * graph-view.spec.ts), so tuning it cannot strand a suite on a stale wait.
 */
export const TRIM_ARM_DELAY_MS = 200;

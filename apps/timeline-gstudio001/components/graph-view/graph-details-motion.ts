// ONE PRESS, ONE MOTION.
//
// Stepping the details view moves three things at once: the row of panels
// slides, the outgoing centre narrows while the incoming one widens, and the
// film strip above travels to bring the new subject into view.
//
// They were on four clocks — 300ms for the panel widths, 300ms for the row,
// 520ms for the strip, 200ms for the panel chrome — and every one of them on
// a plain `ease-out`. That is what made the transition read as amateur, and
// neither half of it is a bug: nothing was janky and nothing was wrong. It
// simply looked like four things reacting to the same press rather than one
// thing happening.
//
// ── WHY ONE DURATION AND NOT FOUR SCALED ONES ───────────────────────────────
//
// The obvious alternative is to keep the strip longer because it travels much
// further — around 986px against the row's ~350. But a duration is not a
// speed: giving the far-travelling element more time is how you make it move
// at the same PACE as the near one, and pace is not what the eye reads here.
// What it reads is whether the press produced one event or several, and
// several things settling 220ms apart is the answer "several" no matter how
// well each one is tuned. One duration, different distances, therefore
// different speeds — which is what actually happens when one gesture moves a
// near thing and a far thing.
//
// ── THE CURVE ───────────────────────────────────────────────────────────────
//
// `ease-out` is the curve you get for free, and it looks it: a soft start and
// a long lazy tail that never quite commits. This is an emphasized
// decelerate — it leaves hard, covers most of the distance in the first third,
// and spends the rest settling. Motion that commits early and settles slowly
// reads as weight; motion that eases evenly reads as a tween.
//
// It is deliberately NOT a spring or an overshoot. These panels are frames of
// film with pictures in them, and a picture that bounces past its mark and
// comes back says the software is pleased with itself. The confidence is in
// the departure, not in the arrival.
/**
 * THE STEP'S CURVE, and the reason a step felt violent had nothing to do with
 * how long it lasted.
 *
 * It was `cubic-bezier(0.32, 0.72, 0, 1)` — a hard ease-out, the kind that
 * feels crisp on a 40px control and is brutal on a 507px one. Measured against
 * that distance over 420ms, where the average speed is 1207px/s:
 *
 *   starts at 2716px/s   — from a standing start, in the first frame
 *   peaks at 5094px/s    — 4.2x average, only 16% of the way through
 *   90% of the distance covered in 37% of the time
 *
 * So the card leapt away at more than twice average speed with no acceleration
 * at all, was effectively parked a third of the way in, and spent the remaining
 * 265ms on a settle nobody can see. Both complaints — too quick, too strong —
 * are that one line.
 *
 * LENGTHENING IT WOULD NOT HAVE HELPED: the extra time lands in the invisible
 * tail, and the leap at the front is unchanged.
 *
 * This is ease-in-out-sine. Same 420ms, and it starts from REST:
 *
 *   starts at 0px/s
 *   peaks at 1919px/s    — 1.6x average, halfway through
 *   90% of the distance covered in 79% of the time
 *
 * Peak speed falls by 62%, and the visible motion more than doubles in length —
 * 155ms of it becomes 332ms — without touching the clock. The card accelerates,
 * travels and arrives, instead of appearing already at speed.
 */
const DETAILS_STEP_EASE = "cubic-bezier(0.37, 0, 0.63, 1)";

/**
 * How long a step takes, everywhere it is visible.
 *
 * Longer than the 300ms it replaces, which is the counter-intuitive half:
 * quick reads as cheap here because the distance is large and the curve does
 * most of its work early — at 300ms the settle is over before the eye has
 * followed it, so the motion registers as a jump that happened to be animated.
 * 420ms with this curve is still well inside "immediate" and leaves room for
 * the deceleration to be seen, which is the part that reads as considered.
 */
export const DETAILS_STEP_MS = 420;

/** The step's easing, as a CSS value. */
export const DETAILS_STEP_EASING = DETAILS_STEP_EASE;

/**
 * WIDTH, HEIGHT AND THE ROW'S TRAVEL ALL MOVE TOGETHER, ON THIS CLOCK.
 *
 * Both orderings were built and looked at. Resize-then-slide made the subject
 * grow before it had anywhere to go; slide-then-resize landed it 184px right of
 * centre — half the 368px between the two widths, because the row's offset is
 * computed from a uniform neighbour width and only centres the subject once the
 * subject IS the wide card — and left it to close that gap by growing.
 *
 * Simultaneous was right all along. What was actually wrong was that only HALF
 * of it was animated: width eased over the step and HEIGHT was in nobody's
 * transition list, so a card promoted to subject jumped from 368px tall to 519
 * in a single frame — and because the cards hang from a common bottom, that
 * moved its top edge 151px at the exact moment the row began to travel. One
 * dimension gliding while the other teleported is the whole of what looked
 * wrong; the ordering was never the problem.
 *
 * WIDTH TRAVELS WITH THE ROW; HEIGHT WAITS. The card has to be the right WIDTH
 * when it lands — the row's offset is computed from a uniform neighbour width
 * and only centres the subject once the subject is the wide card, so a width
 * that arrived late would leave the card 184px off centre and creeping. Height
 * is under no such obligation: nothing about the horizontal landing depends on
 * it, and it is the change that was jarring, because the cards hang from a
 * common bottom and 151px of it lands on the top edge.
 *
 * So the vertical change is held back until the horizontal one has effectively
 * finished, and gets a clock of its own.
 */
/** `transition` shorthand for a property that moves with a step. */
export function detailsStepTransition(properties: string): string {
  return properties
    .split(",")
    .map((property) => `${property.trim()} ${DETAILS_STEP_MS}ms ${DETAILS_STEP_EASE}`)
    .join(", ");
}

/**
 * The chrome's own timing — a ring brightening, a shadow lifting.
 *
 * Deliberately SHORTER and on the same curve. These do not travel, so matching
 * the step's duration would leave a border still resolving long after the thing
 * it borders had arrived. Half the step, so it lands inside it rather than
 * alongside it.
 */
export const DETAILS_CHROME_MS = 210;

/**
 * How long the height change takes, once it starts.
 *
 * Shorter than the step, because it is a correction rather than a journey —
 * 151px against the row's 507. At this duration it peaks around 1482px/s,
 * comfortably under the row's own 1919, so the thing that waits is also the
 * quieter of the two.
 */
export const DETAILS_HEIGHT_MS = 160;

/**
 * When it starts — DERIVED, so that width and height LAND TOGETHER.
 *
 * They used to finish 80ms apart: width and the row's travel stopped at 420ms
 * and the height ran on to 500. That tail is the whole of what felt off. Every
 * other part of the step had settled and one edge was still creeping, so the
 * motion ended twice and the second ending was the one you noticed.
 *
 * Written as a subtraction rather than as its own number so the two cannot
 * drift apart again: change either clock and they still land on the same frame.
 * The height still WAITS — it starts at 260ms, well over halfway through the
 * travel — it simply stops when everything else does.
 */
export const DETAILS_HEIGHT_DELAY_MS = DETAILS_STEP_MS - DETAILS_HEIGHT_MS;

/**
 * How long the subject's chrome takes to LEAVE the card losing it, and how
 * long the card gaining it waits before claiming it.
 *
 * A step grows one card and shrinks another at the same time, and for the few
 * frames either side of the crossing they are near enough the same size that
 * neither reads as the subject. Watched back frame by frame, the eye has
 * nothing to follow through the middle of the step.
 *
 * THE FIX IS NOT TO STAGGER THE WIDTHS. Both cards change by exactly the same
 * amount in opposite directions, so animating them together keeps the row's
 * total width invariant; offsetting them makes it dip by that amount — 236px
 * at 1920 — and every card to the right of the pair slides out and back. The
 * geometry has to stay simultaneous.
 *
 * So the HANDOFF is staggered instead, which costs no layout at all. The
 * outgoing card drops its surface and border inside this window; the incoming
 * one waits it out before taking them. The two never wear the mark at once,
 * so there is exactly one subject at every frame of the step even while the
 * sizes are crossing.
 *
 * A third of the step. Long enough to read as a handoff rather than a
 * simultaneous swap, short enough that the arriving card is fully marked well
 * before it stops moving.
 */
export const DETAILS_HANDOFF_MS = 140;

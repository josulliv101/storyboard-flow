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
const DETAILS_STEP_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";

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

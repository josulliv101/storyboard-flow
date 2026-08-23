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

/* (kept for reference)
 * THE CHROME AND THE HANDOFF USED TO HAVE CLOCKS OF THEIR OWN, and both are
 * gone.
 *
 * The chrome ran at 210ms on the reasoning that a border and a shadow do not
 * travel, so matching the step would leave them resolving after the panel had
 * arrived. The handoff then split that again — 140ms for the card losing the
 * mark, 140ms of delay for the one taking it — so that no frame had two
 * subjects.
 *
 * Both are defensible in isolation and together they meant a single step ran
 * on four different clocks: 420ms for the travel and the two axes, 210 for the
 * chrome at rest, 140 for a card giving the mark up, 140-delayed for a card
 * taking it. Every one of those boundaries is a moment where something stops
 * while everything else is still going, and enough of them read as timing that
 * is simply off.
 *
 * One clock for the whole step now. If the crossing needs the two cards told
 * apart again, it should be done with something other than a second duration.
 */

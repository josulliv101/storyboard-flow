// Immediate press feedback on a card — the acknowledgement a deferred
// selection cannot give.
//
// A collection's click-selection is HELD for the double-click window
// (`SELECTION_DEFER_MS`) so an ordinary double-click never paints a selection
// on its way into the drill-in. Correct, but it leaves a stretch where a click
// has landed and nothing on screen has changed, and that reads as the app
// missing the click. This fills it: the animation starts on POINTERDOWN, before
// the selection question is even asked, so the answer to "did that register?"
// no longer depends on what the click turns out to mean.
//
// It therefore plays for EVERY press — single click, the first click of a
// double, and the start of a drag. That is the point. Feedback conditional on
// the gesture's outcome would arrive exactly as late as the thing it covers for.
//
// IMPERATIVE, not React state. This is transient decoration no other component
// reads, and routing it through state would re-render the pressed card on every
// press — the dnd-collections efficiency model is built on cards NOT
// re-rendering when nothing they display has changed, and a story test
// (`RenderEfficiencyDuringDrag`) fails when a bystander card re-renders.
// Animating an element directly sidesteps all of it.

/**
 * Peak scale. Deliberately tiny — the brief is "barely even notice it".
 *
 * Tuned DOWN twice by eye: 1.035 -> 1.02 -> 1.012. On a ~360px card frame
 * that is roughly 12.7px -> 7.2px -> 4.3px of growth.
 *
 * The reason it kept needing to shrink is worth recording: duration and
 * amplitude trade against each other. At the original 340ms a 3.5% swell was
 * barely legible, but the motion was later slowed to 640ms, and once the eye
 * has time to FOLLOW the movement the same number reads as a real zoom. If
 * `PRESS_MS` is ever shortened again, this can afford to grow back.
 */
const PRESS_SCALE = 1.012;

/**
 * Out and back, in equal halves.
 *
 * Deliberately unhurried. 340ms was the first value and read as a twitch —
 * the swell arrived and left before the eye settled on it. At 640 the motion
 * is slow enough to follow, which is what makes something this small (3.5%)
 * legible at all.
 *
 * It deliberately OUTLASTS the 250ms selection hold. The two are not sequential
 * steps to be kept apart: the scale acknowledges the press, the selection
 * answers what the press meant, and letting the first still be settling when
 * the second lands reads as one continuous response rather than two events.
 */
const PRESS_MS = 640;

/**
 * Acknowledge a press by letting the card's artwork swell very slightly.
 *
 * THE IMAGES, not the card. Two reasons, and the first is a correctness one:
 *
 *  - dnd-kit drives drags with `transform` on the card and its wrapper. A press
 *    is also where a drag begins, so animating the card's own transform would
 *    put this in direct conflict with the drag it may be starting.
 *  - The frame row that holds the images already clips (`overflow-hidden`), so
 *    scaling the images inside it reads as a gentle zoom WITHIN the frame. The
 *    card's own geometry never moves, which is what keeps neighbouring cards
 *    still and the effect subtle.
 *
 * Scaling every image covers both card shapes without either knowing about
 * this: media cards carry one filmstrip frame, collection cards up to three
 * preview frames, and both are plain `<img>`.
 */
export function spawnPressFeedback(host: HTMLElement): void {
  if (typeof window === "undefined") return;
  // Reduced motion means NO animation. The effect IS the motion, so there is
  // no static fallback worth substituting.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const images = host.querySelectorAll<HTMLElement>("img");
  for (const image of images) {
    if (typeof image.animate !== "function") continue;
    image.animate(
      [
        // PER-KEYFRAME easing, because the two halves want different curves
        // and the timing option below could only apply one shape to both.
        //
        // GROW — starts almost imperceptibly and accelerates into full size.
        // The acceleration is the point: a press should feel like it is being
        // answered with increasing conviction, not like a value being
        // interpolated.
        { transform: "scale(1)", easing: "ease-in" },
        // SHRINK — leaves the peak at the speed the grow arrived with, then
        // decelerates to rest. Pairing ease-in up with ease-out down keeps the
        // SPEED continuous through the apex; two ease-ins back to back would
        // slam to a halt at full size and read as a bump.
        //
        // Exactly the MIDPOINT, so growing and shrinking still take the same
        // wall time.
        { transform: `scale(${PRESS_SCALE})`, offset: 0.5, easing: "ease-out" },
        { transform: "scale(1)" },
      ],
      // LINEAR overall. The per-keyframe curves above do all the shaping; an
      // easing here would warp PROGRESS as well, which moves the `offset: 0.5`
      // keyframe off the midpoint in wall time and quietly breaks the equal
      // halves.
      { duration: PRESS_MS, easing: "linear" },
    );
  }
  // No cleanup: a Web Animations keyframe effect with no `fill` leaves the
  // element exactly as it found it, so nothing has to be undone — and an
  // element that unmounts mid-animation (a drill-in does that immediately)
  // takes its animation with it.
}

/**
 * The card a press landed on, or null when the press does not deserve feedback.
 *
 * Controls own their own gestures and their own feedback — the chevron and the
 * `⋮` already have hover and active states, so animating the whole card
 * underneath them would claim something happened to the card when it did not.
 */
export function pressFeedbackHostFor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-collections-keyboard-ignore]") !== null) return null;
  return target.closest<HTMLElement>("[data-node-id]");
}

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

/** Peak scale. Deliberately tiny — the brief is "barely even notice it", and
 *  anything past ~1.05 stops reading as acknowledgement and starts reading as
 *  a hover effect. */
const PRESS_SCALE = 1.035;

/** Out and back. Long enough to be a smooth swell rather than a twitch, short
 *  enough to be over before the 250ms selection hold resolves. */
const PRESS_MS = 340;

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
        { transform: "scale(1)" },
        { transform: `scale(${PRESS_SCALE})`, offset: 0.45 },
        { transform: "scale(1)" },
      ],
      // ease-in-out both ways: the swell and the settle should feel like one
      // motion. Easing only on the way out makes the return look like a snap.
      { duration: PRESS_MS, easing: "ease-in-out" },
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

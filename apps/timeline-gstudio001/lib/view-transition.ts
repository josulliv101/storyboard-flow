import { flushSync } from "react-dom";

// CSS view transitions, for the two places that animate between DOM states:
// the trim modal growing out of its card (PL10-008) and the trash drawer
// rising from the bottom edge.
//
// Extracted from the modal, which had it inline, once the drawer became a
// second caller. Two copies would be two chances to forget the root flag
// below, and the e2e's `settleViewTransition` depends on every caller setting
// it — a transition that does not announce itself is one the suite cannot wait
// for, and the failure lands on a later step as a click that did nothing.
//
// NOT for a change to a container the rest of the layout is measured against.
// A view transition snapshots the WHOLE page, so animating something the page
// is laid out around (the icon rail's width, say) paints the old and new
// layouts on top of each other. The two callers here are both overlays.

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type ViewTransition = {
  finished: Promise<void>;
  // Rejects with an AbortError when the transition is SKIPPED — another one
  // starting, the tab hiding, or the browser deciding it cannot capture. It is
  // declared here only so it can be silenced; see the note at the call.
  ready?: Promise<void>;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => ViewTransition;
};

/**
 * Runs `mutate` inside a view transition when the browser has one, and plainly
 * when it doesn't (or when the user asked for less motion). `flushSync` is
 * required, not decorative: the browser captures the "after" state the moment
 * the callback returns, and a normal React update would still be queued.
 */
export type ViewTransitionOptions = Readonly<{
  /**
   * Run even when the system asks for less motion.
   *
   * OFF BY DEFAULT, and it should stay off for anything that MOVES — the
   * default here exists because a preference for less motion is an
   * accessibility setting, not a style choice.
   *
   * The one caller that sets it is the board card flying into the details
   * view, at the owner's explicit request after finding it silently absent on
   * a machine with the preference on. That flight is a morph between two
   * positions of the same picture rather than something sliding across the
   * page, and it is the only thing that says the card and the view are the
   * same shot — without it opening a clip is a hard cut.
   *
   * Anything new that wants this should be asked for the same way, out loud.
   */
  ignoreReducedMotion?: boolean;
}>;

export function withViewTransition(
  mutate: () => void,
  options: ViewTransitionOptions = {},
): Promise<void> {
  const doc = document as ViewTransitionDocument;
  const quiet = prefersReducedMotion() && options.ignoreReducedMotion !== true;
  if (!doc.startViewTransition || quiet) {
    mutate();
    return Promise.resolve();
  }
  // Announce the transition on the root, SYNCHRONOUSLY, before it starts.
  // While one runs the browser paints a snapshot over the page and every
  // pointer event lands on <html>, so "is a transition in flight?" is a real
  // question about whether the UI is inert — and polling `getAnimations()`
  // cannot answer it, because the animations only exist after the browser has
  // captured a frame. Anything waiting for the UI to be live again (the e2e
  // does) watches this attribute instead.
  doc.documentElement.dataset.viewTransition = "running";
  const transition = doc.startViewTransition(() => {
    flushSync(mutate);
  });
  // `ready` REJECTS ON A SKIP, and nothing was listening to it — so a skipped
  // transition surfaced as an unhandled "AbortError: Transition was skipped".
  // Harmless to the DOM (the callback has already run) but not harmless to a
  // test runner, which counts an unhandled rejection against whatever test
  // happened to be in flight: it took out six unrelated stories in one run,
  // each of which passed on its own.
  //
  // Silenced rather than surfaced because a skip is a normal outcome here —
  // opening a second clip before the first has finished animating skips the
  // first, and that is the interaction working, not failing.
  transition.ready?.catch(() => {});
  return transition.finished.catch(() => {
      // A transition can be abandoned (another one starts, the tab hides).
      // The DOM change has already happened either way.
    })
    .finally(() => {
      delete doc.documentElement.dataset.viewTransition;
    });
}

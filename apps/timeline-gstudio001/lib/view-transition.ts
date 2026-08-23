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

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

/**
 * Runs `mutate` inside a view transition when the browser has one, and plainly
 * when it doesn't (or when the user asked for less motion). `flushSync` is
 * required, not decorative: the browser captures the "after" state the moment
 * the callback returns, and a normal React update would still be queued.
 */
/**
 * Whether a view transition would actually run, asked at the moment of the
 * gesture rather than during render.
 *
 * Deliberately NOT a hook. A render-time capability check differs between the
 * server and the client and desynchronises hydration; this is only ever read
 * inside an event handler, where the DOM is real and the answer is honest.
 */
export function canViewTransition(): boolean {
  const doc = document as ViewTransitionDocument;
  return Boolean(doc.startViewTransition) && !prefersReducedMotion();
}

export function withViewTransition(mutate: () => void): Promise<void> {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || prefersReducedMotion()) {
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
  return doc
    .startViewTransition(() => {
      flushSync(mutate);
    })
    .finished.catch(() => {
      // A transition can be abandoned (another one starts, the tab hides).
      // The DOM change has already happened either way.
    })
    .finally(() => {
      delete doc.documentElement.dataset.viewTransition;
    });
}

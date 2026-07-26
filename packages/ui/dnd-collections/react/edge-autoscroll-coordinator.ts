"use client";

import { finiteNonNegativeOr, finitePositiveOr } from "../core/numeric";
import {
  AUTO_SCROLL_FRAME_MS,
  edgeScrollVelocity,
  frameScaledDistance,
} from "./edge-autoscroll-math";
import { type CollectionsStore } from "./collections-store";

// ONE edge auto-scroll driver per provider instance, replacing a driver per
// mounted virtual view. Every view used to install its own window pointer
// tracker and — the moment ANY drag went live — start its own
// requestAnimationFrame loop plus capture-phase scroll/resize listeners, even
// though the pointer can only ever sit in one place. The recursive sub-graph
// tree multiplies mounted views, so one drag ran O(mounted views) schedulers
// per frame. Views now REGISTER their containers here; one pointer tracker
// and one frame loop serve them all, and each frame runs the exact per-view
// math the old hook ran (a container scrolls iff it would have before — the
// cross-axis span check keeps disjoint views from fighting, same as N loops
// did).
//
// The pieces worth not reinventing are lifted verbatim from the per-view
// hook: pointer tracking from POINTERDOWN (the move that crosses dnd-kit's
// activation threshold may be the last pointer event before the user parks
// at an edge — see the ActivationPointerSeedsEdgeAutoScroll story), lazy
// pointermove attach (idle mouse movement costs nothing), per-entry cached
// rects refreshed on ancestor scroll/resize but never on the container's own
// scroll (scrolling a container moves its content, not its box), and
// elapsed-time-scaled distances (a 120Hz display must not scroll twice as
// fast as a 60Hz one).

export type EdgeAutoScrollOptions = Readonly<{ edge?: number; maxSpeed?: number }>;

/** The one bit of `Node` the containment rule below needs. Structural on
 *  purpose: it lets the rule be unit-tested in the node-env project, which has
 *  no DOM. */
export type ContainmentNode = Readonly<{ contains: (other: never) => boolean }>;

/**
 * Whether a scroll on `scope` can have moved `el`'s box — the rule that keeps
 * the frame loop off O(mounted views) forced layouts.
 *
 * - The scroller itself: NO. Scrolling a container moves its content, not its
 *   own box. (This is also every frame of our own auto-scroll.)
 * - Something inside it: yes, that content travelled.
 * - Something outside it: NO. A sibling view cannot move because another
 *   scroller scrolled.
 * - `scope === null` (a resize, whose target is `window`, not a Node): yes,
 *   anything may have moved.
 *
 * A window/document scroll needs no special case: `document.contains(el)` is
 * true for every mounted element, so it measures all.
 */
export function scrollCanMoveBox(scope: ContainmentNode | null, el: ContainmentNode): boolean {
  if (scope === null) return true;
  if (scope === el) return false;
  return scope.contains(el as never);
}

type Entry = {
  readonly el: HTMLElement;
  readonly axis: "x" | "y";
  readonly edge: number;
  readonly maxSpeed: number;
  rect: DOMRect;
};

export type EdgeAutoScrollCoordinator = Readonly<{
  /** Enroll a scroll container; returns unregister. Safe at any time — an
   *  entry registered mid-drag joins the live loop with a fresh rect. */
  register: (el: HTMLElement, axis: "x" | "y", options?: EdgeAutoScrollOptions) => () => void;
  /**
   * Install the window listeners and the store subscription that starts/stops
   * the frame loop with drag state. Effect-shaped on purpose (returns
   * teardown): creating the coordinator must stay side-effect-free so the
   * provider can build it during render under StrictMode/SSR.
   */
  attach: () => () => void;
}>;

export function createEdgeAutoScrollCoordinator(
  store: CollectionsStore
): EdgeAutoScrollCoordinator {
  const entries = new Set<Entry>();

  // --- pointer tracking (one instance of the old per-view pattern) ---------
  let pointer: Readonly<{ id: number; x: number; y: number }> | null = null;
  const handleMove = (event: PointerEvent) => {
    if (pointer?.id !== event.pointerId) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const detachMove = () => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleEnd);
    window.removeEventListener("pointercancel", handleEnd);
  };
  function handleEnd(event: PointerEvent) {
    // Only the tracked pointer's own release tears down: a foreign or
    // non-primary pointer's up must not stop tracking the one we own.
    if (pointer?.id !== event.pointerId) return;
    pointer = null;
    detachMove();
  }
  const handleDown = (event: PointerEvent) => {
    if (!event.isPrimary) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    // addEventListener dedupes identical (type, listener, capture) triples,
    // so a second primary press before release can't double-bind.
    window.addEventListener("pointermove", handleMove, { passive: true });
    window.addEventListener("pointerup", handleEnd, { passive: true });
    window.addEventListener("pointercancel", handleEnd, { passive: true });
  };

  // --- the frame loop ------------------------------------------------------
  let running = false;
  let frame = 0;
  let lastTime: number | null = null;

  const measureAll = () => {
    for (const entry of entries) entry.rect = entry.el.getBoundingClientRect();
  };
  const remeasure = (event: Event) => {
    // Scoped by `scrollCanMoveBox`, because this is the hottest path in the
    // package: the listener is capture-phase on window, so it sees every
    // scroll in the document — including the ones this very loop causes when
    // it writes scrollLeft/scrollTop each frame. Measuring every entry there
    // meant one forced layout per mounted view per frame, and the recursive
    // sub-graph tree is exactly what multiplies mounted views.
    const scope = event.target instanceof Node ? (event.target as ContainmentNode) : null;
    for (const entry of entries) {
      if (!scrollCanMoveBox(scope, entry.el as unknown as ContainmentNode)) continue;
      entry.rect = entry.el.getBoundingClientRect();
    }
  };

  const step = (now: number) => {
    // Scale each tick by the real elapsed time (the rAF timestamp), not a
    // fixed per-frame amount. First frame uses one baseline frame's worth.
    const elapsedMs = lastTime === null ? AUTO_SCROLL_FRAME_MS : now - lastTime;
    lastTime = now;
    if (pointer !== null) {
      for (const entry of entries) {
        const { rect } = entry;
        const inCrossAxis =
          entry.axis === "x"
            ? pointer.y >= rect.top && pointer.y <= rect.bottom
            : pointer.x >= rect.left && pointer.x <= rect.right;
        if (!inCrossAxis) continue;
        const [position, start, end] =
          entry.axis === "x"
            ? [pointer.x, rect.left, rect.right]
            : [pointer.y, rect.top, rect.bottom];
        const velocity = edgeScrollVelocity(position, start, end, entry.edge, entry.maxSpeed);
        if (velocity !== 0) {
          const distance = frameScaledDistance(velocity, elapsedMs);
          if (entry.axis === "x") entry.el.scrollLeft += distance;
          else entry.el.scrollTop += distance;
        }
      }
    }
    frame = requestAnimationFrame(step);
  };

  const start = () => {
    if (running) return;
    running = true;
    lastTime = null;
    measureAll();
    window.addEventListener("scroll", remeasure, { passive: true, capture: true });
    window.addEventListener("resize", remeasure, { passive: true });
    frame = requestAnimationFrame(step);
  };
  const stop = () => {
    if (!running) return;
    running = false;
    window.removeEventListener("scroll", remeasure, { capture: true });
    window.removeEventListener("resize", remeasure);
    cancelAnimationFrame(frame);
  };

  return {
    register: (el, axis, options) => {
      const entry: Entry = {
        el,
        axis,
        edge: finitePositiveOr(options?.edge, 48),
        maxSpeed: finiteNonNegativeOr(options?.maxSpeed, 14),
        rect: el.getBoundingClientRect(),
      };
      entries.add(entry);
      return () => {
        entries.delete(entry);
      };
    },
    attach: () => {
      window.addEventListener("pointerdown", handleDown, { passive: true });
      // Explicit drag-live flag: set by beginDrag/beginPaletteDrag, cleared
      // by endDrag — never inferred from intents, which can be null mid-drag
      // over dead zones (and must never leak past a drop).
      const unsubscribe = store.subscribe(() => {
        if (store.getSnapshot().interaction.isDragging) start();
        else stop();
      });
      // Attach can land mid-drag (StrictMode re-mount); don't miss the state.
      if (store.getSnapshot().interaction.isDragging) start();
      return () => {
        unsubscribe();
        stop();
        window.removeEventListener("pointerdown", handleDown);
        detachMove();
        pointer = null;
      };
    },
  };
}

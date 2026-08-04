"use client";

import { useEffect, useState } from "react";

import type { RulerWindow } from "./graph-playhead-model";

/** Ticks are drawn in fixed-width CHUNKS rather than per pixel: the window
 *  changes when scrolling crosses a chunk boundary, so the per-scroll-event
 *  work is a compare-and-bail, and each re-render is amortized over ~512px
 *  of travel. One chunk of overscan each side keeps ticks present under the
 *  pointer during the between-chunks glide. */
const RULER_WINDOW_CHUNK_PX = 512;

/** Pre-measure fallback: covers any plausible first paint from scroll 0 so
 *  the ruler is never blank while the ResizeObserver's initial (async)
 *  delivery is in flight; the first real measure then tightens it. */
const INITIAL_RULER_WINDOW: RulerWindow = { startX: 0, endX: RULER_WINDOW_CHUNK_PX * 8 };


// Finding the scroll container an overlay must track, and the window of ticks
// worth drawing in it.
//
// Shared by the ruler (which climbs to its scroller with `closest`) and the
// seek rails (whose rail is a SIBLING of the scroller and has to query across),
// so it sits beside them rather than inside either.

/**
 * The window of ruler ticks worth drawing for a scroll container.
 *
 * The RULER can climb to its own scroller from inside it (it is an ancestor,
 * reachable with `closest`), while the seek rail is a SIBLING of the strip
 * and has to query across. Both hand the same element here.
 *
 * Updates ride the scroller's scroll event and a ResizeObserver — both async,
 * so no synchronous setState-in-effect; the observer's initial delivery IS the
 * first measurement.
 */
export function useScrollerTickWindow(scroller: HTMLElement | null): RulerWindow {
  const [tickWindow, setTickWindow] = useState<RulerWindow>(INITIAL_RULER_WINDOW);

  useEffect(() => {
    // No scroller yet (or not inside a strip): the initial window stands,
    // degrading to the unwindowed behavior for the first few thousand pixels.
    if (!scroller) return;
    const update = () => {
      const chunk = RULER_WINDOW_CHUNK_PX;
      const startX = Math.max(0, (Math.floor(scroller.scrollLeft / chunk) - 1) * chunk);
      const endX = (Math.ceil((scroller.scrollLeft + scroller.clientWidth) / chunk) + 1) * chunk;
      setTickWindow((previous) =>
        previous.startX === startX && previous.endX === endX
          ? previous
          : { startX, endX },
      );
    };
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scroller]);

  return tickWindow;
}

/** The strip scroller for an element that rides the strip's own overlay layer
 *  (the ruler climbs to it) or sits beside it (the rail queries across).
 *  Resolved in a REF CALLBACK rather than an effect — the repo's lint forbids
 *  the synchronous setState-in-effect this would otherwise be. */
export const stripScrollerAbove = (element: HTMLElement): HTMLElement | null =>
  element.closest<HTMLElement>("[data-virtual-strip]");
export const stripScrollerBeside = (element: HTMLElement): HTMLElement | null =>
  element.parentElement?.querySelector<HTMLElement>("[data-virtual-strip]") ?? null;


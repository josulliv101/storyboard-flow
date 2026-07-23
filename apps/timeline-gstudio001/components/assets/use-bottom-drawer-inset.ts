"use client";

import { useLayoutEffect, type RefObject } from "react";

/**
 * The page's bottom inset, in px, owned by whichever bottom drawer is open.
 * `app/layout.tsx` pads `<main>` by it, and the workbench preview subtracts it
 * from the visible viewport when sizing itself.
 */
const BOTTOM_INSET_VARIABLE = "--asset-library-height";

/**
 * Publish an open bottom drawer's height as the page's bottom inset.
 *
 * A drawer that is `position: fixed` at the bottom covers page content, and
 * nothing scrolls it out from under: the page's scroll range ends where its
 * content ends, so the last rows of a board simply cannot be brought into
 * view. Padding `<main>` by the drawer's live height extends that range by
 * exactly the covered amount.
 *
 * Shared by every bottom drawer rather than re-implemented per drawer — the
 * asset library had this and the graph's asset palette did not, which is
 * precisely how the graph board ended up with unreachable content. The height
 * is observed, not assumed, so a drawer that grows (content, a resize, a
 * wrapped toolbar) keeps the inset honest, and unmounting or closing restores
 * it to zero.
 */
export function useBottomDrawerInset(
  panelRef: RefObject<HTMLElement | null>,
  open: boolean,
): void {
  useLayoutEffect(() => {
    const root = document.documentElement;

    if (!open) {
      root.style.setProperty(BOTTOM_INSET_VARIABLE, "0px");
      return;
    }

    const panel = panelRef.current;
    if (!panel) return;

    const publishHeight = () => {
      root.style.setProperty(
        BOTTOM_INSET_VARIABLE,
        `${panel.getBoundingClientRect().height}px`,
      );
    };

    publishHeight();
    const observer = new ResizeObserver(publishHeight);
    observer.observe(panel);
    window.addEventListener("resize", publishHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publishHeight);
      root.style.setProperty(BOTTOM_INSET_VARIABLE, "0px");
    };
  }, [open, panelRef]);
}

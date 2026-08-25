"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Makes `aria-modal="true"` true.
 *
 * The graph view's two portalled dialogs — the item details modal and the
 * shortcuts sheet — declared `role="dialog" aria-modal="true"` and did none of
 * what that attribute promises: focus stayed on whatever was behind the scrim,
 * Tab walked straight out into the board, and closing left focus wherever the
 * dialog had abandoned it. `aria-modal` tells assistive technology that
 * everything outside is unavailable, so a screen-reader user tabbing out
 * landed in content their reader had been told was hidden, with no way back.
 *
 * Three behaviours, which is what the attribute is short for:
 *
 *   1. Focus moves IN on open — the first focusable descendant, or the panel
 *      itself (it takes `tabIndex={-1}` from `dialogProps`) when there is none.
 *   2. Tab CYCLES inside. Computed per keypress rather than cached: these
 *      dialogs mount controls conditionally (the rename editor swaps in for a
 *      label, undo/redo enable and disable), so a list captured at open goes
 *      stale while the dialog is still on screen.
 *   3. Focus is RESTORED on close, to whatever held it before — the card the
 *      modal was opened from, so the board's roving focus is not reset.
 *
 * Everything outside the dialog is also made `inert`, which is the DOM's own
 * version of the same claim: it removes the background from the tab order and
 * the accessibility tree together, so the two cannot disagree.
 *
 * `trapFocus: false` KEEPS 1 AND 3 AND DROPS 2 (PL15-029). The details views
 * are not dialogs any more — they replace the content area rather than cover
 * it — and trapping Tab inside something that is not modal is the same defect
 * this hook was written to fix, arrived at from the other side: the reader is
 * told nothing is hidden, and then cannot leave. The inert marking goes with
 * it, for the same reason.
 *
 * Moving focus IN and RESTORING it are not modal behaviours, though, and they
 * are the two worth keeping. Restoring in particular: focus goes back to the
 * card the view was opened from, which is what stops the board's roving focus
 * resetting to the top every time someone looks at a clip.
 */

/** Focusable candidates, in DOM order. `:not([inert] *)` keeps the background
 *  out once it has been marked, and negative tabindex is excluded because it
 *  is reachable by script but not by Tab. */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) =>
      !element.hasAttribute("inert") &&
      element.getAttribute("aria-hidden") !== "true" &&
      // offsetParent is null for display:none; a fixed-position element has
      // none either, hence the rect fallback.
      (element.offsetParent !== null || element.getBoundingClientRect().height > 0),
  );
}

export function useDialogFocus<T extends HTMLElement>(
  options?: Readonly<{ trapFocus?: boolean }>,
) {
  const trapFocus = options?.trapFocus ?? true;
  const panelRef = useRef<T | null>(null);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Everything that is not this dialog's own portal root. `inert` covers the
    // tab order AND the accessibility tree, so it is the one attribute that
    // makes aria-modal's claim actually hold.
    const backdrop = trapFocus
      ? Array.from(document.body.children).filter(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && !element.contains(panel),
        )
      : [];
    const previouslyInert = backdrop.map((element) => element.hasAttribute("inert"));
    for (const element of backdrop) element.setAttribute("inert", "");

    const first = focusableWithin(panel)[0];
    (first ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = focusableWithin(panel);
      if (focusable.length === 0) {
        // Nothing to move between — keep focus on the panel rather than
        // letting Tab escape into the inert background.
        event.preventDefault();
        panel.focus();
        return;
      }
      const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
      const wrapTo = event.shiftKey ? focusable[focusable.length - 1] : focusable[0];
      const active = document.activeElement;
      // `focusable` was length-checked above, so both ends exist; with nothing
      // to wrap to there is no trap to enforce and the key should pass through
      // rather than be swallowed.
      if (wrapTo !== undefined && (active === edge || !panel.contains(active))) {
        event.preventDefault();
        wrapTo.focus();
      }
    };

    if (trapFocus) document.addEventListener("keydown", onKeyDown, true);
    return () => {
      if (trapFocus) document.removeEventListener("keydown", onKeyDown, true);
      backdrop.forEach((element, index) => {
        if (!previouslyInert[index]) element.removeAttribute("inert");
      });
      // The element may itself have been removed (the card was deleted while
      // the modal was open) — focusing a detached node is a silent no-op, so
      // check rather than trust.
      if (restoreTo?.isConnected) restoreTo.focus();
    };
  }, [trapFocus]);

  /** Spread onto the dialog's own element. `tabIndex={-1}` is what lets the
   *  panel hold focus when it contains no focusable control. */
  const dialogProps = { ref: panelRef, tabIndex: -1 } as const;

  const focusPanel = useCallback(() => panelRef.current?.focus(), []);

  return { panelRef, dialogProps, focusPanel };
}

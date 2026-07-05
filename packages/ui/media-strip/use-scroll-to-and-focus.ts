import { useCallback, useRef } from "react";
import { type Virtualizer } from "@tanstack/react-virtual";

/**
 * A custom hook to coordinate scrolling a virtualized list to an index
 * and shifting focus to the corresponding item once it mounts in the DOM.
 * Includes a request cancellation token to prevent overlapping focus-shifting
 * loops during rapid key interactions.
 */
export function useScrollToAndFocus(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>
) {
  const activeRequestIdRef = useRef<number>(0);

  const scrollToAndFocus = useCallback(
    (index: number, valueId: string, preferHandle: boolean = false) => {
      // Increment request ID to invalidate any pending focus polling loops
      const requestId = ++activeRequestIdRef.current;

      rowVirtualizer.scrollToIndex(index, { align: "auto" });

      const escapedId = CSS.escape(valueId);
      let retries = 5;

      const focusTarget = () => {
        // If a newer request has started in the meantime, cancel this polling loop
        if (requestId !== activeRequestIdRef.current) return;

        const viewport = viewportRef.current;
        if (!viewport) return;

        // Try to find the grip handle if in reordering mode, or the card item if in standard navigation
        const selector = preferHandle
          ? `[data-reorder-handle="${escapedId}"]`
          : `[data-value="${escapedId}"], [value="${escapedId}"]`;

        const targetEl = viewport.querySelector<HTMLElement>(selector);

        if (targetEl) {
          targetEl.focus();
        } else if (retries > 0) {
          retries--;
          requestAnimationFrame(focusTarget);
        }
      };

      requestAnimationFrame(focusTarget);
    },
    [viewportRef, rowVirtualizer]
  );

  return scrollToAndFocus;
}

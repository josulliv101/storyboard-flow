import { useCallback, useRef, useEffect } from "react";
import { type Virtualizer } from "@tanstack/react-virtual";
import {
  DATA_VALUE_ATTR,
  VALUE_ATTR,
  DATA_REORDER_HANDLE_ATTR,
} from "./media-strip.dom-utils";

const FOCUS_FALLBACK_TIMEOUT_MS = 500;

/**
 * A custom hook to coordinate scrolling a virtualized list to an index
 * and shifting focus to the corresponding item once it mounts in the DOM.
 * Uses a MutationObserver to listen for DOM mounts immediately and cleanly.
 */
export function useScrollToAndFocus(
  viewportRef: React.RefObject<HTMLDivElement | null>,
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>
) {
  const activeObserverRef = useRef<MutationObserver | null>(null);
  const activeTimeoutRef = useRef<number | null>(null);

  // Clean up observers and timers on unmount
  useEffect(() => {
    return () => {
      if (activeObserverRef.current) {
        activeObserverRef.current.disconnect();
      }
      if (activeTimeoutRef.current) {
        clearTimeout(activeTimeoutRef.current);
      }
    };
  }, []);

  const scrollToAndFocus = useCallback(
    (index: number, valueId: string, preferHandle: boolean = false) => {
      // Disconnect any existing observer and clear any active timeout
      if (activeObserverRef.current) {
        activeObserverRef.current.disconnect();
        activeObserverRef.current = null;
      }
      if (activeTimeoutRef.current) {
        clearTimeout(activeTimeoutRef.current);
        activeTimeoutRef.current = null;
      }

      rowVirtualizer.scrollToIndex(index, { align: "auto" });

      const viewport = viewportRef.current;
      if (!viewport) return;

      const escapedId = CSS.escape(valueId);
      const selector = preferHandle
        ? `[${DATA_REORDER_HANDLE_ATTR}="${escapedId}"]`
        : `[${DATA_VALUE_ATTR}="${escapedId}"], [${VALUE_ATTR}="${escapedId}"]`;

      // Check if target element is already present in the DOM
      const targetEl = viewport.querySelector<HTMLElement>(selector);
      if (targetEl) {
        targetEl.focus();
        return;
      }

      // Start observing the viewport DOM mutations to catch mounting
      const observer = new MutationObserver((_mutations, obs) => {
        const el = viewport.querySelector<HTMLElement>(selector);
        if (el) {
          el.focus();
          obs.disconnect();
          if (activeObserverRef.current === obs) {
            activeObserverRef.current = null;
          }
          if (activeTimeoutRef.current) {
            clearTimeout(activeTimeoutRef.current);
            activeTimeoutRef.current = null;
          }
        }
      });

      activeObserverRef.current = observer;
      observer.observe(viewport, { childList: true, subtree: true });

      // Fallback timeout to prevent memory leak if index is out of bounds or element never renders
      activeTimeoutRef.current = window.setTimeout(() => {
        observer.disconnect();
        if (activeObserverRef.current === observer) {
          activeObserverRef.current = null;
        }
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            `[useScrollToAndFocus] MutationObserver timed out waiting for selector: ${selector}`
          );
        }
      }, FOCUS_FALLBACK_TIMEOUT_MS);
    },
    [viewportRef, rowVirtualizer]
  );

  return scrollToAndFocus;
}

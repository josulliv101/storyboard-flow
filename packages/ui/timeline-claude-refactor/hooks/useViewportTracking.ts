import { useCallback, useLayoutEffect, useRef, useState } from "react";

/**
 * Tracks `scrollLeft` and `clientWidth` of a scrollable element, throttled
 * to once per animation frame, and keeps them in sync with an initial
 * scroll offset and ResizeObserver-driven size changes.
 */
export function useViewportTracking(initialScrollLeft: number) {
  const elementRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);

  const [scrollLeft, setScrollLeft] = useState(initialScrollLeft);
  const [viewportClientWidth, setViewportClientWidth] = useState(0);

  const syncScrollState = useCallback(() => {
    const el = elementRef.current;
    if (!el) return;

    setScrollLeft(el.scrollLeft);
    setViewportClientWidth(el.clientWidth);
  }, []);

  const handleScroll = useCallback(() => {
    if (frameRef.current !== null) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      syncScrollState();
    });
  }, [syncScrollState]);

  useLayoutEffect(() => {
    const el = elementRef.current;
    if (!el) return;

    if (el.scrollLeft === 0 && initialScrollLeft > 0) {
      el.scrollLeft = initialScrollLeft;
    }

    syncScrollState();

    const observer = new ResizeObserver(() => {
      syncScrollState();
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
    // Only re-run if the caller-provided initial offset changes; the element
    // ref itself is stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScrollLeft]);

  return {
    elementRef,
    scrollLeft,
    setScrollLeft,
    viewportClientWidth,
    handleScroll,
    syncScrollState,
  };
}

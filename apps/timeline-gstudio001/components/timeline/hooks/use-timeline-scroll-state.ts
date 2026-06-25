import { useCallback, useLayoutEffect, useRef, useState } from "react";

type UseTimelineScrollStateOptions = {
  initialScrollLeft: number;
  parentRef: React.RefObject<HTMLDivElement | null>;
};

export function useTimelineScrollState({
  initialScrollLeft,
  parentRef,
}: UseTimelineScrollStateOptions) {
  const scrollFrameRef = useRef<number | null>(null);
  const prevScrollLeftRef = useRef(initialScrollLeft);
  const pendingScrollLeftRef = useRef<number | null>(null);
  const [scrollLeft, setScrollLeft] = useState(initialScrollLeft);
  const [viewportClientWidth, setViewportClientWidth] = useState(0);

  const syncScrollState = useCallback(() => {
    const element = parentRef.current;
    if (!element) return;

    setScrollLeft(element.scrollLeft);
    prevScrollLeftRef.current = element.scrollLeft;
    setViewportClientWidth(element.clientWidth);
  }, [parentRef]);

  const handleScroll = useCallback(() => {
    if (scrollFrameRef.current !== null) return;

    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      syncScrollState();
    });
  }, [syncScrollState]);

  useLayoutEffect(() => {
    const element = parentRef.current;
    if (!element) return;

    if (element.scrollLeft === 0 && initialScrollLeft > 0) {
      element.scrollLeft = initialScrollLeft;
    }

    syncScrollState();
    const observer = new ResizeObserver(syncScrollState);
    observer.observe(element);
    return () => observer.disconnect();
  }, [initialScrollLeft, parentRef, syncScrollState]);

  const cleanupScrollFrame = useCallback(() => {
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }
  }, []);

  return {
    scrollLeft,
    setScrollLeft,
    viewportClientWidth,
    prevScrollLeftRef,
    pendingScrollLeftRef,
    handleScroll,
    cleanupScrollFrame,
  };
}

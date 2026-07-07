import { useCallback, useLayoutEffect, useRef, useState } from "react";
export function useTimelineScrollState({ initialScrollLeft, parentRef, }) {
    const scrollFrameRef = useRef(null);
    const prevScrollLeftRef = useRef(initialScrollLeft);
    const pendingScrollLeftRef = useRef(null);
    const [scrollLeft, setScrollLeft] = useState(initialScrollLeft);
    const [scrollTop, setScrollTop] = useState(0);
    const [pageScrollTop, setPageScrollTop] = useState(0);
    const [viewportClientWidth, setViewportClientWidth] = useState(0);
    const [viewportClientHeight, setViewportClientHeight] = useState(0);
    const [pageViewportHeight, setPageViewportHeight] = useState(0);
    const syncScrollState = useCallback(() => {
        const element = parentRef.current;
        if (!element)
            return;
        setScrollLeft(element.scrollLeft);
        setScrollTop(element.scrollTop);
        prevScrollLeftRef.current = element.scrollLeft;
        setViewportClientWidth(element.clientWidth);
        setViewportClientHeight(element.clientHeight);
        const rect = element.getBoundingClientRect();
        setPageScrollTop(-rect.top);
        setPageViewportHeight(window.innerHeight);
    }, [parentRef]);
    const handleScroll = useCallback(() => {
        if (scrollFrameRef.current !== null)
            return;
        scrollFrameRef.current = requestAnimationFrame(() => {
            scrollFrameRef.current = null;
            syncScrollState();
        });
    }, [syncScrollState]);
    useLayoutEffect(() => {
        const element = parentRef.current;
        if (!element)
            return;
        if (element.scrollLeft === 0 && initialScrollLeft > 0) {
            element.scrollLeft = initialScrollLeft;
        }
        syncScrollState();
        const observer = new ResizeObserver(syncScrollState);
        observer.observe(element);
        window.addEventListener("scroll", handleScroll, { passive: true });
        window.addEventListener("resize", handleScroll);
        return () => {
            observer.disconnect();
            window.removeEventListener("scroll", handleScroll);
            window.removeEventListener("resize", handleScroll);
        };
    }, [handleScroll, initialScrollLeft, parentRef, syncScrollState]);
    const cleanupScrollFrame = useCallback(() => {
        if (scrollFrameRef.current !== null) {
            cancelAnimationFrame(scrollFrameRef.current);
        }
    }, []);
    return {
        scrollLeft,
        scrollTop,
        pageScrollTop,
        setScrollLeft,
        viewportClientWidth,
        viewportClientHeight,
        pageViewportHeight,
        prevScrollLeftRef,
        pendingScrollLeftRef,
        handleScroll,
        cleanupScrollFrame,
    };
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
export function useTimelineZoom({ clips, initialZoom, parentRef, prevScrollLeftRef, selectedIndex, setScrollLeft, thumbnailMode, thumbnailWidth, }) {
    const [zoomLevel, setZoomLevel] = useState(initialZoom);
    const [isZooming, setIsZooming] = useState(false);
    const zoomTimeoutRef = useRef(null);
    const zoomScrollTargetRef = useRef(null);
    const safePixelsPerSecond = Math.max(20, zoomLevel);
    const handleZoomChange = useCallback((event) => {
        var _a;
        const newZoom = Number(event.target.value);
        if (newZoom === zoomLevel)
            return;
        setIsZooming(true);
        if (zoomTimeoutRef.current)
            clearTimeout(zoomTimeoutRef.current);
        zoomTimeoutRef.current = setTimeout(() => setIsZooming(false), 150);
        const element = parentRef.current;
        if (!element) {
            setZoomLevel(newZoom);
            return;
        }
        const firstClip = (_a = clips[0]) !== null && _a !== void 0 ? _a : null;
        let currentOverhang = 0;
        if (firstClip && selectedIndex === 0 && firstClip.trimIn > 0) {
            currentOverhang = thumbnailMode
                ? Math.max(0, -(thumbnailWidth / 2 -
                    (firstClip.trimIn * safePixelsPerSecond +
                        firstClip.duration * safePixelsPerSecond / 2)))
                : firstClip.trimIn * safePixelsPerSecond;
        }
        const centerPx = element.scrollLeft + element.clientWidth / 2 - currentOverhang;
        const centerTime = thumbnailMode
            ? centerPx / thumbnailWidth * ((firstClip === null || firstClip === void 0 ? void 0 : firstClip.duration) || 1)
            : centerPx / safePixelsPerSecond;
        const nextPixelsPerSecond = Math.max(20, newZoom);
        let nextOverhang = 0;
        if (firstClip && selectedIndex === 0 && firstClip.trimIn > 0) {
            nextOverhang = thumbnailMode
                ? Math.max(0, -(thumbnailWidth / 2 -
                    (firstClip.trimIn * nextPixelsPerSecond +
                        firstClip.duration * nextPixelsPerSecond / 2)))
                : firstClip.trimIn * nextPixelsPerSecond;
        }
        const nextCenterPx = thumbnailMode
            ? centerTime / ((firstClip === null || firstClip === void 0 ? void 0 : firstClip.duration) || 1) * thumbnailWidth + nextOverhang
            : centerTime * nextPixelsPerSecond + nextOverhang;
        const nextScrollLeft = Math.max(0, nextCenterPx - element.clientWidth / 2);
        setZoomLevel(newZoom);
        setScrollLeft(nextScrollLeft);
        zoomScrollTargetRef.current = nextScrollLeft;
    }, [
        clips,
        parentRef,
        safePixelsPerSecond,
        selectedIndex,
        setScrollLeft,
        thumbnailMode,
        thumbnailWidth,
        zoomLevel,
    ]);
    useLayoutEffect(() => {
        if (zoomScrollTargetRef.current === null)
            return;
        if (parentRef.current) {
            parentRef.current.scrollLeft = zoomScrollTargetRef.current;
            prevScrollLeftRef.current = zoomScrollTargetRef.current;
        }
        zoomScrollTargetRef.current = null;
    });
    useEffect(() => () => {
        if (zoomTimeoutRef.current)
            clearTimeout(zoomTimeoutRef.current);
    }, []);
    return {
        zoomLevel,
        safePixelsPerSecond,
        isZooming,
        handleZoomChange,
    };
}

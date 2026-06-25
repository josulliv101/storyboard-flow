import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { TimelineClip } from "../types";

type UseTimelineZoomOptions = {
  clips: TimelineClip[];
  initialZoom: number;
  parentRef: React.RefObject<HTMLDivElement | null>;
  prevScrollLeftRef: React.MutableRefObject<number>;
  selectedIndex: number | null;
  setScrollLeft: React.Dispatch<React.SetStateAction<number>>;
  thumbnailMode: boolean;
  thumbnailWidth: number;
};

export function useTimelineZoom({
  clips,
  initialZoom,
  parentRef,
  prevScrollLeftRef,
  selectedIndex,
  setScrollLeft,
  thumbnailMode,
  thumbnailWidth,
}: UseTimelineZoomOptions) {
  const [zoomLevel, setZoomLevel] = useState(initialZoom);
  const [isZooming, setIsZooming] = useState(false);
  const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomScrollTargetRef = useRef<number | null>(null);
  const safePixelsPerSecond = Math.max(20, zoomLevel);

  const handleZoomChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const newZoom = Number(event.target.value);
    if (newZoom === zoomLevel) return;

    setIsZooming(true);
    if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
    zoomTimeoutRef.current = setTimeout(() => setIsZooming(false), 150);

    const element = parentRef.current;
    if (!element) {
      setZoomLevel(newZoom);
      return;
    }

    const firstClip = clips[0] ?? null;
    let currentOverhang = 0;
    if (firstClip && selectedIndex === 0 && firstClip.trimIn > 0) {
      currentOverhang = thumbnailMode
        ? Math.max(
            0,
            -(thumbnailWidth / 2 -
              (firstClip.trimIn * safePixelsPerSecond +
                firstClip.duration * safePixelsPerSecond / 2)),
          )
        : firstClip.trimIn * safePixelsPerSecond;
    }

    const centerPx = element.scrollLeft + element.clientWidth / 2 - currentOverhang;
    const centerTime = thumbnailMode
      ? centerPx / thumbnailWidth * (firstClip?.duration || 1)
      : centerPx / safePixelsPerSecond;
    const nextPixelsPerSecond = Math.max(20, newZoom);
    let nextOverhang = 0;

    if (firstClip && selectedIndex === 0 && firstClip.trimIn > 0) {
      nextOverhang = thumbnailMode
        ? Math.max(
            0,
            -(thumbnailWidth / 2 -
              (firstClip.trimIn * nextPixelsPerSecond +
                firstClip.duration * nextPixelsPerSecond / 2)),
          )
        : firstClip.trimIn * nextPixelsPerSecond;
    }

    const nextCenterPx = thumbnailMode
      ? centerTime / (firstClip?.duration || 1) * thumbnailWidth + nextOverhang
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
    if (zoomScrollTargetRef.current === null) return;
    if (parentRef.current) {
      parentRef.current.scrollLeft = zoomScrollTargetRef.current;
      prevScrollLeftRef.current = zoomScrollTargetRef.current;
    }
    zoomScrollTargetRef.current = null;
  });

  useEffect(() => () => {
    if (zoomTimeoutRef.current) clearTimeout(zoomTimeoutRef.current);
  }, []);

  return {
    zoomLevel,
    safePixelsPerSecond,
    isZooming,
    handleZoomChange,
  };
}

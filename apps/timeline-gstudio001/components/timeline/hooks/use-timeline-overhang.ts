/* eslint-disable react-hooks/refs */

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { TimelineClip, VideoSourceWindowEditMode } from "../types";

type ActiveEdge = {
  index: number;
  edge: "left" | "right";
} | null;

type ActiveFilmStripEdit = {
  index: number;
  mode: VideoSourceWindowEditMode;
} | null;

type UseTimelineOverhangOptions = {
  activeFilmStripEdit: ActiveFilmStripEdit;
  activeResize: ActiveEdge;
  clipsLength: number;
  isFilmStripEditing: boolean;
  isResizing: boolean;
  isUnfreezing: boolean;
  manualOverhangScroll: boolean;
  parentRef: React.RefObject<HTMLDivElement | null>;
  pixelsPerSecond: number;
  prevScrollLeftRef: React.MutableRefObject<number>;
  scrollLeft: number;
  selectedVideoClip: TimelineClip | null;
  setScrollLeft: React.Dispatch<React.SetStateAction<number>>;
  thumbnailMode: boolean;
  thumbnailWidth: number;
};

export function useTimelineOverhang({
  activeFilmStripEdit,
  activeResize,
  clipsLength,
  isFilmStripEditing,
  isResizing,
  isUnfreezing,
  manualOverhangScroll,
  parentRef,
  pixelsPerSecond,
  prevScrollLeftRef,
  scrollLeft,
  selectedVideoClip,
  setScrollLeft,
  thumbnailMode,
  thumbnailWidth,
}: UseTimelineOverhangOptions) {
  const overhangsRef = useRef({ first: 0, last: 0 });
  const prevFirstOverhangRef = useRef(0);
  const prevLastOverhangRef = useRef(0);
  const [closingOverhangOffset, setClosingOverhangOffset] = useState(0);
  const [isClosingOverhang, setIsClosingOverhang] = useState(false);

  const freezeFirstOverhang =
    isFilmStripEditing &&
    (thumbnailMode ||
      activeFilmStripEdit?.mode === "move" ||
      activeFilmStripEdit?.mode === "center");

  const firstOverhang = useMemo(() => {
    let nextOverhang = 0;
    if (selectedVideoClip?.index === 0 && selectedVideoClip.trimIn > 0) {
      if (thumbnailMode) {
        const clipCenter = thumbnailWidth / 2;
        const sourceLeft =
          clipCenter -
          (selectedVideoClip.trimIn * pixelsPerSecond +
            selectedVideoClip.duration * pixelsPerSecond / 2);
        nextOverhang = Math.max(0, -sourceLeft);
      } else {
        nextOverhang = selectedVideoClip.trimIn * pixelsPerSecond;
      }
    }

    if (freezeFirstOverhang) return overhangsRef.current.first;
    overhangsRef.current.first = nextOverhang;
    return nextOverhang;
  }, [
    freezeFirstOverhang,
    pixelsPerSecond,
    selectedVideoClip,
    thumbnailMode,
    thumbnailWidth,
  ]);

  const freezeLastOverhang =
    isFilmStripEditing &&
    (thumbnailMode ||
      activeFilmStripEdit?.mode === "move" ||
      activeFilmStripEdit?.mode === "center");

  const lastOverhang = useMemo(() => {
    let nextOverhang = 0;
    if (selectedVideoClip?.index === clipsLength - 1) {
      const trimOut =
        selectedVideoClip.sourceDuration -
        selectedVideoClip.trimIn -
        selectedVideoClip.duration;

      if (trimOut > 0) {
        if (thumbnailMode) {
          const clipCenter = thumbnailWidth / 2;
          const selectedWidth = selectedVideoClip.duration * pixelsPerSecond;
          const sourceWidth = selectedVideoClip.sourceDuration * pixelsPerSecond;
          const trimInWidth = selectedVideoClip.trimIn * pixelsPerSecond;
          const sourceLeft = clipCenter - (trimInWidth + selectedWidth / 2);
          nextOverhang = Math.max(0, sourceLeft + sourceWidth - thumbnailWidth);
        } else {
          nextOverhang = trimOut * pixelsPerSecond;
        }
      }
    }

    if (freezeLastOverhang) return overhangsRef.current.last;
    overhangsRef.current.last = nextOverhang;
    return nextOverhang;
  }, [
    clipsLength,
    freezeLastOverhang,
    pixelsPerSecond,
    selectedVideoClip,
    thumbnailMode,
    thumbnailWidth,
  ]);

  const isResizingFirstClipLeft =
    (isResizing && activeResize?.index === 0 && activeResize.edge === "left") ||
    (isFilmStripEditing &&
      activeFilmStripEdit?.index === 0 &&
      activeFilmStripEdit.mode === "left");

  useLayoutEffect(() => {
    const previousOverhang = prevFirstOverhangRef.current;
    const delta = firstOverhang - previousOverhang;
    prevFirstOverhangRef.current = firstOverhang;
    if (!manualOverhangScroll || delta === 0 || isResizingFirstClipLeft) return;

    const element = parentRef.current;
    if (!element) return;

    const oldScrollLeft = element.scrollLeft;
    const newScrollLeft = Math.max(0, oldScrollLeft + delta);

    if (delta < 0) {
      const uncompensated = newScrollLeft - (oldScrollLeft + delta);
      if (uncompensated > 0) {
        setClosingOverhangOffset(uncompensated);
        setIsClosingOverhang(true);
        requestAnimationFrame(() => {
          setClosingOverhangOffset(0);
          setIsClosingOverhang(false);
        });
      }
    }

    element.scrollLeft = newScrollLeft;
    setScrollLeft(newScrollLeft);
  }, [
    firstOverhang,
    isResizingFirstClipLeft,
    manualOverhangScroll,
    parentRef,
    setScrollLeft,
  ]);

  useLayoutEffect(() => {
    const previousOverhang = prevLastOverhangRef.current;
    const delta = lastOverhang - previousOverhang;
    prevLastOverhangRef.current = lastOverhang;

    if (
      delta >= 0 ||
      freezeLastOverhang ||
      isFilmStripEditing ||
      isUnfreezing
    ) {
      return;
    }

    const element = parentRef.current;
    if (!element) return;

    const clampedDifference = prevScrollLeftRef.current - element.scrollLeft;
    if (clampedDifference <= 0) return;

    setClosingOverhangOffset((current) => current - clampedDifference);
    setIsClosingOverhang(true);
    requestAnimationFrame(() => {
      setClosingOverhangOffset(0);
      setIsClosingOverhang(false);
    });

    setScrollLeft(element.scrollLeft);
    prevScrollLeftRef.current = element.scrollLeft;
  }, [
    freezeLastOverhang,
    isFilmStripEditing,
    isUnfreezing,
    lastOverhang,
    parentRef,
    prevScrollLeftRef,
    setScrollLeft,
  ]);

  const hasOffscreenOverhang =
    manualOverhangScroll && firstOverhang > 0 && scrollLeft > 0;

  const scrollToOverhang = useCallback(() => {
    parentRef.current?.scrollTo({ left: 0, behavior: "smooth" });
  }, [parentRef]);

  return {
    firstOverhang,
    lastOverhang,
    closingOverhangOffset,
    isClosingOverhang,
    isResizingFirstClipLeft,
    hasOffscreenOverhang,
    scrollToOverhang,
    prevFirstOverhangRef,
  };
}

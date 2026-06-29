import { useCallback, useMemo, useRef, useState } from "react";

import type { TimelineGridMetrics } from "../timeline-grid";
import type { TimelineClip, TrimScrubPreview } from "../types";
import type {
  SetScrollLeft,
  SetSelectedIndex,
  WindowDragCoordinator,
} from "./timeline-interaction-types";
import { useTimelineFilmstripEdit } from "./use-timeline-filmstrip-edit";
import { useTimelinePan } from "./use-timeline-pan";
import { useTimelineResize } from "./use-timeline-resize";

type UseTimelineInteractionsProps = {
  parentRef: React.RefObject<HTMLDivElement | null>;
  clips: TimelineClip[];
  safePixelsPerSecond: number;
  minDuration: number;
  gridMetrics: TimelineGridMetrics;
  itemTop: number;
  thumbnailMode?: boolean;
  thumbnailWidth?: number;
  setScrollLeft: SetScrollLeft;
  setSelectedIndex: SetSelectedIndex;
  setScrubPreview: (value: TrimScrubPreview | null) => void;
  scheduleClips: (clips: TimelineClip[]) => void;
  applyClipsNow: (clips: TimelineClip[]) => void;
  pendingScrollLeftRef?: React.MutableRefObject<number | null>;
  timelineId?: string;
};

export function useTimelineInteractions({
  parentRef,
  clips,
  safePixelsPerSecond,
  minDuration,
  gridMetrics,
  itemTop,
  thumbnailMode = false,
  thumbnailWidth = 0,
  setScrollLeft,
  setSelectedIndex,
  setScrubPreview,
  applyClipsNow,
  pendingScrollLeftRef,
  timelineId,
}: UseTimelineInteractionsProps) {
  const [trackTranslateX, setTrackTranslateX] = useState(0);
  const windowDragCleanupRef = useRef<(() => void) | null>(null);
  const cleanupWindowDragListeners = useCallback(() => {
    windowDragCleanupRef.current?.();
    windowDragCleanupRef.current = null;
  }, []);
  const setWindowDragCleanup = useCallback((cleanup: (() => void) | null) => {
    windowDragCleanupRef.current = cleanup;
  }, []);
  const windowDrag = useMemo<WindowDragCoordinator>(
    () => ({
      cleanup: cleanupWindowDragListeners,
      setCleanup: setWindowDragCleanup,
    }),
    [cleanupWindowDragListeners, setWindowDragCleanup],
  );

  const pan = useTimelinePan({
    applyClipsNow,
    clips,
    parentRef,
    safePixelsPerSecond,
    setScrollLeft,
    setSelectedIndex,
    gridMetrics,
    itemTop,
    thumbnailMode,
    thumbnailWidth: thumbnailWidth ?? 0,
    windowDrag,
    timelineId,
  });

  const sharedOptions = {
    applyClipsNow,
    clips,
    minDuration,
    parentRef,
    pendingScrollLeftRef,
    safePixelsPerSecond,
    setScrollLeft,
    setScrubPreview,
    setSelectedIndex,
    setTrackTranslateX,
    stopInertia: pan.stopInertia,
    windowDrag,
  };
  const resize = useTimelineResize(sharedOptions);
  const filmstrip = useTimelineFilmstripEdit({
    ...sharedOptions,
    thumbnailMode,
  });

  const handlePointerCancel = useCallback(() => {
    pan.cancelPan();
    resize.cancelResize();
    filmstrip.cancelFilmstripEdit();
    setScrubPreview(null);
    cleanupWindowDragListeners();
  }, [
    cleanupWindowDragListeners,
    filmstrip,
    pan,
    resize,
    setScrubPreview,
  ]);

  return {
    handlePointerDown: pan.handlePointerDown,
    handlePointerCancel,
    handleResizeDown: resize.handleResizeDown,
    handleResizeMove: resize.handleResizeMove,
    handleResizeUp: resize.handleResizeUp,
    handleResizeKeyDown: resize.handleResizeKeyDown,
    handleFilmStripPointerDown: filmstrip.handleFilmStripPointerDown,
    cleanupWindowDragListeners,
    stopInertia: pan.stopInertia,
    runInertia: pan.runInertia,
    trackTranslateX,
    isReordering: pan.isReordering,
    reorderPreview: pan.reorderPreview,
    isResizing: resize.isResizing,
    activeResize: resize.activeResize,
    isSnappingBack: resize.isSnappingBack,
    isFilmStripEditing: filmstrip.isFilmStripEditing,
    activeFilmStripEdit: filmstrip.activeFilmStripEdit,
    isUnfreezing: filmstrip.isUnfreezing,
  };
}

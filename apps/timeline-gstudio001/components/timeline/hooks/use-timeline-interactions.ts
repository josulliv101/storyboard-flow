import { useRef, useCallback, useState } from "react";
import { TimelineClip, TrimScrubPreview, VideoSourceWindowEditMode } from "../types";
import { clamp, getSourceTimeFromClientX, getTrimHandleSourceTime } from "../utils";
import { DRAG_THRESHOLD_PX, MAX_WIDTH, RESIZE_KEY_STEP_PX, TIMELINE_TRAILING_PADDING_SECONDS } from "../constants";
import { editVideoSourceWindowFromBaseline, resizeClipsFromBaseline } from "./use-timeline-clips";

type UseTimelineInteractionsProps = {
  parentRef: React.RefObject<HTMLDivElement | null>;
  clips: TimelineClip[];
  safePixelsPerSecond: number;
  minDuration: number;
  thumbnailMode?: boolean;
  thumbnailWidth?: number;
  setScrollLeft: (value: number | ((prev: number) => number)) => void;
  setSelectedIndex: (value: number | null | ((prev: number | null) => number | null)) => void;
  setScrubPreview: (value: TrimScrubPreview | null) => void;
  scheduleClips: (clips: TimelineClip[]) => void;
  applyClipsNow: (clips: TimelineClip[]) => void;
  pendingScrollLeftRef?: React.MutableRefObject<number | null>;
};

export function useTimelineInteractions({
  parentRef,
  clips,
  safePixelsPerSecond,
  minDuration,
  thumbnailMode = false,
  thumbnailWidth = 250,
  setScrollLeft,
  setSelectedIndex,
  setScrubPreview,
  scheduleClips,
  applyClipsNow,
  pendingScrollLeftRef,
}: UseTimelineInteractionsProps) {
  const windowDragCleanupRef = useRef<(() => void) | null>(null);
  const inertiaFrameRef = useRef<number | null>(null);

  const [trackTranslateX, setTrackTranslateX] = useState(0);

  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startScrollLeft: 0,
    lastX: 0,
    lastTime: 0,
    velocity: 0,
    moved: false,
    pointerId: -1,
    pressedIndex: null as number | null,
  });

  const [isResizing, setIsResizing] = useState(false);
  const [activeResize, setActiveResize] = useState<{index: number, edge: "left" | "right"} | null>(null);
  const [isSnappingBack, setIsSnappingBack] = useState(false);
  const [isFilmStripEditing, setIsFilmStripEditing] = useState(false);
  const [activeFilmStripEdit, setActiveFilmStripEdit] = useState<{index: number, mode: VideoSourceWindowEditMode} | null>(null);
  const [isUnfreezing, setIsUnfreezing] = useState(false);

  const resizeState = useRef({
    active: false,
    anchorIndex: -1,
    edge: "right" as "left" | "right",
    startX: 0,
    startScrollLeft: 0,
    baselineClips: null as TimelineClip[] | null,
  });

  const filmStripEditState = useRef({
    active: false,
    anchorIndex: -1,
    mode: "move" as VideoSourceWindowEditMode,
    startX: 0,
    lastX: 0,
    startSourceTime: 0,
    lastSourceTime: 0,
    rectLeft: 0,
    rectWidth: 1,
    pointerId: -1,
    startScrollLeft: 0,
    moved: false,
    baselineClips: null as TimelineClip[] | null,
  });

  const stopInertia = useCallback(() => {
    if (inertiaFrameRef.current !== null) {
      cancelAnimationFrame(inertiaFrameRef.current);
      inertiaFrameRef.current = null;
    }
  }, []);

  const runInertia = useCallback(() => {
    const el = parentRef.current;
    if (!el) return;

    const friction = 0.95;
    const minVelocity = 0.1;

    const step = () => {
      const state = dragState.current;
      state.velocity *= friction;

      if (Math.abs(state.velocity) < minVelocity) {
        inertiaFrameRef.current = null;
        return;
      }

      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const next = clamp(el.scrollLeft + state.velocity, 0, maxScroll);
      el.scrollLeft = next;
      setScrollLeft(next);

      if (next === 0 || next === maxScroll) {
        state.velocity = 0;
        inertiaFrameRef.current = null;
        return;
      }

      inertiaFrameRef.current = requestAnimationFrame(step);
    };

    inertiaFrameRef.current = requestAnimationFrame(step);
  }, [parentRef, setScrollLeft]);

  const cleanupWindowDragListeners = useCallback(() => {
    windowDragCleanupRef.current?.();
    windowDragCleanupRef.current = null;
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const el = parentRef.current;
      if (!el) return;

      const target = e.target as HTMLElement;
      if (target.closest("[data-trim-handle]")) return;

      stopInertia();
      cleanupWindowDragListeners();

      const item = target.closest("[data-clip-index]") as HTMLElement | null;
      const rawIndex = item?.dataset.clipIndex;
      const pressedIndex = rawIndex === undefined ? null : Number(rawIndex);
      const normalizedPressedIndex = Number.isFinite(pressedIndex)
        ? pressedIndex
        : null;

      const state = dragState.current;
      state.isDragging = true;
      state.moved = false;
      state.startX = e.clientX;
      state.startScrollLeft = el.scrollLeft;
      state.lastX = e.clientX;
      state.lastTime = e.timeStamp;
      state.velocity = 0;
      state.pointerId = e.pointerId;
      state.pressedIndex = normalizedPressedIndex;

      try {
        el.setPointerCapture(e.pointerId);
      } catch {}

      const moveTimeline = (clientX: number, timeStamp: number) => {
        const currentState = dragState.current;
        const currentEl = parentRef.current;
        if (!currentState.isDragging || !currentEl) return;

        const dx = clientX - currentState.startX;

        if (!currentState.moved && Math.abs(dx) <= DRAG_THRESHOLD_PX) return;

        currentState.moved = true;

        const maxScroll = Math.max(
          0,
          currentEl.scrollWidth - currentEl.clientWidth,
        );
        const nextScrollLeft = clamp(
          currentState.startScrollLeft - dx,
          0,
          maxScroll,
        );
        currentEl.scrollLeft = nextScrollLeft;
        setScrollLeft(nextScrollLeft);

        const dt = timeStamp - currentState.lastTime;
        if (dt > 0) {
          const instantaneous = (-(clientX - currentState.lastX) / dt) * 16.67;
          currentState.velocity =
            0.7 * instantaneous + 0.3 * currentState.velocity;
        }

        currentState.lastX = clientX;
        currentState.lastTime = timeStamp;
      };

      const finishTimelineDrag = (pointerId: number, timeStamp: number) => {
        const currentState = dragState.current;
        const currentEl = parentRef.current;
        if (!currentState.isDragging || !currentEl) return;

        currentState.isDragging = false;

        try {
          if (currentEl.hasPointerCapture(pointerId)) {
            currentEl.releasePointerCapture(pointerId);
          }
        } catch {}

        const timeSinceLastMove = timeStamp - currentState.lastTime;
        if (timeSinceLastMove > 50) {
          currentState.velocity = 0;
        }

        if (!currentState.moved && currentState.pressedIndex !== null) {
          const index = currentState.pressedIndex;
          setSelectedIndex((previous) => (previous === index ? null : index));
        } else if (Math.abs(currentState.velocity) > 1) {
          runInertia();
        }

        currentState.pointerId = -1;
        currentState.pressedIndex = null;
        cleanupWindowDragListeners();
      };

      const handleWindowPointerMove = (event: PointerEvent) => {
        if (event.pointerId !== dragState.current.pointerId) return;
        event.preventDefault();
        moveTimeline(event.clientX, event.timeStamp);
      };

      const handleWindowPointerUp = (event: PointerEvent) => {
        if (event.pointerId !== dragState.current.pointerId) return;
        finishTimelineDrag(event.pointerId, event.timeStamp);
      };

      const handleWindowPointerCancel = (event: PointerEvent) => {
        if (event.pointerId !== dragState.current.pointerId) return;
        finishTimelineDrag(event.pointerId, event.timeStamp);
      };

      window.addEventListener("pointermove", handleWindowPointerMove, {
        passive: false,
      });
      window.addEventListener("pointerup", handleWindowPointerUp);
      window.addEventListener("pointercancel", handleWindowPointerCancel);

      windowDragCleanupRef.current = () => {
        window.removeEventListener("pointermove", handleWindowPointerMove);
        window.removeEventListener("pointerup", handleWindowPointerUp);
        window.removeEventListener("pointercancel", handleWindowPointerCancel);
      };
    },
    [
      parentRef,
      stopInertia,
      cleanupWindowDragListeners,
      setScrollLeft,
      setSelectedIndex,
      runInertia,
    ],
  );

  const handlePointerCancel = useCallback(() => {
    const state = dragState.current;
    state.isDragging = false;
    state.pointerId = -1;
    state.pressedIndex = null;

    const filmStripState = filmStripEditState.current;
    filmStripState.active = false;
    filmStripState.anchorIndex = -1;
    filmStripState.pointerId = -1;
    filmStripState.moved = false;
    filmStripState.baselineClips = null;

    const rs = resizeState.current;
    if (rs.active) {
      rs.active = false;
      setIsResizing(false);
      setActiveResize(null);
      rs.anchorIndex = -1;
      rs.baselineClips = null;
      setTrackTranslateX(0);
    }

    setScrubPreview(null);
    cleanupWindowDragListeners();
  }, [cleanupWindowDragListeners, setScrubPreview]);

  const handleResizeDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      clip: TimelineClip,
      edge: "left" | "right",
    ) => {
      e.stopPropagation();
      e.preventDefault();
      stopInertia();
      setSelectedIndex(clip.index);

      if (clip.kind === "video") {
        setScrubPreview({
          clipIndex: clip.index,
          time: getTrimHandleSourceTime(clip, edge),
        });
      } else {
        setScrubPreview(null);
      }

      const rs = resizeState.current;
      rs.active = true;
      setIsResizing(true);
      setActiveResize({ index: clip.index, edge });
      rs.anchorIndex = clip.index;
      rs.edge = edge;
      rs.startX = e.clientX;
      rs.startScrollLeft = parentRef.current?.scrollLeft ?? 0;
      rs.baselineClips = clips.map((currentClip) => ({ ...currentClip }));

      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
    },
    [clips, stopInertia, setSelectedIndex, setScrubPreview, parentRef],
  );

  const handleResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rs = resizeState.current;
      if (!rs.active || !rs.baselineClips) return;

      e.stopPropagation();
      e.preventDefault();

      const deltaTime = (e.clientX - rs.startX) / safePixelsPerSecond;
      const nextClips = resizeClipsFromBaseline({
        baselineClips: rs.baselineClips,
        anchorIndex: rs.anchorIndex,
        edge: rs.edge,
        deltaTime,
        minDuration,
      });

      const previewClip = nextClips[rs.anchorIndex];
      if (previewClip?.kind === "video") {
        setScrubPreview({
          clipIndex: previewClip.index,
          time: getTrimHandleSourceTime(previewClip, rs.edge),
        });
      }

      if (rs.edge === "left") {
        // For clip 0, the contentOffsetPx mechanism in the parent keeps visual
        // positions stable as trimIn changes, so no scroll compensation needed.
        if (rs.anchorIndex !== 0) {
          const originalClip = rs.baselineClips[rs.anchorIndex];
          const nextClip = nextClips[rs.anchorIndex];
          const durationDelta = nextClip.duration - originalClip.duration;
          const scrollDelta = durationDelta * safePixelsPerSecond;
          const targetScrollLeft = rs.startScrollLeft + scrollDelta;
          
          let nextScrollLeft = targetScrollLeft;
          let trackTranslate = 0;
          
          if (targetScrollLeft < 0) {
            nextScrollLeft = 0;
            trackTranslate = -targetScrollLeft;
          }

          setScrollLeft(nextScrollLeft);
          if (pendingScrollLeftRef) {
            pendingScrollLeftRef.current = nextScrollLeft;
          } else if (parentRef.current) {
            parentRef.current.scrollLeft = nextScrollLeft;
          }
          setTrackTranslateX(trackTranslate);
        } else {
          setTrackTranslateX(0);
        }
      } else if (rs.edge === "right") {
        setTrackTranslateX(0);
      }

      applyClipsNow(nextClips);
    },
    [minDuration, safePixelsPerSecond, applyClipsNow, setScrubPreview, setScrollLeft, parentRef, pendingScrollLeftRef],
  );

  const handleResizeUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rs = resizeState.current;
      if (!rs.active || !rs.baselineClips) return;

      e.stopPropagation();
      e.preventDefault();

      const deltaTime = (e.clientX - rs.startX) / safePixelsPerSecond;
      const nextClips = resizeClipsFromBaseline({
        baselineClips: rs.baselineClips,
        anchorIndex: rs.anchorIndex,
        edge: rs.edge,
        deltaTime,
        minDuration,
      });

      if (rs.edge === "left") {
        // For clip 0, the contentOffsetPx mechanism handles visual stability.
        if (rs.anchorIndex !== 0) {
          const originalClip = rs.baselineClips[rs.anchorIndex];
          const nextClip = nextClips[rs.anchorIndex];
          const durationDelta = nextClip.duration - originalClip.duration;
          const scrollDelta = durationDelta * safePixelsPerSecond;
          const targetScrollLeft = rs.startScrollLeft + scrollDelta;
          
          let nextScrollLeft = targetScrollLeft;
          
          if (targetScrollLeft < 0) {
            nextScrollLeft = 0;
          }

          setScrollLeft(nextScrollLeft);
          if (pendingScrollLeftRef) {
            pendingScrollLeftRef.current = nextScrollLeft;
          } else if (parentRef.current) {
            parentRef.current.scrollLeft = nextScrollLeft;
          }
        }
        setTrackTranslateX(0);
      } else if (rs.edge === "right") {
        let maxDuration = 0;
        for (const c of nextClips) {
          maxDuration = Math.max(maxDuration, c.startTime + c.duration);
        }
        maxDuration += TIMELINE_TRAILING_PADDING_SECONDS;

        const nextTimelineWidthPx = Math.ceil(maxDuration * safePixelsPerSecond);
        const clientWidth = parentRef.current?.clientWidth || 0;
        const currentScrollLeft = parentRef.current?.scrollLeft || 0;

        const expectedNewScrollLeft = Math.max(0, nextTimelineWidthPx - clientWidth);

        if (currentScrollLeft > expectedNewScrollLeft) {
          const jump = currentScrollLeft - expectedNewScrollLeft;
          setTrackTranslateX(-jump);
          setIsSnappingBack(true);
          setIsResizing(false);
          setActiveResize(null);
          
          if (pendingScrollLeftRef) {
            pendingScrollLeftRef.current = expectedNewScrollLeft;
          }

          requestAnimationFrame(() => {
            setTrackTranslateX(0);
            setIsSnappingBack(false);
          });

          applyClipsNow(nextClips);
          setScrubPreview(null);
          rs.active = false;
          rs.anchorIndex = -1;
          rs.baselineClips = null;

          const target = e.currentTarget as HTMLElement;
          if (target.hasPointerCapture(e.pointerId)) {
            target.releasePointerCapture(e.pointerId);
          }
          return;
        }

        setTrackTranslateX(0);
      }

      applyClipsNow(nextClips);
      setScrubPreview(null);

      rs.active = false;
      setIsResizing(false);
      setActiveResize(null);
      rs.anchorIndex = -1;
      rs.baselineClips = null;

      const target = e.currentTarget as HTMLElement;
      if (target.hasPointerCapture(e.pointerId)) {
        target.releasePointerCapture(e.pointerId);
      }
    },
    [applyClipsNow, minDuration, safePixelsPerSecond, setScrubPreview, setScrollLeft, parentRef, pendingScrollLeftRef],
  );

  const handleResizeKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLDivElement>,
      clip: TimelineClip,
      edge: "left" | "right",
    ) => {
      let deltaPx = 0;

      if (e.key === "Home") {
        deltaPx = edge === "left" ? -MAX_WIDTH : -MAX_WIDTH;
      } else if (e.key === "End") {
        deltaPx = edge === "left" ? MAX_WIDTH : MAX_WIDTH;
      } else if (e.key === "ArrowLeft") {
        deltaPx = -RESIZE_KEY_STEP_PX;
      } else if (e.key === "ArrowRight") {
        deltaPx = RESIZE_KEY_STEP_PX;
      } else {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      stopInertia();
      setSelectedIndex(clip.index);
      setScrubPreview(null);

      const nextClips = resizeClipsFromBaseline({
        baselineClips: clips.map((currentClip) => ({ ...currentClip })),
        anchorIndex: clip.index,
        edge,
        deltaTime: deltaPx / safePixelsPerSecond,
        minDuration,
      });

      if (edge === "left") {
        // For clip 0, the contentOffsetPx mechanism handles visual stability.
        if (clip.index !== 0) {
          const originalClip = clips[clip.index];
          const nextClip = nextClips[clip.index];
          const durationDelta = nextClip.duration - originalClip.duration;
          const scrollDelta = durationDelta * safePixelsPerSecond;
          const startScrollLeft = parentRef.current?.scrollLeft ?? 0;
          const targetScrollLeft = startScrollLeft + scrollDelta;
          
          let nextScrollLeft = targetScrollLeft;
          
          if (targetScrollLeft < 0) {
            nextScrollLeft = 0;
          }

          setScrollLeft(nextScrollLeft);
          if (pendingScrollLeftRef) {
            pendingScrollLeftRef.current = nextScrollLeft;
          } else if (parentRef.current) {
            parentRef.current.scrollLeft = nextScrollLeft;
          }
        }
        setTrackTranslateX(0);
      }

      applyClipsNow(nextClips);
    },
    [applyClipsNow, clips, minDuration, safePixelsPerSecond, stopInertia, setSelectedIndex, setScrubPreview, setScrollLeft, parentRef, pendingScrollLeftRef],
  );

  const handleFilmStripPointerDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      clip: TimelineClip,
      mode: VideoSourceWindowEditMode,
    ) => {
      if (clip.kind !== "video") return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const filmStripElement = (e.target as HTMLElement).closest(
        "[data-video-filmstrip]",
      ) as HTMLElement | null;
      if (!filmStripElement) return;

      e.stopPropagation();
      e.preventDefault();
      stopInertia();
      cleanupWindowDragListeners();
      setSelectedIndex(clip.index);

      const rect = filmStripElement.getBoundingClientRect();
      const rectWidth = Math.max(1, rect.width);
      const startSourceTime = getSourceTimeFromClientX({
        clientX: e.clientX,
        rectLeft: rect.left,
        rectWidth,
        sourceDuration: clip.sourceDuration,
      });

      const state = filmStripEditState.current;
      state.active = true;
      state.anchorIndex = clip.index;
      state.mode = mode;

      setIsFilmStripEditing(true);
      setActiveFilmStripEdit({ index: clip.index, mode });
      state.startX = e.clientX;
      state.lastX = e.clientX;
      state.startSourceTime = startSourceTime;
      state.lastSourceTime = startSourceTime;
      state.rectLeft = rect.left;
      state.rectWidth = rectWidth;
      state.pointerId = e.pointerId;
      state.startScrollLeft = parentRef.current?.scrollLeft ?? 0;
      state.moved = mode === "center";
      state.baselineClips = clips.map((currentClip) => ({ ...currentClip }));

      const getEditedClips = (clientX: number) => {
        const currentState = filmStripEditState.current;
        if (!currentState.baselineClips) return clips;

        const dx = clientX - currentState.startX;
        const sourceTime = currentState.startSourceTime + dx / safePixelsPerSecond;
        
        currentState.lastX = clientX;
        currentState.lastSourceTime = sourceTime;

        return editVideoSourceWindowFromBaseline({
          baselineClips: currentState.baselineClips,
          anchorIndex: currentState.anchorIndex,
          mode: currentState.mode,
          deltaTime: sourceTime - currentState.startSourceTime,
          sourceTime,
          minDuration,
        });
      };

      const previewEditedClips = (nextClips: TimelineClip[]) => {
        const currentState = filmStripEditState.current;
        const previewClip = nextClips[currentState.anchorIndex];
        
        if (currentState.mode === "left" && currentState.baselineClips) {
          // For clip 0, the contentOffsetPx mechanism handles visual stability.
          if (currentState.anchorIndex !== 0) {
            const originalClip = currentState.baselineClips[currentState.anchorIndex];
            const nextClip = nextClips[currentState.anchorIndex];
            const durationDelta = nextClip.duration - originalClip.duration;
            const scrollDelta = thumbnailMode ? 0 : durationDelta * safePixelsPerSecond;
            const targetScrollLeft = currentState.startScrollLeft + scrollDelta;
            let nextScrollLeft = targetScrollLeft;
            let trackTranslate = 0;
            
            if (targetScrollLeft < 0) {
              nextScrollLeft = 0;
              trackTranslate = -targetScrollLeft;
            }

            setScrollLeft(nextScrollLeft);
            if (pendingScrollLeftRef) {
              pendingScrollLeftRef.current = nextScrollLeft;
            } else if (parentRef.current) {
              parentRef.current.scrollLeft = nextScrollLeft;
            }
            if (!thumbnailMode) {
              setTrackTranslateX(trackTranslate);
            }
          } else {
            setTrackTranslateX(0);
          }
        } else if (!thumbnailMode && currentState.mode === "right") {
          setTrackTranslateX(0);
        }
        
        if (previewClip?.kind === "video") {
          setScrubPreview({
            clipIndex: previewClip.index,
            time: previewClip.trimIn,
          });
        }
      };

      setScrubPreview({ clipIndex: clip.index, time: clip.trimIn });

      if (mode === "center") {
        const nextClips = getEditedClips(e.clientX);
        previewEditedClips(nextClips);
        applyClipsNow(nextClips);
      }

      const targetElement = e.currentTarget as HTMLElement;

      try {
        targetElement.setPointerCapture(e.pointerId);
      } catch {}

      const handleWindowFilmStripMove = (event: PointerEvent) => {
        const currentState = filmStripEditState.current;
        if (event.pointerId !== currentState.pointerId) return;

        event.preventDefault();

        const dx = event.clientX - currentState.startX;
        if (!currentState.moved && Math.abs(dx) <= DRAG_THRESHOLD_PX) return;

        currentState.moved = true;
        const nextClips = getEditedClips(event.clientX);
        previewEditedClips(nextClips);
        applyClipsNow(nextClips);
      };

      const finishFilmStripEdit = (event: PointerEvent) => {
        const currentState = filmStripEditState.current;
        if (event.pointerId !== currentState.pointerId) return;

        const nextClips = currentState.baselineClips
          ? getEditedClips(currentState.moved ? event.clientX : currentState.lastX)
          : clips;

        if (currentState.moved) {
          applyClipsNow(nextClips);
        }

        setScrubPreview(null);

        currentState.active = false;
        currentState.anchorIndex = -1;
        currentState.pointerId = -1;
        currentState.moved = false;
        currentState.baselineClips = null;

        setIsFilmStripEditing(false);
        setActiveFilmStripEdit(null);
        setTrackTranslateX(0);
        setIsUnfreezing(true);
        requestAnimationFrame(() => setIsUnfreezing(false));

        try {
          if (targetElement.hasPointerCapture(event.pointerId)) {
            targetElement.releasePointerCapture(event.pointerId);
          }
        } catch {}

        cleanupWindowDragListeners();
      };

      const cancelFilmStripEdit = (event: PointerEvent) => {
        const currentState = filmStripEditState.current;
        if (event.pointerId !== currentState.pointerId) return;

        setScrubPreview(null);
        currentState.active = false;
        currentState.anchorIndex = -1;
        currentState.pointerId = -1;
        currentState.moved = false;
        currentState.baselineClips = null;

        setIsFilmStripEditing(false);
        setActiveFilmStripEdit(null);
        setTrackTranslateX(0);
        setIsUnfreezing(true);
        requestAnimationFrame(() => setIsUnfreezing(false));

        try {
          if (targetElement.hasPointerCapture(event.pointerId)) {
            targetElement.releasePointerCapture(event.pointerId);
          }
        } catch {}

        cleanupWindowDragListeners();
      };

      window.addEventListener("pointermove", handleWindowFilmStripMove, {
        passive: false,
      });
      window.addEventListener("pointerup", finishFilmStripEdit);
      window.addEventListener("pointercancel", cancelFilmStripEdit);

      windowDragCleanupRef.current = () => {
        window.removeEventListener("pointermove", handleWindowFilmStripMove);
        window.removeEventListener("pointerup", finishFilmStripEdit);
        window.removeEventListener("pointercancel", cancelFilmStripEdit);
      };
    },
    [
      applyClipsNow,
      cleanupWindowDragListeners,
      clips,
      minDuration,
      stopInertia,
      setSelectedIndex,
      setScrubPreview,
      setScrollLeft,
      parentRef,
      pendingScrollLeftRef,
      safePixelsPerSecond,
      thumbnailMode,
    ],
  );

  return {
    handlePointerDown,
    handlePointerCancel,
    handleResizeDown,
    handleResizeMove,
    handleResizeUp,
    handleResizeKeyDown,
    handleFilmStripPointerDown,
    cleanupWindowDragListeners,
    stopInertia,
    runInertia,
    trackTranslateX,
    isResizing,
    activeResize,
    isSnappingBack,
    isFilmStripEditing,
    activeFilmStripEdit,
    isUnfreezing,
  };
}

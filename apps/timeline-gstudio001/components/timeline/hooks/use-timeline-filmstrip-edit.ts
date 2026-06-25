import { useCallback, useRef, useState } from "react";

import { DRAG_THRESHOLD_PX } from "../constants";
import type { TimelineClip, VideoSourceWindowEditMode } from "../types";
import { getSourceTimeFromClientX } from "../utils";
import type { TimelineInteractionSharedOptions } from "./timeline-interaction-types";
import { editVideoSourceWindowFromBaseline } from "./use-timeline-clips";

type UseTimelineFilmstripEditOptions = TimelineInteractionSharedOptions & {
  thumbnailMode: boolean;
};

export function useTimelineFilmstripEdit({
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
  stopInertia,
  thumbnailMode,
  windowDrag,
}: UseTimelineFilmstripEditOptions) {
  const [isFilmStripEditing, setIsFilmStripEditing] = useState(false);
  const [activeFilmStripEdit, setActiveFilmStripEdit] = useState<{
    index: number;
    mode: VideoSourceWindowEditMode;
  } | null>(null);
  const [isUnfreezing, setIsUnfreezing] = useState(false);
  const editState = useRef({
    active: false,
    anchorIndex: -1,
    mode: "move" as VideoSourceWindowEditMode,
    startX: 0,
    lastX: 0,
    startSourceTime: 0,
    lastSourceTime: 0,
    pointerId: -1,
    startScrollLeft: 0,
    moved: false,
    baselineClips: null as TimelineClip[] | null,
  });

  const writeScrollLeft = useCallback((value: number) => {
    setScrollLeft(value);
    if (pendingScrollLeftRef) {
      pendingScrollLeftRef.current = value;
    } else if (parentRef.current) {
      parentRef.current.scrollLeft = value;
    }
  }, [parentRef, pendingScrollLeftRef, setScrollLeft]);

  const resetFilmstripEdit = useCallback(() => {
    const state = editState.current;
    state.active = false;
    state.anchorIndex = -1;
    state.pointerId = -1;
    state.moved = false;
    state.baselineClips = null;
    setIsFilmStripEditing(false);
    setActiveFilmStripEdit(null);
    setTrackTranslateX(0);
    setIsUnfreezing(true);
    requestAnimationFrame(() => setIsUnfreezing(false));
  }, [setTrackTranslateX]);

  const handleFilmStripPointerDown = useCallback(
    (
      event: React.PointerEvent<HTMLDivElement>,
      clip: TimelineClip,
      mode: VideoSourceWindowEditMode,
    ) => {
      if (clip.kind !== "video") return;
      if (event.pointerType === "mouse" && event.button !== 0) return;

      const filmStripElement = (event.target as HTMLElement).closest(
        "[data-video-filmstrip]",
      ) as HTMLElement | null;
      if (!filmStripElement) return;

      event.stopPropagation();
      event.preventDefault();
      stopInertia();
      windowDrag.cleanup();
      setSelectedIndex(clip.index);

      const rect = filmStripElement.getBoundingClientRect();
      const startSourceTime = getSourceTimeFromClientX({
        clientX: event.clientX,
        rectLeft: rect.left,
        rectWidth: Math.max(1, rect.width),
        sourceDuration: clip.sourceDuration,
      });
      const state = editState.current;
      Object.assign(state, {
        active: true,
        anchorIndex: clip.index,
        mode,
        startX: event.clientX,
        lastX: event.clientX,
        startSourceTime,
        lastSourceTime: startSourceTime,
        pointerId: event.pointerId,
        startScrollLeft: parentRef.current?.scrollLeft ?? 0,
        moved: mode === "center",
        baselineClips: clips.map((currentClip) => ({ ...currentClip })),
      });
      setIsFilmStripEditing(true);
      setActiveFilmStripEdit({ index: clip.index, mode });

      const getEditedClips = (clientX: number) => {
        const currentState = editState.current;
        if (!currentState.baselineClips) return clips;

        const sourceTime =
          currentState.startSourceTime +
          (clientX - currentState.startX) / safePixelsPerSecond;
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
        const currentState = editState.current;
        const previewClip = nextClips[currentState.anchorIndex];

        if (currentState.mode === "left" && currentState.baselineClips) {
          if (currentState.anchorIndex !== 0) {
            const durationDelta =
              nextClips[currentState.anchorIndex].duration -
              currentState.baselineClips[currentState.anchorIndex].duration;
            const scrollDelta = thumbnailMode
              ? 0
              : durationDelta * safePixelsPerSecond;
            const targetScrollLeft =
              currentState.startScrollLeft + scrollDelta;
            writeScrollLeft(Math.max(0, targetScrollLeft));
            if (!thumbnailMode) {
              setTrackTranslateX(
                targetScrollLeft < 0 ? -targetScrollLeft : 0,
              );
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
        const nextClips = getEditedClips(event.clientX);
        previewEditedClips(nextClips);
        applyClipsNow(nextClips);
      }

      const targetElement = event.currentTarget as HTMLElement;
      try {
        targetElement.setPointerCapture(event.pointerId);
      } catch {}

      const onPointerMove = (pointerEvent: PointerEvent) => {
        const currentState = editState.current;
        if (pointerEvent.pointerId !== currentState.pointerId) return;
        pointerEvent.preventDefault();

        if (
          !currentState.moved &&
          Math.abs(pointerEvent.clientX - currentState.startX) <=
            DRAG_THRESHOLD_PX
        ) {
          return;
        }

        currentState.moved = true;
        const nextClips = getEditedClips(pointerEvent.clientX);
        previewEditedClips(nextClips);
        applyClipsNow(nextClips);
      };

      const finishEdit = (pointerEvent: PointerEvent) => {
        const currentState = editState.current;
        if (pointerEvent.pointerId !== currentState.pointerId) return;

        const nextClips = currentState.baselineClips
          ? getEditedClips(
              currentState.moved ? pointerEvent.clientX : currentState.lastX,
            )
          : clips;
        if (currentState.moved) applyClipsNow(nextClips);
        setScrubPreview(null);
        resetFilmstripEdit();

        try {
          if (targetElement.hasPointerCapture(pointerEvent.pointerId)) {
            targetElement.releasePointerCapture(pointerEvent.pointerId);
          }
        } catch {}
        windowDrag.cleanup();
      };

      const cancelEdit = (pointerEvent: PointerEvent) => {
        if (pointerEvent.pointerId !== editState.current.pointerId) return;
        setScrubPreview(null);
        resetFilmstripEdit();
        try {
          if (targetElement.hasPointerCapture(pointerEvent.pointerId)) {
            targetElement.releasePointerCapture(pointerEvent.pointerId);
          }
        } catch {}
        windowDrag.cleanup();
      };

      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", finishEdit);
      window.addEventListener("pointercancel", cancelEdit);
      windowDrag.setCleanup(() => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finishEdit);
        window.removeEventListener("pointercancel", cancelEdit);
      });
    },
    [
      applyClipsNow,
      clips,
      minDuration,
      parentRef,
      resetFilmstripEdit,
      safePixelsPerSecond,
      setScrubPreview,
      setSelectedIndex,
      setTrackTranslateX,
      stopInertia,
      thumbnailMode,
      windowDrag,
      writeScrollLeft,
    ],
  );

  const cancelFilmstripEdit = useCallback(() => {
    if (!editState.current.active) return;
    setScrubPreview(null);
    resetFilmstripEdit();
  }, [resetFilmstripEdit, setScrubPreview]);

  return {
    handleFilmStripPointerDown,
    cancelFilmstripEdit,
    isFilmStripEditing,
    activeFilmStripEdit,
    isUnfreezing,
  };
}

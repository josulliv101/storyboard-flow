import { useCallback, useRef } from "react";
import type {
  TimelineClip,
  TrimScrubPreview,
  VideoSourceWindowEditMode,
} from "../types";
import { editVideoSourceWindowFromBaseline } from "../timeline";
import { getSourceTimeFromClientX } from "../utils/math";
import { DRAG_THRESHOLD_PX } from "../constants";

type UseFilmStripEditOptions = {
  clips: TimelineClip[];
  minDuration: number;
  setSelectedIndex: (index: number) => void;
  setScrubPreview: (preview: TrimScrubPreview | null) => void;
  scheduleClips: (next: TimelineClip[]) => void;
  applyClipsNow: (next: TimelineClip[]) => void;
  stopInertia: () => void;
  /** Stops the separate timeline-pan drag system from also engaging. */
  cleanupOtherDragListeners: () => void;
};

/**
 * Drag handling for the selected video's filmstrip: dragging the highlighted
 * window moves it ("move"), clicking elsewhere in the strip re-centers it
 * ("center"), and dragging its left/right edges resizes the source window
 * while keeping the opposite timeline edge fixed.
 */
export function useFilmStripEdit({
  clips,
  minDuration,
  setSelectedIndex,
  setScrubPreview,
  scheduleClips,
  applyClipsNow,
  stopInertia,
  cleanupOtherDragListeners,
}: UseFilmStripEditOptions) {
  const editState = useRef({
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
    moved: false,
    baselineClips: null as TimelineClip[] | null,
  });

  const windowCleanupRef = useRef<(() => void) | null>(null);

  const cleanupWindowListeners = useCallback(() => {
    windowCleanupRef.current?.();
    windowCleanupRef.current = null;
  }, []);

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
      cleanupOtherDragListeners();
      setSelectedIndex(clip.index);

      const rect = filmStripElement.getBoundingClientRect();
      const rectWidth = Math.max(1, rect.width);
      const startSourceTime = getSourceTimeFromClientX({
        clientX: e.clientX,
        rectLeft: rect.left,
        rectWidth,
        sourceDuration: clip.sourceDuration,
      });

      const state = editState.current;
      state.active = true;
      state.anchorIndex = clip.index;
      state.mode = mode;
      state.startX = e.clientX;
      state.lastX = e.clientX;
      state.startSourceTime = startSourceTime;
      state.lastSourceTime = startSourceTime;
      state.rectLeft = rect.left;
      state.rectWidth = rectWidth;
      state.pointerId = e.pointerId;
      state.moved = mode === "center";
      state.baselineClips = clips.map((currentClip) => ({ ...currentClip }));

      const getEditedClips = (clientX: number) => {
        const currentState = editState.current;
        if (!currentState.baselineClips) return clips;

        const sourceTime = getSourceTimeFromClientX({
          clientX,
          rectLeft: currentState.rectLeft,
          rectWidth: currentState.rectWidth,
          sourceDuration: clip.sourceDuration,
        });
        currentState.lastX = clientX;
        currentState.lastSourceTime = sourceTime;

        return editVideoSourceWindowFromBaseline({
          baselineClips: currentState.baselineClips,
          anchorIndex: currentState.anchorIndex,
          mode: currentState.mode,
          // Dragging the highlighted source window should move the slip
          // window in the same visual direction as the pointer. The source
          // strip itself is positioned opposite the selected clip by trimIn,
          // so invert the delta for move-mode drags.
          deltaTime:
            currentState.mode === "move"
              ? currentState.startSourceTime - sourceTime
              : sourceTime - currentState.startSourceTime,
          sourceTime,
          minDuration,
        });
      };

      const previewEditedClips = (nextClips: TimelineClip[]) => {
        const currentState = editState.current;
        const previewClip = nextClips[currentState.anchorIndex];
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
        scheduleClips(nextClips);
      }

      try {
        filmStripElement.setPointerCapture(e.pointerId);
      } catch {
        // Window listeners below still keep editing alive.
      }

      const handleWindowMove = (event: PointerEvent) => {
        const currentState = editState.current;
        if (event.pointerId !== currentState.pointerId) return;

        event.preventDefault();

        const dx = event.clientX - currentState.startX;
        if (!currentState.moved && Math.abs(dx) <= DRAG_THRESHOLD_PX) return;

        currentState.moved = true;
        const nextClips = getEditedClips(event.clientX);
        previewEditedClips(nextClips);
        scheduleClips(nextClips);
      };

      const finishEdit = (event: PointerEvent) => {
        const currentState = editState.current;
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

        try {
          if (filmStripElement.hasPointerCapture(event.pointerId)) {
            filmStripElement.releasePointerCapture(event.pointerId);
          }
        } catch {
          // Ignore release errors from browsers that never captured the pointer.
        }

        cleanupWindowListeners();
      };

      const cancelEdit = (event: PointerEvent) => {
        const currentState = editState.current;
        if (event.pointerId !== currentState.pointerId) return;

        setScrubPreview(null);
        currentState.active = false;
        currentState.anchorIndex = -1;
        currentState.pointerId = -1;
        currentState.moved = false;
        currentState.baselineClips = null;
        cleanupWindowListeners();
      };

      window.addEventListener("pointermove", handleWindowMove, {
        passive: false,
      });
      window.addEventListener("pointerup", finishEdit);
      window.addEventListener("pointercancel", cancelEdit);

      windowCleanupRef.current = () => {
        window.removeEventListener("pointermove", handleWindowMove);
        window.removeEventListener("pointerup", finishEdit);
        window.removeEventListener("pointercancel", cancelEdit);
      };
    },
    [
      applyClipsNow,
      cleanupOtherDragListeners,
      cleanupWindowListeners,
      clips,
      minDuration,
      scheduleClips,
      setScrubPreview,
      setSelectedIndex,
      stopInertia,
    ],
  );

  const cancelActiveEdit = useCallback(() => {
    const state = editState.current;
    state.active = false;
    state.anchorIndex = -1;
    state.pointerId = -1;
    state.moved = false;
    state.baselineClips = null;
    cleanupWindowListeners();
  }, [cleanupWindowListeners]);

  return {
    handleFilmStripPointerDown,
    cancelActiveEdit,
    cleanupWindowListeners,
  };
}

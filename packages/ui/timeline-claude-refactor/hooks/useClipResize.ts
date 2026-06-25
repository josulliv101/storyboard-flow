import { useCallback, useRef } from "react";
import type { TimelineClip, TrimEdge, TrimScrubPreview } from "../types";
import { resizeClipsFromBaseline, getTrimHandleSourceTime } from "../timeline";
import { MAX_WIDTH, RESIZE_KEY_STEP_PX } from "../constants";

type UseClipResizeOptions = {
  clips: TimelineClip[];
  minDuration: number;
  pixelsPerSecond: number;
  setSelectedIndex: (index: number) => void;
  setScrubPreview: (preview: TrimScrubPreview | null) => void;
  scheduleClips: (next: TimelineClip[]) => void;
  applyClipsNow: (next: TimelineClip[]) => void;
  stopInertia: () => void;
};

/**
 * Drag and keyboard handling for a selected clip's trim handles (the amber
 * bars at the left/right edges of a timeline item). Dragging trims that
 * clip's visible duration and repacks neighbors; arrow keys nudge by a fixed
 * pixel step, Home/End jump to the size extremes.
 */
export function useClipResize({
  clips,
  minDuration,
  pixelsPerSecond,
  setSelectedIndex,
  setScrubPreview,
  scheduleClips,
  applyClipsNow,
  stopInertia,
}: UseClipResizeOptions) {
  const resizeState = useRef({
    active: false,
    anchorIndex: -1,
    edge: "right" as TrimEdge,
    startX: 0,
    baselineClips: null as TimelineClip[] | null,
  });

  const handleResizeDown = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      clip: TimelineClip,
      edge: TrimEdge,
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
      rs.anchorIndex = clip.index;
      rs.edge = edge;
      rs.startX = e.clientX;
      rs.baselineClips = clips.map((currentClip) => ({ ...currentClip }));

      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
    },
    [clips, setScrubPreview, setSelectedIndex, stopInertia],
  );

  const handleResizeMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rs = resizeState.current;
      if (!rs.active || !rs.baselineClips) return;

      e.stopPropagation();
      e.preventDefault();

      const deltaTime = (e.clientX - rs.startX) / pixelsPerSecond;
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

      scheduleClips(nextClips);
    },
    [minDuration, pixelsPerSecond, scheduleClips, setScrubPreview],
  );

  const handleResizeUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rs = resizeState.current;
      if (!rs.active || !rs.baselineClips) return;

      e.stopPropagation();
      e.preventDefault();

      const deltaTime = (e.clientX - rs.startX) / pixelsPerSecond;
      const nextClips = resizeClipsFromBaseline({
        baselineClips: rs.baselineClips,
        anchorIndex: rs.anchorIndex,
        edge: rs.edge,
        deltaTime,
        minDuration,
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
    },
    [applyClipsNow, minDuration, pixelsPerSecond, setScrubPreview],
  );

  const handleResizeKeyDown = useCallback(
    (
      e: React.KeyboardEvent<HTMLDivElement>,
      clip: TimelineClip,
      edge: TrimEdge,
    ) => {
      let deltaPx = 0;

      if (e.key === "Home") {
        deltaPx = -MAX_WIDTH;
      } else if (e.key === "End") {
        deltaPx = MAX_WIDTH;
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
        deltaTime: deltaPx / pixelsPerSecond,
        minDuration,
      });

      applyClipsNow(nextClips);
    },
    [applyClipsNow, clips, minDuration, pixelsPerSecond, setScrubPreview, setSelectedIndex, stopInertia],
  );

  return {
    handleResizeDown,
    handleResizeMove,
    handleResizeUp,
    handleResizeKeyDown,
  };
}

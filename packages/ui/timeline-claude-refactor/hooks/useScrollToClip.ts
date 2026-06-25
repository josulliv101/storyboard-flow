import { useCallback } from "react";
import type { TimelineClip } from "../types";
import { clamp } from "../utils/math";

export function useScrollToClip(
  elementRef: React.RefObject<HTMLDivElement | null>,
  clips: TimelineClip[],
  pixelsPerSecond: number,
  stopInertia: () => void,
) {
  return useCallback(
    (targetIndex: number) => {
      const el = elementRef.current;
      if (!el || clips.length === 0) return;

      stopInertia();

      const index = clamp(Math.floor(targetIndex), 0, clips.length - 1);
      const clip = clips[index];
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const nextScrollLeft = clamp(
        clip.startTime * pixelsPerSecond,
        0,
        maxScroll,
      );

      el.scrollTo({ left: nextScrollLeft, behavior: "smooth" });
    },
    [clips, elementRef, pixelsPerSecond, stopInertia],
  );
}

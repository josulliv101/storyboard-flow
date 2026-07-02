import { useCallback } from "react";

import { MAX_WIDTH, MIN_WIDTH } from "../constants";
import type { TimelineClip } from "../types";
import { clamp } from "../utils";
import { packClipsLeftToRight } from "./use-timeline-clips";

type UseTimelineMediaDurationOptions = {
  itemHeight: number;
  pixelsPerSecond: number;
  setClips: React.Dispatch<React.SetStateAction<TimelineClip[]>>;
};

export function useTimelineMediaDuration({
  itemHeight,
  pixelsPerSecond,
  setClips,
}: UseTimelineMediaDurationOptions) {
  return useCallback((index: number, duration: number) => {
    setClips((previousClips) => {
      const clip = previousClips.find((candidate) => candidate.index === index);
      if (!clip || clip.kind !== "video") return previousClips;
      if (Math.abs(clip.sourceDuration - duration) < 0.1) return previousClips;

      const nextClips = previousClips.map((candidate) => ({ ...candidate }));
      const nextClip = { ...clip, sourceDuration: duration };
      const visibleWidth = clamp(
        Math.round(itemHeight * clip.aspect),
        MIN_WIDTH,
        MAX_WIDTH,
      );
      const targetDuration = visibleWidth / pixelsPerSecond;
      const hiddenDuration = Math.max(0, duration - targetDuration);

      nextClip.duration = Math.min(duration, targetDuration);
      nextClip.trimIn = hiddenDuration / 2;
      nextClip.trimOut = hiddenDuration - nextClip.trimIn;
      nextClips[index] = nextClip;
      return packClipsLeftToRight(nextClips, index, nextClip);
    });
  }, [itemHeight, pixelsPerSecond, setClips]);
}

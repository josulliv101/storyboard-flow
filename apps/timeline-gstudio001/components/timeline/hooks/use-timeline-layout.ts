/* eslint-disable react-hooks/refs */

import { useMemo, useRef } from "react";

import {
  THUMBNAIL_GAP,
  TIMELINE_TRAILING_PADDING_SECONDS,
  VISIBLE_OVERSCAN_PX,
} from "../constants";
import {
  getTimelineGridContentWidth,
  getTimelineGridItemLayout,
  type TimelineGridMetrics,
} from "../timeline-grid";
import type { TimelineClip } from "../types";

type UseTimelineLayoutOptions = {
  clips: TimelineClip[];
  closingOverhangOffset: number;
  firstOverhang: number;
  isResizing: boolean;
  lastOverhang: number;
  pixelsPerSecond: number;
  scrollLeft: number;
  gridMetrics: TimelineGridMetrics;
  thumbnailMode: boolean;
  thumbnailWidth: number;
  viewportClientWidth: number;
};

export function useTimelineLayout({
  clips,
  closingOverhangOffset,
  firstOverhang,
  isResizing,
  lastOverhang,
  pixelsPerSecond,
  scrollLeft,
  gridMetrics,
  thumbnailMode,
  thumbnailWidth,
  viewportClientWidth,
}: UseTimelineLayoutOptions) {
  const maxDurationDuringDragRef = useRef<number | null>(null);

  const baseTotalDuration = useMemo(() => {
    const lastClipEnd = clips.reduce(
      (maximum, clip) => Math.max(maximum, clip.startTime + clip.duration),
      0,
    );
    return lastClipEnd + TIMELINE_TRAILING_PADDING_SECONDS;
  }, [clips]);

  let totalDuration = baseTotalDuration;
  if (isResizing) {
    maxDurationDuringDragRef.current ??= baseTotalDuration;
    totalDuration = Math.max(baseTotalDuration, maxDurationDuringDragRef.current);
  } else {
    maxDurationDuringDragRef.current = null;
  }

  const visibleClips = useMemo(() => {
    const offset = firstOverhang + closingOverhangOffset;
    const visibleStartPx = scrollLeft - offset - VISIBLE_OVERSCAN_PX;
    const visibleEndPx =
      scrollLeft - offset + viewportClientWidth + VISIBLE_OVERSCAN_PX;
    const visibleStartTime = Math.max(0, visibleStartPx / pixelsPerSecond);
    const visibleEndTime = visibleEndPx / pixelsPerSecond;

    return clips.filter((clip) => {
      if (thumbnailMode && gridMetrics.enabled) {
        const layout = getTimelineGridItemLayout(clip.index, gridMetrics);
        const clipStartPx = layout.left;
        const clipEndPx = clipStartPx + layout.width;
        return clipEndPx >= visibleStartPx && clipStartPx <= visibleEndPx;
      }

      if (thumbnailMode) {
        const clipStartPx = clip.index * (thumbnailWidth + THUMBNAIL_GAP);
        const clipEndPx = clipStartPx + thumbnailWidth;
        return clipEndPx >= visibleStartPx && clipStartPx <= visibleEndPx;
      }

      return (
        clip.startTime + clip.duration >= visibleStartTime &&
        clip.startTime <= visibleEndTime
      );
    });
  }, [
    clips,
    closingOverhangOffset,
    firstOverhang,
    gridMetrics,
    pixelsPerSecond,
    scrollLeft,
    thumbnailMode,
    thumbnailWidth,
    viewportClientWidth,
  ]);

  const contentWidth = thumbnailMode && gridMetrics.enabled
    ? getTimelineGridContentWidth(clips.length, gridMetrics)
    : thumbnailMode
    ? clips.length * thumbnailWidth +
      Math.max(0, clips.length - 1) * THUMBNAIL_GAP
    : Math.ceil(totalDuration * pixelsPerSecond);
  const timelineWidth = Math.max(
    viewportClientWidth || 1,
    contentWidth + firstOverhang + lastOverhang,
  );

  return {
    totalDuration,
    visibleClips,
    timelineWidth,
  };
}

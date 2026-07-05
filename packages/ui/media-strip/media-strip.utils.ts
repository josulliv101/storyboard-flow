import { type CSSProperties } from "react";
import type { TimelineItem, VideoTimelineItem } from "./media-strip.types";

export const MIN_ITEM_WIDTH_PX = 96;
export const MAX_ITEM_WIDTH_PX = 320;

export const getTimelineItemEndTimeSeconds = (item: TimelineItem): number =>
  item.startTimeSeconds + item.durationSeconds;

/** Derives visible duration from the source trim points, independent of `durationSeconds`. */
export const getVideoVisibleDurationSeconds = (
  item: Pick<VideoTimelineItem, "sourceDurationSeconds" | "trimInSeconds" | "trimOutSeconds">
): number =>
  item.sourceDurationSeconds - item.trimInSeconds - item.trimOutSeconds;

/**
 * Calculates clamped item width in pixels based on its duration and scale.
 */
export function getItemWidth(
  item: Pick<TimelineItem, "durationSeconds">,
  pxPerSecond: number
): number {
  return Math.max(
    MIN_ITEM_WIDTH_PX,
    Math.min(item.durationSeconds * pxPerSecond, MAX_ITEM_WIDTH_PX)
  );
}

/**
 * Formats a duration in seconds into a readable string (e.g. MM:SS or H:MM:SS).
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Custom comparison function to optimize MediaStripItemButton memoization.
 * Performs reference equality check on the item and structural equality checks
 * on the virtualized absolute positioning styles.
 *
 * NOTE: Constant properties (like `position: "absolute"` and `left: 0`) are
 * intentionally skipped since they are identical across all items. Only styles
 * that vary per virtual item (`width`, `transform`, `top`, `height`) are compared here.
 * If layout logic is modified in the future (e.g. for RTL left adjustments), those
 * fields must be added here to avoid stale renders.
 */
export function areEqual(
  prevProps: { item: TimelineItem; style?: CSSProperties },
  nextProps: { item: TimelineItem; style?: CSSProperties }
): boolean {
  return (
    prevProps.item === nextProps.item &&
    prevProps.style?.width === nextProps.style?.width &&
    prevProps.style?.transform === nextProps.style?.transform &&
    prevProps.style?.top === nextProps.style?.top &&
    prevProps.style?.height === nextProps.style?.height
  );
}

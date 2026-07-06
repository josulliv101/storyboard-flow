import { type CSSProperties } from "react";
import type { TimelineItem, VideoTimelineItem, MediaStripMove } from "./media-strip.types";

export const MIN_ITEM_WIDTH_PX = 96;

/**
 * Padding applied to the ToggleGroup container in pixels.
 * Coupled with Tailwind's "p-1" class (0.25rem = 4px).
 */
export const TOGGLE_GROUP_PADDING_PX = 4;

export const getTimelineItemEndTimeSeconds = (item: TimelineItem): number =>
  item.startTimeSeconds + item.durationSeconds;

/** Derives visible duration from the source trim points, independent of `durationSeconds`. */
export const getVideoVisibleDurationSeconds = (
  item: Pick<VideoTimelineItem, "sourceDurationSeconds" | "trimInSeconds" | "trimOutSeconds">
): number =>
  item.sourceDurationSeconds - item.trimInSeconds - item.trimOutSeconds;

/**
 * Calculates item width in pixels based on its duration and scale, clamped to a minimum.
 */
export function getItemWidth(
  item: Pick<TimelineItem, "durationSeconds">,
  pxPerSecond: number
): number {
  return Math.max(MIN_ITEM_WIDTH_PX, item.durationSeconds * pxPerSecond);
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

/** Shared props type between the item button and the custom memoization comparator. */
export type MediaStripItemAreEqualProps = {
  item: TimelineItem;
  style?: CSSProperties;
  thumbnailVariant?: "single" | "sequence";
  items: TimelineItem[];
  isKeyboardReordering?: boolean;
  stripId?: string;
  onMoveItem?: (details: MediaStripMove) => void;
};

/**
 * Custom comparison function to optimize MediaStripItemButton memoization.
 * Performs reference equality check on the item and structural equality checks
 * on the virtualized absolute positioning styles.
 *
 * NOTE: style.left (derived from virtualItem.start) and style.width (derived from itemWidths)
 * vary per virtual item and are compared. style.top and style.height are constant (defined
 * relative to TOGGLE_GROUP_PADDING_PX) but are included for robustness.
 * Constant properties (like `position: "absolute"`) are skipped since they are identical
 * across all items.
 * Transform/transition properties are computed separately via useSortable inside the
 * MediaStripItemButton component and are not compared here.
 */
export function areEqual(
  prevProps: MediaStripItemAreEqualProps,
  nextProps: MediaStripItemAreEqualProps
): boolean {
  return (
    prevProps.item === nextProps.item &&
    prevProps.style?.width === nextProps.style?.width &&
    prevProps.style?.left === nextProps.style?.left &&
    prevProps.style?.top === nextProps.style?.top &&
    prevProps.style?.height === nextProps.style?.height &&
    prevProps.thumbnailVariant === nextProps.thumbnailVariant &&
    prevProps.items === nextProps.items &&
    prevProps.isKeyboardReordering === nextProps.isKeyboardReordering &&
    prevProps.stripId === nextProps.stripId &&
    prevProps.onMoveItem === nextProps.onMoveItem
  );
}

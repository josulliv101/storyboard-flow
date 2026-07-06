import { type CSSProperties } from "react";
import type { TimelineItem, VideoTimelineItem, MediaStripMove } from "./media-strip.types";

export const MIN_ITEM_WIDTH_PX = 96;

/**
 * Height of the thumbnail card in pixels.
 * Coupled with Tailwind's "h-24" class (6rem = 96px).
 */
export const THUMBNAIL_HEIGHT_PX = 96;

/**
 * Distance thresholds in pixels to activate dragging gestures.
 * - scroll: drag distance required to initiate drag scrolling on the scroll area.
 * - board: drag distance required to initiate dnd-kit item reordering.
 * Board threshold is slightly higher to prioritize clicks and distinguish them from drag scrolls.
 */
export const DRAG_ACTIVATION_THRESHOLDS_PX = {
  scroll: 4,
  board: 5,
};

/**
 * Shared DOM attribute names to keep selectors in sync across files.
 */
export const DATA_VALUE_ATTR = "data-value";
export const VALUE_ATTR = "value";
export const DATA_REORDER_HANDLE_ATTR = "data-reorder-handle";

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
  const width = item.durationSeconds * pxPerSecond;
  if (!Number.isFinite(width) || width < 0) {
    return MIN_ITEM_WIDTH_PX;
  }
  return Math.max(MIN_ITEM_WIDTH_PX, width);
}

/**
 * Formats a duration in seconds into a readable string (e.g. MM:SS or H:MM:SS).
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "00:00";
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Checks if a DOM element is horizontally fully visible within its scroll container.
 */
export function isElementFullyVisibleInScrollArea(
  element: HTMLElement,
  container: HTMLElement,
  bufferPx = 4
): boolean {
  const rect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  return (
    rect.left >= containerRect.left - bufferPx &&
    rect.right <= containerRect.right + bufferPx
  );
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
 * Whitelists other props for shallow comparison so that any future added props
 * must be explicitly considered and compared, preventing silent memoization regression.
 */
export function areEqual(
  prevProps: MediaStripItemAreEqualProps,
  nextProps: MediaStripItemAreEqualProps
): boolean {
  // Structural checks on virtualized style object properties
  const prevStyle = prevProps.style;
  const nextStyle = nextProps.style;
  if (
    prevStyle?.width !== nextStyle?.width ||
    prevStyle?.left !== nextStyle?.left ||
    prevStyle?.top !== nextStyle?.top ||
    prevStyle?.height !== nextStyle?.height
  ) {
    return false;
  }

  // whitelist for simple value/reference checks
  // Note: if you add a new prop to MediaStripItemAreEqualProps, add it here.
  const keys: Exclude<keyof MediaStripItemAreEqualProps, "style">[] = [
    "item",
    "thumbnailVariant",
    "items",
    "isKeyboardReordering",
    "stripId",
    "onMoveItem",
  ];

  return keys.every((key) => prevProps[key] === nextProps[key]);
}

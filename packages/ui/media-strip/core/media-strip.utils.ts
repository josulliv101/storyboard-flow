import { type CSSProperties } from "react";
import {
  type TimelineItem,
  type VideoTimelineItem,
  type CollectionId,
} from "./media-strip.types";

export const MIN_ITEM_WIDTH_PX = 96;

/**
 * Height of the thumbnail card in pixels.
 * Coupled with Tailwind's "h-24" class (6rem = 96px).
 */
export const THUMBNAIL_HEIGHT_PX = 96;

/**
 * Nesting hotspot boundary offset scale factors.
 * An item dropped within [20%, 80%] of a nested collection's card bounding box triggers nesting.
 */
export const NEST_HOTSPOT_MIN_OFFSET = 0.2;
export const NEST_HOTSPOT_MAX_OFFSET = 0.8;

/**
 * Rect shape accepted by `isPointInNestHotspot`: both `DOMRect` (from
 * `getBoundingClientRect`) and `MediaStripDndClientRect` (the DnD-adapter's
 * own rect type) satisfy this structurally.
 */
export type NestHotspotRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

/**
 * True if `point` falls within the central [20%, 80%] hotspot of `rect` —
 * the region that triggers nesting a dragged item into a collection card
 * instead of reordering next to it. Shared by every DnD adapter's nest-target
 * detection (dnd-kit's collision detection, and the pointer-driven adapters'
 * `getNestTargetId`) so the hotspot geometry can't drift between them.
 */
export function isPointInNestHotspot(
  rect: NestHotspotRect,
  point: { x: number; y: number }
): boolean {
  const hotspotLeft = rect.left + rect.width * NEST_HOTSPOT_MIN_OFFSET;
  const hotspotRight = rect.left + rect.width * NEST_HOTSPOT_MAX_OFFSET;
  const hotspotTop = rect.top + rect.height * NEST_HOTSPOT_MIN_OFFSET;
  const hotspotBottom = rect.top + rect.height * NEST_HOTSPOT_MAX_OFFSET;

  return (
    point.x >= hotspotLeft &&
    point.x <= hotspotRight &&
    point.y >= hotspotTop &&
    point.y <= hotspotBottom
  );
}

/**
 * True if `point` falls anywhere within `rect` (inclusive of its edges).
 * Used to prioritize whichever droppable the pointer is actually
 * geometrically over, before falling back to a pure nearest-neighbor search
 * — see `detectCollision` for why the fallback alone isn't reliable.
 */
export function isPointWithinRect(
  rect: NestHotspotRect,
  point: { x: number; y: number }
): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.left + rect.width &&
    point.y >= rect.top &&
    point.y <= rect.top + rect.height
  );
}

/**
 * Which side of `rect` a horizontal drop should land on, given a reference
 * x-coordinate (the pointer position for the pointer-driven adapters, or the
 * dragged item's own current x-position for dnd-kit). Splitting at the
 * midpoint keeps this in sync with `isPointInNestHotspot`'s [20%, 80%]
 * center band: outside that band is always "before"/"after" territory, so
 * the two checks never disagree about whether a point is a reorder or a nest.
 */
export function resolveItemDropSide(
  rect: NestHotspotRect,
  referenceX: number
): "before" | "after" {
  const midpointX = rect.left + rect.width / 2;
  return referenceX < midpointX ? "before" : "after";
}

/**
 * Default width in pixels for the drag overlay representation of a media item
 * if its real dimensions cannot be resolved from the DOM.
 */
export const DEFAULT_DRAG_OVERLAY_WIDTH_PX = 160;

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
 * Reference frame duration used to express pointer velocities in px/frame at
 * 60fps. Shared by the drag-scroll gesture tracking and the inertia animation
 * so the velocity handed from one to the other means the same thing in both.
 */
export const FRAME_DURATION_60FPS_MS = 16.67;

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
  index: number;
  isKeyboardReordering?: boolean;
  collectionId?: CollectionId;
};

// Compile-time-exhaustive whitelist: adding a prop to
// `MediaStripItemAreEqualProps` without listing it here (or explicitly
// excluding it like `style`) is a type error, not a silent memoization
// regression.
const SHALLOW_COMPARED_PROP_KEYS = {
  item: true,
  thumbnailVariant: true,
  index: true,
  isKeyboardReordering: true,
  collectionId: true,
} satisfies Record<Exclude<keyof MediaStripItemAreEqualProps, "style">, true>;

/**
 * Custom comparison function to optimize MediaStripItemButton memoization.
 * Performs reference equality check on the item and structural equality checks
 * on the virtualized absolute positioning styles.
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

  const keys = Object.keys(SHALLOW_COMPARED_PROP_KEYS) as Array<
    keyof typeof SHALLOW_COMPARED_PROP_KEYS
  >;

  return keys.every((key) => prevProps[key] === nextProps[key]);
}

/**
 * Unified instructions for keyboard reordering mode.
 * shared by the handle's aria-label and the screen-reader announcements to prevent copy drift.
 */
export const KEYBOARD_REORDER_INSTRUCTIONS =
  "Use ArrowLeft/Right to reorder, ArrowUp/Down to move between collections, Home/End to skip to edges, N to nest, U to move out to the parent collection, Enter or Space to drop, Escape to cancel.";


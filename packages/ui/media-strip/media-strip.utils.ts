import { type CSSProperties } from "react";
import {
  type TimelineItem,
  type VideoTimelineItem,
  type DndTarget,
  type TimelineItemId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemMove,
  type TimelineItemDrop,
  asTimelineItemId,
  asCollectionId,
  isCollectionItem,
} from "./media-strip.types";

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
  items: readonly TimelineItem[];
  isKeyboardReordering?: boolean;
  collectionId?: CollectionId;
  onMoveItem?: (details: TimelineItemMove | TimelineItemDrop) => void;
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
    "collectionId",
    "onMoveItem",
  ];

  return keys.every((key) => prevProps[key] === nextProps[key]);
}

export function encodeDndTarget(target: DndTarget): string {
  if (target.type === "item") return `item:${target.itemId}`;
  if (target.type === "collection-container") return `container:${target.collectionId}`;
  if (target.type === "collection-nest-target") return `nest:${target.collectionId}`;
  throw new Error("Invalid target type");
}

export function decodeDndTarget(id: string): DndTarget | null {
  if (id.startsWith("item:")) {
    const rawId = id.slice(5);
    const parsed = asTimelineItemId(rawId);
    if (parsed.ok) {
      return { type: "item", itemId: parsed.value };
    }
  }
  if (id.startsWith("container:")) {
    const rawId = id.slice(10);
    const parsed = asCollectionId(rawId);
    if (parsed.ok) {
      return { type: "collection-container", collectionId: parsed.value };
    }
  }
  if (id.startsWith("nest:")) {
    const rawId = id.slice(5);
    const parsed = asCollectionId(rawId);
    if (parsed.ok) {
      return { type: "collection-nest-target", collectionId: parsed.value };
    }
  }
  return null;
}

export function syncCollectionItemCounts(
  collectionsById: Readonly<Record<CollectionId, TimelineCollection>>
): Readonly<Record<CollectionId, TimelineCollection>> {
  const result: Record<CollectionId, TimelineCollection> = {};
  let changed = false;

  for (const [id, col] of Object.entries(collectionsById)) {
    const colId = id as CollectionId;
    const nextItems = col.items.map((item) => {
      if (isCollectionItem(item)) {
        const backingCol = collectionsById[item.collectionId];
        const derivedCount = backingCol ? backingCol.items.length : 0;
        if (item.itemCount !== derivedCount) {
          changed = true;
          return { ...item, itemCount: derivedCount };
        }
      }
      return item;
    });

    result[colId] = {
      ...col,
      items: nextItems,
    };
  }

  return changed ? result : (collectionsById as Record<CollectionId, TimelineCollection>);
}

export function moveTimelineItem({
  collectionsById,
  move,
}: {
  collectionsById: Readonly<Record<CollectionId, TimelineCollection>>;
  move: TimelineItemMove;
}): Record<CollectionId, TimelineCollection> {
  const { itemId, fromCollectionId, toCollectionId, fromIndex, toIndex } = move;

  const fromCol = collectionsById[fromCollectionId];
  const toCol = collectionsById[toCollectionId];

  if (!fromCol || !toCol) {
    return collectionsById as Record<CollectionId, TimelineCollection>;
  }

  const nextCollections = { ...collectionsById };

  if (fromCollectionId === toCollectionId) {
    const items = [...fromCol.items];
    const actualFromIndex = items.findIndex((i) => i.id === itemId);
    if (actualFromIndex === -1) return collectionsById as Record<CollectionId, TimelineCollection>;
    const [removed] = items.splice(actualFromIndex, 1);
    const targetIdx = Math.max(0, Math.min(toIndex, items.length));
    items.splice(targetIdx, 0, removed);

    nextCollections[fromCollectionId] = {
      ...fromCol,
      items,
    };
  } else {
    const fromItems = [...fromCol.items];
    const actualFromIndex = fromItems.findIndex((i) => i.id === itemId);
    if (actualFromIndex === -1) return collectionsById as Record<CollectionId, TimelineCollection>;
    const [removed] = fromItems.splice(actualFromIndex, 1);

    const toItems = [...toCol.items];
    const targetIdx = Math.max(0, Math.min(toIndex, toItems.length));
    toItems.splice(targetIdx, 0, removed);

    nextCollections[fromCollectionId] = {
      ...fromCol,
      items: fromItems,
    };
    nextCollections[toCollectionId] = {
      ...toCol,
      items: toItems,
    };
  }

  return syncCollectionItemCounts(nextCollections);
}

export function applyTimelineItemMoveOrDrop({
  collectionsById,
  moveOrDrop,
}: {
  collectionsById: Readonly<Record<CollectionId, TimelineCollection>>;
  moveOrDrop: TimelineItemMove | TimelineItemDrop;
}): Readonly<Record<CollectionId, TimelineCollection>> {
  if ("intent" in moveOrDrop) {
    const drop = moveOrDrop;
    const { itemId, fromCollectionId, fromIndex, intent } = drop;
    const toCollectionId = intent.toCollectionId;
    const toCol = collectionsById[toCollectionId];
    const toIndex = intent.type === "nest"
      ? (intent.toIndex ?? (toCol ? toCol.items.length : 0))
      : intent.toIndex;

    return moveTimelineItem({
      collectionsById,
      move: {
        itemId,
        fromCollectionId,
        toCollectionId,
        fromIndex,
        toIndex,
      },
    });
  } else {
    return moveTimelineItem({
      collectionsById,
      move: moveOrDrop,
    });
  }
}


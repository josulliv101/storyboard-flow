import { type CSSProperties } from "react";
import {
  type TimelineItem,
  type CollectionId,
} from "./core/media-strip.types";

// React/DOM-coupled helpers that used to live in core/media-strip.utils.ts.
// They're split out so core/ actually satisfies its own contract
// ("framework- and DOM-independent, no React" — see ARCHITECTURE.md): this
// file is the designated home for anything that imports from react, takes an
// HTMLElement, or names a DOM attribute.

/**
 * Shared DOM attribute names to keep selectors in sync across files.
 */
export const DATA_VALUE_ATTR = "data-value";
export const VALUE_ATTR = "value";
export const DATA_REORDER_HANDLE_ATTR = "data-reorder-handle";

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

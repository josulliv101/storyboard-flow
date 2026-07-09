import { type KeyboardEvent, useCallback, useMemo } from "react";
import { type TimelineItem } from "./core/media-strip.types";
import { DATA_VALUE_ATTR, VALUE_ATTR } from "./media-strip.dom-utils";

/**
 * Custom hook to handle arrow key grid navigation across items in a media strip.
 * Supports roving tabindex and triggers virtualized scroll/focus coordination
 * when target items are virtualized out of the DOM.
 */
export function useMediaStripKeyboardNav(
  items: readonly TimelineItem[],
  viewportRef: React.RefObject<HTMLDivElement | null>,
  scrollToAndFocus: (index: number, valueId: string, preferHandle?: boolean) => void
) {
  // id-string -> index, so a keypress is an O(1) lookup rather than a
  // findIndex scan of `items` — which matters at the 1,000+ item scale the
  // strip virtualizes for.
  const indexByItemId = useMemo(() => {
    const map = new Map<string, number>();
    items.forEach((item, index) => map.set(String(item.id), index));
    return map;
  }, [items]);

  const handleKeyDownCapture = useCallback(
    (event: KeyboardEvent) => {
      // Note: Arrow key events on the item button container itself are captured here to manage
      // grid roving tabindex. For keyboard-driven reordering within the handles, refer to use-reorder-keyboard.ts.
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

      const currentEl = event.target as HTMLElement;
      const currentId = currentEl.getAttribute(DATA_VALUE_ATTR) || currentEl.getAttribute(VALUE_ATTR);
      if (!currentId) return;

      const currentIndex = indexByItemId.get(currentId);
      if (currentIndex === undefined) return;

      const nextIndex = event.key === "ArrowRight" ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex < 0 || nextIndex >= items.length) return;

      const nextId = String(items[nextIndex].id);
      const escapedId = CSS.escape(nextId);
      const alreadyMounted = viewportRef.current?.querySelector(
        `[${DATA_VALUE_ATTR}="${escapedId}"], [${VALUE_ATTR}="${escapedId}"]`
      );

      if (alreadyMounted) {
        // Let roving tabindex and standard focus flow handle it if it's already in the DOM
        // (WAI-ARIA roving tabindex navigates focus naturally within horizontal row rows,
        // while vertical navigation is handled by standard tab/shift-tab to avoid overriding
        // native page scroll navigation.)
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      scrollToAndFocus(nextIndex, nextId, false);
    },
    [items, indexByItemId, viewportRef, scrollToAndFocus]
  );

  return handleKeyDownCapture;
}

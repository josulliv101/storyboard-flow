import { useCallback, useMemo, type RefObject } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { type TimelineItem } from "./core/media-strip.types";
import { getItemWidth } from "./core/media-strip.utils";

/**
 * Sets up the horizontal `@tanstack/react-virtual` virtualizer for a media
 * strip's item row, along with the per-item pixel widths it (and the render
 * loop) both need — memoized once here so estimateSize and rendering don't
 * each recompute `getItemWidth` independently.
 */
export function useMediaStripVirtualizer(
  items: readonly TimelineItem[],
  pxPerSecond: number,
  itemGap: number,
  viewportRef: RefObject<HTMLDivElement | null>
) {
  const itemWidths = useMemo(() => {
    return items.map((item) => getItemWidth(item, pxPerSecond));
  }, [items, pxPerSecond]);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    getItemKey: useCallback(
      (index: number) => String(items[index]?.id ?? index),
      [items]
    ),
    estimateSize: useCallback(
      (index: number) => {
        return itemWidths[index] + itemGap;
      },
      [itemWidths, itemGap]
    ),
    horizontal: true,
    overscan: 5,
  });

  return { itemWidths, rowVirtualizer };
}

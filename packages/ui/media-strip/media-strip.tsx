"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  type ComponentPropsWithoutRef,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Button } from "../core/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "../core/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "../core/empty";
import { ToggleGroup } from "../core/toggle-group";
import { cn } from "../lib/utils";

import { DraggableScrollArea } from "./draggable-scroll-area";
import { MediaStripItemButton } from "./media-strip-item";
import type { TimelineItem, TimelineItemId } from "./media-strip.types";
import { getItemWidth } from "./media-strip.utils";

/**
 * Padding applied to the ToggleGroup container in pixels.
 * Coupled with Tailwind's "p-1" class (0.25rem = 4px).
 */
export const TOGGLE_GROUP_PADDING_PX = 4;

export type MediaStripSelection = {
  selectedIds: TimelineItemId[];
  selectedItems: TimelineItem[];
};

export type MediaStripProps = Omit<ComponentPropsWithoutRef<"div">, "title"> & {
  actionLabel?: string;
  emptyLabel?: string;
  heading?: string;
  items: TimelineItem[];
  onAction?: () => void;
  onSelectionChange: (selection: MediaStripSelection) => void;
  pxPerSecond?: number;
  itemGap?: number;
  selectedIds: TimelineItemId[];
  thumbnailVariant?: "single" | "sequence";
};

export function MediaStrip({
  actionLabel = "Add media",
  className,
  emptyLabel = "No media items yet.",
  heading = "Media strip",
  items,
  onAction,
  onSelectionChange,
  pxPerSecond = 32,
  itemGap = 12,
  selectedIds,
  thumbnailVariant = "sequence",
  ...props
}: MediaStripProps) {
  const headingId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportContentRef = useRef<HTMLDivElement>(null);

  const itemById = useMemo(() => {
    return new Map<TimelineItemId, TimelineItem>(
      items.map((item) => [item.id, item]),
    );
  }, [items]);

  const visibleSelectedIds = useMemo(() => {
    return selectedIds.filter((id) => itemById.has(id));
  }, [itemById, selectedIds]);

  const handleSelectionChange = useCallback(
    (values: string[]) => {
      const selectedItems = values
        .map((value) => itemById.get(value as TimelineItemId))
        .filter((item): item is TimelineItem => item !== undefined);

      const nextSelectedIds = selectedItems.map((item) => item.id);

      onSelectionChange({
        selectedIds: nextSelectedIds,
        selectedItems,
      });
    },
    [itemById, onSelectionChange],
  );

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => viewportRef.current,
    getItemKey: useCallback(
      (index: number) => String(items[index]?.id ?? index),
      [items]
    ),
    estimateSize: useCallback(
      (index: number) => {
        const item = items[index];
        const baseWidth = getItemWidth(item, pxPerSecond);
        // Add spacing/gap between items
        return baseWidth + itemGap;
      },
      [items, pxPerSecond, itemGap]
    ),
    horizontal: true,
    overscan: 5,
  });

  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;

      const currentEl = event.target as HTMLElement;
      const currentId = currentEl.getAttribute("data-value") || currentEl.getAttribute("value");
      if (!currentId) return;

      const currentIndex = items.findIndex((i) => String(i.id) === currentId);
      if (currentIndex === -1) return;

      const nextIndex = event.key === "ArrowRight" ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex < 0 || nextIndex >= items.length) return;

      const nextId = String(items[nextIndex].id);
      const escapedId = CSS.escape(nextId);
      const alreadyMounted = viewportRef.current?.querySelector(
        `[data-value="${escapedId}"], [value="${escapedId}"]`
      );

      if (alreadyMounted) {
        // Let Base UI handle the already-mounted case natively (preserving roving tabindex, RTL, Home/End, etc.)
        return;
      }

      // Intercept navigation keys at the container level only to bypass Base UI's
      // internal arrow-key listener for unmounted virtualized items.
      event.preventDefault();
      event.stopPropagation();

      rowVirtualizer.scrollToIndex(nextIndex, { align: "auto" });

      // Wait for the virtualizer to mount/render the element, then shift focus to it.
      // NOTE: requestAnimationFrame is a timing assumption rather than a guarantee, but is
      // highly reliable for DOM insertion cycles in modern browsers and React.
      requestAnimationFrame(() => {
        const nextEl = viewportRef.current?.querySelector<HTMLElement>(
          `[data-value="${escapedId}"], [value="${escapedId}"]`
        );
        if (nextEl) {
          nextEl.focus();
        }
      });
    },
    [items, rowVirtualizer]
  );

  return (
    <Card
      aria-labelledby={headingId}
      role="region"
      size="sm"
      className={cn("min-w-0 w-full", className)}
      {...props}
    >
      <CardHeader>
        <CardTitle id={headingId}>{heading}</CardTitle>
        {onAction && (
          <CardAction>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onAction}
            >
              {actionLabel}
            </Button>
          </CardAction>
        )}
      </CardHeader>

      <CardContent className="min-w-0">
        {items.length === 0 ? (
          <MediaStripEmptyState emptyLabel={emptyLabel} />
        ) : (
          <DraggableScrollArea label={`${heading} items`} viewportRef={viewportRef} viewportContentRef={viewportContentRef}>
            {/*
              Roving-tabindex accessibility note: Base UI's roving-tabindex keyboard navigation
              handles arrow keys internally, but since this is a virtualized list, off-screen items
              are unmounted. Keyboard navigation will be restricted to the currently mounted
              (visible and overscanned) items.
            */}
            <ToggleGroup
              multiple
              ref={viewportContentRef}
              aria-label={`${heading} selection`}
              // Note: p-1 corresponds to TOGGLE_GROUP_PADDING_PX (4px). If this padding class
              // is changed, TOGGLE_GROUP_PADDING_PX must be updated to match it.
              className="relative max-w-none items-stretch p-1 h-[9.5rem]"
              style={{
                // Subtract itemGap to fix the trailing-gap bug (so the scroll container
                // doesn't have an extra itemGap of dead space after the final item).
                width: `${Math.max(0, rowVirtualizer.getTotalSize() - itemGap)}px`,
              }}
              value={visibleSelectedIds}
              onValueChange={handleSelectionChange}
              onKeyDownCapture={handleKeyDownCapture}
              variant="outline"
            >
              {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const item = items[virtualItem.index];
                const baseWidth = getItemWidth(item, pxPerSecond);
                return (
                  <MediaStripItemButton
                    key={String(item.id)}
                    item={item}
                    thumbnailVariant={thumbnailVariant}
                    style={{
                      position: "absolute",
                      top: TOGGLE_GROUP_PADDING_PX,
                      left: 0,
                      width: `${baseWidth}px`,
                      transform: `translateX(${virtualItem.start}px)`,
                      height: `calc(100% - ${2 * TOGGLE_GROUP_PADDING_PX}px)`,
                    }}
                  />
                );
              })}
            </ToggleGroup>
          </DraggableScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function MediaStripEmptyState({ emptyLabel }: { emptyLabel: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyTitle>No media items</EmptyTitle>
        <EmptyDescription>{emptyLabel}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
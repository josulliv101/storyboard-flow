"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useEffect,
  type ComponentPropsWithoutRef,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LayoutGroup } from "motion/react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy } from "@dnd-kit/sortable";

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
import { getItemWidth, TOGGLE_GROUP_PADDING_PX } from "./media-strip.utils";
import { useMediaStripBoard } from "./media-strip-board";
import { useScrollToAndFocus } from "./use-scroll-to-and-focus";



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
  stripId?: string;
  onMoveItem?: (details: MediaStripMove) => void;
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
  stripId,
  onMoveItem,
  ...props
}: MediaStripProps) {
  const headingId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportContentRef = useRef<HTMLDivElement>(null);

  const defaultStripId = useId();
  const activeStripId = stripId ?? defaultStripId;

  // Integrate with the shared board Dnd Context
  const { activeKeyboardReorderId, registerStrip, unregisterStrip } = useMediaStripBoard();

  // Register this strip's ID within the board-scoped registry
  useEffect(() => {
    registerStrip(activeStripId);
    return () => {
      unregisterStrip(activeStripId);
    };
  }, [activeStripId, registerStrip, unregisterStrip]);

  // Register this strip as a droppable zone
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: activeStripId,
  });

  // Combine local scroll content ref with Dnd Kit droppable ref
  const mergedRef = useCallback(
    (element: HTMLDivElement | null) => {
      viewportContentRef.current = element;
      setDroppableRef(element);
    },
    [setDroppableRef]
  );

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

  // Memoize item widths to avoid double-computation in estimateSize and the render loop
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

  const scrollToAndFocus = useScrollToAndFocus(viewportRef, rowVirtualizer);

  // Monitor the index of the active keyboard reorder item within this strip's items.
  // If it moves (either locally or entering from another strip), ensure it is scrolled into view and focused.
  const keyboardReorderIndex = useMemo(() => {
    if (!activeKeyboardReorderId) return -1;
    return items.findIndex((item) => item.id === activeKeyboardReorderId);
  }, [items, activeKeyboardReorderId]);

  useEffect(() => {
    if (keyboardReorderIndex === -1 || !activeKeyboardReorderId) return;
    scrollToAndFocus(keyboardReorderIndex, String(activeKeyboardReorderId), true);
  }, [keyboardReorderIndex, activeKeyboardReorderId, scrollToAndFocus]);

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
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      scrollToAndFocus(nextIndex, nextId, false);
    },
    [items, scrollToAndFocus]
  );

  // Memoize sortable items list to prevent unnecessary garbage collection and areEqual loops
  const sortableItemIds = useMemo(() => items.map((item) => item.id), [items]);

  return (
    <Card
      aria-labelledby={headingId}
      role="region"
      size="sm"
      className={cn("min-w-0 w-full", className)}
      data-testid="media-strip"
      data-strip-id={activeStripId}
      // {...props} is safe to spread here because packages/ui/core/card.tsx's Card component
      // explicitly forwards all unknown props to its root <div> element.
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
          <div
            ref={setDroppableRef}
            className={cn(
              "rounded-lg border border-dashed p-4 transition-all duration-200",
              isOver ? "border-primary bg-primary/5 scale-[1.01] shadow-sm" : "border-border"
            )}
          >
            <MediaStripEmptyState emptyLabel={emptyLabel} />
          </div>
        ) : (
          <DraggableScrollArea
            label={`${heading} items`}
            viewportRef={viewportRef}
            viewportContentRef={viewportContentRef}
            testId={`media-strip-drag-scroll-${activeStripId}`}
          >
            <ToggleGroup
              multiple
              ref={mergedRef}
              aria-label={`${heading} selection`}
              className="relative max-w-none items-stretch p-1 h-[9.5rem]"
              style={{
                width: `${Math.max(0, rowVirtualizer.getTotalSize() - itemGap)}px`,
              }}
              value={visibleSelectedIds}
              onValueChange={handleSelectionChange}
              onKeyDownCapture={handleKeyDownCapture}
              variant="outline"
            >
              <SortableContext
                items={sortableItemIds}
                strategy={horizontalListSortingStrategy}
              >
                <LayoutGroup id={activeStripId}>
                  {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                    const item = items[virtualItem.index];
                    const baseWidth = itemWidths[virtualItem.index];
                    const isKeyboardReordering = activeKeyboardReorderId === item.id;
                    return (
                      <MediaStripItemButton
                        key={String(item.id)}
                        item={item}
                        thumbnailVariant={thumbnailVariant}
                        stripId={activeStripId}
                        onMoveItem={onMoveItem}
                        items={items}
                        isKeyboardReordering={isKeyboardReordering}
                        style={{
                          position: "absolute",
                          top: TOGGLE_GROUP_PADDING_PX,
                          left: `${virtualItem.start}px`,
                          width: `${baseWidth}px`,
                          height: `calc(100% - ${2 * TOGGLE_GROUP_PADDING_PX}px)`,
                        }}
                      />
                    );
                  })}
                </LayoutGroup>
              </SortableContext>
            </ToggleGroup>
          </DraggableScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function MediaStripEmptyState({ emptyLabel }: { emptyLabel: string }) {
  return (
    <Empty className="border-0">
      <EmptyHeader>
        <EmptyTitle>No media items</EmptyTitle>
        <EmptyDescription>{emptyLabel}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
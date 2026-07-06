"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useEffect,
  memo,
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
import { getItemWidth, TOGGLE_GROUP_PADDING_PX, encodeDndTarget } from "./media-strip.utils";
import { useMediaStripBoard } from "./media-strip-board";
import { useScrollToAndFocus } from "./use-scroll-to-and-focus";
import { useMediaStripKeyboardNav } from "./use-media-strip-keyboard-nav";
import {
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
  type TimelineItemMove,
  type TimelineItemDrop,
} from "./media-strip.types";

export type MediaStripSelection = {
  selectedIds: TimelineItemId[];
  selectedItems: TimelineItem[];
};

export type MediaStripProps = Omit<ComponentPropsWithoutRef<"div">, "title"> & {
  actionLabel?: string;
  emptyLabel?: string;
  heading?: string;
  collectionId?: CollectionId;
  items: readonly TimelineItem[];
  onAction?: () => void;
  onSelectionChange: (selection: MediaStripSelection) => void;
  pxPerSecond?: number;
  itemGap?: number;
  selectedIds: readonly TimelineItemId[];
  thumbnailVariant?: "single" | "sequence";
  onMoveItem?: (details: TimelineItemMove | TimelineItemDrop) => void;
};

export const MediaStrip = memo(
  function MediaStrip({
    actionLabel = "Add media",
    className,
    emptyLabel = "No media items yet.",
    heading = "Media strip",
    collectionId,
    items,
    onAction,
    onSelectionChange,
    pxPerSecond = 32,
    itemGap = 12,
    selectedIds,
    thumbnailVariant = "sequence",
    onMoveItem,
    ...props
  }: MediaStripProps) {
    const headingId = useId();
    const viewportRef = useRef<HTMLDivElement>(null);
    const viewportContentRef = useRef<HTMLDivElement>(null);

    const defaultCollectionId = useId() as CollectionId;
    const activeCollectionId = collectionId ?? defaultCollectionId;

    // Integrate with the shared board Dnd Context
    const { activeKeyboardReorderId, registerCollection, unregisterCollection } = useMediaStripBoard();

    // Register this collection ID within the board-scoped registry
    useEffect(() => {
      registerCollection(activeCollectionId);
      return () => {
        unregisterCollection(activeCollectionId);
      };
    }, [activeCollectionId, registerCollection, unregisterCollection]);

    // Register this strip as a droppable zone.
    const { setNodeRef: setDroppableRef, isOver } = useDroppable({
      id: `container:${activeCollectionId}`,
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
        items.map((item) => [item.id, item])
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
      [itemById, onSelectionChange]
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
    const keyboardReorderIndex = useMemo(() => {
      if (!activeKeyboardReorderId) return -1;
      return items.findIndex((item) => item.id === activeKeyboardReorderId);
    }, [items, activeKeyboardReorderId]);

    useEffect(() => {
      if (keyboardReorderIndex === -1 || !activeKeyboardReorderId) return;
      scrollToAndFocus(keyboardReorderIndex, String(activeKeyboardReorderId), true);
    }, [keyboardReorderIndex, activeKeyboardReorderId, scrollToAndFocus]);

    // Handle capture-phase keyboard arrow navigation across the items grid
    const handleKeyDownCapture = useMediaStripKeyboardNav(
      items,
      viewportRef,
      scrollToAndFocus
    );

    // Memoize sortable items list using the encoded DnD targets format
    const sortableItemIds = useMemo(() => {
      return items.map((item) => encodeDndTarget({ type: "item", itemId: item.id }));
    }, [items]);

    return (
      <Card
        aria-labelledby={headingId}
        role="region"
        size="sm"
        className={cn("min-w-0 w-full", className)}
        data-testid={`media-strip-${activeCollectionId}`}
        data-strip-id={activeCollectionId}
        data-collection-id={activeCollectionId}
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
              testId={`media-strip-drag-scroll-${activeCollectionId}`}
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
                  <LayoutGroup id={activeCollectionId}>
                    {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                      const item = items[virtualItem.index];
                      const baseWidth = itemWidths[virtualItem.index];
                      const isKeyboardReordering = activeKeyboardReorderId === item.id;
                      return (
                        <MediaStripItemButton
                          key={String(item.id)}
                          item={item}
                          thumbnailVariant={thumbnailVariant}
                          collectionId={activeCollectionId}
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
);

MediaStrip.displayName = "MediaStrip";

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
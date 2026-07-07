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
import { getItemWidth, TOGGLE_GROUP_PADDING_PX } from "./core/media-strip.utils";
import { encodeDndTarget } from "./core/media-strip.dnd";
import {
  useMediaStripBoardStable,
  useMediaStripBoardDrag,
} from "./media-strip-board";
import {
  MediaStripDroppable,
  MediaStripSortableItems,
} from "./media-strip-dnd-kit";
import { useScrollToAndFocus } from "./use-scroll-to-and-focus";
import { useMediaStripKeyboardNav } from "./use-media-strip-keyboard-nav";
import {
  asCollectionId,
  parseTimelineItemId,
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
} from "./core/media-strip.types";

export type MediaStripSelection = {
  selectedIds: TimelineItemId[];
  selectedItems: TimelineItem[];
};

export type MediaStripProps = Omit<ComponentPropsWithoutRef<"div">, "title"> & {
  actionLabel?: string;
  emptyLabel?: string;
  heading?: string;
  collectionId?: CollectionId;
  onAction?: () => void;
  onSelectionChange: (selection: MediaStripSelection) => void;
  pxPerSecond?: number;
  itemGap?: number;
  selectedIds: readonly TimelineItemId[];
  thumbnailVariant?: "single" | "sequence";
};

export const MediaStrip = memo(
  function MediaStrip({
    actionLabel = "Add media",
    className,
    emptyLabel = "No media items yet.",
    heading = "Media strip",
    collectionId,
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
    const viewportContentRef = useRef<HTMLDivElement | null>(null);

    // useId() is guaranteed to be non-empty, so this parse can never throw.
    const defaultCollectionId = asCollectionId(useId());
    const activeCollectionId = collectionId ?? defaultCollectionId;

    // Integrate with the shared board Dnd Context
    const stable = useMediaStripBoardStable();
    const drag = useMediaStripBoardDrag();
    const activeKeyboardReorderId = drag.activeKeyboardReorderId;
    const registerCollection = stable.registerCollection;
    const unregisterCollection = stable.unregisterCollection;

    const col = stable.collectionsById.get(activeCollectionId);
    const resolvedItems: readonly TimelineItem[] = col ? col.items : [];

    // Register this collection ID within the board-scoped registry
    useEffect(() => {
      registerCollection(activeCollectionId);
      return () => {
        unregisterCollection(activeCollectionId);
      };
    }, [activeCollectionId, registerCollection, unregisterCollection]);

    const containerDndId = useMemo(() => {
      return encodeDndTarget({
        type: "collection-container",
        collectionId: activeCollectionId,
      });
    }, [activeCollectionId]);

    const itemById = useMemo(() => {
      return new Map<TimelineItemId, TimelineItem>(
        resolvedItems.map((item) => [item.id, item])
      );
    }, [resolvedItems]);

    const visibleSelectedIds = useMemo(() => {
      return selectedIds.filter((id) => itemById.has(id));
    }, [itemById, selectedIds]);

    const handleSelectionChange = useCallback(
      (values: string[]) => {
        const selectedItems = values
          .map((value) => {
            const parsed = parseTimelineItemId(value);
            return parsed.ok ? itemById.get(parsed.value) : undefined;
          })
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
      return resolvedItems.map((item) => getItemWidth(item, pxPerSecond));
    }, [resolvedItems, pxPerSecond]);

    const rowVirtualizer = useVirtualizer({
      count: resolvedItems.length,
      getScrollElement: () => viewportRef.current,
      getItemKey: useCallback(
        (index: number) => String(resolvedItems[index]?.id ?? index),
        [resolvedItems]
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
      return resolvedItems.findIndex((item) => item.id === activeKeyboardReorderId);
    }, [resolvedItems, activeKeyboardReorderId]);

    useEffect(() => {
      if (keyboardReorderIndex === -1 || !activeKeyboardReorderId) return;
      scrollToAndFocus(keyboardReorderIndex, String(activeKeyboardReorderId), true);
    }, [keyboardReorderIndex, activeKeyboardReorderId, scrollToAndFocus]);

    // Handle capture-phase keyboard arrow navigation across the items grid
    const handleKeyDownCapture = useMediaStripKeyboardNav(
      resolvedItems,
      viewportRef,
      scrollToAndFocus
    );

    // Memoize sortable items list using the encoded DnD targets format
    const sortableItemIds = useMemo(() => {
      return resolvedItems.map((item) => encodeDndTarget({ type: "item", itemId: item.id }));
    }, [resolvedItems]);

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
          <MediaStripDroppable id={containerDndId}>
            {({ isOver, setNodeRef }) => {
              const mergedRef = (element: HTMLDivElement | null) => {
                viewportContentRef.current = element;
                if (typeof setNodeRef === "function") {
                  setNodeRef(element);
                }
              };

              return resolvedItems.length === 0 ? (
                <div
                  ref={setNodeRef}
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
                    <MediaStripSortableItems items={sortableItemIds}>
                      <LayoutGroup id={activeCollectionId}>
                        {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                          const item = resolvedItems[virtualItem.index];
                          const baseWidth = itemWidths[virtualItem.index];
                          const isKeyboardReordering = activeKeyboardReorderId === item.id;
                          return (
                            <MediaStripItemButton
                              key={String(item.id)}
                              item={item}
                              thumbnailVariant={thumbnailVariant}
                              collectionId={activeCollectionId}
                              index={virtualItem.index}
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
                    </MediaStripSortableItems>
                  </ToggleGroup>
                </DraggableScrollArea>
              );
            }}
          </MediaStripDroppable>
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

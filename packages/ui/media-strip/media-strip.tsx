"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useEffect,
  memo,
  type ComponentPropsWithoutRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
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
import { STRIP_ROW_HEIGHT_REM, TOGGLE_GROUP_PADDING_PX } from "./core/media-strip.utils";
import { encodeDndTarget } from "./core/media-strip.dnd";
import { useMediaStripBoardStable } from "./media-strip-board";
import { useMediaStripActiveKeyboardReorderId } from "./media-strip-drag-store";
import {
  MediaStripDroppable,
  MediaStripSortableItems,
} from "./media-strip-dnd-provider";
import { useScrollToAndFocus } from "./use-scroll-to-and-focus";
import { useMediaStripKeyboardNav } from "./use-media-strip-keyboard-nav";
import { useMediaStripVirtualizer } from "./use-media-strip-virtualizer";
import {
  trustedCollectionId,
  parseTimelineItemId,
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
} from "./core/media-strip.types";

export type MediaStripSelection = {
  collectionId: CollectionId;
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
    const defaultCollectionId = trustedCollectionId(useId());
    const activeCollectionId = collectionId ?? defaultCollectionId;

    // Integrate with the shared board Dnd Context
    const stable = useMediaStripBoardStable();
    // Selector subscription: the strip only re-renders when the active
    // keyboard-reorder item changes (pick-up/drop), not on pointer-drag
    // moves — those flow to individual items via the drag store instead.
    const activeKeyboardReorderId = useMediaStripActiveKeyboardReorderId();
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
          collectionId: activeCollectionId,
          selectedIds: nextSelectedIds,
          selectedItems,
        });
      },
      [activeCollectionId, itemById, onSelectionChange]
    );

    const { itemWidths, rowVirtualizer } = useMediaStripVirtualizer(
      resolvedItems,
      pxPerSecond,
      itemGap,
      viewportRef
    );

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
                  <MediaStripItemRow
                    droppableRef={setNodeRef}
                    viewportContentRef={viewportContentRef}
                    ariaLabel={`${heading} selection`}
                    widthPx={Math.max(0, rowVirtualizer.getTotalSize() - itemGap)}
                    value={visibleSelectedIds}
                    onValueChange={handleSelectionChange}
                    onKeyDownCapture={handleKeyDownCapture}
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
                  </MediaStripItemRow>
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

/**
 * The item row's `ToggleGroup`, which is also this strip's droppable surface
 * (the drag-scroll hook needs the same node via `viewportContentRef`). It
 * exists as its own component solely so it can merge the adapter-provided
 * `droppableRef` (only knowable inside `MediaStripDroppable`'s render prop)
 * with `viewportContentRef` via a hook-legal `useCallback` — rather than
 * stashing `droppableRef` into a ref during render, which is a render-phase
 * side effect that concurrent/StrictMode double-renders can run twice or
 * discard.
 *
 * The merged ref must stay stable across renders: media-strip re-renders on
 * every pointer move during a drag (`activeDropPlacement`), and a
 * fresh ref callback each render would detach + re-attach the droppable
 * node every frame, breaking dnd-kit's droppable tracking mid-drag. It IS
 * stable, because `droppableRef` is stable for all three adapters (dnd-kit's
 * `useDroppable().setNodeRef`, and the native/pragmatic `useState` setters).
 */
function MediaStripItemRow({
  droppableRef,
  viewportContentRef,
  ariaLabel,
  widthPx,
  value,
  onValueChange,
  onKeyDownCapture,
  children,
}: {
  droppableRef: Ref<HTMLDivElement>;
  viewportContentRef: RefObject<HTMLDivElement | null>;
  ariaLabel: string;
  widthPx: number;
  value: string[];
  onValueChange: (values: string[]) => void;
  onKeyDownCapture: (event: ReactKeyboardEvent) => void;
  children: ReactNode;
}) {
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      viewportContentRef.current = element;
      setRefValue(droppableRef, element);
    },
    [droppableRef, viewportContentRef]
  );

  return (
    <ToggleGroup
      multiple
      ref={setRef}
      aria-label={ariaLabel}
      // min-w-full makes the droppable surface at least as wide as the
      // visible viewport, not just the content — without it, a short strip
      // in a wide container has dead space to the right of the last item
      // that isn't part of the droppable (unlike the empty-state branch,
      // which has no explicit width and naturally fills its parent).
      className="relative max-w-none min-w-full items-stretch p-1"
      style={{ width: `${widthPx}px`, height: `${STRIP_ROW_HEIGHT_REM}rem` }}
      value={value}
      onValueChange={onValueChange}
      onKeyDownCapture={onKeyDownCapture}
      variant="outline"
    >
      {children}
    </ToggleGroup>
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

function setRefValue<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if ("current" in ref) {
    (ref as { current: T | null }).current = value;
  }
}

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
  selectedIds: TimelineItemId[];
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
  selectedIds,
  ...props
}: MediaStripProps) {
  const headingId = useId();
  const viewportRef = useRef<HTMLDivElement>(null);

  const itemById = useMemo(() => {
    return new Map<string, TimelineItem>(
      items.map((item) => [String(item.id), item]),
    );
  }, [items]);

  const visibleSelectedIds = useMemo(() => {
    return selectedIds.filter((id) => itemById.has(String(id)));
  }, [itemById, selectedIds]);

  const handleSelectionChange = useCallback(
    (values: string[]) => {
      const selectedItems = values
        .map((value) => itemById.get(value))
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
    estimateSize: useCallback(
      (index: number) => {
        const item = items[index];
        const baseWidth = Math.max(96, Math.min(item.durationSeconds * pxPerSecond, 320));
        // Add 12px spacing/gap between items
        return baseWidth + 12;
      },
      [items, pxPerSecond]
    ),
    horizontal: true,
    overscan: 5,
  });

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
          <DraggableScrollArea label={`${heading} items`} viewportRef={viewportRef}>
            <ToggleGroup
              multiple
              aria-label={`${heading} selection`}
              className="relative max-w-none items-stretch p-1 h-[9.5rem]"
              style={{
                width: `${rowVirtualizer.getTotalSize()}px`,
              }}
              value={visibleSelectedIds as string[]}
              onValueChange={handleSelectionChange}
              variant="outline"
            >
              {rowVirtualizer.getVirtualItems().map((virtualItem) => {
                const item = items[virtualItem.index];
                const baseWidth = Math.max(96, Math.min(item.durationSeconds * pxPerSecond, 320));
                return (
                  <MediaStripItemButton
                    key={String(item.id)}
                    item={item}
                    pxPerSecond={pxPerSecond}
                    style={{
                      position: "absolute",
                      top: 4,
                      left: 0,
                      width: `${baseWidth}px`,
                      transform: `translateX(${virtualItem.start}px)`,
                      height: "calc(100% - 8px)",
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
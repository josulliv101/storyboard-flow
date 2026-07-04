"use client";

import { type ComponentPropsWithoutRef } from "react";
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
import { MediaStripItem } from "./media-strip.types";
import { MediaStripItemButton } from "./media-strip-item";

export type MediaStripProps = ComponentPropsWithoutRef<"div"> & {
  actionLabel?: string;
  emptyLabel?: string;
  items: MediaStripItem[];
  onAction?: () => void;
  onSelectItem?: (item: MediaStripItem) => void;
  selectedId?: string;
  title?: string;
};

export function MediaStrip({
  actionLabel = "Add media",
  className,
  emptyLabel = "No media items yet.",
  items,
  onAction,
  onSelectItem,
  selectedId,
  title = "Media strip",
  ...props
}: MediaStripProps) {
  return (
    <Card
      aria-label={title}
      role="region"
      size="sm"
      className={cn(
        "min-w-0 w-full",
        className,
      )}
      {...props}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardAction>
          <Button size="sm" variant="outline" onClick={onAction}>
            {actionLabel}
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="min-w-0">
        {items.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>{title}</EmptyTitle>
              <EmptyDescription>{emptyLabel}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <DraggableScrollArea label={`${title} items`}>
            <ToggleGroup
              aria-label={`${title} selection`}
              className="w-max max-w-none items-stretch p-1"
              value={selectedId ? [selectedId] : []}
              onValueChange={(value) => {
                const item = items.find(({ id }) => id === value[0]);

                if (item) {
                  onSelectItem?.(item);
                }
              }}
              spacing={3}
              variant="outline"
            >
              {items.map((item) => <MediaStripItemButton key={item.id} item={item} />)}
            </ToggleGroup>
          </DraggableScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

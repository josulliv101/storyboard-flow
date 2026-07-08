"use client";

import { type ReactNode } from "react";

import {
  type MediaStripDndDroppableProps,
  type MediaStripDndProviderProps,
  type MediaStripDndSortableItemProps,
  type MediaStripDndSortableItemsProps,
} from "./media-strip-dnd.types";
import { useMediaStripDndRuntime } from "./media-strip-dnd-runtime";

export function MediaStripDndProvider({
  adapter,
  ...props
}: MediaStripDndProviderProps) {
  const Provider = adapter.Provider;
  return <Provider adapter={adapter} {...props} />;
}

export function MediaStripDragOverlay({ children }: { children: ReactNode }) {
  const { adapter } = useMediaStripDndRuntime();
  const DragOverlay = adapter.DragOverlay;
  return <DragOverlay>{children}</DragOverlay>;
}

export function MediaStripDroppable(props: MediaStripDndDroppableProps) {
  const { adapter } = useMediaStripDndRuntime();
  const Droppable = adapter.Droppable;
  return <Droppable {...props} />;
}

export function MediaStripSortableItems(
  props: MediaStripDndSortableItemsProps
) {
  const { adapter } = useMediaStripDndRuntime();
  const SortableItems = adapter.SortableItems;
  return <SortableItems {...props} />;
}

export function MediaStripSortableItem(props: MediaStripDndSortableItemProps) {
  const { adapter } = useMediaStripDndRuntime();
  const SortableItem = adapter.SortableItem;
  return <SortableItem {...props} />;
}

import { type HTMLAttributes, type ReactNode, type Ref } from "react";

import {
  type MediaStripDndAdapterId,
  type MediaStripDndAutoScrollOptions,
  type MediaStripDndCollisionDetection,
  type MediaStripDndDragEndEvent,
  type MediaStripDndDragMoveEvent,
  type MediaStripDndDragOverEvent,
  type MediaStripDndDragStartEvent,
  type MediaStripDndIdentifier,
} from "./core/media-strip.dnd-adapter";
import { type CollectionId } from "./core/media-strip.types";

export type MediaStripDndPointerInput = Readonly<{
  clientX: number;
  clientY: number;
}>;

export type MediaStripDndProviderProps = {
  adapter: MediaStripDndAdapter;
  autoScroll?: MediaStripDndAutoScrollOptions;
  children: ReactNode;
  dndKit?: Readonly<{
    activationDistance: number;
    collisionDetection?: MediaStripDndCollisionDetection;
  }>;
  getNestTargetId?: (args: {
    activeId: MediaStripDndIdentifier;
    overId: MediaStripDndIdentifier;
    element: Element;
    input: MediaStripDndPointerInput;
  }) => CollectionId | null;
  onDragCancel?: () => void;
  onDragEnd?: (event: MediaStripDndDragEndEvent) => void;
  onDragMove?: (event: MediaStripDndDragMoveEvent) => void;
  onDragOver?: (event: MediaStripDndDragOverEvent) => void;
  onDragStart?: (event: MediaStripDndDragStartEvent) => void;
};

export type MediaStripSortableRenderProps = {
  attributes: HTMLAttributes<HTMLElement>;
  isDragging: boolean;
  listeners: HTMLAttributes<HTMLElement>;
  setActivatorNodeRef: Ref<HTMLButtonElement>;
  setNodeRef: Ref<HTMLDivElement>;
  transformStyle: string | undefined;
  transition: string | undefined;
};

export type MediaStripDroppableRenderProps = {
  isOver: boolean;
  setNodeRef: Ref<HTMLDivElement>;
};

export type MediaStripDndDragOverlayProps = {
  children: ReactNode;
};

export type MediaStripDndDroppableProps = {
  children: (props: MediaStripDroppableRenderProps) => ReactNode;
  id: MediaStripDndIdentifier;
};

export type MediaStripDndSortableItemsProps = {
  children: ReactNode;
  items: MediaStripDndIdentifier[];
};

export type MediaStripDndSortableItemProps = {
  children: (props: MediaStripSortableRenderProps) => ReactNode;
  id: MediaStripDndIdentifier;
};

export type MediaStripDndAdapterComponents = Readonly<{
  DragOverlay: (props: MediaStripDndDragOverlayProps) => ReactNode;
  Droppable: (props: MediaStripDndDroppableProps) => ReactNode;
  Provider: (props: MediaStripDndProviderProps) => ReactNode;
  SortableItem: (props: MediaStripDndSortableItemProps) => ReactNode;
  SortableItems: (props: MediaStripDndSortableItemsProps) => ReactNode;
}>;

export type MediaStripDndAdapter = MediaStripDndAdapterComponents & Readonly<{
  id: MediaStripDndAdapterId;
}>;

"use client";

import {
  useCallback,
  useMemo,
  type ComponentProps,
  type Ref,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  type MediaStripDndAdapter,
  type MediaStripDndDragOverlayProps,
  type MediaStripDndDroppableProps,
  type MediaStripDndProviderProps,
  type MediaStripDndSortableItemProps,
  type MediaStripDndSortableItemsProps,
} from "../media-strip-dnd.types";
import { MediaStripDndRuntimeContext } from "../media-strip-dnd-runtime";

type DndContextProps = ComponentProps<typeof DndContext>;

export function DndKitProvider({
  adapter,
  autoScroll,
  children,
  dndKit,
  onDragCancel,
  onDragEnd,
  onDragMove,
  onDragOver,
  onDragStart,
}: MediaStripDndProviderProps) {
  const activationDistance = dndKit?.activationDistance ?? 0;
  const collisionDetection = dndKit?.collisionDetection;
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: activationDistance,
      },
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    onDragStart?.({ active: { id: event.active.id } });
  }, [onDragStart]);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    onDragMove?.({
      active: { id: event.active.id },
      over: event.over ? { id: event.over.id } : null,
    });
  }, [onDragMove]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    onDragOver?.({
      active: { id: event.active.id },
      over: event.over ? { id: event.over.id } : null,
    });
  }, [onDragOver]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    onDragEnd?.({
      active: { id: event.active.id },
      over: event.over ? { id: event.over.id } : null,
    });
  }, [onDragEnd]);

  const handleDragCancel = useCallback(() => {
    onDragCancel?.();
  }, [onDragCancel]);

  const handleCollisionDetection = useCallback<CollisionDetection>((args) => {
    if (!collisionDetection) return [];
    return collisionDetection(args) as Collision[];
  }, [collisionDetection]);

  const contextValue = useMemo(() => ({
    adapter,
    overlayPosition: null,
  }), [adapter]);

  return (
    <MediaStripDndRuntimeContext.Provider value={contextValue}>
      <DndContext
        autoScroll={autoScroll as DndContextProps["autoScroll"]}
        collisionDetection={collisionDetection ? handleCollisionDetection : undefined}
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        {children}
      </DndContext>
    </MediaStripDndRuntimeContext.Provider>
  );
}

export function DndKitDragOverlay({ children }: MediaStripDndDragOverlayProps) {
  return <DragOverlay>{children}</DragOverlay>;
}

export function DndKitDroppable({
  children,
  id,
}: MediaStripDndDroppableProps) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return children({
    isOver,
    setNodeRef: setNodeRef as Ref<HTMLDivElement>,
  });
}

export function DndKitSortableItems({
  children,
  items,
}: MediaStripDndSortableItemsProps) {
  return (
    <SortableContext items={items} strategy={horizontalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}

export function DndKitSortableItem({
  children,
  id,
}: MediaStripDndSortableItemProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return children({
    attributes,
    isDragging,
    listeners: listeners ?? {},
    setActivatorNodeRef: setActivatorNodeRef as Ref<HTMLButtonElement>,
    setNodeRef: setNodeRef as Ref<HTMLDivElement>,
    transformStyle: transform ? CSS.Transform.toString(transform) : undefined,
    transition: transition || undefined,
  });
}

export const dndKitMediaStripDndAdapter = {
  id: "dnd-kit",
  DragOverlay: DndKitDragOverlay,
  Droppable: DndKitDroppable,
  Provider: DndKitProvider,
  SortableItem: DndKitSortableItem,
  SortableItems: DndKitSortableItems,
  capabilities: {
    supportsSortableTransforms: true,
    supportsCollisionDetection: true,
    supportsCustomDragOverlay: true,
    supportsKeyboardSensor: false,
    requiresManualAutoScroll: false,
    requiresManualOverlayPosition: false,
  },
} satisfies MediaStripDndAdapter;

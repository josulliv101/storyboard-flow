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
import { type MediaStripDndCollisionDetectionArgs } from "../core/media-strip.dnd-adapter";
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

  // This adapter is the one boundary where dnd-kit's `UniqueIdentifier`
  // (`string | number`) enters the package. Every id we ever register is an
  // `encodeDndTarget` string, so `String(...)` here is a runtime no-op that
  // just re-narrows the type — letting `MediaStripDndIdentifier` be `string`
  // everywhere downstream.
  const handleDragStart = useCallback((event: DragStartEvent) => {
    onDragStart?.({ active: { id: String(event.active.id) } });
  }, [onDragStart]);

  // nestTargetId/placement are explicit nulls, not real resolutions: this
  // adapter's capabilities declare supportsCollisionDetection, which tells
  // the board's drag controller that placement resolution arrives
  // out-of-band via the collisionDetection callback — it ignores these
  // fields and keeps the collision results instead.
  const handleDragMove = useCallback((event: DragMoveEvent) => {
    onDragMove?.({
      active: { id: String(event.active.id) },
      over: event.over ? { id: String(event.over.id) } : null,
      nestTargetId: null,
      placement: null,
    });
  }, [onDragMove]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    onDragOver?.({
      active: { id: String(event.active.id) },
      over: event.over ? { id: String(event.over.id) } : null,
      nestTargetId: null,
      placement: null,
    });
  }, [onDragOver]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    onDragEnd?.({
      active: { id: String(event.active.id) },
      over: event.over ? { id: String(event.over.id) } : null,
      nestTargetId: null,
      placement: null,
    });
  }, [onDragEnd]);

  const handleDragCancel = useCallback(() => {
    onDragCancel?.();
  }, [onDragCancel]);

  const handleCollisionDetection = useCallback<CollisionDetection>((args) => {
    if (!collisionDetection) return [];
    // dnd-kit's collision args carry `string | number` ids; ours are always
    // the encoded strings we registered. The structural cast bridges that
    // (and dnd-kit's arg shape has a superset of the fields we read).
    return collisionDetection(
      args as unknown as MediaStripDndCollisionDetectionArgs
    ) as Collision[];
  }, [collisionDetection]);

  const contextValue = useMemo(() => ({ adapter }), [adapter]);

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

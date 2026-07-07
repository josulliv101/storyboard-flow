"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
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
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { disableNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  type DropTargetRecord,
  type Input,
} from "@atlaskit/pragmatic-drag-and-drop/types";

import {
  type MediaStripDndAdapterId,
  type MediaStripDndCollisionDetection,
  type MediaStripDndDragEndEvent,
  type MediaStripDndDragMoveEvent,
  type MediaStripDndDragOverEvent,
  type MediaStripDndDragStartEvent,
  type MediaStripDndIdentifier,
} from "./core/media-strip.dnd-adapter";
import { type CollectionId } from "./core/media-strip.types";

type DndContextProps = ComponentProps<typeof DndContext>;

type MediaStripDndProviderProps = Pick<
  DndContextProps,
  | "autoScroll"
  | "children"
  | "collisionDetection"
> & {
  activationDistance: number;
  adapter: MediaStripDndAdapterId;
  getNestTargetId?: (args: {
    activeId: MediaStripDndIdentifier;
    overId: MediaStripDndIdentifier;
    element: Element;
    input: Pick<Input, "clientX" | "clientY">;
  }) => CollectionId | null;
  onDragCancel?: () => void;
  onDragEnd?: (event: MediaStripDndDragEndEvent) => void;
  onDragMove?: (event: MediaStripDndDragMoveEvent) => void;
  onDragOver?: (event: MediaStripDndDragOverEvent) => void;
  onDragStart?: (event: MediaStripDndDragStartEvent) => void;
};

type SortableRenderProps = {
  attributes: HTMLAttributes<HTMLElement>;
  isDragging: boolean;
  listeners: HTMLAttributes<HTMLElement>;
  setActivatorNodeRef: Ref<HTMLElement>;
  setNodeRef: Ref<HTMLElement>;
  transformStyle: string | undefined;
  transition: string | undefined;
};

type DroppableRenderProps = {
  isOver: boolean;
  setNodeRef: Ref<HTMLElement>;
};

type MediaStripDndRuntimeContextType = {
  adapter: MediaStripDndAdapterId;
  overlayPosition: { x: number; y: number } | null;
};

const MediaStripDndRuntimeContext = createContext<MediaStripDndRuntimeContextType>({
  adapter: "dnd-kit",
  overlayPosition: null,
});

export function MediaStripDndProvider({
  adapter,
  ...props
}: MediaStripDndProviderProps) {
  if (adapter === "pragmatic") {
    return <PragmaticDndProvider adapter={adapter} {...props} />;
  }

  return <DndKitProvider adapter={adapter} {...props} />;
}

function DndKitProvider({
  activationDistance,
  adapter,
  children,
  onDragEnd,
  onDragMove,
  onDragOver,
  onDragStart,
  ...props
}: MediaStripDndProviderProps) {
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

  const contextValue = useMemo<MediaStripDndRuntimeContextType>(() => ({
    adapter,
    overlayPosition: null,
  }), [adapter]);

  return (
    <MediaStripDndRuntimeContext.Provider value={contextValue}>
      <DndContext
        {...props}
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {children}
      </DndContext>
    </MediaStripDndRuntimeContext.Provider>
  );
}

function PragmaticDndProvider({
  adapter,
  children,
  getNestTargetId,
  onDragEnd,
  onDragMove,
  onDragOver,
  onDragStart,
}: MediaStripDndProviderProps) {
  const [overlayPosition, setOverlayPosition] = useState<{ x: number; y: number } | null>(null);

  const getEventPayload = useCallback((sourceId: MediaStripDndIdentifier, input: Input, dropTargets: DropTargetRecord[]) => {
    const overRecord = dropTargets[0];
    const overId = overRecord ? getDndIdentifier(overRecord.data.id) : null;
    const nestTargetId = overRecord && overId && getNestTargetId
      ? getNestTargetId({
        activeId: sourceId,
        overId,
        element: overRecord.element,
        input,
      })
      : null;

    return {
      active: { id: sourceId },
      over: overId ? { id: overId } : null,
      nestTargetId,
    };
  }, [getNestTargetId]);

  useEffect(() => {
    return monitorForElements({
      canMonitor({ source }) {
        return getDndIdentifier(source.data.id) !== null;
      },
      onDragStart({ location, source }) {
        const sourceId = getDndIdentifier(source.data.id);
        if (!sourceId) return;

        setOverlayPosition(toOverlayPosition(location.current.input));
        onDragStart?.({ active: { id: sourceId } });
      },
      onDrag({ location, source }) {
        const sourceId = getDndIdentifier(source.data.id);
        if (!sourceId) return;

        setOverlayPosition(toOverlayPosition(location.current.input));
        const payload = getEventPayload(sourceId, location.current.input, location.current.dropTargets);
        onDragMove?.(payload);
        onDragOver?.(payload);
      },
      onDropTargetChange({ location, source }) {
        const sourceId = getDndIdentifier(source.data.id);
        if (!sourceId) return;

        setOverlayPosition(toOverlayPosition(location.current.input));
        const payload = getEventPayload(sourceId, location.current.input, location.current.dropTargets);
        onDragMove?.(payload);
        onDragOver?.(payload);
      },
      onDrop({ location, source }) {
        const sourceId = getDndIdentifier(source.data.id);
        if (!sourceId) return;

        const payload = getEventPayload(sourceId, location.current.input, location.current.dropTargets);
        onDragEnd?.(payload);
        setOverlayPosition(null);
      },
    });
  }, [getEventPayload, onDragEnd, onDragMove, onDragOver, onDragStart]);

  const contextValue = useMemo<MediaStripDndRuntimeContextType>(() => ({
    adapter,
    overlayPosition,
  }), [adapter, overlayPosition]);

  return (
    <MediaStripDndRuntimeContext.Provider value={contextValue}>
      {children}
    </MediaStripDndRuntimeContext.Provider>
  );
}

export function MediaStripDragOverlay({ children }: { children: ReactNode }) {
  const { adapter, overlayPosition } = useContext(MediaStripDndRuntimeContext);

  if (adapter === "pragmatic") {
    if (!overlayPosition) return null;

    return (
      <div
        className="pointer-events-none fixed left-0 top-0 z-50"
        style={{
          transform: `translate3d(${overlayPosition.x}px, ${overlayPosition.y}px, 0) translate(-50%, -50%)`,
        }}
      >
        {children}
      </div>
    );
  }

  return <DragOverlay>{children}</DragOverlay>;
}

export function MediaStripDroppable({
  children,
  id,
}: {
  children: (props: DroppableRenderProps) => ReactNode;
  id: MediaStripDndIdentifier;
}) {
  const { adapter } = useContext(MediaStripDndRuntimeContext);

  if (adapter === "pragmatic") {
    return <PragmaticDroppable id={id}>{children}</PragmaticDroppable>;
  }

  return <DndKitDroppable id={id}>{children}</DndKitDroppable>;
}

function DndKitDroppable({
  children,
  id,
}: {
  children: (props: DroppableRenderProps) => ReactNode;
  id: MediaStripDndIdentifier;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return children({
    isOver,
    setNodeRef: setNodeRef as Ref<HTMLElement>,
  });
}

function PragmaticDroppable({
  children,
  id,
}: {
  children: (props: DroppableRenderProps) => ReactNode;
  id: MediaStripDndIdentifier;
}) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    if (!element) return undefined;

    return dropTargetForElements({
      element,
      getData: () => ({ id }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [element, id]);

  return children({
    isOver,
    setNodeRef: setElement as Ref<HTMLElement>,
  });
}

export function MediaStripSortableItems({
  children,
  items,
}: {
  children: ReactNode;
  items: MediaStripDndIdentifier[];
}) {
  const { adapter } = useContext(MediaStripDndRuntimeContext);

  if (adapter === "pragmatic") {
    return <>{children}</>;
  }

  return (
    <SortableContext items={items} strategy={horizontalListSortingStrategy}>
      {children}
    </SortableContext>
  );
}

export function MediaStripSortableItem({
  children,
  id,
}: {
  children: (props: SortableRenderProps) => ReactNode;
  id: MediaStripDndIdentifier;
}) {
  const { adapter } = useContext(MediaStripDndRuntimeContext);

  if (adapter === "pragmatic") {
    return <PragmaticSortableItem id={id}>{children}</PragmaticSortableItem>;
  }

  return <DndKitSortableItem id={id}>{children}</DndKitSortableItem>;
}

function DndKitSortableItem({
  children,
  id,
}: {
  children: (props: SortableRenderProps) => ReactNode;
  id: MediaStripDndIdentifier;
}) {
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
    setActivatorNodeRef: setActivatorNodeRef as Ref<HTMLElement>,
    setNodeRef: setNodeRef as Ref<HTMLElement>,
    transformStyle: transform ? CSS.Transform.toString(transform) : undefined,
    transition: transition || undefined,
  });
}

function PragmaticSortableItem({
  children,
  id,
}: {
  children: (props: SortableRenderProps) => ReactNode;
  id: MediaStripDndIdentifier;
}) {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [dragHandle, setDragHandle] = useState<HTMLElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!element) return undefined;

    return combine(
      draggable({
        element,
        dragHandle: dragHandle ?? undefined,
        getInitialData: () => ({ id }),
        onGenerateDragPreview: ({ nativeSetDragImage }) => {
          disableNativeDragPreview({ nativeSetDragImage });
        },
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element,
        getData: () => ({ id }),
      }),
    );
  }, [dragHandle, element, id]);

  return children({
    attributes: {},
    isDragging,
    listeners: {},
    setActivatorNodeRef: setDragHandle as Ref<HTMLElement>,
    setNodeRef: setElement as Ref<HTMLElement>,
    transformStyle: undefined,
    transition: undefined,
  });
}

function getDndIdentifier(value: unknown): MediaStripDndIdentifier | null {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  return null;
}

function toOverlayPosition(input: Input): { x: number; y: number } {
  return {
    x: input.clientX,
    y: input.clientY,
  };
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Ref,
} from "react";
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
  type MediaStripDndAutoScrollOptions,
  type MediaStripDndIdentifier,
} from "../core/media-strip.dnd-adapter";
import {
  type MediaStripDndAdapter,
  type MediaStripDndDragOverlayProps,
  type MediaStripDndDroppableProps,
  type MediaStripDndProviderProps,
  type MediaStripDndSortableItemProps,
  type MediaStripDndSortableItemsProps,
} from "../media-strip-dnd.types";
import {
  MediaStripDndRuntimeContext,
  useMediaStripDndRuntime,
} from "../media-strip-dnd-runtime";

export function PragmaticProvider({
  adapter,
  autoScroll,
  children,
  getNestTargetId,
  onDragCancel,
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

        scrollPragmaticAutoScroll(location.current.input, autoScroll);
        setOverlayPosition(toOverlayPosition(location.current.input));
        const payload = getEventPayload(sourceId, location.current.input, location.current.dropTargets);
        onDragMove?.(payload);
        onDragOver?.(payload);
      },
      onDropTargetChange({ location, source }) {
        const sourceId = getDndIdentifier(source.data.id);
        if (!sourceId) return;

        scrollPragmaticAutoScroll(location.current.input, autoScroll);
        setOverlayPosition(toOverlayPosition(location.current.input));
        const payload = getEventPayload(sourceId, location.current.input, location.current.dropTargets);
        onDragMove?.(payload);
        onDragOver?.(payload);
      },
      onDrop({ location, source }) {
        const sourceId = getDndIdentifier(source.data.id);
        if (!sourceId) return;

        const payload = getEventPayload(sourceId, location.current.input, location.current.dropTargets);
        if (payload.over) {
          onDragEnd?.(payload);
        } else {
          onDragCancel?.();
        }
        setOverlayPosition(null);
      },
    });
  }, [autoScroll, getEventPayload, onDragCancel, onDragEnd, onDragMove, onDragOver, onDragStart]);

  const contextValue = useMemo(() => ({
    adapter,
    overlayPosition,
  }), [adapter, overlayPosition]);

  return (
    <MediaStripDndRuntimeContext.Provider value={contextValue}>
      {children}
    </MediaStripDndRuntimeContext.Provider>
  );
}

export function PragmaticDragOverlay({
  children,
}: MediaStripDndDragOverlayProps) {
  const { overlayPosition } = useMediaStripDndRuntime();
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

export function PragmaticDroppable({
  children,
  id,
}: MediaStripDndDroppableProps) {
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
    setNodeRef: setElement as Ref<HTMLDivElement>,
  });
}

export function PragmaticSortableItems({
  children,
}: MediaStripDndSortableItemsProps) {
  return <>{children}</>;
}

export function PragmaticSortableItem({
  children,
  id,
}: MediaStripDndSortableItemProps) {
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
    setActivatorNodeRef: setDragHandle as Ref<HTMLButtonElement>,
    setNodeRef: setElement as Ref<HTMLDivElement>,
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

function scrollPragmaticAutoScroll(
  input: Input,
  autoScroll: MediaStripDndAutoScrollOptions | undefined
) {
  if (!autoScroll || typeof document === "undefined") return;

  const element = document.elementFromPoint(input.clientX, input.clientY);
  const scrollArea = element?.closest('[data-scroll-area="true"]');
  const viewport = scrollArea?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
  if (!viewport) return;
  if (autoScroll.canScroll && !autoScroll.canScroll(viewport)) return;

  const rect = viewport.getBoundingClientRect();
  const threshold = autoScroll.threshold ?? 48;
  const maxSpeed = autoScroll.maxSpeed ?? 18;
  const distanceFromLeft = input.clientX - rect.left;
  const distanceFromRight = rect.right - input.clientX;

  let delta = 0;
  if (distanceFromLeft >= 0 && distanceFromLeft < threshold) {
    delta = -scaleAutoScrollSpeed(threshold - distanceFromLeft, threshold, maxSpeed);
  } else if (distanceFromRight >= 0 && distanceFromRight < threshold) {
    delta = scaleAutoScrollSpeed(threshold - distanceFromRight, threshold, maxSpeed);
  }

  if (delta !== 0) {
    viewport.scrollBy({ left: delta });
  }
}

function scaleAutoScrollSpeed(distance: number, threshold: number, maxSpeed: number) {
  return Math.max(1, Math.ceil((distance / threshold) * maxSpeed));
}

export const pragmaticMediaStripDndAdapter = {
  id: "pragmatic",
  DragOverlay: PragmaticDragOverlay,
  Droppable: PragmaticDroppable,
  Provider: PragmaticProvider,
  SortableItem: PragmaticSortableItem,
  SortableItems: PragmaticSortableItems,
} satisfies MediaStripDndAdapter;

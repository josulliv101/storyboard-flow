"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
  type Ref,
} from "react";

import {
  type MediaStripDndIdentifier,
} from "../core/media-strip.dnd-adapter";
import {
  type MediaStripDndAdapter,
  type MediaStripDndDragOverlayProps,
  type MediaStripDndDroppableProps,
  type MediaStripDndPointerInput,
  type MediaStripDndProviderProps,
  type MediaStripDndSortableItemProps,
  type MediaStripDndSortableItemsProps,
} from "../media-strip-dnd.types";
import {
  MediaStripDndRuntimeContext,
  useMediaStripDndRuntime,
} from "../media-strip-dnd-runtime";
import { scrollDraggedViewport } from "./dom-autoscroll";
import { useConstantStore, useRafBatchedStoreSetter } from "./external-store";

const NATIVE_DND_MIME = "application/x-storyboard-media-strip-dnd-id";

type NativeDropTargetKind = "container" | "item";

type NativeDropTarget = Readonly<{
  element: Element;
  id: MediaStripDndIdentifier;
  kind: NativeDropTargetKind;
}>;

type NativeOverlayPosition = Readonly<{ x: number; y: number }>;

type NativeDndContextType = Readonly<{
  activeId: MediaStripDndIdentifier | null;
  cancelDrag: () => void;
  dropOnTarget: (target: NativeDropTarget, event: DragEvent) => void;
  endDrag: () => void;
  getOverlaySnapshot: () => NativeOverlayPosition | null;
  getOverIdSnapshot: () => MediaStripDndIdentifier | null;
  moveOverTarget: (target: NativeDropTarget, event: DragEvent) => void;
  startDrag: (id: MediaStripDndIdentifier, event: ReactDragEvent<HTMLElement>) => void;
  subscribeOverlay: (listener: () => void) => () => void;
  subscribeOverId: (listener: () => void) => () => void;
}>;

const NativeDndContext = createContext<NativeDndContextType | null>(null);

export function NativeHtml5Provider({
  adapter,
  autoScroll,
  children,
  getDropTargetInfo,
  onDragCancel,
  onDragEnd,
  onDragMove,
  onDragOver,
  onDragStart,
}: MediaStripDndProviderProps) {
  const [activeId, setActiveId] = useState<MediaStripDndIdentifier | null>(null);
  const overlayStore = useConstantStore<NativeOverlayPosition | null>(null);
  const overIdStore = useConstantStore<MediaStripDndIdentifier | null>(null);
  const activeIdRef = useRef<MediaStripDndIdentifier | null>(null);
  const didDropRef = useRef(false);

  const {
    schedule: scheduleOverlayPosition,
    cancelScheduled: cancelScheduledOverlayPosition,
  } = useRafBatchedStoreSetter(overlayStore);

  const clearDragState = useCallback(() => {
    activeIdRef.current = null;
    didDropRef.current = false;
    cancelScheduledOverlayPosition();
    setActiveId(null);
    overIdStore.set(null);
    overlayStore.set(null);
  }, [cancelScheduledOverlayPosition, overlayStore, overIdStore]);

  const getPayload = useCallback((
    sourceId: MediaStripDndIdentifier,
    target: NativeDropTarget | null,
    input: MediaStripDndPointerInput
  ) => {
    const info = target && getDropTargetInfo
      ? getDropTargetInfo({
        activeId: sourceId,
        overId: target.id,
        element: target.element,
        input,
      })
      : null;

    return {
      active: { id: sourceId },
      over: target ? { id: target.id } : null,
      nestTargetId: info?.nestTargetId ?? null,
      placement: info?.placement ?? null,
    };
  }, [getDropTargetInfo]);

  const startDrag = useCallback((id: MediaStripDndIdentifier, event: ReactDragEvent<HTMLElement>) => {
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
      onDragCancel?.();
      clearDragState();
      return;
    }

    activeIdRef.current = id;
    didDropRef.current = false;
    setActiveId(id);
    overIdStore.set(null);
    scheduleOverlayPosition(toOverlayPosition(event));

    dataTransfer.effectAllowed = "move";
    dataTransfer.setData(NATIVE_DND_MIME, String(id));
    dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);

    onDragStart?.({ active: { id } });
  }, [clearDragState, onDragCancel, onDragStart, overIdStore, scheduleOverlayPosition]);

  const moveOverTarget = useCallback((target: NativeDropTarget, event: DragEvent) => {
    const sourceId = activeIdRef.current;
    if (!sourceId) return;

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }

    const input = toPointerInput(event);
    overIdStore.set(target.id);
    scheduleOverlayPosition(toOverlayPosition(event));
    scrollDraggedViewport(input, autoScroll);

    const payload = getPayload(sourceId, target, input);
    onDragMove?.(payload);
    onDragOver?.(payload);
  }, [autoScroll, getPayload, onDragMove, onDragOver, overIdStore, scheduleOverlayPosition]);

  const dropOnTarget = useCallback((target: NativeDropTarget, event: DragEvent) => {
    const sourceId = activeIdRef.current;
    if (!sourceId) return;

    event.preventDefault();
    didDropRef.current = true;

    const input = toPointerInput(event);
    const payload = getPayload(sourceId, target, input);
    if (payload.over) {
      onDragEnd?.(payload);
    } else {
      onDragCancel?.();
    }
    clearDragState();
  }, [clearDragState, getPayload, onDragCancel, onDragEnd]);

  const cancelDrag = useCallback(() => {
    if (activeIdRef.current) {
      onDragCancel?.();
    }
    clearDragState();
  }, [clearDragState, onDragCancel]);

  const endDrag = useCallback(() => {
    if (!didDropRef.current && activeIdRef.current) {
      onDragCancel?.();
    }
    clearDragState();
  }, [clearDragState, onDragCancel]);

  useEffect(() => {
    if (!activeId) return undefined;

    const handleDocumentDragOver = (event: DragEvent) => {
      if (!activeIdRef.current) return;
      const input = toPointerInput(event);
      scheduleOverlayPosition(toOverlayPosition(event));
      scrollDraggedViewport(input, autoScroll);
    };

    document.addEventListener("dragover", handleDocumentDragOver, { capture: true });

    return () => {
      document.removeEventListener("dragover", handleDocumentDragOver, { capture: true });
    };
  }, [activeId, autoScroll, scheduleOverlayPosition]);

  const nativeContextValue = useMemo(() => ({
    activeId,
    cancelDrag,
    dropOnTarget,
    endDrag,
    getOverlaySnapshot: overlayStore.getSnapshot,
    getOverIdSnapshot: overIdStore.getSnapshot,
    moveOverTarget,
    startDrag,
    subscribeOverlay: overlayStore.subscribe,
    subscribeOverId: overIdStore.subscribe,
  }), [
    activeId,
    cancelDrag,
    dropOnTarget,
    endDrag,
    overlayStore,
    overIdStore,
    moveOverTarget,
    startDrag,
  ]);

  const runtimeContextValue = useMemo(() => ({ adapter }), [adapter]);

  return (
    <MediaStripDndRuntimeContext.Provider value={runtimeContextValue}>
      <NativeDndContext.Provider value={nativeContextValue}>
        {children}
      </NativeDndContext.Provider>
    </MediaStripDndRuntimeContext.Provider>
  );
}

export function NativeHtml5DragOverlay({
  children,
}: MediaStripDndDragOverlayProps) {
  useMediaStripDndRuntime();
  const overlayPosition = useNativeOverlayPosition();
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

export function NativeHtml5Droppable({
  children,
  id,
}: MediaStripDndDroppableProps) {
  const overId = useNativeOverId();
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useNativeDropTarget(element, id, "container");

  return children({
    isOver: overId === id,
    setNodeRef: setElement as Ref<HTMLDivElement>,
  });
}

export function NativeHtml5SortableItems({
  children,
}: MediaStripDndSortableItemsProps) {
  return <>{children}</>;
}

export function NativeHtml5SortableItem({
  children,
  id,
}: MediaStripDndSortableItemProps) {
  const nativeDnd = useNativeDnd();
  const [element, setElement] = useState<HTMLDivElement | null>(null);

  useNativeDropTarget(element, id, "item");

  return children({
    attributes: {
      "aria-grabbed": nativeDnd.activeId === id,
      draggable: true,
    },
    isDragging: false,
    listeners: {
      onDragEnd: nativeDnd.endDrag,
      onDragStart: (event) => nativeDnd.startDrag(id, event),
    },
    setActivatorNodeRef: noopRef,
    setNodeRef: setElement as Ref<HTMLDivElement>,
    transformStyle: undefined,
    transition: undefined,
  });
}

function useNativeDnd() {
  const context = useContext(NativeDndContext);
  if (!context) {
    throw new Error("Native media-strip DnD components must be rendered inside NativeHtml5Provider.");
  }
  return context;
}

function useNativeOverlayPosition() {
  const { getOverlaySnapshot, subscribeOverlay } = useNativeDnd();
  return useSyncExternalStore(subscribeOverlay, getOverlaySnapshot, getOverlaySnapshot);
}

function useNativeOverId() {
  const { getOverIdSnapshot, subscribeOverId } = useNativeDnd();
  return useSyncExternalStore(subscribeOverId, getOverIdSnapshot, getOverIdSnapshot);
}

function useNativeDropTarget(
  element: HTMLElement | null,
  id: MediaStripDndIdentifier,
  kind: NativeDropTargetKind
) {
  const { dropOnTarget, moveOverTarget } = useNativeDnd();

  useEffect(() => {
    if (!element) return undefined;

    const target = { element, id, kind } satisfies NativeDropTarget;
    const handleDragOver = (event: DragEvent) => {
      if (kind === "item") {
        event.stopPropagation();
      }
      moveOverTarget(target, event);
    };
    const handleDrop = (event: DragEvent) => {
      if (kind === "item") {
        event.stopPropagation();
      }
      dropOnTarget(target, event);
    };

    element.addEventListener("dragover", handleDragOver);
    element.addEventListener("drop", handleDrop);

    return () => {
      element.removeEventListener("dragover", handleDragOver);
      element.removeEventListener("drop", handleDrop);
    };
  }, [dropOnTarget, element, id, kind, moveOverTarget]);
}

const noopRef: Ref<HTMLButtonElement> = () => {};

let transparentDragImage: HTMLCanvasElement | null = null;

function getTransparentDragImage() {
  if (transparentDragImage) return transparentDragImage;
  transparentDragImage = document.createElement("canvas");
  transparentDragImage.width = 1;
  transparentDragImage.height = 1;
  return transparentDragImage;
}

function toPointerInput(event: DragEvent | ReactDragEvent<HTMLElement>): MediaStripDndPointerInput {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
  };
}

function toOverlayPosition(event: DragEvent | ReactDragEvent<HTMLElement>) {
  return {
    x: event.clientX,
    y: event.clientY,
  };
}

export const nativeHtml5MediaStripDndAdapter = {
  id: "native-html5",
  DragOverlay: NativeHtml5DragOverlay,
  Droppable: NativeHtml5Droppable,
  Provider: NativeHtml5Provider,
  SortableItem: NativeHtml5SortableItem,
  SortableItems: NativeHtml5SortableItems,
  capabilities: {
    supportsSortableTransforms: false,
    supportsCollisionDetection: false,
    supportsCustomDragOverlay: true,
    supportsKeyboardSensor: false,
    requiresManualAutoScroll: true,
    requiresManualOverlayPosition: true,
  },
} satisfies MediaStripDndAdapter;

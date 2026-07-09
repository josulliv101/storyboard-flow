"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
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
} from "../media-strip-dnd-runtime";
import { scrollDraggedViewport } from "./dom-autoscroll";
import {
  type ExternalStore,
  useConstantStore,
  useRafBatchedStoreSetter,
} from "./external-store";

type PragmaticOverlayPosition = Readonly<{ x: number; y: number }>;

// Overlay position travels through its own external store, NOT the runtime
// context: routing it through provider state re-rendered every runtime
// context consumer (the entire strip subtree) on every pointer move. Only
// PragmaticDragOverlay subscribes to this.
const PragmaticOverlayStoreContext =
  createContext<ExternalStore<PragmaticOverlayPosition | null> | null>(null);

export function PragmaticProvider({
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
  const overlayStore = useConstantStore<PragmaticOverlayPosition | null>(null);
  const {
    schedule: scheduleOverlayPosition,
    cancelScheduled: cancelScheduledOverlayPosition,
  } = useRafBatchedStoreSetter(overlayStore);

  const getEventPayload = useCallback((sourceId: MediaStripDndIdentifier, input: Input, dropTargets: DropTargetRecord[]) => {
    const overRecord = dropTargets[0];
    const overId = overRecord ? getDndIdentifier(overRecord.data.id) : null;
    const info = overRecord && overId && getDropTargetInfo
      ? getDropTargetInfo({
        activeId: sourceId,
        overId,
        element: overRecord.element,
        input,
      })
      : null;

    return {
      active: { id: sourceId },
      over: overId ? { id: overId } : null,
      nestTargetId: info?.nestTargetId ?? null,
      placement: info?.placement ?? null,
    };
  }, [getDropTargetInfo]);

  useEffect(() => {
    return monitorForElements({
      canMonitor({ source }) {
        return getDndIdentifier(source.data.id) !== null;
      },
      onDragStart({ location, source }) {
        const sourceId = getDndIdentifier(source.data.id);
        if (!sourceId) return;

        scheduleOverlayPosition(toOverlayPosition(location.current.input));
        onDragStart?.({ active: { id: sourceId } });
      },
      onDrag({ location, source }) {
        const sourceId = getDndIdentifier(source.data.id);
        if (!sourceId) return;

        scrollDraggedViewport(location.current.input, autoScroll);
        scheduleOverlayPosition(toOverlayPosition(location.current.input));
        const payload = getEventPayload(sourceId, location.current.input, location.current.dropTargets);
        onDragMove?.(payload);
        onDragOver?.(payload);
      },
      onDropTargetChange({ location, source }) {
        const sourceId = getDndIdentifier(source.data.id);
        if (!sourceId) return;

        scrollDraggedViewport(location.current.input, autoScroll);
        scheduleOverlayPosition(toOverlayPosition(location.current.input));
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
        // Clear immediately (not via the rAF batch) so the overlay can't
        // flash at a stale position for a frame after the drop.
        cancelScheduledOverlayPosition();
        overlayStore.set(null);
      },
    });
  }, [
    autoScroll,
    getEventPayload,
    onDragCancel,
    onDragEnd,
    onDragMove,
    onDragOver,
    onDragStart,
    overlayStore,
    scheduleOverlayPosition,
    cancelScheduledOverlayPosition,
  ]);

  const contextValue = useMemo(() => ({ adapter }), [adapter]);

  return (
    <MediaStripDndRuntimeContext.Provider value={contextValue}>
      <PragmaticOverlayStoreContext.Provider value={overlayStore}>
        {children}
      </PragmaticOverlayStoreContext.Provider>
    </MediaStripDndRuntimeContext.Provider>
  );
}

export function PragmaticDragOverlay({
  children,
}: MediaStripDndDragOverlayProps) {
  const overlayStore = useContext(PragmaticOverlayStoreContext);
  if (!overlayStore) {
    throw new Error("PragmaticDragOverlay must be rendered inside PragmaticProvider.");
  }
  const overlayPosition = useSyncExternalStore(
    overlayStore.subscribe,
    overlayStore.getSnapshot,
    overlayStore.getSnapshot
  );
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
  // Our ids are always encoded strings (see MediaStripDndIdentifier). This
  // reads out of pragmatic's untyped data bag, so it still guards the type,
  // but a non-string is never one of ours — treat it as absent.
  return typeof value === "string" ? value : null;
}

function toOverlayPosition(input: Input): { x: number; y: number } {
  return {
    x: input.clientX,
    y: input.clientY,
  };
}

/**
 * @experimental Its actual drag interaction is NOT covered by this package's
 * automated test suite. `@atlaskit/pragmatic-drag-and-drop` re-derives the
 * element under the pointer via its own internal `elementFromPoint`-based
 * "honey pot" mechanism, which doesn't reliably respond to this package's
 * synthetic-event test helpers — a regression in this adapter's behavior
 * would not be caught by CI. It renders and its static structure typechecks,
 * but treat its actual drag/drop/nest behavior as unverified until that test
 * gap is closed (see ARCHITECTURE.md's "Known gaps"). The `experimental`
 * prefix in the export name is deliberate — it surfaces this status at every
 * call site, not just here. Prefer `dndKitMediaStripDndAdapter` or
 * `nativeHtml5MediaStripDndAdapter` (both fully tested) for anything shipping.
 */
export const experimentalPragmaticMediaStripDndAdapter = {
  id: "pragmatic",
  DragOverlay: PragmaticDragOverlay,
  Droppable: PragmaticDroppable,
  Provider: PragmaticProvider,
  SortableItem: PragmaticSortableItem,
  SortableItems: PragmaticSortableItems,
  capabilities: {
    supportsSortableTransforms: false,
    supportsCollisionDetection: false,
    supportsCustomDragOverlay: true,
    supportsKeyboardSensor: false,
    requiresManualAutoScroll: true,
    requiresManualOverlayPosition: true,
  },
} satisfies MediaStripDndAdapter;

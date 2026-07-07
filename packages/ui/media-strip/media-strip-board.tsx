"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  DndContext,
  useSensors,
  useSensor,
  PointerSensor,
  DragOverlay,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemCommand,
  type KeyboardReorderAction,
  isCollectionItem,
} from "./media-strip.types";
import {
  formatDuration,
  TOGGLE_GROUP_PADDING_PX,
  DRAG_ACTIVATION_THRESHOLDS_PX,
  DATA_VALUE_ATTR,
  VALUE_ATTR,
  DEFAULT_DRAG_OVERLAY_WIDTH_PX,
} from "./media-strip.utils";
import {
  decodeDndTarget,
  resolveDropIntent,
  detectCollision,
} from "./media-strip.dnd";
import { wouldCreateCollectionCycle } from "./media-strip.validation";
import { MediaStripThumbnail } from "./media-strip-thumbnail";
import { useBoardRegistry } from "./use-board-registry";
import { useBoardDragState } from "./use-board-drag-state";
import { useKeyboardReorderSession } from "./use-keyboard-reorder-session";

type MediaStripBoardStableContextType = {
  collectionsById: ReadonlyMap<CollectionId, TimelineCollection>;
  itemLookup: Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>;
  registerCollection: (collectionId: CollectionId) => void;
  unregisterCollection: (collectionId: CollectionId) => void;
  getAdjacentCollectionId: (currentCollectionId: CollectionId, direction: "up" | "down") => CollectionId | null;
  applyCommand: (command: TimelineItemCommand) => void;
  announce: (message: string) => void;
  startKeyboardReorder: (itemId: TimelineItemId, collectionId: CollectionId, index: number) => void;
  cancelKeyboardReorder: () => void;
  confirmKeyboardReorder: () => void;
  handleKeyboardReorderAction: (itemId: TimelineItemId, action: KeyboardReorderAction) => void;
};

type MediaStripBoardDragContextType = {
  activeDragId: TimelineItemId | null;
  activeDragSourceCollectionId: CollectionId | null;
  activeNestTargetId: CollectionId | null;
  activeDragWidth: number;
  activeKeyboardReorderId: TimelineItemId | null;
};

export const MediaStripBoardStableContext = createContext<MediaStripBoardStableContextType | null>(null);
export const MediaStripBoardDragContext = createContext<MediaStripBoardDragContextType | null>(null);

export function useMediaStripBoardStable() {
  const context = useContext(MediaStripBoardStableContext);
  if (!context) {
    throw new Error("useMediaStripBoardStable must be used within a MediaStripBoard provider");
  }
  return context;
}

export function useMediaStripBoardDrag() {
  const context = useContext(MediaStripBoardDragContext);
  if (!context) {
    throw new Error("useMediaStripBoardDrag must be used within a MediaStripBoard provider");
  }
  return context;
}

export function useMediaStripBoardStableOptional() {
  return useContext(MediaStripBoardStableContext);
}

function isAncestorCollection(
  possibleAncestor: CollectionId,
  child: CollectionId,
  itemLookup: Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>
): boolean {
  let currentId: CollectionId | undefined = child;
  while (currentId) {
    let parentColId: CollectionId | undefined = undefined;
    for (const [_, entry] of itemLookup.entries()) {
      if (entry.item.kind === "collection" && entry.item.collectionId === currentId) {
        parentColId = entry.collectionId;
        break;
      }
    }
    if (parentColId === possibleAncestor) {
      return true;
    }
    currentId = parentColId;
  }
  return false;
}

export function MediaStripBoard({
  children,
  collectionsById,
  visibleCollectionIds,
  onMoveItem,
}: {
  children: React.ReactNode;
  collectionsById?: ReadonlyMap<CollectionId, TimelineCollection>;
  visibleCollectionIds?: readonly CollectionId[];
  onMoveItem?: (command: TimelineItemCommand) => void;
}) {
  const [announcement, setAnnouncement] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  const activeNestTargetRef = useRef<CollectionId | null>(null);
  const activeOverCollectionIdRef = useRef<CollectionId | null>(null);

  // 1. Board Registry
  const { registeredCollections, registerCollection, unregisterCollection } = useBoardRegistry();

  // 2. Drag State Management
  const {
    activeDragId,
    activeDragSourceCollectionId,
    activeNestTargetId,
    activeDragWidth,
    startDrag,
    moveDrag,
    endDrag,
  } = useBoardDragState();

  const collectionsByIdResolved = useMemo(
    () => collectionsById ?? new Map<CollectionId, TimelineCollection>(),
    [collectionsById]
  );

  const visibleCollectionIdsResolved = useMemo(
    () => visibleCollectionIds ?? [],
    [visibleCollectionIds]
  );

  const activeCollectionIds = useMemo(() => {
    const ids = new Set<CollectionId>();
    if (visibleCollectionIdsResolved) {
      visibleCollectionIdsResolved.forEach((id) => ids.add(id));
    }
    registeredCollections.forEach((id) => ids.add(id));
    return ids;
  }, [visibleCollectionIdsResolved, registeredCollections]);

  // Lookup map to support O(1) index searches
  const itemLookup = useMemo(() => {
    const lookup = new Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>();
    for (const collectionId of activeCollectionIds) {
      const col = collectionsByIdResolved.get(collectionId);
      if (col && Array.isArray(col.items)) {
        col.items.forEach((item, index) => {
          lookup.set(item.id, { collectionId, index, item });
        });
      }
    }
    return lookup;
  }, [collectionsByIdResolved, activeCollectionIds]);



  const announce = useCallback((message: string) => {
    setAnnouncement((prev) => {
      if (prev === message) {
        return message + "\u200B";
      }
      if (prev === message + "\u200B") {
        return message;
      }
      return message;
    });
  }, []);

  // 3. Unified Command Pipeline Callback
  const applyCommand = useCallback((command: TimelineItemCommand) => {
    if (onMoveItem) {
      onMoveItem(command);
    } else if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[MediaStripBoard] applyCommand was triggered, but "onMoveItem" callback is undefined. Drag-and-drop actions will not persist changes.`
      );
    }
  }, [onMoveItem]);



  const collisionDetectionStrategy = useCallback<CollisionDetection>((args) => {
    const { nestTargetId, intersections } = detectCollision({
      active: args.active,
      collisionRect: args.collisionRect,
      droppableRects: args.droppableRects,
      pointerCoordinates: args.pointerCoordinates,
      droppableContainers: args.droppableContainers,
      itemLookup,
    });
    activeNestTargetRef.current = nestTargetId;
    return intersections;
  }, [itemLookup]);

  const activeDragItem = useMemo(() => {
    if (!activeDragId) return null;
    return itemLookup.get(activeDragId)?.item ?? null;
  }, [activeDragId, itemLookup]);

  const getAdjacentCollectionId = useCallback(
    (currentCollectionId: CollectionId, direction: "up" | "down"): CollectionId | null => {
      const container = containerRef.current;
      if (!container) return null;

      const colEls = Array.from(container.querySelectorAll("[data-collection-id]"));
      if (colEls.length === 0) return null;

      colEls.sort((a, b) => {
        const compare = a.compareDocumentPosition(b);
        if (compare & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (compare & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      const colIds = colEls
        .map((el) => el.getAttribute("data-collection-id"))
        .filter((id): id is string => !!id) as CollectionId[];

      const idx = colIds.indexOf(currentCollectionId);
      if (idx === -1) return null;

      const targetIdx = direction === "down" ? idx + 1 : idx - 1;
      if (targetIdx >= 0 && targetIdx < colIds.length) {
        return colIds[targetIdx];
      }
      return null;
    },
    []
  );

  // 4. Keyboard Reorder Session Management
  const {
    activeKeyboardReorderId,
    startKeyboardReorder,
    cancelKeyboardReorder,
    confirmKeyboardReorder,
    handleKeyboardReorderAction,
  } = useKeyboardReorderSession({
    itemLookup,
    collectionsById: collectionsByIdResolved,
    getAdjacentCollectionId,
    applyCommand,
    announce,
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: DRAG_ACTIVATION_THRESHOLDS_PX.board,
      },
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const decoded = decodeDndTarget(String(event.active.id));
    if (!decoded || decoded.type !== "item") return;
    const itemId = decoded.itemId;

    let dragWidth = DEFAULT_DRAG_OVERLAY_WIDTH_PX;
    const escapedId = CSS.escape(String(itemId));
    const activeEl = containerRef.current?.querySelector(
      `[${DATA_VALUE_ATTR}="${escapedId}"], [${VALUE_ATTR}="${escapedId}"]`
    );
    if (activeEl) {
      dragWidth = activeEl.getBoundingClientRect().width;
    }

    const found = itemLookup.get(itemId);
    if (found) {
      activeOverCollectionIdRef.current = found.collectionId;
      startDrag(itemId, found.collectionId, dragWidth);
      announce(`Picked up item "${found.item.name}".`);
    }
  }, [itemLookup, announce, startDrag]);

  const handleDragMove = useCallback(() => {
    moveDrag(activeNestTargetRef.current);
  }, [moveDrag]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    moveDrag(activeNestTargetRef.current);
    const { over } = event;
    if (over) {
      const decoded = decodeDndTarget(String(over.id));
      if (decoded) {
        if (decoded.type === "collection-container") {
          activeOverCollectionIdRef.current = decoded.collectionId;
        } else if (decoded.type === "item") {
          const found = itemLookup.get(decoded.itemId);
          if (found) {
            activeOverCollectionIdRef.current = found.collectionId;
          }
        } else if (decoded.type === "collection-nest-target") {
          activeOverCollectionIdRef.current = decoded.collectionId;
        }
      }
    } else {
      activeOverCollectionIdRef.current = null;
    }
  }, [moveDrag, itemLookup]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { over, active } = event;
    const itemId = activeDragId;
    const nestTargetId = activeNestTargetRef.current;

    activeNestTargetRef.current = null;
    activeOverCollectionIdRef.current = null;

    if (!itemId) return;

    const foundSource = itemLookup.get(itemId);
    if (!foundSource) {
      endDrag();
      announce("Cancelled drag.");
      return;
    }

    if (over) {
      const intent = resolveDropIntent({
        overId: over.id,
        activeId: active.id,
        collectionsById: collectionsByIdResolved,
        itemLookup,
      });

      if (intent) {
        if (isCollectionItem(foundSource.item)) {
          const targetCollectionId = nestTargetId || intent.toCollectionId;
          if (wouldCreateCollectionCycle({
            movingCollectionId: foundSource.item.collectionId,
            targetCollectionId,
            collectionsById: collectionsByIdResolved,
          })) {
            announce("Cannot move a collection into itself or one of its nested collections.");
            endDrag();
            return;
          }
        }

        if (nestTargetId) {
          applyCommand({
            type: "nest",
            itemId,
            fromCollectionId: foundSource.collectionId,
            targetCollectionId: nestTargetId,
          });
          announce(`Moved "${foundSource.item.name}" into collection.`);
        } else if (intent.type === "move") {
          const targetCollectionId = intent.toCollectionId;
          const targetIndex = intent.toIndex;

          if (
            foundSource.collectionId !== targetCollectionId ||
            foundSource.index !== targetIndex
          ) {
            applyCommand({
              type: "move",
              itemId,
              fromCollectionId: foundSource.collectionId,
              toCollectionId: targetCollectionId,
              toIndex: targetIndex,
            });
            announce(`Dropped "${foundSource.item.name}" at position ${targetIndex + 1}.`);
          } else {
            announce(`Dropped "${foundSource.item.name}" at position ${foundSource.index + 1}.`);
          }
        }
      } else {
        announce("Cancelled drag.");
      }
    } else {
      announce("Cancelled drag.");
    }

    endDrag();
  }, [
    activeDragId,
    itemLookup,
    applyCommand,
    collectionsByIdResolved,
    announce,
    endDrag,
  ]);

  const handleDragCancel = useCallback(() => {
    activeNestTargetRef.current = null;
    activeOverCollectionIdRef.current = null;
    endDrag();
    announce("Cancelled drag.");
  }, [endDrag, announce]);
  const stableContextValue = useMemo(
    () => ({
      collectionsById: collectionsByIdResolved,
      itemLookup,
      registerCollection,
      unregisterCollection,
      getAdjacentCollectionId,
      applyCommand,
      announce,
      startKeyboardReorder,
      cancelKeyboardReorder,
      confirmKeyboardReorder,
      handleKeyboardReorderAction,
    }),
    [
      collectionsByIdResolved,
      itemLookup,
      registerCollection,
      unregisterCollection,
      getAdjacentCollectionId,
      applyCommand,
      announce,
      startKeyboardReorder,
      cancelKeyboardReorder,
      confirmKeyboardReorder,
      handleKeyboardReorderAction,
    ]
  );

  const dragContextValue = useMemo(
    () => ({
      activeDragId,
      activeDragSourceCollectionId,
      activeNestTargetId,
      activeDragWidth,
      activeKeyboardReorderId,
    }),
    [
      activeDragId,
      activeDragSourceCollectionId,
      activeNestTargetId,
      activeDragWidth,
      activeKeyboardReorderId,
    ]
  );

  return (
    <MediaStripBoardStableContext.Provider value={stableContextValue}>
      <MediaStripBoardDragContext.Provider value={dragContextValue}>
        <div ref={containerRef} style={{ display: "contents" }}>
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetectionStrategy}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            autoScroll={{
              canScroll: (element) => {
                if (!activeDragSourceCollectionId) return true;
                const colEl = element.closest("[data-collection-id]");
                if (!colEl) return true;
                const colId = colEl.getAttribute("data-collection-id") as CollectionId;

                // 1. Always scroll the active drag source container
                if (colId === activeDragSourceCollectionId) return true;

                // 2. Scroll the currently hovered container, unless it is an ancestor of the source container
                if (colId === activeOverCollectionIdRef.current) {
                  return !isAncestorCollection(colId, activeDragSourceCollectionId, itemLookup);
                }

                return false;
              }
            }}
          >
            {children}

            <DragOverlay>
              {activeDragItem ? (
                <DragOverlayItem item={activeDragItem} width={activeDragWidth} />
              ) : null}
            </DragOverlay>

            <div
              aria-live="polite"
              role="status"
              style={{
                position: "absolute",
                width: "1px",
                height: "1px",
                padding: "0",
                margin: "-1px",
                overflow: "hidden",
                clip: "rect(0, 0, 0, 0)",
                whiteSpace: "nowrap",
                border: "0",
              }}
            >
              {announcement}
            </div>
          </DndContext>
        </div>
      </MediaStripBoardDragContext.Provider>
    </MediaStripBoardStableContext.Provider>
  );
}

function DragOverlayItem({
  item,
  width,
}: {
  item: TimelineItem;
  width: number;
}) {
  return (
    <div
      data-testid="drag-overlay-item"
      className="bg-card border-primary border p-2 rounded-lg opacity-85 shadow-2xl flex flex-col items-stretch justify-start gap-2 text-left pointer-events-none select-none"
      style={{
        width: `${width}px`,
        height: `calc(9.5rem - ${2 * TOGGLE_GROUP_PADDING_PX}px)`,
      }}
    >
      <MediaStripThumbnail item={item} variant="sequence" />
      <span className="truncate text-xs font-medium text-foreground pr-4">
        {item.name}
      </span>
      <div className="self-start text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded font-mono">
        {formatDuration(item.durationSeconds)}
      </div>
    </div>
  );
}

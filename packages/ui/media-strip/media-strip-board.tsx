"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  DndContext,
  useSensors,
  useSensor,
  PointerSensor,
  closestCenter,
  DragOverlay,
  type CollisionDetection,
  type UniqueIdentifier,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  type TimelineItem,
  type TimelineItemId,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemMove,
  type TimelineItemDrop,
  type TimelineDropIntent,
  isCollectionItem,
} from "./media-strip.types";
import {
  formatDuration,
  TOGGLE_GROUP_PADDING_PX,
  DRAG_ACTIVATION_THRESHOLDS_PX,
  decodeDndTarget,
  DATA_VALUE_ATTR,
  VALUE_ATTR,
} from "./media-strip.utils";
import { wouldCreateCollectionCycle } from "./media-strip.validation";
import { MediaStripThumbnail } from "./media-strip-thumbnail";

type MediaStripBoardContextType = {
  activeDragId: TimelineItemId | null;
  activeDragSourceCollectionId: CollectionId | null;
  activeKeyboardReorderId: TimelineItemId | null;
  activeNestTargetId: CollectionId | null;
  startKeyboardReorder: (itemId: TimelineItemId, collectionId: CollectionId, index: number) => void;
  cancelKeyboardReorder: () => void;
  confirmKeyboardReorder: () => void;
  announce: (message: string) => void;
  collectionsById: Readonly<Record<CollectionId, TimelineCollection>>;
  registerCollection: (collectionId: CollectionId) => void;
  unregisterCollection: (collectionId: CollectionId) => void;
  getAdjacentCollectionId: (currentCollectionId: CollectionId, direction: "up" | "down") => CollectionId | null;
  moveItem: (itemId: TimelineItemId, toCollectionId: CollectionId, toIndex: number) => void;
  nestItem: (itemId: TimelineItemId, targetCollectionId: CollectionId) => void;
};

export const MediaStripBoardContext = createContext<MediaStripBoardContextType | null>(null);

export function useMediaStripBoard() {
  const context = useContext(MediaStripBoardContext);
  if (!context) {
    throw new Error("useMediaStripBoard must be used within a MediaStripBoard provider");
  }
  return context;
}

function useBoardRegistry() {
  const [registeredCollections, setRegisteredCollections] = useState<CollectionId[]>([]);

  const registerCollection = useCallback((collectionId: CollectionId) => {
    setRegisteredCollections((prev) => (prev.includes(collectionId) ? prev : [...prev, collectionId]));
  }, []);

  const unregisterCollection = useCallback((collectionId: CollectionId) => {
    setRegisteredCollections((prev) => prev.filter((id) => id !== collectionId));
  }, []);

  return {
    registeredCollections,
    registerCollection,
    unregisterCollection,
  };
}

function useBoardDragState() {
  const [activeDragId, setActiveDragId] = useState<TimelineItemId | null>(null);
  const [activeDragSourceCollectionId, setActiveDragSourceCollectionId] = useState<CollectionId | null>(null);
  const [activeNestTargetId, setActiveNestTargetId] = useState<CollectionId | null>(null);
  const [activeDragWidth, setActiveDragWidth] = useState<number>(160);

  return {
    activeDragId,
    setActiveDragId,
    activeDragSourceCollectionId,
    setActiveDragSourceCollectionId,
    activeNestTargetId,
    setActiveNestTargetId,
    activeDragWidth,
    setActiveDragWidth,
  };
}

function useDropIntent({
  collectionsByIdResolved,
  itemLookup,
}: {
  collectionsByIdResolved: Readonly<Record<CollectionId, TimelineCollection>>;
  itemLookup: Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>;
}) {
  const resolveDropIntent = useCallback(
    (overId: UniqueIdentifier, activeId: UniqueIdentifier): TimelineDropIntent | null => {
      const decoded = decodeDndTarget(String(overId));
      if (!decoded) return null;

      if (decoded.type === "collection-container") {
        return {
          type: "insert",
          toCollectionId: decoded.collectionId,
          toIndex: collectionsByIdResolved[decoded.collectionId]?.items.length ?? 0,
        };
      }

      if (decoded.type === "item") {
        const foundTarget = itemLookup.get(decoded.itemId);
        if (foundTarget) {
          return {
            type: "insert",
            toCollectionId: foundTarget.collectionId,
            toIndex: foundTarget.index,
          };
        }
      }

      return null;
    },
    [collectionsByIdResolved, itemLookup]
  );

  return { resolveDropIntent };
}

function useKeyboardReorderSession({
  itemLookup,
  moveItem,
  announce,
}: {
  itemLookup: Map<TimelineItemId, { collectionId: CollectionId; index: number; item: TimelineItem }>;
  moveItem: (itemId: TimelineItemId, toCollectionId: CollectionId, toIndex: number) => void;
  announce: (message: string) => void;
}) {
  const [activeKeyboardReorderId, setActiveKeyboardReorderId] = useState<TimelineItemId | null>(null);
  const initialPositionRef = useRef<{ collectionId: CollectionId; index: number } | null>(null);

  const startKeyboardReorder = useCallback((itemId: TimelineItemId, collectionId: CollectionId, index: number) => {
    setActiveKeyboardReorderId(itemId);
    initialPositionRef.current = { collectionId, index };
  }, []);

  const cancelKeyboardReorder = useCallback(() => {
    const itemId = activeKeyboardReorderId;
    const orig = initialPositionRef.current;

    if (itemId && orig) {
      const current = itemLookup.get(itemId);
      if (current) {
        if (current.collectionId !== orig.collectionId || current.index !== orig.index) {
          moveItem(itemId, orig.collectionId, orig.index);
        }
        announce(`Reorder cancelled. Reverted "${current.item.name}" to position ${orig.index + 1}.`);
      }
    }

    setActiveKeyboardReorderId(null);
    initialPositionRef.current = null;
  }, [activeKeyboardReorderId, itemLookup, moveItem, announce]);

  const confirmKeyboardReorder = useCallback(() => {
    setActiveKeyboardReorderId(null);
    initialPositionRef.current = null;
  }, []);

  return {
    activeKeyboardReorderId,
    startKeyboardReorder,
    cancelKeyboardReorder,
    confirmKeyboardReorder,
  };
}

export function MediaStripBoard({
  children,
  collectionsById,
  visibleCollectionIds,
  onMoveItem,
}: {
  children: React.ReactNode;
  collectionsById?: Readonly<Record<CollectionId, TimelineCollection>>;
  visibleCollectionIds?: readonly CollectionId[];
  onMoveItem?: (move: TimelineItemMove | TimelineItemDrop) => void;
}) {
  const [announcement, setAnnouncement] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Refs for tracking drag move & collision suppression
  const lastMoveRef = useRef<{ itemId: TimelineItemId; toCollectionId: CollectionId; toIndex: number } | null>(null);
  const activeNestTargetRef = useRef<CollectionId | null>(null);
  const recentlyMovedToNewContainer = useRef(false);
  const lastOverIdRef = useRef<UniqueIdentifier | null>(null);

  // 1. Board Registry
  const { registeredCollections, registerCollection, unregisterCollection } = useBoardRegistry();

  // 2. Drag State Management
  const {
    activeDragId,
    setActiveDragId,
    activeDragSourceCollectionId,
    setActiveDragSourceCollectionId,
    activeNestTargetId,
    setActiveNestTargetId,
    activeDragWidth,
    setActiveDragWidth,
  } = useBoardDragState();

  const collectionsByIdResolved = useMemo(
    () => collectionsById ?? {},
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
      const col = collectionsByIdResolved[collectionId];
      if (col && Array.isArray(col.items)) {
        col.items.forEach((item, index) => {
          lookup.set(item.id, { collectionId, index, item });
        });
      }
    }
    return lookup;
  }, [collectionsByIdResolved, activeCollectionIds]);

  useEffect(() => {
    requestAnimationFrame(() => {
      recentlyMovedToNewContainer.current = false;
    });
  }, [collectionsByIdResolved]);

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

  // 3. Move and Nest Callbacks
  const moveItem = useCallback((itemId: TimelineItemId, toCollectionId: CollectionId, toIndex: number) => {
    const foundSource = itemLookup.get(itemId);
    if (!foundSource) return;

    if (isCollectionItem(foundSource.item)) {
      if (wouldCreateCollectionCycle({
        movingCollectionId: foundSource.item.collectionId,
        targetCollectionId: toCollectionId,
        collectionsById: collectionsByIdResolved,
      })) {
        announce("Cannot move a collection into itself or one of its nested collections.");
        return;
      }
    }

    if (onMoveItem) {
      onMoveItem({
        itemId,
        fromCollectionId: foundSource.collectionId,
        toCollectionId,
        fromIndex: foundSource.index,
        toIndex,
      });
    }
  }, [itemLookup, onMoveItem, collectionsByIdResolved, announce]);

  const nestItem = useCallback((itemId: TimelineItemId, targetCollectionId: CollectionId) => {
    const foundSource = itemLookup.get(itemId);
    if (!foundSource) return;

    if (isCollectionItem(foundSource.item)) {
      if (wouldCreateCollectionCycle({
        movingCollectionId: foundSource.item.collectionId,
        targetCollectionId,
        collectionsById: collectionsByIdResolved,
      })) {
        announce("Cannot move a collection into itself or one of its nested collections.");
        return;
      }
    }

    if (onMoveItem) {
      onMoveItem({
        itemId,
        fromCollectionId: foundSource.collectionId,
        fromIndex: foundSource.index,
        intent: {
          type: "nest",
          toCollectionId: targetCollectionId,
        },
      });
    }
  }, [itemLookup, onMoveItem, collectionsByIdResolved, announce]);

  // 4. Keyboard Reorder Session Management
  const {
    activeKeyboardReorderId,
    startKeyboardReorder,
    cancelKeyboardReorder,
    confirmKeyboardReorder,
  } = useKeyboardReorderSession({ itemLookup, moveItem, announce });

  // 5. Drop Intent Resolution
  const { resolveDropIntent } = useDropIntent({ collectionsByIdResolved, itemLookup });

  const collisionDetectionStrategy = useCallback<CollisionDetection>((args) => {
    if (recentlyMovedToNewContainer.current && lastOverIdRef.current != null) {
      return [{ id: lastOverIdRef.current }];
    }

    const itemContainers = args.droppableContainers.filter(
      (c) => decodeDndTarget(String(c.id))?.type === "item" && c.id !== args.active.id
    );
    const containerBackgrounds = args.droppableContainers.filter(
      (c) => decodeDndTarget(String(c.id))?.type === "collection-container"
    );

    let intersections = closestCenter({
      ...args,
      droppableContainers: itemContainers,
    });

    if (intersections.length === 0) {
      intersections = closestCenter({
        ...args,
        droppableContainers: containerBackgrounds,
      });
    }

    activeNestTargetRef.current = null;
    if (intersections.length > 0 && args.pointerCoordinates) {
      const primaryCollision = intersections[0];
      const decoded = decodeDndTarget(String(primaryCollision.id));
      if (decoded && decoded.type === "item") {
        const found = itemLookup.get(decoded.itemId);
        if (found && found.item.kind === "collection") {
          const container = args.droppableContainers.find(c => c.id === primaryCollision.id);
          const rect = container?.rect.current;
          if (rect) {
            const width = rect.width;
            const height = rect.height;
            const hotspotLeft = rect.left + width * 0.2;
            const hotspotRight = rect.left + width * 0.8;
            const hotspotTop = rect.top + height * 0.2;
            const hotspotBottom = rect.top + height * 0.8;

            const px = args.pointerCoordinates.x;
            const py = args.pointerCoordinates.y;

            if (px >= hotspotLeft && px <= hotspotRight && py >= hotspotTop && py <= hotspotBottom) {
              const activeDecoded = decodeDndTarget(String(args.active.id));
              const activeItemId = activeDecoded?.type === "item" ? activeDecoded.itemId : args.active.id;
              if (activeItemId !== found.item.id) {
                activeNestTargetRef.current = found.item.collectionId;
              }
            }
          }
        }
      }
    }

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

    setActiveDragId(itemId);
    lastMoveRef.current = null;
    lastOverIdRef.current = null;
    recentlyMovedToNewContainer.current = false;

    const escapedId = CSS.escape(String(itemId));
    const activeEl = containerRef.current?.querySelector(
      `[${DATA_VALUE_ATTR}="${escapedId}"], [${VALUE_ATTR}="${escapedId}"]`
    );
    if (activeEl) {
      setActiveDragWidth(activeEl.getBoundingClientRect().width);
    } else {
      setActiveDragWidth(160);
    }

    const found = itemLookup.get(itemId);
    if (found) {
      setActiveDragSourceCollectionId(found.collectionId);
      announce(`Picked up item "${found.item.name}".`);
    }
  }, [itemLookup, announce, setActiveDragId, setActiveDragSourceCollectionId, setActiveDragWidth]);

  const handleDragMove = useCallback(() => {
    setActiveNestTargetId(activeNestTargetRef.current);
  }, [setActiveNestTargetId]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    setActiveNestTargetId(activeNestTargetRef.current);

    if (!over) return;
    lastOverIdRef.current = over.id;

    const decodedActive = decodeDndTarget(String(active.id));
    if (!decodedActive || decodedActive.type !== "item") return;
    const itemId = decodedActive.itemId;

    const foundSource = itemLookup.get(itemId);
    if (!foundSource) return;

    const intent = resolveDropIntent(over.id, active.id);
    if (!intent) return;

    const isNestIntent = activeNestTargetRef.current != null;

    if (!isNestIntent && intent.type === "insert" && foundSource.collectionId !== intent.toCollectionId) {
      const targetCollectionId = intent.toCollectionId;
      const targetIndex = intent.toIndex;

      const lastMove = lastMoveRef.current;
      if (
        lastMove &&
        lastMove.itemId === itemId &&
        lastMove.toCollectionId === targetCollectionId &&
        lastMove.toIndex === targetIndex
      ) {
        return;
      }
      lastMoveRef.current = { itemId, toCollectionId: targetCollectionId, toIndex: targetIndex };
      recentlyMovedToNewContainer.current = true;

      moveItem(itemId, targetCollectionId, targetIndex);
    }
  }, [itemLookup, resolveDropIntent, moveItem, setActiveNestTargetId]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { over, active } = event;
    const itemId = activeDragId;
    const nestTargetId = activeNestTargetRef.current;

    setActiveNestTargetId(null);
    activeNestTargetRef.current = null;
    lastMoveRef.current = null;
    lastOverIdRef.current = null;
    recentlyMovedToNewContainer.current = false;

    if (!itemId) return;

    const foundSource = itemLookup.get(itemId);
    if (!foundSource) {
      setActiveDragId(null);
      setActiveDragSourceCollectionId(null);
      announce("Cancelled drag.");
      return;
    }

    if (over) {
      const intent = resolveDropIntent(over.id, active.id);

      if (intent) {
        if (isCollectionItem(foundSource.item)) {
          const targetCollectionId = nestTargetId || intent.toCollectionId;
          if (wouldCreateCollectionCycle({
            movingCollectionId: foundSource.item.collectionId,
            targetCollectionId,
            collectionsById: collectionsByIdResolved,
          })) {
            announce("Cannot move a collection into itself or one of its nested collections.");
            setActiveDragId(null);
            setActiveDragSourceCollectionId(null);
            return;
          }
        }

        if (nestTargetId) {
          if (onMoveItem) {
            onMoveItem({
              itemId,
              fromCollectionId: foundSource.collectionId,
              fromIndex: foundSource.index,
              intent: {
                type: "nest",
                toCollectionId: nestTargetId,
              },
            });
            announce(`Moved "${foundSource.item.name}" into collection.`);
          }
        } else if (intent.type === "insert") {
          const targetCollectionId = intent.toCollectionId;
          const targetIndex = intent.toIndex;

          if (
            foundSource.collectionId !== targetCollectionId ||
            foundSource.index !== targetIndex
          ) {
            moveItem(itemId, targetCollectionId, targetIndex);
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

    setActiveDragId(null);
    setActiveDragSourceCollectionId(null);
  }, [
    activeDragId,
    itemLookup,
    resolveDropIntent,
    moveItem,
    onMoveItem,
    collectionsByIdResolved,
    announce,
    setActiveDragId,
    setActiveDragSourceCollectionId,
    setActiveNestTargetId,
  ]);

  const contextValue = useMemo(
    () => ({
      activeDragId,
      activeDragSourceCollectionId,
      activeKeyboardReorderId,
      activeNestTargetId,
      startKeyboardReorder,
      cancelKeyboardReorder,
      confirmKeyboardReorder,
      announce,
      collectionsById: collectionsByIdResolved,
      registerCollection,
      unregisterCollection,
      getAdjacentCollectionId,
      moveItem,
      nestItem,
    }),
    [
      activeDragId,
      activeDragSourceCollectionId,
      activeKeyboardReorderId,
      activeNestTargetId,
      startKeyboardReorder,
      cancelKeyboardReorder,
      confirmKeyboardReorder,
      announce,
      collectionsByIdResolved,
      registerCollection,
      unregisterCollection,
      getAdjacentCollectionId,
      moveItem,
      nestItem,
    ]
  );

  return (
    <MediaStripBoardContext.Provider value={contextValue}>
      <div ref={containerRef} style={{ display: "contents" }}>
        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetectionStrategy}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          autoScroll={{
            canScroll: (element) => {
              if (!activeDragSourceCollectionId) return true;
              const colEl = element.closest("[data-collection-id]");
              if (!colEl) return true;
              const colId = colEl.getAttribute("data-collection-id");
              return colId === activeDragSourceCollectionId;
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
    </MediaStripBoardContext.Provider>
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

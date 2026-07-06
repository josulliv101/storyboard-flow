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
import { type TimelineItem, type TimelineItemId, asTimelineItemId, type MediaStripMove } from "./media-strip.types";
import { formatDuration, TOGGLE_GROUP_PADDING_PX, DRAG_ACTIVATION_THRESHOLDS_PX } from "./media-strip.utils";
import { MediaStripThumbnail } from "./media-strip-thumbnail";

type MediaStripBoardContextType = {
  activeDragId: TimelineItemId | null;
  activeDragSourceStripId: string | null;
  activeKeyboardReorderId: TimelineItemId | null;
  startKeyboardReorder: (itemId: TimelineItemId, stripId: string, index: number) => void;
  cancelKeyboardReorder: () => void;
  confirmKeyboardReorder: () => void;
  announce: (message: string) => void;
  itemsByStripId: Record<string, TimelineItem[]>;
  registerStrip: (stripId: string) => void;
  unregisterStrip: (stripId: string) => void;
  getAdjacentStripId: (currentStripId: string, direction: "up" | "down") => string | null;
  moveItem: (itemId: TimelineItemId, toStripId: string, toIndex: number) => void;
};

export const MediaStripBoardContext = createContext<MediaStripBoardContextType | null>(null);

export function useMediaStripBoard() {
  const context = useContext(MediaStripBoardContext);
  if (!context) {
    throw new Error("useMediaStripBoard must be used within a MediaStripBoard provider");
  }
  return context;
}

export function MediaStripBoard({
  children,
  itemsByStripId,
  onMoveItem,
}: {
  children: React.ReactNode;
  itemsByStripId: Record<string, TimelineItem[]>;
  onMoveItem?: (move: MediaStripMove) => void;
}) {
  const [activeDragId, setActiveDragId] = useState<TimelineItemId | null>(null);
  const [activeDragSourceStripId, setActiveDragSourceStripId] = useState<string | null>(null);
  const [activeKeyboardReorderId, setActiveKeyboardReorderId] = useState<TimelineItemId | null>(null);
  const [activeDragWidth, setActiveDragWidth] = useState<number>(160);
  const [announcement, setAnnouncement] = useState<string>("");

  // Registry for child media strips (maintained for backwards compatibility, but not relied on for visual ordering)
  const [registeredStrips, setRegisteredStrips] = useState<string[]>([]);

  // Keyboard reorder initial position session state
  const initialPositionRef = useRef<{ stripId: string; index: number } | null>(null);

  // Ref to track last processed move to prevent redundant state update calls during fast drag
  const lastMoveRef = useRef<{ itemId: TimelineItemId; toStripId: string; toIndex: number } | null>(null);

  // Suppress collision re-detection immediately after a cross-container move commits.
  const recentlyMovedToNewContainer = useRef(false);
  const lastOverIdRef = useRef<UniqueIdentifier | null>(null);

  useEffect(() => {
    // True for one render cycle right after a cross-container move commits.
    // Prevents collisionDetection from re-resolving against DOM that hasn't
    // finished reflowing yet, which otherwise oscillates the target index
    // forever and blows React's update-depth guard.
    requestAnimationFrame(() => {
      recentlyMovedToNewContainer.current = false;
    });
  }, [itemsByStripId]);

  const collisionDetectionStrategy = useCallback<CollisionDetection>((args) => {
    if (recentlyMovedToNewContainer.current && lastOverIdRef.current != null) {
      return [{ id: lastOverIdRef.current }];
    }
    return closestCenter(args);
  }, []);

  // O(1) Lookup index map to prevent performance-killing linear scans during fast drags
  const itemLookup = useMemo(() => {
    const lookup = new Map<TimelineItemId, { stripId: string; index: number; item: TimelineItem }>();
    for (const [stripId, list] of Object.entries(itemsByStripId)) {
      list.forEach((item, index) => {
        lookup.set(item.id, { stripId, index, item });
      });
    }
    return lookup;
  }, [itemsByStripId]);

  const activeDragItem = useMemo(() => {
    if (!activeDragId) return null;
    return itemLookup.get(activeDragId)?.item ?? null;
  }, [activeDragId, itemLookup]);

  const registerStrip = useCallback((stripId: string) => {
    setRegisteredStrips((prev) => (prev.includes(stripId) ? prev : [...prev, stripId]));
  }, []);

  const unregisterStrip = useCallback((stripId: string) => {
    setRegisteredStrips((prev) => prev.filter((id) => id !== stripId));
  }, []);

  // Shared moveItem function is the single source of truth for both pointer and keyboard reorders
  const moveItem = useCallback((itemId: TimelineItemId, toStripId: string, toIndex: number) => {
    const foundSource = itemLookup.get(itemId);
    if (!foundSource) return;

    if (onMoveItem) {
      onMoveItem({
        itemId,
        fromStripId: foundSource.stripId,
        toStripId,
        fromIndex: foundSource.index,
        toIndex,
      });
    }
  }, [itemLookup, onMoveItem]);

  const getAdjacentStripId = useCallback(
    (currentStripId: string, direction: "up" | "down"): string | null => {
      // Query all rendered strip elements in the DOM to establish visual order.
      // This avoids relying on React effect-mount registration order, which may not match DOM order.
      const stripEls = Array.from(document.querySelectorAll("[data-strip-id]"));
      if (stripEls.length === 0) return null;

      stripEls.sort((a, b) => {
        const compare = a.compareDocumentPosition(b);
        if (compare & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (compare & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

      const stripIds = stripEls
        .map((el) => el.getAttribute("data-strip-id"))
        .filter((id): id is string => !!id);

      const idx = stripIds.indexOf(currentStripId);
      if (idx === -1) return null;

      const targetIdx = direction === "down" ? idx + 1 : idx - 1;
      if (targetIdx >= 0 && targetIdx < stripIds.length) {
        return stripIds[targetIdx];
      }
      return null;
    },
    []
  );

  const announce = useCallback((message: string) => {
    setAnnouncement((prev) => {
      // Append a zero-width space if the message is identical to force a DOM diff
      // that screen readers will notice and announce.
      if (prev === message) {
        return message + "\u200B";
      }
      if (prev === message + "\u200B") {
        return message;
      }
      return message;
    });
  }, []);

  const startKeyboardReorder = useCallback((itemId: TimelineItemId, stripId: string, index: number) => {
    setActiveKeyboardReorderId(itemId);
    initialPositionRef.current = { stripId, index };
  }, []);

  const cancelKeyboardReorder = useCallback(() => {
    const itemId = activeKeyboardReorderId;
    const orig = initialPositionRef.current;

    if (itemId && orig) {
      // O(1) Current position lookup
      const current = itemLookup.get(itemId);
      if (current) {
        if (current.stripId !== orig.stripId || current.index !== orig.index) {
          moveItem(itemId, orig.stripId, orig.index);
        }
        announce(`Dropped "${current.item.name}" at position ${orig.index + 1}.`);
      }
    }

    setActiveKeyboardReorderId(null);
    initialPositionRef.current = null;
  }, [activeKeyboardReorderId, itemLookup, moveItem, announce]);

  const confirmKeyboardReorder = useCallback(() => {
    setActiveKeyboardReorderId(null);
    initialPositionRef.current = null;
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // Drag distance threshold in pixels before initiating item drag.
        // Cross-referenced with DRAG_ACTIVATION_THRESHOLDS_PX.scroll in use-horizontal-drag-scroll.ts.
        // Slightly higher to give priority to click selections and prevent accidental reorders.
        distance: DRAG_ACTIVATION_THRESHOLDS_PX.board,
      },
    })
  );

  // Helper to resolve drop target strip ID and index from dnd-kit `over.id`
  const resolveDropTarget = useCallback(
    (overId: string | number): { stripId: string; index: number } | null => {
      if (overId in itemsByStripId) {
        const stripId = String(overId);
        return { stripId, index: itemsByStripId[stripId].length };
      }
      const parsedOver = asTimelineItemId(String(overId));
      if (parsedOver.ok) {
        const foundTarget = itemLookup.get(parsedOver.value);
        if (foundTarget) {
          return { stripId: foundTarget.stripId, index: foundTarget.index };
        }
      }
      return null;
    },
    [itemsByStripId, itemLookup]
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const parsed = asTimelineItemId(String(event.active.id));
    if (!parsed.ok) return;
    const itemId = parsed.value;
    setActiveDragId(itemId);
    lastMoveRef.current = null;
    lastOverIdRef.current = null;
    recentlyMovedToNewContainer.current = false;

    // Measure exact width of the active item DOM node to size the drag overlay perfectly
    const escapedId = CSS.escape(String(itemId));
    const activeEl = document.querySelector(`[data-value="${escapedId}"], [value="${escapedId}"]`);
    if (activeEl) {
      setActiveDragWidth(activeEl.getBoundingClientRect().width);
    } else {
      setActiveDragWidth(160); // Fallback
    }

    const found = itemLookup.get(itemId);
    if (found) {
      setActiveDragSourceStripId(found.stripId);
      announce(`Picked up item "${found.item.name}".`);
    }
  }, [itemLookup, announce]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    lastOverIdRef.current = over.id;

    const parsedActive = asTimelineItemId(String(active.id));
    if (!parsedActive.ok) return;
    const itemId = parsedActive.value;

    const target = resolveDropTarget(over.id);
    if (!target) return;
    const { stripId: targetStripId, index: targetIndex } = target;

    const foundSource = itemLookup.get(itemId);
    if (!foundSource) return;

    // ONLY perform real-time cross-container moves inside onDragOver.
    // Within-strip reordering is animated visually via CSS transforms and committed in onDragEnd.
    if (foundSource.stripId !== targetStripId) {
      const lastMove = lastMoveRef.current;
      if (
        lastMove &&
        lastMove.itemId === itemId &&
        lastMove.toStripId === targetStripId &&
        lastMove.toIndex === targetIndex
      ) {
        return;
      }
      lastMoveRef.current = { itemId, toStripId: targetStripId, toIndex: targetIndex };
      recentlyMovedToNewContainer.current = true;

      moveItem(itemId, targetStripId, targetIndex);
    }
  }, [itemLookup, resolveDropTarget, moveItem]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { over } = event;
    const itemId = activeDragId;
    if (!itemId) return;

    lastMoveRef.current = null;
    lastOverIdRef.current = null;
    recentlyMovedToNewContainer.current = false;

    const foundSource = itemLookup.get(itemId);
    if (!foundSource) {
      setActiveDragId(null);
      setActiveDragSourceStripId(null);
      announce(`Cancelled drag.`);
      return;
    }

    let targetStripId = foundSource.stripId;
    let targetIndex = foundSource.index;

    if (over) {
      const target = resolveDropTarget(over.id);
      if (target) {
        targetStripId = target.stripId;
        targetIndex = target.index;
      }

      // If dragged within the same strip, commit reorder now
      if (
        targetIndex !== -1 &&
        foundSource.stripId === targetStripId &&
        foundSource.index !== targetIndex
      ) {
        moveItem(itemId, targetStripId, targetIndex);
      }
    }

    setActiveDragId(null);
    setActiveDragSourceStripId(null);

    // Compute the drop position announcement synchronously using targetIndex/targetStripId
    if (over && targetIndex !== -1) {
      announce(`Dropped "${foundSource.item.name}" at position ${targetIndex + 1}.`);
    } else {
      announce(`Cancelled drag.`);
    }
  }, [activeDragId, itemLookup, resolveDropTarget, moveItem, announce]);

  // Memoize the context value object to prevent unnecessary re-rendering of all consumers
  const contextValue = useMemo(
    () => ({
      activeDragId,
      activeDragSourceStripId,
      activeKeyboardReorderId,
      startKeyboardReorder,
      cancelKeyboardReorder,
      confirmKeyboardReorder,
      announce,
      itemsByStripId,
      registerStrip,
      unregisterStrip,
      getAdjacentStripId,
      moveItem,
    }),
    [
      activeDragId,
      activeDragSourceStripId,
      activeKeyboardReorderId,
      startKeyboardReorder,
      cancelKeyboardReorder,
      confirmKeyboardReorder,
      announce,
      itemsByStripId,
      registerStrip,
      unregisterStrip,
      getAdjacentStripId,
      moveItem,
    ]
  );

  return (
    <MediaStripBoardContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetectionStrategy}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {children}

        <DragOverlay>
          {activeDragItem ? (
            <DragOverlayItem item={activeDragItem} width={activeDragWidth} />
          ) : null}
        </DragOverlay>

        {/* hidden aria-live status announcer */}
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

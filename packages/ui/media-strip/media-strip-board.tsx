"use client";

import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from "react";
import {
  DndContext,
  useSensors,
  useSensor,
  PointerSensor,
  closestCenter,
  DragOverlay,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { type TimelineItem, type TimelineItemId, asTimelineItemId, type MediaStripMove } from "./media-strip.types";
import { formatDuration, TOGGLE_GROUP_PADDING_PX } from "./media-strip.utils";
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
  const [announcement, setAnnouncement] = useState<string>("");

  // Registry for child media strips to support scoped cross-strip navigation
  const [registeredStrips, setRegisteredStrips] = useState<string[]>([]);

  // Keyboard reorder initial position session state
  const initialPositionRef = useRef<{ stripId: string; index: number } | null>(null);

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

  const getAdjacentStripId = useCallback(
    (currentStripId: string, direction: "up" | "down"): string | null => {
      const idx = registeredStrips.indexOf(currentStripId);
      if (idx === -1) return null;
      const targetIdx = direction === "down" ? idx + 1 : idx - 1;
      if (targetIdx >= 0 && targetIdx < registeredStrips.length) {
        return registeredStrips[targetIdx];
      }
      return null;
    },
    [registeredStrips]
  );

  const announce = useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  const startKeyboardReorder = useCallback((itemId: TimelineItemId, stripId: string, index: number) => {
    setActiveKeyboardReorderId(itemId);
    initialPositionRef.current = { stripId, index };
  }, []);

  const cancelKeyboardReorder = useCallback(() => {
    const itemId = activeKeyboardReorderId;
    const orig = initialPositionRef.current;

    if (itemId && orig && onMoveItem) {
      // O(1) Current position lookup
      const current = itemLookup.get(itemId);
      if (current && (current.stripId !== orig.stripId || current.index !== orig.index)) {
        onMoveItem({
          itemId,
          fromStripId: current.stripId,
          toStripId: orig.stripId,
          fromIndex: current.index,
          toIndex: orig.index,
        });
      }
    }

    setActiveKeyboardReorderId(null);
    initialPositionRef.current = null;
  }, [activeKeyboardReorderId, itemLookup, onMoveItem]);

  const confirmKeyboardReorder = useCallback(() => {
    setActiveKeyboardReorderId(null);
    initialPositionRef.current = null;
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        // Drag distance threshold in pixels before initiating item drag.
        // Cross-referenced with DRAG_CLICK_THRESHOLD_PX = 4 in use-horizontal-drag-scroll.ts.
        // Slightly higher (5px) to give priority to click selections and prevent accidental reorders.
        distance: 5,
      },
    })
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const parsed = asTimelineItemId(String(event.active.id));
    if (!parsed.ok) return;
    const itemId = parsed.value;
    setActiveDragId(itemId);

    const found = itemLookup.get(itemId);
    if (found) {
      setActiveDragSourceStripId(found.stripId);
      announce(`Picked up item "${found.item.name}".`);
    }
  }, [itemLookup, announce]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const parsedActive = asTimelineItemId(String(active.id));
    if (!parsedActive.ok) return;
    const itemId = parsedActive.value;

    const overId = over.id;

    let targetStripId = "";
    let targetIndex = 0;

    if (overId in itemsByStripId) {
      targetStripId = String(overId);
      targetIndex = itemsByStripId[targetStripId].length;
    } else {
      const parsedOver = asTimelineItemId(String(overId));
      if (parsedOver.ok) {
        const foundTarget = itemLookup.get(parsedOver.value);
        if (foundTarget) {
          targetStripId = foundTarget.stripId;
          targetIndex = foundTarget.index;
        }
      }
    }

    if (!targetStripId) return;

    const foundSource = itemLookup.get(itemId);
    if (!foundSource) return;

    // ONLY perform real-time cross-container moves inside onDragOver.
    // Within-strip reordering is animated visually via CSS transforms and committed in onDragEnd.
    if (foundSource.stripId !== targetStripId) {
      if (onMoveItem) {
        onMoveItem({
          itemId,
          fromStripId: foundSource.stripId,
          toStripId: targetStripId,
          fromIndex: foundSource.index,
          toIndex: targetIndex,
        });
      }
    }
  }, [itemsByStripId, itemLookup, onMoveItem]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { over } = event;
    const itemId = activeDragId;
    if (!itemId) return;

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
      const overId = over.id;
      let calculatedTargetStripId = "";
      let calculatedTargetIndex = -1;

      if (overId in itemsByStripId) {
        calculatedTargetStripId = String(overId);
        calculatedTargetIndex = itemsByStripId[calculatedTargetStripId].length;
      } else {
        const parsedOver = asTimelineItemId(String(overId));
        if (parsedOver.ok) {
          const foundTarget = itemLookup.get(parsedOver.value);
          if (foundTarget) {
            calculatedTargetStripId = foundTarget.stripId;
            calculatedTargetIndex = foundTarget.index;
          }
        }
      }

      if (calculatedTargetStripId && calculatedTargetIndex !== -1) {
        targetStripId = calculatedTargetStripId;
        targetIndex = calculatedTargetIndex;
      }

      // If dragged within the same strip, commit reorder now
      if (
        targetIndex !== -1 &&
        foundSource.stripId === targetStripId &&
        foundSource.index !== targetIndex
      ) {
        if (onMoveItem) {
          onMoveItem({
            itemId,
            fromStripId: foundSource.stripId,
            toStripId: targetStripId,
            fromIndex: foundSource.index,
            toIndex: targetIndex,
          });
        }
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
  }, [activeDragId, itemLookup, itemsByStripId, onMoveItem, announce]);

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
    ]
  );

  return (
    <MediaStripBoardContext.Provider value={contextValue}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {children}

        <DragOverlay>
          {activeDragItem ? (
            <DragOverlayItem item={activeDragItem} />
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
}: {
  item: TimelineItem;
}) {
  return (
    <div
      className="bg-card border-primary border p-2 rounded-lg opacity-85 shadow-2xl flex flex-col items-stretch justify-start gap-2 text-left pointer-events-none select-none"
      style={{
        width: "160px",
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

"use client";

import React, { useCallback, useRef, useMemo, useEffect, useLayoutEffect } from "react";
import {
  parseCollectionId,
  isCollectionItem,
  type TimelineItem,
  type CollectionId,
  type TimelineCollection,
  type TimelineItemId,
  type TimelineItemCommand,
} from "./core/media-strip.types";
import { DRAG_ACTIVATION_THRESHOLDS_PX } from "./core/media-strip.utils";
import { wouldCreateCollectionCycle } from "./core/media-strip.validation";
import { validateProjectTimeline } from "./core/media-strip.project-validation";
import { DragOverlayItem } from "./media-strip-drag-overlay-item";
import { useBoardRegistry } from "./use-board-registry";
import { useBoardDragState } from "./use-board-drag-state";
import { useKeyboardReorderSession } from "./use-keyboard-reorder-session";
import { useMediaStripAnnouncements } from "./use-media-strip-announcements";
import { useMediaStripRejectionFlash } from "./use-media-strip-rejection-flash";
import { useMediaStripBoardDragController } from "./use-media-strip-board-drag-controller";
import {
  MediaStripDndProvider,
  MediaStripDragOverlay,
} from "./media-strip-dnd-provider";
import { type MediaStripDndAdapter } from "./media-strip-dnd.types";
import {
  MediaStripBoardStableContext,
} from "./media-strip-board-context";
import {
  MediaStripDragStoreProvider,
  useMediaStripDragStoreInstance,
} from "./media-strip-drag-store";

export {
  MediaStripBoardStableContext,
  useMediaStripBoardStable,
  useMediaStripBoardStableOptional,
} from "./media-strip-board-context";

export function MediaStripBoard({
  children,
  collectionsById,
  dndAdapter,
  visibleCollectionIds,
  onMoveItem,
}: {
  children: React.ReactNode;
  collectionsById?: ReadonlyMap<CollectionId, TimelineCollection>;
  dndAdapter: MediaStripDndAdapter;
  visibleCollectionIds?: readonly CollectionId[];
  onMoveItem?: (command: TimelineItemCommand) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { announcement, announce } = useMediaStripAnnouncements();
  const { rejectedItemId, flashRejection } = useMediaStripRejectionFlash();

  // 1. Board Registry
  const { registeredCollections, registerCollection, unregisterCollection } = useBoardRegistry();

  // 2. Drag State Management
  const {
    activeDragId,
    activeDragSourceCollectionId,
    activeNestTargetId,
    activeDropPlacement,
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

  // Parent-edge map (collectionId -> id of the collection whose items contain
  // it) so ancestor checks on the pointer-move hot path walk O(depth) instead
  // of scanning the whole item lookup per level.
  const parentByCollectionId = useMemo(() => {
    const parents = new Map<CollectionId, CollectionId>();
    for (const entry of itemLookup.values()) {
      if (entry.item.kind === "collection") {
        parents.set(entry.item.collectionId, entry.collectionId);
      }
    }
    return parents;
  }, [itemLookup]);

  // MediaStripBoard trusts collectionsById's graph shape (itemLookup is a
  // Map keyed by item id, so duplicate global ids silently overwrite each
  // other; parentByCollectionId is single-valued, so a shared/multi-parent
  // collection silently picks whichever parent registered last). Neither
  // failure mode throws — they just make drag-and-drop resolve to the wrong
  // target. Surface them loudly in development instead of leaving them to
  // manifest as "why did my drag do that" bug reports.
  //
  // "missing-collection" is deliberately excluded: a CollectionTimelineItem
  // whose backing collection isn't in collectionsById yet is the expected
  // shape for a lazily-loaded app (a collection card can render from its own
  // itemCount before its contents are fetched — see the fallback-preserving
  // behavior in syncCollectionItemCounts), not a broken graph. It doesn't
  // corrupt itemLookup or parentByCollectionId the way the other three
  // reasons do, so warning on it would just be noise for a supported case.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;

    const result = validateProjectTimeline({
      collectionsById: collectionsByIdResolved,
      rootCollectionIds: visibleCollectionIdsResolved,
    });

    if (!result.valid && result.reason !== "missing-collection") {
      console.warn(
        `[MediaStripBoard] collectionsById failed validateProjectTimeline (reason: "${result.reason}"). ` +
          "This graph shape can make drag-and-drop silently resolve to the wrong item or collection. Details:",
        result
      );
    }
  }, [collectionsByIdResolved, visibleCollectionIdsResolved]);

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

  const activeDragItem = useMemo(() => {
    if (!activeDragId) return null;
    return itemLookup.get(activeDragId)?.item ?? null;
  }, [activeDragId, itemLookup]);

  // Whether the collection currently hovered as a nest target (`activeNestTargetId`)
  // would form a cycle if the dragged item nested into it. Computed once here —
  // the drop-time command resolver enforces the same rule, and the hovered
  // card's "Cannot drop (cycle)" overlay reads this instead of re-running
  // `wouldCreateCollectionCycle` in every collection-card component on every
  // drag frame. Only meaningful when a collection is being dragged onto a
  // nest target; false otherwise.
  const activeNestTargetInvalid = useMemo(() => {
    if (!activeNestTargetId || !activeDragItem || !isCollectionItem(activeDragItem)) {
      return false;
    }
    return wouldCreateCollectionCycle({
      movingCollectionId: activeDragItem.collectionId,
      targetCollectionId: activeNestTargetId,
      collectionsById: collectionsByIdResolved,
    });
  }, [activeNestTargetId, activeDragItem, collectionsByIdResolved]);

  const getAdjacentCollectionId = useCallback(
    (currentCollectionId: CollectionId, direction: "up" | "down"): CollectionId | null => {
      // The ordered `visibleCollectionIds` prop is the canonical source of
      // strip order. The DOM query is only a fallback for strips that
      // self-registered at runtime without being listed in the prop.
      let colIds: readonly CollectionId[] = visibleCollectionIdsResolved;

      if (!colIds.includes(currentCollectionId)) {
        const container = containerRef.current;
        if (!container) return null;

        // querySelectorAll already returns elements in document order.
        colIds = Array.from(container.querySelectorAll("[data-collection-id]")).flatMap(
          (el) => {
            const attr = el.getAttribute("data-collection-id");
            if (attr === null) return [];
            const parsed = parseCollectionId(attr);
            return parsed.ok ? [parsed.value] : [];
          }
        );
      }

      const idx = colIds.indexOf(currentCollectionId);
      if (idx === -1) return null;

      const targetIdx = direction === "down" ? idx + 1 : idx - 1;
      if (targetIdx >= 0 && targetIdx < colIds.length) {
        return colIds[targetIdx];
      }
      return null;
    },
    [visibleCollectionIdsResolved]
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
    parentByCollectionId,
    applyCommand,
    announce,
    flashRejection,
  });

  // 5. Pointer Drag Event Handling
  const {
    collisionDetectionStrategy,
    getDropTargetInfo,
    handleDragStart,
    handleDragMove,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
    canScroll,
  } = useMediaStripBoardDragController({
    containerRef,
    itemLookup,
    collectionsById: collectionsByIdResolved,
    parentByCollectionId,
    activeDragId,
    activeDragSourceCollectionId,
    adapterResolvesDropTargetsInEvents: !dndAdapter.capabilities.supportsCollisionDetection,
    startDrag,
    moveDrag,
    endDrag,
    applyCommand,
    announce,
    flashRejection,
  });

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

  // Per-move drag state is published through an external store, not context,
  // so only the items whose slice changes re-render (see
  // media-strip-drag-store.ts). The board still holds this state as React
  // state (it drives the drag overlay + announcer here), and pushes each new
  // snapshot into the store in a layout effect — synchronously after the
  // board's own commit, before paint, so subscribed items update in the same
  // frame with no visible lag.
  const dragStore = useMediaStripDragStoreInstance();
  useLayoutEffect(() => {
    dragStore.set({
      activeDragId,
      activeNestTargetId,
      activeNestTargetInvalid,
      activeDropPlacement,
      activeKeyboardReorderId,
      rejectedItemId,
    });
  }, [
    dragStore,
    activeDragId,
    activeNestTargetId,
    activeNestTargetInvalid,
    activeDropPlacement,
    activeKeyboardReorderId,
    rejectedItemId,
  ]);

  return (
    <MediaStripBoardStableContext.Provider value={stableContextValue}>
      <MediaStripDragStoreProvider value={dragStore}>
        <div ref={containerRef} style={{ display: "contents" }}>
          <MediaStripDndProvider
            adapter={dndAdapter}
            dndKit={{
              activationDistance: DRAG_ACTIVATION_THRESHOLDS_PX.board,
              collisionDetection: collisionDetectionStrategy,
            }}
            getDropTargetInfo={getDropTargetInfo}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
            autoScroll={{ canScroll }}
          >
            {children}

            <MediaStripDragOverlay>
              {activeDragItem ? (
                <DragOverlayItem item={activeDragItem} width={activeDragWidth} />
              ) : null}
            </MediaStripDragOverlay>

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
          </MediaStripDndProvider>
        </div>
      </MediaStripDragStoreProvider>
    </MediaStripBoardStableContext.Provider>
  );
}

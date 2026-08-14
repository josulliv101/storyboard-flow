"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

import { getChildren, parseNodeId, useCollectionsStore } from "@storyboard/ui/dnd-collections";

import { useFlatItems } from "./graph-preview";
import { useNativeDragArmed } from "./graph-native-drag-signal";
import { AppendFilesContext, useNativeDrop } from "./graph-native-drop-engine";
import {
  DROP_INDICATOR_CLASS,
  NativeDropStatus,
  acceptsNativeDrag,
  dropZoneClassName,
} from "./graph-native-drop-chrome";
import {
  stripDropAnchor,
  stripIndicatorX,
  type CardGeometry,
  type DropAnchor,
} from "./graph-native-drop-model";

type DragGeometry = Readonly<{
  wrapperLeft: number;
  /** Mounted cards in DOM order, which mirrors child order. */
  cards: readonly CardGeometry[];
}>;

/**
 * Wraps a strip and accepts native drops into the given collection.
 * Insertion position follows the legacy midpoint rule, resolved against the
 * MOUNTED cards (virtualization: DOM order matches child order, but indexes
 * must come from the graph, not the DOM position).
 *
 * This component owns MEASUREMENT and PAINTING only; both the boundary rule
 * and the indicator's position are pure functions in
 * `graph-native-drop-model`, where they are unit-tested.
 */
export function NativeDropStrip({
  collectionId,
  projectId,
  children,
}: Readonly<{ collectionId: string; projectId: string; children: ReactNode }>) {
  const store = useCollectionsStore();
  // Non-null only inside the focused FLAT strip — see useFlatItems. The strip
  // resolves its drop boundary in whatever order it is SHOWING, and in flat
  // mode that is not this collection's children.
  const flatItems = useFlatItems();
  const { commitDrop, upload, appendFiles } = useNativeDrop(collectionId, projectId);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [indicatorX, setIndicatorX] = useState<number | null>(null);
  const armed = useNativeDragArmed();
  // "The pointer is over THIS zone" — separate from the indicator, which an
  // empty strip has nothing to draw.
  const [dragSessionActive, setDragSessionActive] = useState(false);

  // Drag-session geometry (see measureDragGeometry) plus the rAF coalescing
  // state for the drop indicator. All refs: none of it should drive a render.
  const dragGeometryRef = useRef<DragGeometry | null>(null);
  const dragSessionRef = useRef(false);
  const pointerXRef = useRef(0);
  const indicatorFrameRef = useRef<number | null>(null);
  const indicatorXRef = useRef<number | null>(null);

  /**
   * Measure the wrapper and every mounted card ONCE per drag session.
   *
   * `dragover` fires continuously, and reading `getBoundingClientRect` per
   * card per event forces layout on each one. Cards do not move while a
   * native drag is in progress — nothing commits until drop — so the geometry
   * is stable, and the only things that invalidate it are scrolling (which
   * also swaps which cards are virtualized in) and resizing.
   */
  const measureDragGeometry = useCallback((): DragGeometry | null => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;
    const wrapperLeft = wrapper.getBoundingClientRect().left;
    const cards = [...wrapper.querySelectorAll<HTMLElement>("[data-node-id]")].map((card) => {
      const rect = card.getBoundingClientRect();
      return {
        nodeId: card.dataset.nodeId ?? "",
        left: rect.left,
        right: rect.right,
        mid: rect.left + rect.width / 2,
      };
    });
    return { wrapperLeft, cards };
  }, []);

  const resolveDropAnchor = useCallback(
    (clientX: number): DropAnchor => {
      const order =
        flatItems !== null
          ? flatItems.map((item) => item.nodeId)
          : getChildren(store.getSnapshot().graph, parseNodeId(collectionId));
      // Reuse the drag session's measurements; fall back to measuring for a
      // drop that arrived without a preceding dragover (programmatic drops).
      const geometry = dragGeometryRef.current ?? measureDragGeometry();
      return stripDropAnchor({ order, cards: geometry?.cards ?? null, clientX });
    },
    [store, collectionId, flatItems, measureDragGeometry],
  );

  const invalidateDragGeometry = useCallback(() => {
    dragGeometryRef.current = null;
  }, []);

  /** Resolve and paint the indicator for the latest pointer x, once a frame. */
  const flushIndicator = useCallback(() => {
    indicatorFrameRef.current = null;
    const geometry = (dragGeometryRef.current ??= measureDragGeometry());
    if (!geometry) return;
    const x = stripIndicatorX({
      cards: geometry.cards,
      wrapperLeft: geometry.wrapperLeft,
      clientX: pointerXRef.current,
    });
    // Most frames of a drag resolve to the SAME edge — re-rendering for them
    // is pure waste.
    if (indicatorXRef.current === x) return;
    indicatorXRef.current = x;
    setIndicatorX(x);
  }, [measureDragGeometry]);

  const endDragSession = useCallback(() => {
    if (!dragSessionRef.current) return;
    dragSessionRef.current = false;
    window.removeEventListener("scroll", invalidateDragGeometry, true);
    window.removeEventListener("resize", invalidateDragGeometry);
    if (indicatorFrameRef.current !== null) {
      cancelAnimationFrame(indicatorFrameRef.current);
      indicatorFrameRef.current = null;
    }
    dragGeometryRef.current = null;
    indicatorXRef.current = null;
    setIndicatorX(null);
    setDragSessionActive(false);
  }, [invalidateDragGeometry]);

  // A drag can end anywhere (dropped on another target, cancelled with Esc),
  // and `dragend` fires on the drag SOURCE — which is the sidebar, not us. A
  // window-level listener is what actually guarantees the session closes.
  useEffect(() => endDragSession, [endDragSession]);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsNativeDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    if (!dragSessionRef.current) {
      dragSessionRef.current = true;
      setDragSessionActive(true);
      // Capture phase: the strip scrolls in its own container, not the window.
      window.addEventListener("scroll", invalidateDragGeometry, true);
      window.addEventListener("resize", invalidateDragGeometry);
      window.addEventListener("dragend", endDragSession, { once: true });
    }
    // Coalesce to one resolve+paint per frame, no matter the event rate.
    pointerXRef.current = event.clientX;
    if (indicatorFrameRef.current === null) {
      indicatorFrameRef.current = requestAnimationFrame(flushIndicator);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    // Only clear when the pointer truly left the wrapper (dragleave fires
    // for every child boundary crossing).
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    endDragSession();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsNativeDrag(event)) return;
    event.preventDefault();
    // Resolve BEFORE ending the session: the index comes from the same
    // measurements the indicator was drawn from, so where the user saw the
    // line is where the node lands.
    const anchor = resolveDropAnchor(event.clientX);
    endDragSession();
    commitDrop(event, anchor);
  };

  return (
    <div
      ref={wrapperRef}
      data-native-drop={collectionId}
      data-native-drop-armed={armed || undefined}
      data-native-drop-hovered={armed && dragSessionActive ? true : undefined}
      className={dropZoneClassName(armed, dragSessionActive)}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <AppendFilesContext.Provider value={appendFiles}>{children}</AppendFilesContext.Provider>
      {indicatorX !== null && (
        <div
          data-native-drop-indicator
          aria-hidden="true"
          // `inset-y-1`: the strip's bar spans the wrapper's height. See
          // DROP_INDICATOR_CLASS for why the anchor is not shared with the
          // grid's.
          className={`${DROP_INDICATOR_CLASS} inset-y-1`}
          style={{ transform: `translateX(${indicatorX}px)` }}
        />
      )}
      <NativeDropStatus upload={upload} />
    </div>
  );
}

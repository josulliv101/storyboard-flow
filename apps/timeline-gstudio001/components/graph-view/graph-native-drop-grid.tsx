"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

import { getChildren, parseNodeId, useCollectionsStore } from "@storyboard/ui/dnd-collections";

import { useNativeDragArmed } from "./graph-native-drag-signal";
import { AddItemDropMenu } from "./graph-add-item-menu";
import { AppendFilesContext, useNativeDrop } from "./graph-native-drop-engine";
import {
  DROP_INDICATOR_CLASS,
  NativeDropStatus,
  acceptsNativeDrag,
  dropZoneClassName,
} from "./graph-native-drop-chrome";
import {
  gridDropAnchor,
  gridIndicatorGeometry,
  type DropAnchor,
  type GridCellGeometry,
  type GridIndicator,
} from "./graph-native-drop-model";

type GridDragGeometry = Readonly<{
  wrapperLeft: number;
  wrapperTop: number;
  gap: number;
  cells: readonly GridCellGeometry[];
}>;

/**
 * Wraps a GRID and accepts the same native drops the strip does — which grid
 * mode used to swallow, having no drop target at all (#30). The insert index
 * comes from 2-D hit-testing: the boundary falls before the first mounted cell
 * that follows the pointer in reading order (a row below the pointer, or the
 * pointer's own row and to the pointer's right). Indexes still come from the
 * GRAPH, matched to mounted cells by id, exactly as the strip does.
 *
 * As with the strip, this component owns MEASUREMENT and PAINTING only: the
 * hit test, the anchor and the indicator's geometry are pure functions in
 * `graph-native-drop-model`.
 */
export function NativeDropGrid({
  collectionId,
  projectId,
  children,
}: Readonly<{ collectionId: string; projectId: string; children: ReactNode }>) {
  const store = useCollectionsStore();
  const {
    commitDrop,
    upload,
    appendFiles,
    pendingChoice,
    chooseCollection,
    chooseMedia,
    cancelChoice,
  } = useNativeDrop(collectionId, projectId);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState<GridIndicator | null>(null);
  const armed = useNativeDragArmed();
  // "The pointer is over THIS zone" — separate from the indicator, which an
  // empty grid has nothing to draw.
  const [dragSessionActive, setDragSessionActive] = useState(false);

  const dragGeometryRef = useRef<GridDragGeometry | null>(null);
  const dragSessionRef = useRef(false);
  const pointerRef = useRef({ x: 0, y: 0 });
  const indicatorFrameRef = useRef<number | null>(null);

  const measureDragGeometry = useCallback((): GridDragGeometry | null => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;
    const wrapperRect = wrapper.getBoundingClientRect();
    const virtualRow = wrapper.querySelector<HTMLElement>("[data-virtual-row]");
    const measuredGap = virtualRow
      ? Number.parseFloat(window.getComputedStyle(virtualRow).columnGap)
      : 0;
    const gap = Number.isFinite(measuredGap) ? measuredGap : 0;
    const cells = [...wrapper.querySelectorAll<HTMLElement>("[data-node-id]")].map((cell) => {
      const rect = cell.getBoundingClientRect();
      return {
        nodeId: cell.dataset.nodeId ?? "",
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        midX: rect.left + rect.width / 2,
      };
    });
    return { wrapperLeft: wrapperRect.left, wrapperTop: wrapperRect.top, gap, cells };
  }, []);

  const resolveDropAnchor = useCallback(
    (clientX: number, clientY: number): DropAnchor => {
      const children = getChildren(store.getSnapshot().graph, parseNodeId(collectionId));
      const geometry = dragGeometryRef.current ?? measureDragGeometry();
      return gridDropAnchor({ children, cells: geometry?.cells ?? null, clientX, clientY });
    },
    [store, collectionId, measureDragGeometry],
  );

  const invalidateDragGeometry = useCallback(() => {
    dragGeometryRef.current = null;
  }, []);

  const flushIndicator = useCallback(() => {
    indicatorFrameRef.current = null;
    const geometry = (dragGeometryRef.current ??= measureDragGeometry());
    if (!geometry || geometry.cells.length === 0) {
      setIndicator(null);
      return;
    }
    const { x: clientX, y: clientY } = pointerRef.current;
    // The same `before` cell that resolves the DropAnchor also resolves this,
    // so the line cannot advertise one insertion point and commit another.
    const next = gridIndicatorGeometry({
      cells: geometry.cells,
      gap: geometry.gap,
      wrapperLeft: geometry.wrapperLeft,
      wrapperTop: geometry.wrapperTop,
      clientX,
      clientY,
    });
    if (next === null) return;
    setIndicator((current) =>
      current && current.x === next.x && current.y === next.y && current.height === next.height
        ? current
        : next,
    );
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
    setIndicator(null);
    setDragSessionActive(false);
  }, [invalidateDragGeometry]);

  useEffect(() => endDragSession, [endDragSession]);

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsNativeDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";

    if (!dragSessionRef.current) {
      dragSessionRef.current = true;
      setDragSessionActive(true);
      window.addEventListener("scroll", invalidateDragGeometry, true);
      window.addEventListener("resize", invalidateDragGeometry);
      window.addEventListener("dragend", endDragSession, { once: true });
    }
    pointerRef.current = { x: event.clientX, y: event.clientY };
    if (indicatorFrameRef.current === null) {
      indicatorFrameRef.current = requestAnimationFrame(flushIndicator);
    }
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    endDragSession();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!acceptsNativeDrag(event)) return;
    event.preventDefault();
    const anchor = resolveDropAnchor(event.clientX, event.clientY);
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
      {/* The strip's twin, from the same engine state — see the note there. */}
      {pendingChoice !== null && (
        <AddItemDropMenu
          clientX={pendingChoice.clientX}
          clientY={pendingChoice.clientY}
          onCollection={chooseCollection}
          onFiles={chooseMedia}
          onDismiss={cancelChoice}
        />
      )}
      {indicator !== null && (
        <div
          data-native-drop-indicator
          aria-hidden="true"
          // `top-0` plus an explicit height: the grid's bar is sized to the row
          // it marks. See DROP_INDICATOR_CLASS for why the anchor is not
          // shared with the strip's.
          className={`${DROP_INDICATOR_CLASS} top-0`}
          style={{
            transform: `translate(${indicator.x}px, ${indicator.y}px)`,
            height: `${indicator.height}px`,
          }}
        />
      )}
      <NativeDropStatus upload={upload} />
    </div>
  );
}

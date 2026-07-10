"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { useDroppable } from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";

import { getChildren, type NodeId } from "../core/graph";
import { useCollectionsSelector } from "../react/collections-store";
import { NodeCard } from "../react/node-views";
import { VIRTUAL_INSERT_DATA_KEY, type VirtualInsertTarget } from "../react/virtual-droppable";

// Vertical virtualized grid (phase 5 of VIRTUALIZATION-PLAN.md). Cells are
// FIXED-SIZE by decision (media letterboxes inside its card), which keeps
// the virtualizer purely row-based: one virtual item per row, columns are
// index arithmetic. Cards are the standard NodeCard; the droppable contract
// is the same virtualInsert used by VirtualStrip, with 2D boundary math.

export type VirtualGridProps = Readonly<{
  collectionId: NodeId;
  cellWidth?: number;
  cellHeight?: number;
  gap?: number;
  /** Fixed column count; omit to derive responsively from container width. */
  columns?: number;
  /** Extra ROWS rendered on each side of the viewport. */
  overscan?: number;
  /** Scroll viewport height. */
  height?: number;
  className?: string;
}>;

export type VirtualGridHandle = Readonly<{
  scrollToNode: (id: NodeId) => void;
  focusNode: (id: NodeId) => void;
}>;

export const VirtualGrid = forwardRef<VirtualGridHandle, VirtualGridProps>(
  function VirtualGrid(
    {
      collectionId,
      cellWidth = 128,
      cellHeight = 96,
      gap = 8,
      columns,
      overscan = 2,
      height = 480,
      className,
    },
    ref
  ) {
    const childIds = useCollectionsSelector((s) => getChildren(s.graph, collectionId));
    const scrollRef = useRef<HTMLDivElement>(null);

    // Responsive column count from the container's content width, unless
    // pinned by the prop.
    const [measuredColumns, setMeasuredColumns] = useState(1);
    useEffect(() => {
      if (columns !== undefined) return;
      const el = scrollRef.current;
      if (!el) return;
      const compute = () =>
        setMeasuredColumns(
          Math.max(1, Math.floor((el.clientWidth - 16 + gap) / (cellWidth + gap)))
        );
      compute();
      const observer = new ResizeObserver(compute);
      observer.observe(el);
      return () => observer.disconnect();
    }, [columns, cellWidth, gap]);
    const cols = columns ?? measuredColumns;

    const rowCount = Math.ceil(childIds.length / cols);
    const rowSize = cellHeight + gap;

    const virtualizer = useVirtualizer({
      count: rowCount,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => rowSize,
      overscan,
    });

    // Pointer -> visible boundary index: row from y (floor — the row under
    // the pointer), column boundary from x (round — nearest gap between
    // cells). Reads scrollTop live, so intents track (auto-)scroll.
    const resolveBoundary = (point: Readonly<{ x: number; y: number }>): number => {
      const el = scrollRef.current;
      if (!el || childIds.length === 0) return childIds.length;
      const rect = el.getBoundingClientRect();
      const contentX = point.x - rect.left - 8; // p-2
      const contentY = point.y - rect.top + el.scrollTop - 8;
      const row = Math.max(0, Math.min(Math.floor(contentY / rowSize), rowCount - 1));
      const col = Math.max(0, Math.min(Math.round(contentX / (cellWidth + gap)), cols));
      return Math.min(row * cols + col, childIds.length);
    };

    const { setNodeRef: setDroppableRef } = useDroppable({
      id: `vgrid:${collectionId}`,
      data: {
        [VIRTUAL_INSERT_DATA_KEY]: { collectionId, resolveBoundary } satisfies VirtualInsertTarget,
      },
    });
    const setContainerRef = useCallback(
      (el: HTMLDivElement | null) => {
        scrollRef.current = el;
        setDroppableRef(el);
      },
      [setDroppableRef]
    );

    const focusNode = useCallback(
      (id: NodeId) => {
        const index = childIds.indexOf(id);
        if (index === -1) return;
        virtualizer.scrollToIndex(Math.floor(index / cols));
        let attempts = 12;
        const tryFocus = () => {
          const card = scrollRef.current?.querySelector<HTMLElement>(
            `[data-node-id="${CSS.escape(id)}"]`
          );
          if (card) {
            card.focus();
            return;
          }
          if (--attempts > 0) requestAnimationFrame(tryFocus);
        };
        requestAnimationFrame(tryFocus);
      },
      [childIds, virtualizer, cols]
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToNode: (id) => {
          const index = childIds.indexOf(id);
          if (index !== -1) virtualizer.scrollToIndex(Math.floor(index / cols));
        },
        focusNode,
      }),
      [childIds, virtualizer, cols, focusNode]
    );

    const indicatorIndex = useCollectionsSelector((s) => {
      const intent = s.interaction.dropIntent;
      return intent?.type === "insert-at-index" &&
        intent.collectionId === collectionId &&
        !s.interaction.dropIntentInvalid
        ? intent.index
        : null;
    });
    // Boundary k -> a vertical line in row floor(k/cols) at column k%cols
    // (k at a row's end renders at the next row's left edge — the same
    // insertion point).
    const indicator =
      indicatorIndex === null
        ? null
        : {
            left: Math.max(0, (indicatorIndex % cols) * (cellWidth + gap) - gap / 2 - 2),
            top: Math.floor(indicatorIndex / cols) * rowSize,
          };

    return (
      <div
        ref={setContainerRef}
        data-virtual-grid={collectionId}
        // Keyboard scope marker: the provider remaps Alt+ArrowUp/Down to
        // row moves (± this many columns) for cards inside this container.
        data-grid-columns={cols}
        className={[
          "overflow-y-auto rounded-md border border-dashed border-border p-2",
          className ?? "",
        ].join(" ")}
        style={{ height }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
          {indicator && (
            <div
              aria-hidden="true"
              data-drop-indicator="virtual-grid"
              className="pointer-events-none absolute z-20 w-1 rounded-full bg-primary"
              style={{ left: indicator.left, top: indicator.top, height: cellHeight }}
            />
          )}
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-virtual-row={row.index}
              className="[&_[data-node-id]]:w-full"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                display: "flex",
                gap,
                height: cellHeight,
                transform: `translateY(${row.start}px)`,
              }}
            >
              {childIds
                .slice(row.index * cols, Math.min(childIds.length, (row.index + 1) * cols))
                .map((id) => (
                  <div key={id} style={{ width: cellWidth, height: cellHeight }}>
                    <NodeCard id={id} />
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
);

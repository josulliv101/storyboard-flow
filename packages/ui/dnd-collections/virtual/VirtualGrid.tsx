"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { getChildren, type NodeId } from "../core/graph";
import { useCollectionsSelector } from "../react/collections-store";
import { NodeCard } from "../react/node-views";
import { useEdgeAutoScroll } from "../react/use-edge-autoscroll";
import {
  useFocusNode,
  usePublishBoundary,
  useVirtualInsertContainer,
  VirtualEmptyHint,
  type VirtualViewPoint,
} from "./use-virtual-collection-view";

// Vertical virtualized grid. Cells are FIXED-SIZE by decision (media
// letterboxes inside its card), which keeps the virtualizer purely
// row-based: one virtual item per row, columns are index arithmetic.
// Cards are the standard NodeCard; the droppable contract is the same
// virtualInsert used by VirtualStrip, with 2D boundary math. NOTE: cards
// moving BETWEEN rows re-parent (rows are keyed by index), so cross-row
// moves recreate the card's DOM element — FLIP and held focus don't
// survive that hop.

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

    const { scrollRef, contentRef, resolveBoundaryRef, setContainerRef } =
      useVirtualInsertContainer(collectionId, "vgrid");

    // Responsive column count from the content width, unless pinned by the
    // prop. The spacer's clientWidth already excludes container padding.
    // useLayoutEffect (not useEffect) so the FIRST measurement lands before
    // paint — otherwise the initial render lays out at the `measuredColumns`
    // default of 1 (a single tall column of every row) and visibly reflows to
    // the real count a frame later.
    const [measuredColumns, setMeasuredColumns] = useState(1);
    useLayoutEffect(() => {
      if (columns !== undefined) return;
      const el = scrollRef.current;
      if (!el) return;
      const compute = () => {
        const width = contentRef.current?.clientWidth ?? el.clientWidth;
        setMeasuredColumns(Math.max(1, Math.floor((width + gap) / (cellWidth + gap))));
      };
      compute();
      const observer = new ResizeObserver(compute);
      observer.observe(el);
      return () => observer.disconnect();
    }, [columns, cellWidth, gap, scrollRef, contentRef]);
    // Guard the derived geometry against a nonsense `columns` prop: 0 would
    // make rowCount Infinity (Math.ceil(n / 0)), and a fraction/NaN would
    // corrupt every row/column calculation downstream. A pinned column count
    // must be a positive integer; otherwise fall back to the measured value.
    const requestedCols = columns ?? measuredColumns;
    const cols =
      Number.isInteger(requestedCols) && requestedCols >= 1 ? requestedCols : 1;

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
    // cells). The spacer's rect shifts with scroll, so measuring against it
    // keeps intents live during (auto-)scroll too.
    const resolveBoundary = (point: VirtualViewPoint): number => {
      const content = contentRef.current;
      if (!content || childIds.length === 0) return childIds.length;
      const rect = content.getBoundingClientRect();
      const contentX = point.x - rect.left;
      const contentY = point.y - rect.top;
      const row = Math.max(0, Math.min(Math.floor(contentY / rowSize), rowCount - 1));
      const col = Math.max(0, Math.min(Math.round(contentX / (cellWidth + gap)), cols));
      return Math.min(row * cols + col, childIds.length);
    };
    usePublishBoundary(resolveBoundaryRef, resolveBoundary);

    useEdgeAutoScroll(scrollRef, "y");

    const scrollToNode = useCallback(
      (id: NodeId): boolean => {
        const index = childIds.indexOf(id);
        if (index === -1) return false;
        virtualizer.scrollToIndex(Math.floor(index / cols));
        return true;
      },
      [childIds, virtualizer, cols]
    );
    const focusNode = useFocusNode(scrollRef, scrollToNode);

    useImperativeHandle(
      ref,
      () => ({
        scrollToNode: (id) => {
          scrollToNode(id);
        },
        focusNode,
      }),
      [scrollToNode, focusNode]
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
          "relative overflow-y-auto rounded-md border border-dashed border-border p-2",
          className ?? "",
        ].join(" ")}
        style={{ height }}
      >
        <VirtualEmptyHint visible={childIds.length === 0} />
        <div ref={contentRef} style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
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
                    <NodeCard id={id} className="h-full w-full" />
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
);

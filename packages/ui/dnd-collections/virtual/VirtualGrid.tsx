"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
  type CSSProperties,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { twMerge } from "tailwind-merge";

import { getChildren, type NodeId } from "../core/graph";
import {
  finiteNonNegativeOr,
  finitePositiveOr,
  nonNegativeIntegerOr,
  positiveIntegerOrUndefined,
} from "../core/numeric";
import {
  useCollectionsComponents,
  type CollectionItemContentComponent,
  type CollectionItemShellComponent,
  type NodeCardDragActivation,
} from "../react/collections-components";
import { useCollectionsSelector, useCollectionsStore } from "../react/collections-store";
import { NodeCard } from "../react/node-views";
import { isContiguousReorderNoOp } from "./insert-noop";
import { useBackgroundSelectionClear } from "../react/use-background-clear";
import { useEdgeAutoScroll } from "../react/use-edge-autoscroll";
import {
  useFocusNode,
  usePublishBoundary,
  useVirtualInsertContainer,
  useVirtualRovingFocus,
  VirtualEmptyHint,
  type VirtualViewPoint,
} from "./use-virtual-collection-view";

// Vertical virtualized grid. Cells are UNIFORM within a grid (no per-item
// variable width like the strip), which keeps the virtualizer purely
// row-based: one virtual item per row, columns are index arithmetic. Cell
// WIDTH stretches to fill the container exactly (see `cellWidth` doc) — only
// height is a fixed constant, so media letterboxes at a width:height ratio
// that varies slightly with container width, by design (2026-07-19).
// Cards render through the item-shell resolution (per-view `itemShell` →
// registry `ItemShell` → NodeCard); the droppable contract is the same
// virtualInsert used by VirtualStrip, with 2D boundary math. NOTE: cards
// moving BETWEEN rows re-parent (rows are keyed by index), so cross-row
// moves recreate the card's DOM element — FLIP and held focus don't
// survive that hop.

export type VirtualGridProps = Readonly<{
  collectionId: NodeId;
  /** TARGET/MINIMUM column width used to pick the responsive column count.
   *  The actual rendered width stretches evenly across the chosen columns to
   *  fill 100% of the container — unconditionally, even when `columns` is
   *  pinned — so a row never ends with empty trailing space. */
  cellWidth?: number;
  cellHeight?: number;
  gap?: number;
  /** Fixed column count; omit to derive responsively from container width.
   *  Rendered cell width still stretches to fill the container either way. */
  columns?: number;
  /** Extra ROWS rendered on each side of the viewport. */
  overscan?: number;
  /** MAXIMUM scroll viewport height: the grid is content-height while its
   *  rows fit, and scrolls only past this cap. An empty grid keeps one
   *  row's worth of drop area. */
  height?: number;
  /** Per-view card pixels — overrides the provider `components` registry.
   *  MUST be identity-stable (module scope). */
  itemContent?: CollectionItemContentComponent;
  /**
   * Per-view item SHELL — replaces the whole per-cell renderer (NodeCard by
   * default; registry `ItemShell` sits between). See VirtualStrip's prop of
   * the same name. MUST be identity-stable (module scope).
   */
  itemShell?: CollectionItemShellComponent;
  /**
   * How a cell drag starts. Default "body" — the card body drags instantly,
   * which makes a plain click ambiguous with a drag (a press that nudges is a
   * drag, and an in-card affordance's click can be eaten). "hold" mirrors the
   * strip: a quick press is a CLICK (so in-card controls like a drill button
   * work), a press-and-hold starts the reorder drag.
   */
  itemDragActivation?: NodeCardDragActivation;
  /** Presentational layer painted in CONTENT coordinates (inside the
   *  scrolling spacer), like VirtualStrip's `overlay`: a playhead, region
   *  markers. aria-hidden and pointer-events: none — scroll and the drop
   *  spacer height apply for free, and gestures pass through to the cards. */
  overlay?: ReactNode;
  /**
   * Rendered in the cell AFTER the last card — the seam for an "add one here"
   * affordance. NOT AN ITEM: `childIds.length` still drives every index,
   * boundary, and roving calculation, so the slot cannot shift a drop or take
   * a tab stop; it only lengthens the row spacer when it starts a new row.
   */
  trailingSlot?: ReactNode;
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
      cellWidth: cellWidthOption,
      cellHeight: cellHeightOption,
      gap: gapOption,
      columns: columnsOption,
      overscan: overscanOption,
      height: heightOption,
      itemContent,
      itemShell,
      itemDragActivation = "body",
      overlay,
      trailingSlot,
      className,
    },
    ref
  ) {
    // The per-cell renderer: per-view override → provider registry → NodeCard.
    const registeredShell = useCollectionsComponents().ItemShell;
    const ItemShell: CollectionItemShellComponent = itemShell ?? registeredShell ?? NodeCard;
    const cellWidth = finitePositiveOr(cellWidthOption, 128);
    const cellHeight = finitePositiveOr(cellHeightOption, 96);
    const gap = finiteNonNegativeOr(gapOption, 8);
    const columns = positiveIntegerOrUndefined(columnsOption);
    const overscan = nonNegativeIntegerOr(overscanOption, 2);
    const height = finitePositiveOr(heightOption, 480);
    const childIds = useCollectionsSelector((s) => getChildren(s.graph, collectionId));
    const indexById = useMemo(
      () => new Map(childIds.map((id, index) => [id, index])),
      [childIds]
    );

    const { scrollRef, contentRef, resolveBoundaryRef, setContainerRef } =
      useVirtualInsertContainer(collectionId, "vgrid");

    // Responsive column count from the content width, unless pinned by the
    // prop — but the WIDTH itself is always measured (even when columns is
    // pinned): the rendered cell width stretches to fill the container in
    // both modes, so pinning columns must not skip measurement.
    // useLayoutEffect (not useEffect) so the FIRST measurement lands before
    // paint — otherwise the initial render lays out at the `measuredColumns`
    // default of 1 (a single tall column of every row) and visibly reflows to
    // the real count a frame later.
    const [measuredColumns, setMeasuredColumns] = useState(1);
    const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
    useLayoutEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const compute = () => {
        // The spacer's clientWidth already excludes container padding.
        const width = contentRef.current?.clientWidth ?? el.clientWidth;
        setMeasuredWidth(width);
        if (columns === undefined) {
          setMeasuredColumns(Math.max(1, Math.floor((width + gap) / (cellWidth + gap))));
        }
      };
      compute();
      const observer = new ResizeObserver(compute);
      observer.observe(el);
      return () => observer.disconnect();
    }, [columns, cellWidth, gap, scrollRef, contentRef]);
    // Invalid pinned values normalize to responsive measurement; both paths
    // guarantee a positive integer before row/column arithmetic.
    const cols = columns ?? measuredColumns;
    // The RENDERED cell width: stretch evenly across `cols` to consume the
    // full measured width, so a row never ends with unused trailing space —
    // `cellWidth` itself stays only the target used to pick `cols` above.
    // Falls back to the raw target pre-measurement (mirrors `measuredColumns`
    // defaulting to 1 before its own first measurement).
    const fillCellWidth =
      measuredWidth !== null
        ? Math.max(1, (measuredWidth - (cols - 1) * gap) / cols)
        : cellWidth;

    // The trailing slot occupies the cell position AFTER the last card, so
    // it can start a new row. Counted for the SPACER's height only — every
    // index, boundary and roving calculation still reads `childIds.length`,
    // so the slot cannot shift a drop or take a tab stop.
    const rowCount = Math.ceil((childIds.length + (trailingSlot ? 1 : 0)) / cols);
    const rowSize = cellHeight + gap;

    const virtualizer = useVirtualizer({
      count: rowCount,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => rowSize,
      overscan,
    });

    // The virtualizer caches each row's size and does NOT re-read estimateSize
    // when its VALUE changes — only its identity/count. So a changed rowSize
    // (the item-size control resizing cells) leaves getTotalSize() reporting
    // the old height: the spacer stays short and the content-height container
    // clips the now-taller cells. Reset the cache whenever rowSize changes.
    // Layout effect so the corrected height lands before paint, no reflow flash.
    useLayoutEffect(() => {
      virtualizer.measure();
    }, [virtualizer, rowSize]);

    // Pointer -> visible boundary index: row from y (floor — the row under
    // the pointer), column boundary from x (round — nearest gap between
    // cells). The spacer's rect shifts with scroll, so measuring against it
    // keeps intents live during (auto-)scroll too.
    const resolveBoundary = (point: VirtualViewPoint): number => {
      const content = contentRef.current;
      if (
        !content ||
        childIds.length === 0 ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      ) {
        return childIds.length;
      }
      const rect = content.getBoundingClientRect();
      const contentX = point.x - rect.left;
      const contentY = point.y - rect.top;
      const row = Math.max(0, Math.min(Math.floor(contentY / rowSize), rowCount - 1));
      const col = Math.max(0, Math.min(Math.round(contentX / (fillCellWidth + gap)), cols));
      return Math.min(row * cols + col, childIds.length);
    };
    usePublishBoundary(resolveBoundaryRef, resolveBoundary);

    useEdgeAutoScroll(scrollRef, "y");

    const scrollToNode = useCallback(
      (id: NodeId): boolean => {
        const index = indexById.get(id);
        if (index === undefined) return false;
        virtualizer.scrollToIndex(Math.floor(index / cols));
        return true;
      },
      [indexById, virtualizer, cols]
    );
    const focusNode = useFocusNode(scrollRef, scrollToNode);

    // Roving keyboard navigation: bare arrows move focus in 2D (±1 across a
    // row, ±cols between rows), scrolling offscreen rows into view. Alt+arrows
    // stay item MOVES (handled by the keyboard controller via data-grid-columns).
    const store = useCollectionsStore();
    const backgroundClear = useBackgroundSelectionClear(store);
    const name = useCollectionsSelector(
      (s) => s.graph.nodesById.get(collectionId)?.name ?? String(collectionId)
    );
    const focusByIndex = useCallback(
      (index: number) => focusNode(childIds[index]),
      [focusNode, childIds]
    );
    const resolveGridIndex = useCallback(
      (key: string, current: number, count: number): number | null => {
        switch (key) {
          case "ArrowRight":
            return current + 1;
          case "ArrowLeft":
            return current - 1;
          case "ArrowDown":
            return current + cols;
          case "ArrowUp":
            return current - cols;
          case "Home":
            return 0;
          case "End":
            return count - 1;
          default:
            return null;
        }
      },
      [cols]
    );
    const { focusedIndex, onKeyDown, onItemFocus } = useVirtualRovingFocus({
      itemIds: childIds,
      indexById,
      isDragging: () => store.getSnapshot().interaction.isDragging,
      focusByIndex,
      resolveNextIndex: resolveGridIndex,
      // Arrows carry the selection with them (the file-manager convention),
      // so a keyboard user acts on what they navigated to instead of having to
      // press Space at every stop. Shift extends from the pivot.
      onNavigate: useCallback(
        (id: NodeId, extend: boolean) => {
          if (extend) store.selectRange(id);
          else store.setSelection([id]);
        },
        [store],
      ),
    });
    // Keep the roving tab stop on a MOUNTED card: rows virtualize, so if the
    // focused card's row scrolled out, fall back to the first mounted row.
    const mountedRows = virtualizer.getVirtualItems();
    const focusedRow = Math.floor(focusedIndex / cols);
    const rovingIndex = mountedRows.some((r) => r.index === focusedRow)
      ? focusedIndex
      : (mountedRows[0]?.index ?? 0) * cols;

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
      if (
        intent?.type !== "insert-at-index" ||
        intent.collectionId !== collectionId ||
        s.interaction.dropIntentInvalid
      ) {
        return null;
      }
      // Hide the indicator on a NO-OP move: dragging items already in this
      // collection to a boundary that leaves them where they are. Only for a
      // contiguous run wholly inside this collection (see VirtualStrip).
      if (isContiguousReorderNoOp(indexById, s.interaction.activeIds, intent.index)) {
        return null;
      }
      return intent.index;
    });
    // Boundary k -> a vertical line in row floor(k/cols) at column k%cols
    // (k at a row's end renders at the next row's left edge — the same
    // insertion point). SPECIAL CASE: appending after a FULL last row
    // (k === count and count % cols === 0) would otherwise land at row
    // `rowCount`, i.e. exactly the bottom edge of the spacer — outside the
    // content. Render it at the right edge of the last cell of the last row.
    const indicator = (() => {
      if (indicatorIndex === null) return null;
      const appendAfterFullRow =
        indicatorIndex === childIds.length && indicatorIndex > 0 && indicatorIndex % cols === 0;
      const row = appendAfterFullRow
        ? Math.floor((indicatorIndex - 1) / cols)
        : Math.floor(indicatorIndex / cols);
      const col = appendAfterFullRow ? cols : indicatorIndex % cols;
      return {
        // Match the leading-gap center used by a card's "before" indicator.
        // Clamping created a second position at the first item in every row.
        left: Math.max(0, col * (fillCellWidth + gap) - gap / 2),
        top: row * rowSize,
      };
    })();

    return (
      <div
        ref={setContainerRef}
        data-virtual-grid={collectionId}
        // Keyboard scope marker: the provider remaps Alt+ArrowUp/Down to
        // row moves (± this many columns) for cards inside this container.
        data-grid-columns={cols}
        // Live rendered cell width (post fill-stretch) — overlay consumers
        // must read this instead of assuming a fixed pixel width, since it
        // varies with container size the same way data-grid-columns does.
        data-grid-cell-width={fillCellWidth}
        // 2D grid: bare arrows rove; aria-rowcount/colcount + per-row/cell
        // indexes expose the true position ("row 200 of 250") under virtualization.
        role="grid"
        aria-label={`${name}, ${childIds.length} items`}
        aria-rowcount={rowCount}
        aria-colcount={cols}
        onKeyDown={onKeyDown}
        // Empty space is the "deselect" target; the pointerdown half records
        // the press position so a drag that ends over the background is not
        // mistaken for a click. (See useBackgroundSelectionClear.)
        onPointerDown={backgroundClear.onPointerDown}
        onClick={backgroundClear.onClick}
        className={twMerge(
          "relative overflow-y-auto rounded-md border border-dashed border-border p-2",
          className,
        )}
        style={
          {
            maxHeight: height,
            "--dnd-drop-indicator-half-gap": `${gap / 2}px`,
          } as CSSProperties
        }
      >
        <VirtualEmptyHint visible={childIds.length === 0} />
        <div
          ref={contentRef}
          style={{
            height: virtualizer.getTotalSize(),
            // The container hugs content (maxHeight), so an empty grid would
            // collapse to bare padding — keep one row's worth of drop area
            // (the empty hint is absolutely positioned and adds no height).
            minHeight: childIds.length === 0 ? rowSize : undefined,
            position: "relative",
          }}
        >
          {indicator && (
            <div
              aria-hidden="true"
              data-drop-indicator="virtual-grid"
              className="pointer-events-none absolute z-20 w-1 -translate-x-1/2 rounded-full bg-primary"
              style={{ left: indicator.left, top: indicator.top, height: cellHeight }}
            />
          )}
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.key}
              data-virtual-row={row.index}
              role="row"
              aria-rowindex={row.index + 1}
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
              {trailingSlot &&
                Math.floor(childIds.length / cols) === row.index && (
                  <div
                    data-virtual-trailing-slot
                    style={{
                      order: childIds.length % cols,
                      width: fillCellWidth,
                      height: cellHeight,
                    }}
                  >
                    {trailingSlot}
                  </div>
                )}
              {childIds
                .slice(row.index * cols, Math.min(childIds.length, (row.index + 1) * cols))
                .map((id, colInRow) => {
                  const absoluteIndex = row.index * cols + colInRow;
                  return (
                    <div
                      key={id}
                      role="gridcell"
                      aria-colindex={colInRow + 1}
                      onFocus={() => onItemFocus(id)}
                      style={
                        {
                          width: fillCellWidth,
                          height: cellHeight,
                          // A row-EDGE boundary is the grid's own edge, not the
                          // centre of a fictional gap outside the scroller, so
                          // those bars sit flush; matching the virtual
                          // indicator's clamped coordinate keeps the two
                          // rendering paths from alternating. The sides are
                          // separate because only ONE of a cell's two gaps is
                          // ever the row edge — with a single shared value the
                          // first cell in every row also lost the offset on its
                          // interior side, and the bar sat against the card
                          // instead of in the middle of a real gap.
                          "--dnd-drop-indicator-half-gap-before":
                            colInRow === 0 ? "0px" : `${gap / 2}px`,
                          "--dnd-drop-indicator-half-gap-after":
                            colInRow === cols - 1 ? "0px" : `${gap / 2}px`,
                        } as CSSProperties
                      }
                    >
                      <ItemShell
                        id={id}
                        className="h-full w-full"
                        rovingTabIndex={absoluteIndex === rovingIndex ? 0 : -1}
                        itemContent={itemContent}
                        dragActivation={itemDragActivation}
                      />
                    </div>
                  );
                })}
            </div>
          ))}
          {/* Consumer overlay (playhead, region markers) in CONTENT
              coordinates: inside the spacer, so scroll and the drop-spacer
              height apply for free. pointer-events: none so drag/select pass
              through; aria-hidden keeps the grid tree valid (a focusable
              child under aria-hidden would be a keyboard trap). */}
          {overlay != null && (
            <div
              aria-hidden="true"
              data-virtual-grid-overlay
              style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 30 }}
            >
              {overlay}
            </div>
          )}
        </div>
      </div>
    );
  }
);

"use client";

import { forwardRef, useCallback, useImperativeHandle, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { getChildren, type CollectionItemNode, type NodeId } from "../core/graph";
import { useCollectionsSelector, useCollectionsStore } from "../react/collections-store";
import { NodeCard, type NodeCardDragActivation } from "../react/node-views";
import { useEdgeAutoScroll } from "../react/use-edge-autoscroll";
import {
  usePanWithMomentum,
  type PanWithMomentumOptions,
} from "../react/use-pan-with-momentum";
import {
  useFocusNode,
  usePublishBoundary,
  useVirtualInsertContainer,
  useVirtualRovingFocus,
  VirtualEmptyHint,
  type VirtualViewPoint,
} from "./use-virtual-collection-view";

// 1D roving navigation: Left/Right step one item, Home/End jump to the ends.
function resolveStripIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case "ArrowRight":
      return current + 1;
    case "ArrowLeft":
      return current - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

// Horizontal virtualized strip: renders only visible cards + overscan out
// of arbitrarily large collections. Cards ARE the standard NodeCard —
// virtualization changes WHICH ids mount, never how a card works — so
// selection, drag-source dimming, and store subscriptions come along
// unchanged. DnD over gaps and unmounted regions resolves through the
// container droppable (pointer offset → insert-at-index); widths are fixed
// or metadata-driven via itemWidthFor; the surface pans to scroll with
// momentum, with item drags on grip bars or behind press-and-hold.

// Only grip bars are exclusively item-drag territory — card BODIES, gaps,
// and background all pan. (Hold-mode bodies pan too: a fast move cancels
// the hold sensor's activation, and if the hold DOES fire first, the pan
// yields via isGestureClaimed.) Module-level so option identities are
// stable.
const isPannableStripSurface = (target: Element): boolean =>
  !target.closest("[data-drag-handle]");
const STRIP_PAN_DISABLED: PanWithMomentumOptions = { disabled: true };

export type VirtualStripProps = Readonly<{
  collectionId: NodeId;
  /** Card width when `itemWidthFor` is absent or returns nothing for a node. */
  itemWidth?: number;
  /**
   * Per-node width from metadata (aspect ratio, duration, user data...).
   * Evaluated lazily per index — never by rendering the node. The
   * virtualizer memoizes its measurements (keyed by the stable `getItemKey`),
   * so this runs once per layout, not once per render. After metadata loads
   * or zoom/scale changes, call `remeasure()` on the handle to recompute.
   */
  itemWidthFor?: (node: CollectionItemNode) => number | undefined;
  itemHeight?: number;
  gap?: number;
  /** Extra items rendered on each side of the viewport. */
  overscan?: number;
  /** Drag the strip surface to scroll it, with momentum on release. Default on. */
  panToScroll?: boolean;
  /**
   * How item drags start when panToScroll is on: from a grip bar
   * ("handle", default) or by press-and-holding the card body ("hold").
   * Ignored when panToScroll is off (bodies drag instantly).
   */
  itemDragActivation?: "handle" | "hold";
  className?: string;
}>;

export type VirtualStripHandle = Readonly<{
  /** Scroll so the node's slot is in view (works for unmounted nodes). */
  scrollToNode: (id: NodeId) => void;
  /** Scroll to the node, then focus its card once the virtualizer mounts it. */
  focusNode: (id: NodeId) => void;
  /** Drop all cached widths and re-run `itemWidthFor` (metadata/zoom changed). */
  remeasure: () => void;
}>;

export const VirtualStrip = forwardRef<VirtualStripHandle, VirtualStripProps>(
  function VirtualStrip(
    {
      collectionId,
      itemWidth = 128,
      itemWidthFor,
      itemHeight = 96,
      gap = 8,
      overscan = 4,
      panToScroll = true,
      itemDragActivation = "handle",
      className,
    },
    ref
  ) {
    const store = useCollectionsStore();
    const cardActivation: NodeCardDragActivation = panToScroll ? itemDragActivation : "body";

    // Stable array reference between commits — the virtualizer's item keys
    // and index math stay coherent across drags for free.
    const childIds = useCollectionsSelector((s) => getChildren(s.graph, collectionId));
    // nodesById is never re-allocated by moves, so this subscription is inert.
    const nodesById = useCollectionsSelector((s) => s.graph.nodesById);

    const { scrollRef, contentRef, resolveBoundaryRef, setContainerRef } =
      useVirtualInsertContainer(collectionId, "vstrip");

    const widthForIndex = (index: number): number => {
      const node = nodesById.get(childIds[index]);
      return (node && itemWidthFor?.(node)) ?? itemWidth;
    };

    // Stable keys by node id (reorders move DOM nodes instead of repainting
    // every slot's contents) AND a stable callback identity: TanStack
    // memoizes its measurements array on getItemKey's IDENTITY, so an inline
    // closure here would rebuild all N measurements — re-running
    // itemWidthFor for every item — on every render, e.g. once per indicator
    // move during a drag (WidthCallbackColdDuringDrag pins this).
    const getItemKey = useCallback((index: number) => childIds[index], [childIds]);

    const virtualizer = useVirtualizer({
      count: childIds.length,
      getScrollElement: () => scrollRef.current,
      // Lazy per-index width from graph metadata — no DOM render is ever
      // needed to know the strip's layout.
      estimateSize: (index) => widthForIndex(index) + gap,
      horizontal: true,
      overscan,
      getItemKey,
    });

    // Pointer -> visible boundary index from the virtualizer's measurements
    // (O(log n), variable widths included) — never from card rects, since
    // most cards aren't mounted. The spacer's rect shifts with scroll, so
    // measuring against it keeps intents live during (auto-)scroll too.
    const resolveBoundary = (point: VirtualViewPoint): number => {
      const content = contentRef.current;
      if (!content || childIds.length === 0) return childIds.length;
      const contentX = point.x - content.getBoundingClientRect().left;
      if (contentX <= 0) return 0;
      if (contentX >= virtualizer.getTotalSize()) return childIds.length;
      const item = virtualizer.getVirtualItemForOffset(contentX);
      if (!item) return childIds.length;
      return contentX < item.start + item.size / 2 ? item.index : item.index + 1;
    };
    usePublishBoundary(resolveBoundaryRef, resolveBoundary);

    useEdgeAutoScroll(scrollRef, "x");
    const panOptions = useMemo<PanWithMomentumOptions>(
      () =>
        panToScroll
          ? {
              shouldStartPan: isPannableStripSurface,
              // Hold-to-drag can claim a press mid-slop; the pan stands down.
              isGestureClaimed: () => store.getSnapshot().interaction.isDragging,
            }
          : STRIP_PAN_DISABLED,
      [panToScroll, store]
    );
    usePanWithMomentum(scrollRef, "x", panOptions);

    const scrollToNode = useCallback(
      (id: NodeId): boolean => {
        const index = childIds.indexOf(id);
        if (index === -1) return false;
        virtualizer.scrollToIndex(index);
        return true;
      },
      [childIds, virtualizer]
    );
    const focusNode = useFocusNode(scrollRef, scrollToNode);

    // Roving keyboard navigation (bare Left/Right/Home/End). The collection
    // name gives the grid an accessible name.
    const name = useCollectionsSelector(
      (s) => s.graph.nodesById.get(collectionId)?.name ?? String(collectionId)
    );
    const focusByIndex = useCallback(
      (index: number) => focusNode(childIds[index]),
      [focusNode, childIds]
    );
    const { focusedIndex, onKeyDown, onItemFocus } = useVirtualRovingFocus({
      count: childIds.length,
      isDragging: () => store.getSnapshot().interaction.isDragging,
      focusByIndex,
      resolveNextIndex: resolveStripIndex,
    });
    // Keep the roving tab stop on a MOUNTED card: if the focused index scrolled
    // out of view (mouse/pan), fall back to the first mounted item so the strip
    // stays tabbable.
    const mountedItems = virtualizer.getVirtualItems();
    const rovingIndex = mountedItems.some((v) => v.index === focusedIndex)
      ? focusedIndex
      : mountedItems[0]?.index ?? 0;

    useImperativeHandle(
      ref,
      () => ({
        scrollToNode: (id) => {
          scrollToNode(id);
        },
        focusNode,
        remeasure: () => virtualizer.measure(),
      }),
      [scrollToNode, focusNode, virtualizer]
    );

    // Indicator boundary for a live insert-at-index intent aimed at THIS
    // collection (positioned in content coordinates, so it scrolls along).
    const indicatorIndex = useCollectionsSelector((s) => {
      const intent = s.interaction.dropIntent;
      return intent?.type === "insert-at-index" &&
        intent.collectionId === collectionId &&
        !s.interaction.dropIntentInvalid
        ? intent.index
        : null;
    });

    // Boundary k's line sits in the gap before item k (measured offsets, so
    // variable widths align). Boundaries under the pointer are always near
    // the viewport, so the mounted-items lookup is sufficient; k === count
    // (append at the far end) falls back to the total size.
    const boundaryLeft = (k: number): number | null => {
      if (k >= childIds.length) {
        return Math.max(0, virtualizer.getTotalSize() - gap / 2 - 2);
      }
      const item = virtualizer.getVirtualItems().find((v) => v.index === k);
      return item ? Math.max(0, item.start - gap / 2 - 2) : null;
    };
    const indicatorLeft = indicatorIndex !== null ? boundaryLeft(indicatorIndex) : null;

    return (
      <div
        ref={setContainerRef}
        data-virtual-strip={collectionId}
        // One-row grid: arrow keys rove across columns, and aria-colcount /
        // aria-colindex expose the true position ("column 500 of 1000") even
        // though only a handful of cells are mounted.
        role="grid"
        aria-label={`${name}, ${childIds.length} items`}
        aria-rowcount={1}
        aria-colcount={childIds.length}
        onKeyDown={onKeyDown}
        className={[
          "relative overflow-x-auto rounded-md border border-dashed border-border p-2",
          className ?? "",
        ].join(" ")}
        // When WE own horizontal scrolling (pan hook), reserve horizontal
        // touch gestures for it and leave vertical native ("pan-y"). With
        // panToScroll off there is no pan hook, so the browser must keep
        // native horizontal touch scrolling ("auto") or the strip can't be
        // scrolled by touch at all.
        style={{ touchAction: panToScroll ? "pan-y" : "auto" }}
      >
        <VirtualEmptyHint visible={childIds.length === 0} />
        <div
          ref={contentRef}
          role="row"
          aria-rowindex={1}
          style={{ width: virtualizer.getTotalSize(), height: itemHeight, position: "relative" }}
        >
          {indicatorLeft !== null && (
            <div
              aria-hidden="true"
              data-drop-indicator="virtual"
              className="pointer-events-none absolute inset-y-0 z-20 w-1 rounded-full bg-primary"
              style={{ left: indicatorLeft }}
            />
          )}
          {virtualizer.getVirtualItems().map((item) => (
            <div
              key={item.key}
              data-virtual-index={item.index}
              role="gridcell"
              aria-colindex={item.index + 1}
              // Sync the roving index to whatever card actually gains focus
              // (click, programmatic focus), not just keyboard navigation.
              onFocus={() => onItemFocus(item.index)}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: item.size - gap,
                height: itemHeight,
                transform: `translateX(${item.start}px)`,
              }}
            >
              {/* Explicit sizing: the card fills its (possibly variable) slot.
                  With panToScroll, item drags move to the grip bar or behind
                  a press-and-hold so the body is free to pan the strip. */}
              <NodeCard
                id={childIds[item.index]}
                className="h-full w-full"
                dragActivation={cardActivation}
                rovingTabIndex={item.index === rovingIndex ? 0 : -1}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }
);

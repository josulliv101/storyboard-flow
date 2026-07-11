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
  VirtualEmptyHint,
  type VirtualViewPoint,
} from "./use-virtual-collection-view";

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
   * Evaluated lazily per index — never by rendering the node — and cached
   * by node id inside the virtualizer (stable `getItemKey`), so widths
   * survive unmount/remount. After metadata loads or zoom/scale changes,
   * call `remeasure()` on the handle to invalidate.
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

    const virtualizer = useVirtualizer({
      count: childIds.length,
      getScrollElement: () => scrollRef.current,
      // Lazy per-index width — cached by item key, so no DOM render is ever
      // needed to know the strip's layout.
      estimateSize: (index) => widthForIndex(index) + gap,
      horizontal: true,
      overscan,
      // Stable keys by node id: reorders move DOM nodes instead of
      // repainting every slot's contents, and width caches follow the node.
      getItemKey: (index) => childIds[index],
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
        className={[
          "relative overflow-x-auto rounded-md border border-dashed border-border p-2",
          className ?? "",
        ].join(" ")}
        // Vertical touch scrolling stays native; horizontal is ours (pan hook).
        style={{ touchAction: "pan-y" }}
      >
        <VirtualEmptyHint visible={childIds.length === 0} />
        <div
          ref={contentRef}
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
              />
            </div>
          ))}
        </div>
      </div>
    );
  }
);

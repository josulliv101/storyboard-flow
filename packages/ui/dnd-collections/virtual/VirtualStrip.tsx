"use client";

import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { useDroppable } from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";

import { getChildren, type CollectionItemNode, type NodeId } from "../core/graph";
import { useCollectionsSelector } from "../react/collections-store";
import { NodeCard } from "../react/node-views";
import { useEdgeAutoScroll } from "../react/use-edge-autoscroll";
import { VIRTUAL_INSERT_DATA_KEY, type VirtualInsertTarget } from "../react/virtual-droppable";

// Horizontal virtualized strip (phase 2 of VIRTUALIZATION-PLAN.md):
// renders only visible cards + overscan out of arbitrarily large
// collections. Cards ARE the standard NodeCard — virtualization changes
// WHICH ids mount, never how a card works — so selection, drag-source
// dimming, and store subscriptions come along unchanged. Fixed item width
// for now; the variable-width measurement pipeline is phase 4. DnD over
// unmounted regions (container-collision → insert-at-index) is phase 3.

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
      className,
    },
    ref
  ) {
    // Stable array reference between commits — the virtualizer's item keys
    // and index math stay coherent across drags for free.
    const childIds = useCollectionsSelector((s) => getChildren(s.graph, collectionId));
    // nodesById is never re-allocated by moves, so this subscription is inert.
    const nodesById = useCollectionsSelector((s) => s.graph.nodesById);
    const scrollRef = useRef<HTMLDivElement>(null);

    const widthForIndex = (index: number): number => {
      const node = nodesById.get(childIds[index]);
      return (node && itemWidthFor?.(node)) ?? itemWidth;
    };

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
    // most cards aren't mounted. Reads scrollLeft live, so intents keep
    // updating during (auto-)scroll.
    const resolveBoundary = (point: Readonly<{ x: number; y: number }>): number => {
      const el = scrollRef.current;
      if (!el) return childIds.length;
      const contentX = point.x - el.getBoundingClientRect().left + el.scrollLeft - 8; // p-2
      if (contentX <= 0) return 0;
      if (contentX >= virtualizer.getTotalSize()) return childIds.length;
      const item = virtualizer.getVirtualItemForOffset(contentX);
      if (!item) return childIds.length;
      return contentX < item.start + item.size / 2 ? item.index : item.index + 1;
    };

    // The container is the droppable; the provider's collision detection
    // reads this data and emits an insert-at-index intent.
    const { setNodeRef: setDroppableRef } = useDroppable({
      id: `vstrip:${collectionId}`,
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

    useEdgeAutoScroll(scrollRef, "x");

    const focusNode = useCallback(
      (id: NodeId) => {
        const index = childIds.indexOf(id);
        if (index === -1) return;
        virtualizer.scrollToIndex(index);
        // The card may not exist until the virtualizer re-renders after the
        // scroll — retry across a few frames, then give up quietly.
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
      [childIds, virtualizer]
    );

    useImperativeHandle(
      ref,
      () => ({
        scrollToNode: (id) => {
          const index = childIds.indexOf(id);
          if (index !== -1) virtualizer.scrollToIndex(index);
        },
        focusNode,
        remeasure: () => virtualizer.measure(),
      }),
      [childIds, virtualizer, focusNode]
    );

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
          "overflow-x-auto rounded-md border border-dashed border-border p-2",
          className ?? "",
        ].join(" ")}
      >
        <div
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
              {/* Explicit sizing: the card fills its (possibly variable) slot. */}
              <NodeCard id={childIds[item.index]} className="h-full w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }
);

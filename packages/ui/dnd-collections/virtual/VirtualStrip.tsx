"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import { getChildren, isVideoMedia, type CollectionItemNode, type NodeId } from "../core/graph";
import { useCollectionsSelector, useCollectionsStore } from "../react/collections-store";
import { NodeCard, type NodeCardDragActivation } from "../react/node-views";
import { TrimOverviewStrip } from "../react/trim-overview";
import { TrimPreviewContext, type LiveTrim, type TrimPreview } from "../react/trim-preview-context";
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
  !target.closest("[data-drag-handle], [data-trim-handle], [data-trim-overview]");
const STRIP_PAN_DISABLED: PanWithMomentumOptions = { disabled: true };

// Vertical band reserved above the row for the selected video's TrimOverview
// (matches TrimOverviewStrip's own h-11 = 44px).
const OVERVIEW_HEIGHT = 44;
const OVERVIEW_GAP = 8;

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
  /**
   * Enable media trim handles at card edges, converting the drag at this many
   * pixels per second. Set it to the SAME scale your `itemWidthFor` uses so a
   * trim resizes the card by the amount dragged.
   */
  trimPixelsPerSecond?: number;
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
      trimPixelsPerSecond,
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
    // The selected video (if any) drives the TrimOverview band above the row.
    const selectedVideo = useCollectionsSelector((s) => {
      for (const id of s.interaction.selectedIds) {
        const n = s.graph.nodesById.get(id);
        if (n && isVideoMedia(n)) return n;
      }
      return null;
    });

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

    // Variable widths come from node DATA, so a data change (a trim commit,
    // a palette add) must re-run the cached measurements. `nodesById` only
    // gets a new identity on such a commit — never on a move or a drag — so
    // this stays at commit cadence, not per frame. Fixed-width strips
    // (no itemWidthFor) never need it.
    useEffect(() => {
      if (itemWidthFor) virtualizer.measure();
    }, [nodesById, itemWidthFor, virtualizer]);

    // Live trim preview: a trim handle calls this per pointer-move to resize
    // ONE card without a graph commit, AND to publish the drag's current
    // trimIn/trimOut split. Two things read that split during render: the
    // overview (to keep its window on the clip's edges) and the right-edge
    // ANCHOR for a left-handle drag (below). `resizeItem` updates the item's
    // cached size and shifts the offsets after it — no full re-measure, no
    // per-frame graph churn (the commit lands once, on release). The live
    // split lives in state, not a ref, so clearing it on commit/abort forces
    // the anchor transform back to 0 in the same render; the strip re-renders
    // on every move anyway (resizeItem), so this adds no renders, and the
    // memoized cards still don't re-render. The callback must stay
    // reference-stable (trim handles read it via context) — it is, reading
    // mutable inputs from a ref and calling the stable setState.
    const trimStateRef = useRef({ childIds, virtualizer, gap, trimPixelsPerSecond, widthForIndex });
    trimStateRef.current = { childIds, virtualizer, gap, trimPixelsPerSecond, widthForIndex };
    const [liveTrim, setLiveTrim] = useState<{ nodeId: NodeId; trim: LiveTrim } | null>(null);
    // Pre-drag slot size of the item being left-trimmed, captured once per
    // gesture. The anchor transform is measured against THIS, not the live
    // committed size — at the commit render `widthForIndex` already reflects
    // the new size, which would collapse the transform to 0 a frame before
    // the scroll reconciliation and flash. Held until commit/abort clears it.
    const trimBaselineRef = useRef<{ nodeId: NodeId; size0: number } | null>(null);
    // Last computed anchor shift (px), written during render; the commit
    // effect converts it into a real scroll so removing the transform doesn't
    // jump the anchored clip.
    const dragShiftRef = useRef(0);
    const previewTrim = useCallback<TrimPreview["previewTrim"]>((nodeId, live) => {
      const s = trimStateRef.current;
      const index = s.childIds.indexOf(nodeId);

      if (live === null || index === -1) {
        // Abort/no-op: snap the item back to its committed size; clearing the
        // live split resets the anchor transform to 0 (scroll untouched, so
        // the content returns to where it started).
        if (index !== -1) s.virtualizer.resizeItem(index, s.widthForIndex(index) + s.gap);
        trimBaselineRef.current = null;
        setLiveTrim(null);
        return;
      }

      // Capture the pre-drag slot size once, for a left-handle drag on a
      // non-first item (index 0 has no left room, so it keeps grow-right).
      if (live.side === "left" && index > 0 && trimBaselineRef.current?.nodeId !== nodeId) {
        trimBaselineRef.current = { nodeId, size0: s.widthForIndex(index) + s.gap };
      }

      setLiveTrim({ nodeId, trim: live });
      // Crisp width via resizeItem (grows/shrinks rightward). The right-edge
      // anchor is a composited transform derived during render, applied in
      // the SAME commit as this resize (atomic — no stutter).
      s.virtualizer.resizeItem(index, live.effectiveSeconds * (s.trimPixelsPerSecond ?? 0) + s.gap);
    }, []);
    const trimPreview = useMemo<TrimPreview>(() => ({ previewTrim }), [previewTrim]);

    // On a COMMIT (nodesById gets a new identity — trim release, undo/redo,
    // any edit; never a move/drag) convert the drag's anchor transform into a
    // real scroll, so clearing the transform below doesn't jump the anchored
    // clip. Where scrollLeft has no room (a clip near the strip start), this
    // clamps and the final position snaps by the shortfall — the known limit
    // of native-scroll anchoring; the DRAG itself stayed consistent because a
    // transform isn't clamped. Unrelated commits have shift 0 → no-op.
    useEffect(() => {
      const shift = dragShiftRef.current;
      if (shift !== 0 && scrollRef.current) scrollRef.current.scrollLeft -= shift;
      dragShiftRef.current = 0;
      trimBaselineRef.current = null;
      setLiveTrim(null);
    }, [nodesById, scrollRef]);

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

    // Reserve the band whenever a video is selected (not only while its item
    // is mounted) — otherwise scrolling the selected clip on/off screen would
    // repeatedly grow/shrink the row height. The overview itself only renders
    // once its clip is actually mounted (there's nothing to be "above" of
    // when it's off-screen).
    const hasOverviewBand = trimPixelsPerSecond !== undefined && selectedVideo !== null;
    const itemsTop = hasOverviewBand ? OVERVIEW_HEIGHT + OVERVIEW_GAP : 0;
    const contentHeight = itemHeight + (hasOverviewBand ? OVERVIEW_HEIGHT + OVERVIEW_GAP : 0);

    const selectedVideoIndex = selectedVideo ? childIds.indexOf(selectedVideo.id) : -1;
    const selectedVideoItem =
      selectedVideoIndex === -1
        ? undefined
        : mountedItems.find((v) => v.index === selectedVideoIndex);
    // Live values (mid-drag) win over the node's committed trim so the
    // window's position/width track the drag frame-for-frame.
    const overviewTrim =
      selectedVideo &&
      (liveTrim?.nodeId === selectedVideo.id
        ? liveTrim.trim
        : { trimInSeconds: selectedVideo.trimInSeconds, trimOutSeconds: selectedVideo.trimOutSeconds });
    const overviewAnchorLeft =
      selectedVideoItem && overviewTrim
        ? selectedVideoItem.start - overviewTrim.trimInSeconds * (trimPixelsPerSecond ?? 0)
        : 0;

    // Right-edge anchor for a left-handle drag ("grows left"): resizeItem
    // grew the item rightward, so translate the whole content layer by the
    // negated growth. viewport-x = contentX − scrollLeft + dragShiftX, so the
    // right edge (offset + newSize) stays fixed while the left edge and left
    // neighbors slide; right neighbors, shifted by resizeItem, are cancelled
    // and stay put. A transform (not a scrollLeft write) because it's
    // unclamped — consistent when shrinking a clip at the strip start, where
    // scrollLeft can't go below 0 — and composited, applied atomically with
    // the resize (no per-frame scroll write racing it → no stutter).
    let dragShiftX = 0;
    const trimBaseline = trimBaselineRef.current;
    if (liveTrim && trimBaseline && trimBaseline.nodeId === liveTrim.nodeId && liveTrim.trim.side === "left") {
      const liveSlot = liveTrim.trim.effectiveSeconds * (trimPixelsPerSecond ?? 0) + gap;
      dragShiftX = -(liveSlot - trimBaseline.size0);
    }
    dragShiftRef.current = dragShiftX;

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
      <TrimPreviewContext.Provider value={trimPreview}>
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
            style={{
              width: virtualizer.getTotalSize(),
              height: contentHeight,
              position: "relative",
              // The left-handle "grows left" anchor (0 unless a left trim is
              // in flight). Shifts the whole content layer — clips AND the
              // overview — so they move together and stay aligned.
              transform: dragShiftX ? `translateX(${dragShiftX}px)` : undefined,
            }}
          >
            {selectedVideo && selectedVideoItem && overviewTrim && trimPixelsPerSecond !== undefined && (
              <TrimOverviewStrip
                node={selectedVideo}
                pixelsPerSecond={trimPixelsPerSecond}
                anchorLeft={overviewAnchorLeft}
                trimInSeconds={overviewTrim.trimInSeconds}
                trimOutSeconds={overviewTrim.trimOutSeconds}
              />
            )}
            {indicatorLeft !== null && (
              <div
                aria-hidden="true"
                data-drop-indicator="virtual"
                className="pointer-events-none absolute z-20 w-1 rounded-full bg-primary"
                style={{ left: indicatorLeft, top: itemsTop, height: itemHeight }}
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
                  top: itemsTop,
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
                  trimPixelsPerSecond={trimPixelsPerSecond}
                />
              </div>
            ))}
          </div>
        </div>
      </TrimPreviewContext.Provider>
    );
  }
);

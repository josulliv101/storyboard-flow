"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { twMerge } from "tailwind-merge";

import {
  getChildren,
  hasSourceWindow,
  isVideoMedia,
  mediaDurationSeconds,
  type CollectionItemNode,
  type CollectionsGraph,
  type NodeId,
} from "../core/graph";
import {
  finiteNonNegativeOr,
  finitePositiveOr,
  finitePositiveOrUndefined,
  nonNegativeIntegerOr,
} from "../core/numeric";
import { isContiguousReorderNoOp } from "./insert-noop";
import {
  useCollectionsComponents,
  type CollectionItemContentComponent,
  type CollectionItemShellComponent,
} from "../react/collections-components";
import { useCollectionsSelector, useCollectionsStore } from "../react/collections-store";
import { findNodeElement, isEditableKeyboardTarget } from "../react/node-dom";
import { NodeCard, type NodeCardDragActivation } from "../react/node-views";
import { PAN_SURFACE_ATTR } from "../react/gesture-thresholds";
import { isTrimGestureArmed } from "../react/trim-gesture";
import { TrimOverviewStrip } from "../react/trim-overview";
import { TrimPreviewContext, type LiveTrim, type TrimPreview } from "../react/trim-preview-context";
import { useBackgroundSelectionClear } from "../react/use-background-clear";
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
import {
  MIN_ITEM_WIDTH,
  durationToWidth,
  indicatorLeftOffset,
  leftAnchorShift,
  resolveBoundaryIndex,
  slotSizeFor,
} from "./virtual-strip-geometry";
import { useDroppable } from "@dnd-kit/core";
import {
  VIRTUAL_PLACE_DATA_KEY,
  type VirtualPlaceTarget,
} from "../react/virtual-droppable";
import {
  createLaneTimeMap,
  laneFlatIndex,
  laneItemPlacement,
  laneRowPosition,
  laneRowTop,
  laneStackHeight,
  resolveLaneStripIndex,
  snapEdgesFor,
  snapToEdges,
  type LanePictureSlot,
  type LaneRowLayout,
} from "./virtual-strip-lanes";

// 1D roving navigation: Left/Right step one item, Home/End jump to the ends.
// Used when the strip has no lane rows; `resolveLaneStripIndex` takes over
// when it does, and reduces to exactly this for a single row.
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
// of arbitrarily large collections. Cards render through the item-shell
// resolution (per-view `itemShell` → registry `ItemShell` → NodeCard) —
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
//
// A press that belongs to a control INSIDE a card must not pan either: the
// compound primitives invite real interactive children (the graph's inline
// rename <input>, a consumer's custom widget), and a horizontal drag to
// select text in such a field would otherwise cross the pan slop, capture
// the pointer, and scroll the strip out from under the caret. The same
// editable/opted-out targets the keyboard delegation defers to (inputs,
// contenteditable, and anything marked data-collections-keyboard-ignore —
// e.g. the graph's drill button) own their pointer gestures too.
//
// TRIM HANDLES PAN TOO, and that is the whole point of them being here. They
// used to be excluded alongside the grip bars, which made an 8px band at every
// clip edge — 16px at every cut, where two clips sit flush — a place where a
// pan silently became an edit. Now both gestures arm on the same press and the
// trim yields unless it settles (see `trimArmDelayFor`); the pan learns the
// outcome through `isGestureClaimed` below.
const isPannableStripSurface = (target: Element): boolean =>
  !target.closest("[data-drag-handle], [data-trim-overview]") &&
  !isEditableKeyboardTarget(target);
const STRIP_PAN_DISABLED: PanWithMomentumOptions = { disabled: true };

// Gap between the floating overview tooltip and the top of the strip.
const OVERVIEW_GAP = 8;

/** How close (in px) a dragged clip has to be to a cut before it snaps to it. */
const SNAP_THRESHOLD_PX = 8;

/**
 * One row registered as a drop target that resolves to a LANE and a TIME.
 *
 * A component rather than a loop of hooks: the row count changes with the
 * data, and `useDroppable` cannot be called conditionally. Each row owns its
 * own registration and hands the provider a resolver, exactly as the strip
 * container does for boundary indices.
 */
function LaneRowDroppable({
  collectionId,
  lane,
  resolveTime,
  style,
  children,
  ...rest
}: Readonly<{
  collectionId: NodeId;
  lane: number;
  resolveTime: (point: Readonly<{ x: number; y: number }>) => number;
  style: CSSProperties;
  /** Optional: the new-lane target is an empty band, not a row of cards. */
  children?: ReactNode;
}> &
  Readonly<Record<string, unknown>>) {
  // Read through a ref so the droppable's data closure never goes stale as the
  // layout changes mid-drag — the same indirection the container droppable's
  // `resolveBoundary` uses.
  const resolveRef = useRef(resolveTime);
  resolveRef.current = resolveTime;
  const { setNodeRef } = useDroppable({
    id: `vlane:${collectionId}:${lane}`,
    data: {
      [VIRTUAL_PLACE_DATA_KEY]: {
        collectionId,
        lane,
        resolveTime: (point) => resolveRef.current(point),
      } satisfies VirtualPlaceTarget,
    },
  });
  return (
    <div ref={setNodeRef} style={style} {...rest}>
      {children}
    </div>
  );
}

// A lane row draws as a slim band under the picture — the editor idiom, where
// a bed or a voiceover must not compete with the shots for height. A fraction
// rather than a fixed size so every item size gets a proportionate row, with a
// floor so the smallest board still has something clickable.
const LANE_ROW_HEIGHT_FRACTION = 1 / 3;
const MIN_LANE_ROW_HEIGHT = 16;
const DEFAULT_LANE_ROW_GAP = 6;

// Layering inside the strip content: drop indicator and trim-handle hit
// zones sit at z-20, the default trim-preview bubble at z-30; the consumer
// overlay shares the bubble tier — above cards and handles, below nothing.
const OVERLAY_Z_INDEX = 30;

/** A slot on the consumer's clock. Times are the CONSUMER'S, not the strip's
 *  — see `itemTimes`. */
export type StripTimedSlot = Readonly<{
  startSeconds: number;
  durationSeconds: number;
}>;

/** One card on a lane row. */
export type StripLayerItem = StripTimedSlot & Readonly<{ id: NodeId }>;

/**
 * A LANE ROW — content that plays *alongside* the picture rather than after
 * it: a music bed, a voiceover. Drawn as its own row under the picture,
 * time-aligned to it, so a bed under shots 1-3 visibly spans those cards.
 *
 * Layer cards are NOT virtualized. They are few and long where shots are many
 * and short, so the case virtualization exists for does not apply, and leaving
 * them out keeps the picture virtualizer's index space intact.
 */
export type StripLayer = Readonly<{
  items: readonly StripLayerItem[];
}>;

export type VirtualStripProps = Readonly<{
  collectionId: NodeId;
  /**
   * Render THESE nodes instead of `collectionId`'s own children — the seam for
   * a FLAT strip, which shows a whole closure's media in playback order and so
   * spans many parents.
   *
   * `collectionId` still identifies the VIEW (its DOM marker, its accessible
   * name, its insert-container key): a flat strip still belongs to the
   * collection it was opened from. Only the item SOURCE changes.
   *
   * Caller owns reference stability — the virtualizer keys its measurements off
   * this array, so a new array every render re-measures the whole strip. Memoize
   * on the committed graph, as the store's own selectors do.
   *
   * CALLER OWNS INDEX MEANING TOO. Boundaries this strip publishes are indices
   * into THIS list, and the drop intent still names `collectionId` — so a
   * consumer that allows drops must translate (flat boundary → real parent +
   * index) before the command commits, or items land at the wrong index in the
   * wrong collection. The graph view vetoes position-based commands in flat
   * mode for exactly this reason.
   */
  itemIds?: readonly NodeId[];
  /**
   * THE timeline scale: media card widths derive from their effective
   * duration via `durationToWidth(seconds, pixelsPerSecond)`, and — unless
   * `trimPixelsPerSecond` overrides it — the trim handles convert drags at
   * the same scale, so widths and trims cannot drift apart. Collections
   * (and non-media fallbacks) use `itemWidth`. The recommended way to size
   * a duration-mapped strip; `itemWidthFor` remains the advanced override.
   */
  pixelsPerSecond?: number;
  /** Card width when duration-derived sizing doesn't apply: collections,
   *  strips without `pixelsPerSecond`/`itemWidthFor`, or an `itemWidthFor`
   *  miss. */
  itemWidth?: number;
  /**
   * ADVANCED per-node width from metadata (aspect ratio, user data...) —
   * overrides `pixelsPerSecond` sizing when both are set; keep the two on
   * the same scale or trims will resize cards by a different amount than
   * the drag. Evaluated lazily per index — never by rendering the node. The
   * virtualizer memoizes its measurements (keyed by the stable `getItemKey`),
   * so this runs once per layout, not once per render. After metadata loads
   * or zoom/scale changes, call `remeasure()` on the handle to recompute.
   */
  itemWidthFor?: (node: CollectionItemNode) => number | undefined;
  itemHeight?: number;
  /**
   * Rendered in a slot AFTER the last card, at the content's true end, so it
   * scrolls with the strip rather than hovering over it. The seam for an
   * "add one here" affordance without the surface having to know what
   * adding means.
   *
   * NOT AN ITEM. It sits past `getTotalSize()`, which is what every
   * boundary, model, and roving-focus calculation is built on, so nothing
   * counts it and a drop at the end still lands after the last real card.
   */
  trailingSlot?: ReactNode;
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
   * Override the trim handles' pixels-per-second conversion. Defaults to
   * `pixelsPerSecond`, which is almost always what you want (one scale for
   * widths AND trims); set explicitly only with a custom `itemWidthFor`
   * whose scale differs. Trim handles render when either is set.
   */
  trimPixelsPerSecond?: number;
  /**
   * The floating source-window overview above a selected video: "auto"
   * (default) is the behavior described on `TrimOverviewStrip` — the source
   * at timeline scale, laid over the clip. "off" suppresses it entirely, for
   * consumers that present the source window themselves (the graph view puts
   * a FITTED one inside its trim panel, alongside the live frame, because at
   * timeline scale a long source is wider than any viewport).
   */
  trimOverview?: "auto" | "off";
  /** Per-view card pixels — overrides the provider `components` registry.
   *  MUST be identity-stable (module scope). */
  itemContent?: CollectionItemContentComponent;
  /**
   * Per-view item SHELL — replaces the whole per-item renderer (NodeCard by
   * default; registry `ItemShell` sits between). The seam for items that
   * need legally interactive controls: compose them with the CollectionItem
   * primitives as SIBLINGS of the selection surface. MUST be identity-stable
   * (module scope). Receives exactly NodeCard's props.
   */
  itemShell?: CollectionItemShellComponent;
  /**
   * STRICTLY PRESENTATIONAL content rendered in CONTENT coordinates over the
   * whole strip (inside an `aria-hidden`, `pointer-events: none` layer above
   * the cards), so it rides scrolling, auto-scroll, and the live-trim
   * transform for free — a playhead line, region markers. Position children
   * absolutely; convert time to x with `timeToOffset`/`durationToWidth`.
   * NO interactive or focusable elements: the layer is hidden from assistive
   * technology, and a focusable child inside `aria-hidden` is an a11y
   * violation (focusable-but-invisible to AT). An interactive scrubber
   * belongs in your own positioned layer OUTSIDE the strip.
   */
  overlay?: ReactNode;
  /**
   * THE CONSUMER'S CLOCK for the rendered items, aligned 1:1 by index with
   * `itemIds` (or the collection's own children). Required by `layers`, and
   * ignored without them.
   *
   * The strip cannot derive this. Its own notion of duration knows nothing
   * about the inter-clip gap a document packs with, nor about the span a
   * collection card stands for, so a clock derived from widths would drift by
   * one gap per gutter — a few pixels per card, and a lane row visibly sliding
   * off the shots it covers by the tenth one. The consumer already knows the
   * real times; it hands them over and the strip pairs them with the widths it
   * measured.
   *
   * Caller owns reference stability, as with `itemIds`.
   */
  itemTimes?: readonly StripTimedSlot[];
  /**
   * Rows drawn UNDER the picture, time-aligned to it — see `StripLayer`.
   * Requires `itemTimes`; without it there is no clock to align against and
   * layers are ignored.
   *
   * A strip with no layers renders exactly as it did before they existed:
   * every path below is gated, down to the DOM.
   *
   * NOTE cross-lane DRAG is not modelled here. Layer cards drag like any
   * other card and their drops resolve through the same container droppable,
   * so a drop reorders within the collection and leaves the lane alone.
   * Moving a card BETWEEN lanes is the consumer's own write (the lane is
   * consumer data — this package's engine does not model it).
   */
  layers?: readonly StripLayer[];
  /** Height of each lane row. Shorter than `itemHeight` by default — a bed
   *  reads as a slim band under full-height shots. */
  layerHeight?: number;
  /** Vertical gap above each lane row. */
  layerGap?: number;
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
      itemIds,
      pixelsPerSecond: pixelsPerSecondOption,
      itemWidth: itemWidthOption,
      itemWidthFor,
      itemHeight: itemHeightOption,
      trailingSlot,
      gap: gapOption,
      overscan: overscanOption,
      panToScroll = true,
      itemDragActivation = "handle",
      trimPixelsPerSecond: trimPixelsPerSecondOption,
      trimOverview = "auto",
      itemContent,
      itemShell,
      overlay,
      itemTimes,
      layers,
      layerHeight: layerHeightOption,
      layerGap: layerGapOption,
      className,
    },
    ref
  ) {
    const pixelsPerSecond = finitePositiveOrUndefined(pixelsPerSecondOption);
    const itemWidth = finitePositiveOr(itemWidthOption, 128);
    const itemHeight = finitePositiveOr(itemHeightOption, 96);
    const gap = finiteNonNegativeOr(gapOption, 8);
    // Lane rows need a clock to align against; without one they cannot be
    // placed, so they are ignored rather than guessed at. This single flag
    // gates every lane path, including the DOM shape.
    const laneRows = layers !== undefined && layers.length > 0 && itemTimes !== undefined
      ? layers
      : null;
    // The MACHINERY — the time map and the placement droppables — is separate
    // from the visible ROWS, and it has to be, or lanes are a dead end: with
    // no lane yet there is no row, with no row there is nowhere to drop, and
    // the first lane could only ever be made by a tool call. A consumer that
    // supplies a clock is opting into placement whether or not anything is
    // layered yet.
    const canPlace = itemTimes !== undefined && layers !== undefined;
    const layerHeight = finitePositiveOr(
      layerHeightOption,
      Math.max(MIN_LANE_ROW_HEIGHT, itemHeight * LANE_ROW_HEIGHT_FRACTION),
    );
    const layerGap = finiteNonNegativeOr(layerGapOption, DEFAULT_LANE_ROW_GAP);
    const overscan = nonNegativeIntegerOr(overscanOption, 4);
    // One scale for widths AND trims by default: the handles inherit
    // pixelsPerSecond unless explicitly overridden.
    const trimPixelsPerSecond =
      finitePositiveOrUndefined(trimPixelsPerSecondOption) ?? pixelsPerSecond;
    const store = useCollectionsStore();
    const cardActivation: NodeCardDragActivation = panToScroll ? itemDragActivation : "body";
    // The per-item renderer: per-view override → provider registry → NodeCard.
    const registeredShell = useCollectionsComponents().ItemShell;
    const ItemShell: CollectionItemShellComponent = itemShell ?? registeredShell ?? NodeCard;

    // Stable array reference between commits — the virtualizer's item keys
    // and index math stay coherent across drags for free. An `itemIds`
    // override (flat strip) supplies its own list and owns that stability.
    const ownChildIds = useCollectionsSelector((s) => getChildren(s.graph, collectionId));
    const childIds = itemIds ?? ownChildIds;
    const indexById = useMemo(
      () => new Map(childIds.map((id, index) => [id, index])),
      [childIds]
    );
    // Data-change subscriptions, deliberately NOT `s.graph.nodesById`: the
    // map's identity changes on every data commit ANYWHERE (trim, rename,
    // undo/redo), so subscribing to it re-rendered every mounted strip for
    // one clip's trim. (The old comment here — "never re-allocated by moves,
    // so this subscription is inert" — was true and beside the point: moves
    // were never the cost.) The per-parent version bumps only for THIS
    // collection's children plus its own hydration; the generation bumps
    // only on a wholesale `replaceGraph`. Both are primitives. The map
    // itself is read imperatively below — any change that matters to this
    // strip re-renders it through one of these two or the childIds identity.
    const dataVersion = useCollectionsSelector(
      (s) => s.dataVersionByParent.get(collectionId) ?? 0
    );
    const graphGeneration = useCollectionsSelector((s) => s.graphGeneration);
    const nodesById = store.getSnapshot().graph.nodesById;
    // The selected video (if any) drives the TrimOverview band above the row.
    // Scoped to THIS collection's own children: only the strip that owns the
    // selected clip can show its trim overview, so a selection anywhere else in
    // the graph leaves this selector returning null and Object.is bails the
    // re-render. (Unscoped, it returned the first selected video ANYWHERE, so
    // every mounted strip received the same node and re-rendered on any video
    // selection — even though only one strip could ever display it.)
    // Membership, not parentage, when an item source is supplied: a flat
    // strip's cards live under many parents, so the parent test would reject
    // every one of them and the trim overview would never appear.
    const shownIds = useMemo(
      () => (itemIds ? new Set<NodeId>(itemIds) : null),
      [itemIds],
    );
    // The item source as the change-feed subscriber sees it (see its own note).
    // Written in an EFFECT, not during render — a render-time ref write is a
    // lint error in this repo. One commit of lag is harmless here: the
    // subscriber only uses it for `nodes-updated`, whose membership and order
    // are identical in the previous list by definition.
    const shownIdsRef = useRef<readonly NodeId[] | null>(null);
    useEffect(() => {
      shownIdsRef.current = itemIds ?? null;
    }, [itemIds]);
    const selectedVideo = useCollectionsSelector((s) => {
      for (const id of s.interaction.selectedIds) {
        if (shownIds ? !shownIds.has(id) : s.graph.parentById.get(id) !== collectionId) continue;
        const n = s.graph.nodesById.get(id);
        if (n && isVideoMedia(n)) return n;
      }
      return null;
    });

    const { scrollRef, contentRef, resolveBoundaryRef, setContainerRef } =
      useVirtualInsertContainer(collectionId, "vstrip");

    // The committed width of a node, floored at a clickable minimum: a fully
    // trimmed clip derives a 0px width, and NodeCard's w-full would then
    // render it 0px wide and unselectable. estimateSize, the rendered slot,
    // and the targeted-resize subscriber all read this, so layout stays
    // consistent; the node's semantic duration is untouched. Resolution:
    // itemWidthFor (advanced override) → pixelsPerSecond duration mapping
    // (media only) → the fixed itemWidth.
    const widthForNode = (node: CollectionItemNode | undefined): number => {
      if (node && itemWidthFor) {
        return Math.max(MIN_ITEM_WIDTH, finiteNonNegativeOr(itemWidthFor(node), itemWidth));
      }
      if (node && node.kind === "media" && pixelsPerSecond !== undefined) {
        return durationToWidth(mediaDurationSeconds(node), pixelsPerSecond);
      }
      return Math.max(MIN_ITEM_WIDTH, itemWidth);
    };
    const widthForIndex = (index: number): number => {
      const childId = childIds[index];
      // An out-of-range estimate falls back to the same minimum an unknown node
      // gets — the virtualizer asks about indexes around the edges of its
      // window, so this is a normal question, not an error.
      return widthForNode(childId === undefined ? undefined : nodesById.get(childId));
    };

    // The LIVE slot size for a mid-gesture trim, routed through the SAME
    // width resolution as the committed layout by synthesizing a node that
    // carries the live trim values. This is what makes "the last preview
    // equals the committed size" hold for ANY consumer mapping — a custom
    // `itemWidthFor` floor or nonlinear scale would otherwise drift from a
    // raw seconds*pps preview and snap on release (the MIN_ITEM_WIDTH bug
    // class, one level up). Corollary: a FIXED-width strip's card keeps its
    // width during a trim (data changes, geometry doesn't) instead of
    // resizing live and snapping back at commit.
    const previewSlotSize = (nodeId: NodeId, live: LiveTrim): number => {
      const node = nodesById.get(nodeId);
      if (node && node.kind === "media") {
        // Windowed kinds preview by their trims; an image previews by its
        // duration. Keyed on hasSourceWindow so an audio node is not handed a
        // `durationSeconds` field it does not have.
        const previewNode: CollectionItemNode = hasSourceWindow(node)
          ? { ...node, trimInSeconds: live.trimInSeconds, trimOutSeconds: live.trimOutSeconds }
          : { ...node, durationSeconds: live.effectiveSeconds };
        return widthForNode(previewNode) + gap;
      }
      // Trims only exist on media; mirror the raw conversion as a safety net.
      return slotSizeFor(live.effectiveSeconds, trimPixelsPerSecond ?? 0, gap);
    };

    // Stable keys by node id (reorders move DOM nodes instead of repainting
    // every slot's contents) AND a stable callback identity: TanStack
    // memoizes its measurements array on getItemKey's IDENTITY, so an inline
    // closure here would rebuild all N measurements — re-running
    // itemWidthFor for every item — on every render, e.g. once per indicator
    // move during a drag (WidthCallbackColdDuringDrag pins this).
    // Falls back to the INDEX rather than returning undefined: the virtualizer
    // memoizes measurements by this key, and an undefined key would collapse
    // every out-of-range probe onto one entry. The index is unique and stable
    // for the render where the id is momentarily missing.
    const getItemKey = useCallback(
      (index: number) => childIds[index] ?? index,
      [childIds],
    );

    // The FIRST item is the one case that can't reveal its overview's
    // trimmed-in room by scrolling: its offset is 0 with no content (and no
    // scroll room) to its left, so the room would render left of the origin
    // and be clipped. When a trimmed video is selected AT index 0, reserve a
    // leading gutter (its committed trim-in, in px) so the room fits inside
    // the scrollable area — the first clip insets by that much and the room
    // fills the space above it. It's transient: present only while that first
    // item is selected (the overview is selection-gated too), so the strip is
    // undisturbed at rest. Uses the COMMITTED trim-in (not the live drag
    // value) so it changes at selection/commit cadence, never per frame.
    const firstItemGutter =
      trimPixelsPerSecond !== undefined &&
      selectedVideo !== null &&
      childIds[0] === selectedVideo.id
        ? Math.max(0, selectedVideo.trimInSeconds * trimPixelsPerSecond)
        : 0;

    const virtualizer = useVirtualizer({
      count: childIds.length,
      getScrollElement: () => scrollRef.current,
      // Lazy per-index width from graph metadata — no DOM render is ever
      // needed to know the strip's layout.
      estimateSize: (index) => widthForIndex(index) + gap,
      horizontal: true,
      overscan,
      getItemKey,
      // Space before the first item; item offsets, total size, boundary math,
      // and the overview anchor (all keyed off `item.start`) shift with it.
      paddingStart: firstItemGutter,
    });

    // Data-derived sizing reconciles at COMMIT cadence through the store's
    // change feed: a `nodes-updated` patch names exactly the nodes whose
    // widths may have changed (trim commit/undo/redo, keyboard trim), so
    // only THOSE slots are resized — never a full re-measure. Moves, adds,
    // and removals need nothing: TanStack's measurement cache is keyed by
    // `getItemKey` (node id), so sizes follow reorders and new keys measure
    // fresh. The feed fires synchronously during dispatch, before React
    // renders, so `trimStateRef` still holds the pre-commit indexes (which
    // updates don't change) while `update.after` carries the NEW node.
    const sizingFromData =
      itemWidthFor !== undefined ||
      pixelsPerSecond !== undefined ||
      trimPixelsPerSecond !== undefined;
    const feedNodesRef = useRef<CollectionsGraph["nodesById"] | null>(null);
    useEffect(() => {
      if (!sizingFromData) return;
      return store.subscribeToChanges((change) => {
        feedNodesRef.current = change.graph.nodesById;
        if (change.patch.type !== "nodes-updated") return;
        const s = trimStateRef.current;
        // Index derived from the CHANGE's own graph, never a render-time
        // cache: the store supports reentrant dispatch, and queued changes
        // flush in order — a listener dispatching a MOVE before this update
        // drains would make any cached index stale. O(children) per update,
        // at commit cadence.
        // A supplied item source cannot be re-derived from the change's graph
        // (only the consumer knows how the list was built), so it is read from
        // a ref instead. Safe here specifically: `nodes-updated` is a DATA
        // patch — a trim or a rename — which never changes membership or
        // order, so the list this strip last rendered is still the one whose
        // indices these updates address. Structural patches take the
        // childIds-identity path above, not this one.
        const children = shownIdsRef.current ?? change.graph.childrenById.get(collectionId);
        if (!children) return;
        for (const update of change.patch.updates) {
          const index = children.indexOf(update.nodeId);
          if (index === -1) continue;
          s.virtualizer.resizeItem(index, s.widthForNode(update.after) + s.gap);
        }
      });
    }, [store, sizingFromData, collectionId]);
    // replaceGraph and hydrate deliberately emit NO change event: a nodesById
    // identity the feed never saw is data that arrived outside the command
    // pipeline, and surviving ids may carry stale key-based sizes — drop the
    // whole measurement cache. The mount run only SEEDS the baseline (the
    // initial layout measures itself). Keyed on the narrowed signals (this
    // collection's data version + the graph generation) rather than the map:
    // the inner identity compare is unchanged, only WHEN it runs narrowed —
    // an unrelated collection's hydration used to run this in every mounted
    // strip just to conclude "nothing to do".
    useEffect(() => {
      if (!sizingFromData) return;
      const currentNodes = store.getSnapshot().graph.nodesById;
      if (feedNodesRef.current === null || feedNodesRef.current === currentNodes) {
        feedNodesRef.current = currentNodes;
        return;
      }
      feedNodesRef.current = currentNodes;
      virtualizer.measure();
    }, [dataVersion, graphGeneration, store, sizingFromData, virtualizer]);
    // A scale/layout config change re-derives every width (mount run skipped
    // for the same reason).
    const configMeasuredRef = useRef(false);
    useEffect(() => {
      if (!configMeasuredRef.current) {
        configMeasuredRef.current = true;
        return;
      }
      virtualizer.measure();
    }, [pixelsPerSecond, itemWidth, gap, virtualizer]);

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
    const trimStateRef = useRef({
      indexById,
      virtualizer,
      gap,
      widthForIndex,
      widthForNode,
      previewSlotSize,
      nodesById,
    });
    trimStateRef.current = {
      indexById,
      virtualizer,
      gap,
      widthForIndex,
      widthForNode,
      previewSlotSize,
      nodesById,
    };
    const [liveTrim, setLiveTrim] = useState<{ nodeId: NodeId; trim: LiveTrim } | null>(null);
    // The COMMITTED node the live gesture started from. The commit effect
    // below uses it to tell this gesture's own settling commit (the node's
    // identity changed) from an UNRELATED commit landing mid-drag (identity
    // preserved by structural sharing) — converting the anchor transform on
    // an unrelated commit would double-compensate once the still-live drag
    // re-applies it, displacing the strip.
    const gestureNodeRef = useRef<{ nodeId: NodeId; node: CollectionItemNode | null } | null>(null);
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
      const index = s.indexById.get(nodeId) ?? -1;

      // A LANE CARD IS NOT IN THE VIRTUALIZER'S INDEX SPACE. Layer cards are
      // deliberately not virtualized (see `StripLayer`), so `indexById` — built
      // from the picture row's `childIds` — does not know them, and this used
      // to fall into the abort branch below on every pointer move. The trim
      // still committed correctly on release, so the gesture LOOKED wired: you
      // dragged a handle, nothing moved, and the card jumped when you let go.
      //
      // It has no virtualizer slot to resize, so its live width comes from
      // `layerPlacements` reading `liveTrim` instead. Everything else — the
      // duration readout, the commit effect's gesture identity — is the same.
      if (live !== null && index === -1) {
        if (gestureNodeRef.current?.nodeId !== nodeId) {
          gestureNodeRef.current = { nodeId, node: s.nodesById.get(nodeId) ?? null };
        }
        setLiveTrim({ nodeId, trim: live });
        return;
      }

      if (live === null || index === -1) {
        // Abort/no-op: snap the item back to its committed size; clearing the
        // live split resets the anchor transform to 0 (scroll untouched, so
        // the content returns to where it started).
        if (index !== -1) s.virtualizer.resizeItem(index, s.widthForIndex(index) + s.gap);
        trimBaselineRef.current = null;
        gestureNodeRef.current = null;
        setLiveTrim(null);
        return;
      }

      // Remember which committed node this gesture is trimming (once per
      // gesture — the identity can't change mid-gesture except by the very
      // commits the effect below needs to distinguish).
      if (gestureNodeRef.current?.nodeId !== nodeId) {
        gestureNodeRef.current = { nodeId, node: s.nodesById.get(nodeId) ?? null };
      }

      // Capture the pre-drag slot size once, for a left-handle drag on a
      // non-first item (index 0 has no left room, so it keeps grow-right).
      if (live.side === "left" && index > 0 && trimBaselineRef.current?.nodeId !== nodeId) {
        trimBaselineRef.current = { nodeId, size0: s.widthForIndex(index) + s.gap };
      }

      setLiveTrim({ nodeId, trim: live });
      // Crisp width via resizeItem (grows/shrinks rightward), through the
      // SAME width resolution as the committed layout. The right-edge
      // anchor is a composited transform derived during render, applied in
      // the SAME commit as this resize (atomic — no stutter).
      s.virtualizer.resizeItem(index, s.previewSlotSize(nodeId, live));
    }, []);
    const trimPreview = useMemo<TrimPreview>(() => ({ previewTrim }), [previewTrim]);

    // On a data COMMIT in THIS collection (trim release, undo/redo, rename;
    // never a move/drag) convert the drag's anchor transform into a real
    // scroll, so clearing the transform below doesn't jump the anchored
    // clip. Where scrollLeft has no room (a clip near the strip start), this
    // clamps and the final position snaps by the shortfall — the known limit
    // of native-scroll anchoring; the DRAG itself stayed consistent because a
    // transform isn't clamped.
    useEffect(() => {
      // A commit to a DIFFERENT card mid-gesture (e.g. a keyboard trim on a
      // sibling) must not settle this gesture: the trimmed node's identity
      // is preserved by structural sharing, the drag stays live, and
      // converting the transform now would double-compensate — the next
      // pointer move re-applies the transform with no offsetting scroll, and
      // the release converts it again, leaving the strip displaced. The
      // gesture's own settling commits (its release, a same-node keyboard
      // trim, undo) always change the node's identity and fall through.
      // Commits in OTHER collections no longer even run this effect (the
      // narrowed keys) — they always hit this early-return before.
      // (liveTrim is read from this commit's render on purpose — adding it to
      // the deps would run the conversion on every preview move.)
      const gesture = gestureNodeRef.current;
      if (
        liveTrim &&
        gesture?.nodeId === liveTrim.nodeId &&
        store.getSnapshot().graph.nodesById.get(liveTrim.nodeId) === gesture.node
      ) {
        return;
      }
      const shift = dragShiftRef.current;
      if (shift !== 0 && scrollRef.current) scrollRef.current.scrollLeft -= shift;
      dragShiftRef.current = 0;
      trimBaselineRef.current = null;
      gestureNodeRef.current = null;
      setLiveTrim(null);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- liveTrim intentionally omitted (see comment)
    }, [dataVersion, graphGeneration, store, scrollRef]);

    // --- lane rows ---------------------------------------------------------

    // The picture row's time -> content-x map, paired from what the strip
    // MEASURED (x, so an itemWidthFor override and a live trim are included)
    // and what the consumer's clock says (t). Only walked when there are
    // lanes to place: a strip without them never runs any of this.
    //
    // Mid-trim it follows the LIVE x's, so a bed stays attached to the shots
    // it covers while one of them is being trimmed, and the trimmed slot takes
    // the gesture's live duration so its interior stays self-consistent. Slots
    // AFTER it keep their committed start times — only the consumer knows how
    // it repacks — so a layer card downstream of a live trim lags by the trim
    // delta until the commit lands. Sub-second, and exact from then on.
    const laneTimeMap = useMemo(() => {
      if (!canPlace || !itemTimes) return null;
      const slots: LanePictureSlot[] = [];
      let x = firstItemGutter;
      for (let index = 0; index < childIds.length; index += 1) {
        const childId = childIds[index];
        const time = itemTimes[index];
        const live =
          childId !== undefined && liveTrim?.nodeId === childId ? liveTrim.trim : null;
        // Mirrors estimateSize exactly (with resizeItem's override applied for
        // the trimmed slot), which IS the virtualizer's layout — the strip
        // never dynamically measures a card.
        const size =
          live && childId !== undefined
            ? previewSlotSize(childId, live)
            : widthForIndex(index) + gap;
        if (time) {
          slots.push({
            left: x,
            width: size - gap,
            startSeconds: time.startSeconds,
            durationSeconds: live ? live.effectiveSeconds : time.durationSeconds,
          });
        }
        x += size;
      }
      return createLaneTimeMap(slots);
      // widthForIndex/previewSlotSize are re-created every render by design;
      // the graph data they read is covered by dataVersion/graphGeneration,
      // and the layout inputs are listed explicitly. When this memo does re-run
      // it closes over the current render's functions, so it cannot go stale.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
    }, [
      canPlace,
      itemTimes,
      childIds,
      firstItemGutter,
      gap,
      liveTrim,
      dataVersion,
      graphGeneration,
      pixelsPerSecond,
      itemWidth,
      itemWidthFor,
    ]);

    // Read imperatively by the drop resolver, which runs on dnd-kit's collision
    // cadence rather than React's — a closure captured at render would be a
    // frame behind the layout it is measuring against.
    const laneMapRef = useRef(laneTimeMap);
    laneMapRef.current = laneTimeMap;

    // Every layer card's box, plus the furthest right edge any of them reach —
    // the spacer has to cover a bed that outlasts the picture.
    // The picture row gets its live trim width from `virtualizer.resizeItem`;
    // a lane card has no slot to resize, so ITS live width is applied here.
    //
    // Only the DURATION moves. A lane clip is pinned by its placed start, so
    // trimming either edge holds the left and shrinks the width — measured,
    // both sides, and the same on commit. That is what keeps this preview
    // equal to the commit outcome, which the package requires of every
    // preview.
    const layerPlacements = useMemo(() => {
      const byId = new Map<NodeId, Readonly<{ left: number; width: number }>>();
      let right = 0;
      if (laneRows && laneTimeMap) {
        for (const layer of laneRows) {
          for (const item of layer.items) {
            const placement = laneItemPlacement(
              laneTimeMap,
              liveTrim?.nodeId === item.id
                ? { ...item, durationSeconds: liveTrim.trim.effectiveSeconds }
                : item,
            );
            byId.set(item.id, placement);
            right = Math.max(right, placement.left + placement.width);
          }
        }
      }
      return { byId, right };
    }, [laneRows, laneTimeMap, liveTrim]);

    // What snapping measures against: the picture's cuts, each lane's own
    // clips, and which clip is being dragged (it must not snap to itself).
    const laneRowsRef = useRef<{
      picture: readonly StripTimedSlot[];
      byLane: Map<number, readonly StripLayerItem[]>;
      draggedId: string;
    }>({ picture: [], byLane: new Map(), draggedId: "" });
    const activeId = useCollectionsSelector((s) => s.interaction.activeIds[0] ?? null);
    laneRowsRef.current = {
      picture: itemTimes ?? [],
      byLane: new Map((laneRows ?? []).map((layer, index) => [index + 1, layer.items])),
      draggedId: (activeId as string | null) ?? "",
    };

    // The NEXT free lane, offered as a drop target while a node drag is live.
    // Only while dragging: at rest it would be a permanent empty band on every
    // board, which is a lot of chrome to carry for an occasional gesture.
    // Gated on a dragged NODE rather than `isDragging` alone — a palette drag
    // is creating something that does not exist yet, and a placement command
    // needs a node to name.
    const newLane = (laneRows?.length ?? 0) + 1;
    const showNewLaneRow = canPlace && activeId !== null;

    // Row 0 is the picture, then each layer in order — the shape the roving
    // resolver navigates. Empty without lanes, which is what keeps the plain
    // strip on its original 1D path.
    const rowLayout: LaneRowLayout = useMemo(
      () => (laneRows && itemTimes ? [itemTimes, ...laneRows.map((layer) => layer.items)] : []),
      [laneRows, itemTimes],
    );
    // Roving focus navigates ONE list spanning every row, so the grid keeps a
    // single tab stop. Deliberately separate from `indexById`, which stays the
    // PICTURE's index space — the virtualizer's resizeItem, the reorder no-op
    // test and scrollToIndex all address it and would be corrupted by layer
    // entries.
    const rovingIds = useMemo(
      () =>
        laneRows
          ? [...childIds, ...laneRows.flatMap((layer) => layer.items.map((item) => item.id))]
          : childIds,
      [laneRows, childIds],
    );
    const rovingIndexById = useMemo(
      () => (laneRows ? new Map(rovingIds.map((id, index) => [id, index])) : indexById),
      [laneRows, rovingIds, indexById],
    );

    // SHIFT places exactly, overriding the snap. Tracked here rather than read
    // off the drag event because dnd-kit's collision pass carries no
    // modifiers, and the user can press or release Shift mid-drag — the answer
    // has to be live at the moment the pointer moves, not at pick-up. Listeners
    // only exist while a drag does.
    const exactRef = useRef(false);
    const isDragging = useCollectionsSelector((s) => s.interaction.isDragging);
    useEffect(() => {
      if (!isDragging || !canPlace) return;
      const sync = (event: KeyboardEvent) => {
        exactRef.current = event.shiftKey;
      };
      window.addEventListener("keydown", sync);
      window.addEventListener("keyup", sync);
      return () => {
        exactRef.current = false;
        window.removeEventListener("keydown", sync);
        window.removeEventListener("keyup", sync);
      };
    }, [isDragging, canPlace]);

    // Pointer -> a start time on the CONSUMER'S clock, for one row.
    //
    // The dragged clip is placed by its LEFT EDGE, which is what the indicator
    // draws and what a user aims with — grabbing a bed in the middle and
    // dropping it should not bury its start half a card to the left.
    const resolveTimeFor = useCallback(
      (lane: number) => (point: VirtualViewPoint) => {
        const content = contentRef.current;
        const map = laneMapRef.current;
        if (!content || !map) return 0;
        const contentX = point.x - content.getBoundingClientRect().left;
        const raw = map.timeAt(contentX);
        if (exactRef.current) return raw;
        const rows = laneRowsRef.current;
        return snapToEdges(
          map,
          raw,
          snapEdgesFor(
            rows.picture,
            lane === 0 ? [] : (rows.byLane.get(lane) ?? []),
            rows.draggedId,
          ),
          SNAP_THRESHOLD_PX,
        );
      },
      [contentRef],
    );

    // Pointer -> visible boundary index from the virtualizer's measurements
    // (O(log n), variable widths included) — never from card rects, since
    // most cards aren't mounted. The spacer's rect shifts with scroll, so
    // measuring against it keeps intents live during (auto-)scroll too.
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
      const contentX = point.x - content.getBoundingClientRect().left;
      const totalSize = virtualizer.getTotalSize();
      // Only measure an item for an in-range pointer; the pure resolver applies
      // the same before-first / past-end clamps.
      const item =
        contentX > 0 && contentX < totalSize ? virtualizer.getVirtualItemForOffset(contentX) : null;
      return resolveBoundaryIndex(contentX, totalSize, childIds.length, item ?? null);
    };
    usePublishBoundary(resolveBoundaryRef, resolveBoundary);

    useEdgeAutoScroll(scrollRef, "x");
    const panOptions = useMemo<PanWithMomentumOptions>(
      () =>
        panToScroll
          ? {
              shouldStartPan: isPannableStripSurface,
              // Hold-to-drag can claim a press mid-slop; so can a trim handle
              // that settled long enough to arm. Either way the pan stands
              // down — it is the gesture that costs nothing to lose.
              isGestureClaimed: () =>
                store.getSnapshot().interaction.isDragging || isTrimGestureArmed(),
            }
          : STRIP_PAN_DISABLED,
      [panToScroll, store]
    );
    usePanWithMomentum(scrollRef, "x", panOptions);
    const backgroundClear = useBackgroundSelectionClear(store);

    const scrollToNode = useCallback(
      (id: NodeId): boolean => {
        const index = indexById.get(id);
        if (index !== undefined) {
          virtualizer.scrollToIndex(index);
          return true;
        }
        // A layer card. It is always mounted (lanes are not virtualized) but
        // can still be scrolled out of view, so bring its box inside by the
        // smallest move that does it — the virtualizer knows nothing about it.
        const placement = layerPlacements.byId.get(id);
        const scroller = scrollRef.current;
        if (!placement || !scroller) return false;
        const viewLeft = scroller.scrollLeft;
        const viewRight = viewLeft + scroller.clientWidth;
        if (placement.left < viewLeft) {
          scroller.scrollLeft = placement.left;
        } else if (placement.left + placement.width > viewRight) {
          scroller.scrollLeft = placement.left + placement.width - scroller.clientWidth;
        }
        return true;
      },
      [indexById, virtualizer, layerPlacements, scrollRef]
    );
    const focusNode = useFocusNode(scrollRef, scrollToNode);

    // Roving keyboard navigation (bare Left/Right/Home/End). The collection
    // name gives the grid an accessible name.
    const name = useCollectionsSelector(
      (s) => s.graph.nodesById.get(collectionId)?.name ?? String(collectionId)
    );
    const focusByIndex = useCallback(
      (index: number) => {
        // The roving index can outlive the list it points into for a render
        // after a removal; focusing nothing is the right answer there.
        const id = rovingIds[index];
        if (id !== undefined) focusNode(id);
      },
      [focusNode, rovingIds]
    );
    // 2D once there are lanes, and `resolveLaneStripIndex` reduces to exactly
    // the 1D behaviour for a single row — including leaving vertical arrows
    // alone, which is how the page scrolls with the pointer over a strip.
    const resolveNextIndex = useCallback(
      (key: string, current: number, count: number) =>
        rowLayout.length > 0
          ? resolveLaneStripIndex(key, current, rowLayout)
          : resolveStripIndex(key, current, count),
      [rowLayout]
    );
    const { focusedIndex, onKeyDown, onItemFocus } = useVirtualRovingFocus({
      itemIds: rovingIds,
      indexById: rovingIndexById,
      isDragging: () => store.getSnapshot().interaction.isDragging,
      focusByIndex,
      resolveNextIndex,
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
    // Keep the roving tab stop on a MOUNTED card: if the focused index scrolled
    // out of view (mouse/pan), fall back to the first mounted item so the strip
    // stays tabbable.
    //
    // With lanes the focused index is FLAT across rows, so it has to be
    // resolved to a row first: a focused LAYER card means no picture card is
    // the tab stop (-1 matches no index), and the layer cell claims it
    // instead. An index that resolves to no row at all (a render behind a
    // removal) falls back to the picture, so the grid never ends up with no
    // tab stop.
    const mountedItems = virtualizer.getVirtualItems();
    const focusedPosition = rowLayout.length > 0 ? laneRowPosition(focusedIndex, rowLayout) : null;
    const pictureFocusIndex =
      rowLayout.length === 0
        ? focusedIndex
        : focusedPosition === null
          ? 0
          : focusedPosition.row === 0
            ? focusedPosition.column
            : -1;
    const rovingIndex =
      pictureFocusIndex === -1
        ? -1
        : mountedItems.some((v) => v.index === pictureFocusIndex)
          ? pictureFocusIndex
          : mountedItems[0]?.index ?? 0;

    // The overview is a floating TOOLTIP above the selected clip — it does NOT
    // reserve a band in the row, so showing it never displaces the clips. To
    // float above without being clipped (the scroll container's overflow-x
    // clips y too), it's rendered OUTSIDE that container and positioned to
    // track the clip. Only render it while the clip is actually mounted.
    const selectedVideoIndex = selectedVideo ? (indexById.get(selectedVideo.id) ?? -1) : -1;
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
    const showOverview =
      trimOverview !== "off" &&
      selectedVideo !== null &&
      selectedVideoItem !== undefined &&
      !!overviewTrim &&
      trimPixelsPerSecond !== undefined;

    // Imperative positioner for the tooltip overlay. It reads the SELECTED
    // clip's live rect (which already reflects scroll + the live-drag
    // transform) and offsets left by the trim-in width, so the amber window
    // lands exactly on the clip's left edge — no coordinate math to keep in
    // sync. Kept in refs and driven from a layout effect (each render) and a
    // scroll listener, so it never needs a React re-render on scroll.
    const overlayRef = useRef<HTMLDivElement>(null);
    const stripWrapperRef = useRef<HTMLDivElement>(null);
    const overviewPosRef = useRef<{ id: NodeId; trimInPx: number } | null>(null);
    overviewPosRef.current =
      showOverview && selectedVideo && overviewTrim && trimPixelsPerSecond !== undefined
        ? { id: selectedVideo.id, trimInPx: overviewTrim.trimInSeconds * trimPixelsPerSecond }
        : null;
    const positionOverlay = useCallback(() => {
      const el = overlayRef.current;
      const wrap = stripWrapperRef.current;
      const sc = scrollRef.current;
      const info = overviewPosRef.current;
      if (!el || !wrap || !sc || !info) return;
      const clip = findNodeElement(sc, info.id);
      if (!clip) return;
      const x = clip.getBoundingClientRect().left - wrap.getBoundingClientRect().left - info.trimInPx;
      el.style.transform = `translateX(${x}px)`;
    }, [scrollRef]);
    // Reposition after every render (selection / trim / relayout), before paint.
    useLayoutEffect(() => {
      positionOverlay();
    });
    // Follow horizontal scroll without re-rendering (rAF-coalesced).
    useEffect(() => {
      const sc = scrollRef.current;
      if (!sc) return;
      let raf = 0;
      const onScroll = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          positionOverlay();
        });
      };
      sc.addEventListener("scroll", onScroll, { passive: true });
      return () => {
        sc.removeEventListener("scroll", onScroll);
        if (raf) cancelAnimationFrame(raf);
      };
    }, [scrollRef, positionOverlay]);

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
      // Same preview-width resolution as resizeItem, or the anchor transform
      // would cancel a different growth than the one that happened.
      const liveSlot = previewSlotSize(liveTrim.nodeId, liveTrim.trim);
      dragShiftX = leftAnchorShift(liveSlot, trimBaseline.size0);
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
      if (
        intent?.type !== "insert-at-index" ||
        intent.collectionId !== collectionId ||
        s.interaction.dropIntentInvalid
      ) {
        return null;
      }
      // Hide the indicator on a NO-OP: dragging items that already live in this
      // collection to a boundary that leaves them exactly where they are. Only
      // when they form a contiguous run wholly inside this collection — dropping
      // at any boundary from the run's start to just past its end is identity.
      // (A non-contiguous multi-drag reorders the items between them, so it is a
      // real move and keeps its indicator.)
      if (isContiguousReorderNoOp(indexById, s.interaction.activeIds, intent.index)) {
        return null;
      }
      return intent.index;
    });

    // A live PLACEMENT intent aimed at this strip: which row, and at what
    // time. Selected as primitives rather than the intent object so the
    // subscription compares by value — the intent is a fresh object on every
    // pointer move.
    const placingLane = useCollectionsSelector((s) => {
      const intent = s.interaction.dropIntent;
      return intent?.type === "place-at-time" &&
        intent.collectionId === collectionId &&
        !s.interaction.dropIntentInvalid
        ? intent.lane
        : null;
    });
    const placingStart = useCollectionsSelector((s) => {
      const intent = s.interaction.dropIntent;
      return intent?.type === "place-at-time" && intent.collectionId === collectionId
        ? intent.startSeconds
        : null;
    });

    // Boundary k's line sits in the gap before item k (measured offsets, so
    // variable widths align). Boundaries under the pointer are always near
    // the viewport, so the mounted-items lookup is sufficient; k === count
    // (append at the far end) falls back to the total size.
    const boundaryLeft = (k: number): number | null => {
      if (k >= childIds.length) {
        return indicatorLeftOffset(virtualizer.getTotalSize(), gap);
      }
      const item = virtualizer.getVirtualItems().find((v) => v.index === k);
      return item ? indicatorLeftOffset(item.start, gap) : null;
    };
    const indicatorLeft = indicatorIndex !== null ? boundaryLeft(indicatorIndex) : null;

    // The picture row's cells. Hoisted out of the tree because they render in
    // one of two places: directly in the spacer (no lanes — the spacer IS the
    // row, exactly as before lanes existed), or inside their own row element
    // when lane rows are siblings, since a row may not contain a row.
    const pictureCells = virtualizer.getVirtualItems().map((item) => {
      // Resolved ONCE per item. The virtualizer's window can lag a
      // removal by a render, so an index here is not guaranteed to
      // still name a child; skipping is the only correct answer, and
      // it keeps both reads below honest about it.
      const childId = childIds[item.index];
      if (childId === undefined) return null;
      return (
        <div
          key={item.key}
          data-virtual-index={item.index}
          role="gridcell"
          aria-colindex={item.index + 1}
          // Sync the roving index to whatever card actually gains focus
          // (click, programmatic focus), not just keyboard navigation.
          onFocus={() => onItemFocus(childId)}
          style={
            {
              position: "absolute",
              top: 0,
              left: 0,
              width: item.size - gap,
              height: itemHeight,
              transform: `translateX(${item.start}px)`,
              // Only the FIRST card's leading side is special: there
              // is no gap before it, and the scroll box clips anything
              // pulled out into the container's padding. Its trailing
              // side has an ordinary gap and gets the ordinary offset.
              "--dnd-drop-indicator-half-gap-before":
                item.index === 0 ? "0px" : `${gap / 2}px`,
              "--dnd-drop-indicator-half-gap-after": `${gap / 2}px`,
            } as CSSProperties
          }
        >
          {/* Explicit sizing: the item fills its (possibly variable) slot.
              With panToScroll, item drags move to the grip bar or behind
              a press-and-hold so the body is free to pan the strip. */}
          <ItemShell
            id={childId}
            className="h-full w-full"
            dragActivation={cardActivation}
            rovingTabIndex={item.index === rovingIndex ? 0 : -1}
            trimPixelsPerSecond={trimPixelsPerSecond}
            itemContent={itemContent}
          />
        </div>
      );
    });

    // Lane rows: real, focusable cards positioned by TIME rather than by the
    // virtualizer's sequence, so each one spans the picture it actually plays
    // under. They ride inside the content spacer, so scroll, auto-scroll and
    // the live-trim anchor transform all apply to them for free.
    const laneRowElements = laneRows?.map((layer, layerIndex) => {
      if (layer.items.length === 0) return null;
      const lane = layerIndex + 1;
      return (
        <LaneRowDroppable
          key={`lane-${layerIndex}`}
          collectionId={collectionId}
          lane={lane}
          resolveTime={resolveTimeFor(lane)}
          role="row"
          aria-rowindex={layerIndex + 2}
          data-strip-lane={lane}
          data-place-target={placingLane === lane ? "true" : undefined}
          // WHICH ROW the drop lands on. The time indicator runs the full
          // stack height so it cannot be hidden, which means it can no longer
          // say which lane on its own — this does.
          className={
            placingLane === lane ? "rounded-sm bg-primary/10 ring-1 ring-primary/50" : undefined
          }
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: laneRowTop(lane, itemHeight, layerHeight, layerGap),
            height: layerHeight,
          }}
        >
          {layer.items.map((item, column) => {
            const placement = layerPlacements.byId.get(item.id);
            if (!placement) return null;
            const flatIndex = laneFlatIndex(layerIndex + 1, column, rowLayout);
            return (
              <div
                key={item.id}
                role="gridcell"
                aria-colindex={column + 1}
                onFocus={() => onItemFocus(item.id)}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: placement.width,
                  height: layerHeight,
                  transform: `translateX(${placement.left}px)`,
                }}
              >
                <ItemShell
                  id={item.id}
                  className="h-full w-full"
                  dragActivation={cardActivation}
                  rovingTabIndex={flatIndex !== null && flatIndex === focusedIndex ? 0 : -1}
                  trimPixelsPerSecond={trimPixelsPerSecond}
                  itemContent={itemContent}
                />
              </div>
            );
          })}
        </LaneRowDroppable>
      );
    });

    return (
      <TrimPreviewContext.Provider value={trimPreview}>
        {/* Wrapper so the overview tooltip can float ABOVE the strip without
            being clipped by the scroll container's overflow. */}
        <div ref={stripWrapperRef} className="relative">
          {showOverview && selectedVideo && overviewTrim && trimPixelsPerSecond !== undefined && (
            <div
              ref={overlayRef}
              // Floats above the strip; positioned horizontally by
              // positionOverlay (transform set imperatively). An overlay, so
              // it never displaces the clip row. z-50 so it floats above any
              // sticky chrome a consumer pins over the strip (e.g. the graph
              // board's z-40 header) rather than being clipped by it — unlike
              // the playhead/consumer overlay (z-30), which is MEANT to scroll
              // under that chrome.
              className="absolute left-0 z-50"
              style={{ bottom: `calc(100% + ${OVERVIEW_GAP}px)` }}
            >
              <TrimOverviewStrip
                node={selectedVideo}
                pixelsPerSecond={trimPixelsPerSecond}
                trimInSeconds={overviewTrim.trimInSeconds}
                trimOutSeconds={overviewTrim.trimOutSeconds}
              />
            </div>
          )}
          <div
            ref={setContainerRef}
            data-virtual-strip={collectionId}
            // Tells the trim gesture that a plain press here means PAN unless
            // it settles. Keyed off the same flag that installs the pan hook,
            // so a strip with panning off keeps instant trims.
            {...(panToScroll ? { [PAN_SURFACE_ATTR]: "" } : {})}
            // One-row grid: arrow keys rove across columns, and aria-colcount /
            // aria-colindex expose the true position ("column 500 of 1000") even
            // though only a handful of cells are mounted.
            role="grid"
            aria-label={`${name}, ${rovingIds.length} items`}
            // An empty strip has no rows (the spacer drops its row role too);
            // claiming rowcount 1 over an empty row is an invalid grid tree.
            // With lanes the picture is row 1 and each layer adds one under
            // it; a layer with nothing in it emits no row element, the same
            // way virtualization omits columns, so the indices stay stable.
            aria-rowcount={
              laneRows ? 1 + laneRows.length : childIds.length === 0 ? 0 : 1
            }
            aria-colcount={
              laneRows
                ? Math.max(childIds.length, ...laneRows.map((layer) => layer.items.length))
                : childIds.length
            }
            onKeyDown={onKeyDown}
            // Empty space is the "deselect" target. The pointerdown half only
            // records where the press started, so a PAN (which also ends in a
            // click here) can be told apart from a real background click.
            onPointerDown={backgroundClear.onPointerDown}
            onClick={backgroundClear.onClick}
            className={twMerge(
              "relative overflow-x-auto rounded-md border border-dashed border-border p-2",
              className,
            )}
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
              // Without lanes the spacer IS the one row. With them it becomes
              // the rows' container instead — a row may not contain a row —
              // and the picture gets its own row element below.
              {...(childIds.length > 0 && !laneRows
                ? { role: "row", "aria-rowindex": 1 }
                : {})}
              style={{
                // The slot's width is ADDED here and nowhere else: every
                // boundary and model reads `getTotalSize()`, which stays the
                // cards' own extent, so the slot cannot shift an index.
                //
                // A lane row can reach PAST the picture (a bed that outlasts
                // the last shot), so the spacer covers the furthest of the
                // two. Widening it does not move a boundary for the same
                // reason the trailing slot doesn't — boundaries read
                // getTotalSize(), not this.
                width: Math.max(
                  virtualizer.getTotalSize() + (trailingSlot ? itemWidth + gap : 0),
                  layerPlacements.right,
                ),
                // Grows to hold the new-lane row while one is offered. Rows
                // are positioned from the TOP, so nothing already on screen
                // moves — the strip just gets taller for the length of the
                // drag, which is also what makes room to aim at.
                height: laneStackHeight(
                  itemHeight,
                  layerHeight,
                  layerGap,
                  (laneRows?.length ?? 0) + (showNewLaneRow ? 1 : 0),
                ),
                position: "relative",
                // The left-handle "grows left" anchor (0 unless a left trim is
                // in flight). Shifts the whole content layer so clips move
                // together; the overview tooltip tracks the clip's rect, so it
                // follows for free.
                transform: dragShiftX ? `translateX(${dragShiftX}px)` : undefined,
              }}
            >
              {/* PLACEMENT preview. The insert indicator marks a boundary
                  between two cards; a placement has no boundary — it lands at
                  a moment on a row — so it draws where the clip's LEFT EDGE
                  will be, which is what the drop actually sets and what the
                  user is aiming. On the picture row it is a full-height bar,
                  because dropping there means "rejoin the cut" rather than
                  "land at this instant". */}
              {placingLane !== null && laneTimeMap !== null && (
                <div
                  aria-hidden="true"
                  data-place-indicator={placingLane}
                  // FULL HEIGHT, and thicker. Confined to its own row it was a
                  // 2px line directly under the drag ghost — which is centred
                  // on the pointer, so the one thing that shows you the snap
                  // was hidden by the thing you were dragging. Running the
                  // whole stack clears the ghost at top and bottom, and it
                  // reads against the picture, which is what a time is
                  // measured against. WHICH row is the row highlight's job.
                  className="pointer-events-none absolute inset-y-0 z-20 w-1 -translate-x-1/2 rounded-full bg-primary"
                  style={{
                    left: placingStart === null ? 0 : laneTimeMap.at(placingStart),
                  }}
                />
              )}
              {indicatorLeft !== null && (
                <div
                  aria-hidden="true"
                  data-drop-indicator="virtual"
                  className="pointer-events-none absolute inset-y-0 z-20 w-1 -translate-x-1/2 rounded-full bg-primary"
                  style={{ left: indicatorLeft }}
                />
              )}
              {laneRows && childIds.length > 0 ? (
                // A drop target too, so a layered clip dragged up here
                // rejoins the cut. It resolves to lane 0, which the command
                // resolver reads as "clear the placement" — the picture packs
                // from array order, so there is no time to land at.
                <LaneRowDroppable
                  collectionId={collectionId}
                  lane={0}
                  resolveTime={resolveTimeFor(0)}
                  role="row"
                  aria-rowindex={1}
                  data-strip-lane={0}
                  data-place-target={placingLane === 0 ? "true" : undefined}
                  className={
                    placingLane === 0 ? "rounded-sm bg-primary/10 ring-1 ring-primary/50" : undefined
                  }
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: 0,
                    height: itemHeight,
                  }}
                >
                  {pictureCells}
                </LaneRowDroppable>
              ) : (
                pictureCells
              )}
              {laneRowElements}
              {/* SOMEWHERE TO MAKE THE FIRST LANE. Without this the gesture
                  assumes a state only a tool call could produce: rows render
                  for occupied lanes, so with none there was nothing to drop
                  on. Dashed and unlabelled — it is a target, not content, and
                  it carries no cells, so it stays out of the grid tree. */}
              {showNewLaneRow && (
                <LaneRowDroppable
                  collectionId={collectionId}
                  lane={newLane}
                  resolveTime={resolveTimeFor(newLane)}
                  aria-hidden="true"
                  data-strip-new-lane={newLane}
                  data-place-target={placingLane === newLane ? "true" : undefined}
                  // At border/70 on a dark board this was a rectangle you
                  // could find once you knew it was there and would never
                  // discover. It is an invitation, so it looks like one — and
                  // it fills in when the drop would actually land on it.
                  className={
                    placingLane === newLane
                      ? "rounded-sm border-2 border-dashed border-primary bg-primary/15"
                      : "rounded-sm border-2 border-dashed border-muted-foreground/50"
                  }
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    top: laneRowTop(newLane, itemHeight, layerHeight, layerGap),
                    height: layerHeight,
                  }}
                />
              )}
              {trailingSlot && (
                <div
                  data-virtual-trailing-slot
                  style={{
                    position: "absolute",
                    top: 0,
                    left: virtualizer.getTotalSize(),
                    width: itemWidth,
                    height: itemHeight,
                  }}
                >
                  {trailingSlot}
                </div>
              )}
              {/* Consumer overlay (playhead, region markers) in CONTENT
                  coordinates: living inside the spacer means scroll,
                  auto-scroll, and the live-trim anchor transform all apply
                  for free. pointer-events: none so pan/drag/trim gestures
                  pass through; aria-hidden keeps the grid tree valid —
                  which is why the slot is PRESENTATIONAL ONLY (a focusable
                  child inside aria-hidden would be reachable by keyboard
                  yet invisible to assistive technology). */}
              {overlay != null && (
                <div
                  aria-hidden="true"
                  data-virtual-overlay
                  style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: OVERLAY_Z_INDEX }}
                >
                  {overlay}
                </div>
              )}
            </div>
          </div>
        </div>
      </TrimPreviewContext.Provider>
    );
  }
);

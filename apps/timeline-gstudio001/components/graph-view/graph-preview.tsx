"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  MIN_ITEM_WIDTH,
  durationToWidth,
  mediaDurationSeconds,
  useCollectionsSelector,
  useCollectionsStore,
  type CollectionsGraph,
  type NodeId,
} from "@storyboard/ui/dnd-collections";
import {
  graphChildrenToClips,
  hydratedCollectionDuration,
  manifestToClips,
  type DetailsById,
  type PlaybackManifest,
} from "@storyboard/timeline-domain";

import {
  buildGridPlayheadMap,
  buildPlayheadMap,
  buildRulerCollectionSpans,
  buildRulerTicks,
  cardSpansOf,
  childSpans,
  formatRulerTick,
  manifestTrailsLedger,
  nextManifestClipsState,
  nextManifestFailureCount,
  shouldRetryManifestFetch,
  STRIP_GAP_PX,
  type ChildSpan,
  type GridPlayheadMap,
  type PlayheadMap,
  type PreviewCardSpans,
  type RulerWindow,
} from "./graph-playhead-model";

export type { PreviewCardSpans } from "./graph-playhead-model";
import { WorkbenchSplitPane } from "@storyboard/ui/timeline/viewport/workbench-display-surface";
import {
  TimelineDocumentsProvider,
  useTimelineDocuments,
} from "@storyboard/ui/timeline/timeline-document-store";
import { createTimelineDocumentsState } from "@storyboard/ui/timeline/timeline-documents";
import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";

import { enabledClips, packTimelineClips } from "@storyboard/timeline-model";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { requestGraphPreviewToggle } from "@/lib/graph-view-events";

import { useGraphDetailsStore } from "./graph-details-context";
import { GRID_GAP, TIMELINE_PPS } from "./graph-view-config";

export type PreviewTimeChannel = Readonly<{
  get: () => number;
  set: (time: number) => void;
  subscribe: (listener: () => void) => () => void;
  /** Play state, held here (above the preview pane's mount) so it survives the
   *  pane toggling off/on and can be driven before the pane exists — that's how
   *  "play turns the preview on and it's already playing" works. */
  isPlaying: () => boolean;
  setPlaying: (playing: boolean) => void;
  subscribePlaying: (listener: () => void) => () => void;
}>;

export function createPreviewTimeChannel(): PreviewTimeChannel {
  let time = 0;
  let playing = false;
  const listeners = new Set<() => void>();
  const playListeners = new Set<() => void>();
  return {
    get: () => time,
    set: (next) => {
      time = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isPlaying: () => playing,
    setPlaying: (next) => {
      if (playing === next) return;
      playing = next;
      for (const listener of playListeners) listener();
    },
    subscribePlaying: (listener) => {
      playListeners.add(listener);
      return () => {
        playListeners.delete(listener);
      };
    },
  };
}

/**
 * A collection card's width, scaled by the zoom slider like every media clip
 * beside it. Collections carry no single duration to lay out by, so they keep a
 * UNIFORM width — but that width now tracks pixels-per-second so a collection no
 * longer sits frozen while the clips around it grow and shrink. 128px at the
 * default scale (a ~3.2s-equivalent slot), floored so it stays clickable when
 * zoomed all the way out.
 *
 * Exported so the strip's `itemWidth` prop and the playhead's own width model
 * read the SAME number — the two must agree or the marker drifts off the cards.
 */
const COLLECTION_CARD_BASE_PX = 128;
export function collectionCardWidth(pixelsPerSecond: number): number {
  return Math.max(MIN_ITEM_WIDTH, COLLECTION_CARD_BASE_PX * (pixelsPerSecond / TIMELINE_PPS));
}

/**
 * The strip's width resolution at a given zoom, injected into the pure
 * playhead model so its cards use EXACTLY the widths the strip renders —
 * collections at the shared fixed-per-zoom width, media by duration.
 */
function clipWidthAt(pixelsPerSecond: number): (clip: TimelineClip) => number {
  return (clip) =>
    clip.kind === "collection"
      ? collectionCardWidth(pixelsPerSecond)
      : durationToWidth(clip.duration, pixelsPerSecond);
}

// The per-card time windows (and the maps built from them) live in
// graph-playhead-model.ts — pure and unit-tested; this file only carries the
// React seams. The context publishes the manifest's windows to every playhead
// under the pane: the pane plays the manifest whenever it has one, and the
// live projection only in the ~2.5s window after an edit, so the markers must
// map time→x on the SAME clock the pane is playing or they point at the
// wrong cards (the round-1 #6 bug).
const PreviewCardSpansContext = createContext<PreviewCardSpans | null>(null);

/** The global-clock windows the pane is playing, or null when it is on the
 *  live projection (no manifest yet). Sub-rows use it both to gate their
 *  playhead — only shown when a manifest exists, since only then do their
 *  local times line up with the global clock — and to find their own window. */
export function usePreviewCardSpans(): PreviewCardSpans | null {
  return useContext(PreviewCardSpansContext);
}

/**
 * Clip count and total seconds of the focused timeline — the board header's
 * centred aggregate readout. Same plumbing as the playheads (graph + details
 * + manifest spans through `childSpans`), so its total always agrees with
 * where the playhead can actually reach.
 */
export function useFocusedTimelineAggregate(
  focusedId: string,
  pixelsPerSecond: number,
): Readonly<{ count: number; seconds: number }> {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  const graph = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().graph,
    () => store.getSnapshot().graph,
  );
  const details = useSyncExternalStore(
    detailsStore.subscribe,
    () => detailsStore.read(),
    () => detailsStore.read(),
  );
  return useMemo(() => {
    const cards = childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond));
    return {
      count: cards.length,
      seconds: cards.length > 0 ? cards[cards.length - 1].endTime : 0,
    };
  }, [graph, details, focusedId, spans, pixelsPerSecond]);
}


export function GraphPlayhead({
  focusedId,
  channel,
  pixelsPerSecond,
  activeWindow,
}: Readonly<{
  focusedId: string;
  channel: PreviewTimeChannel;
  pixelsPerSecond: number;
  /** When set (sub-rows), the marker is hidden while the global clock is
   *  outside this collection's window — only the row the clock is currently
   *  inside shows it, so one clock appears to sweep through the tree. The
   *  focused row passes none and always shows it. */
  activeWindow?: Readonly<{ start: number; end: number }>;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let lastGraph: CollectionsGraph | null = null;
    let lastDetails: DetailsById | null = null;
    let map: PlayheadMap | null = null;
    // Rebuild the position map only when its geometry inputs (graph/details)
    // change; returns whether it did, so store-driven callers can skip the DOM
    // write when nothing the playhead reads actually moved.
    const rebuildIfNeeded = (): boolean => {
      const graph = store.getSnapshot().graph;
      const details = detailsStore.read();
      if (graph === lastGraph && details === lastDetails) return false;
      lastGraph = graph;
      lastDetails = details;
      map = buildPlayheadMap(
        childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond)),
      );
      return true;
    };
    // Position-only style write, for the current clock time.
    const paint = () => {
      const line = lineRef.current;
      if (!line || !map) return;
      const time = channel.get();
      // 40ms of slack so the marker doesn't blink off at the exact seam
      // between two adjacent collections.
      const inside =
        !activeWindow || (time >= activeWindow.start - 0.04 && time <= activeWindow.end + 0.04);
      line.style.display = inside ? "" : "none";
      if (inside) line.style.transform = `translateX(${map.xAt(time)}px)`;
    };
    // The clock moved: always reposition, cheaply picking up any pending
    // geometry change on the way (the rebuild is a no-op when nothing changed).
    const tick = () => {
      rebuildIfNeeded();
      paint();
    };
    // A store/details notification only matters to the playhead when it changed
    // the geometry. Drag start/end, selection, and every drop-intent tick
    // during a drag leave the committed graph untouched, so this bails before
    // any DOM write — otherwise every mounted sub-timeline playhead repainted
    // on each of those, directly on the drag/INP hot path.
    const onData = () => {
      if (rebuildIfNeeded()) paint();
    };
    tick();
    const unsubscribeTime = channel.subscribe(tick);
    const unsubscribeStore = store.subscribe(onData);
    const unsubscribeDetails = detailsStore.subscribe(onData);
    return () => {
      unsubscribeTime();
      unsubscribeStore();
      unsubscribeDetails();
    };
  }, [store, detailsStore, focusedId, channel, spans, pixelsPerSecond, activeWindow]);

  // No cap on the line: the seek rail's circular thumb above IS the
  // playhead's head now — the old triangle poked up over it. The stem
  // reaches up through the band's clearance (-top-1 = the 4px inset) so it
  // meets the track's underside instead of floating below it.
  return (
    <div
      ref={lineRef}
      data-graph-playhead
      className="absolute -top-1 bottom-0 left-0 w-0.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]"
    />
  );
}

/** Tick height per tier: 0 = labeled major (full band), then progressively
 *  shorter minors (half / quarter / eighth). Index by `level`. */
const RULER_TIER_HEIGHT_PX = [18, 11, 8, 5];

/** Narrowest collection card that still fits its centred duration label —
 *  below this the band stays empty rather than overflowing the neighbours. */
const RULER_COLLECTION_LABEL_MIN_WIDTH_PX = 34;

/** Window quantum for ruler ticks. Coarse on purpose: the window only
 *  changes when scrolling crosses a chunk boundary, so the per-scroll-event
 *  work is a compare-and-bail, and each re-render is amortized over ~512px
 *  of travel. One chunk of overscan each side keeps ticks present under the
 *  pointer during the between-chunks glide. */
const RULER_WINDOW_CHUNK_PX = 512;

/** Pre-measure fallback: covers any plausible first paint from scroll 0 so
 *  the ruler is never blank while the ResizeObserver's initial (async)
 *  delivery is in flight; the first real measure then tightens it. */
const INITIAL_RULER_WINDOW: RulerWindow = { startX: 0, endX: RULER_WINDOW_CHUNK_PX * 8 };

/**
 * The chunk-quantized visible content-x range of the strip this element
 * renders inside — the ruler's tick window. Reads the scroll container via
 * the package's documented `[data-virtual-strip]` selector contract (the
 * ruler rides the strip's own overlay layer, so `closest` finds it). Updates
 * ride the scroller's scroll event and a ResizeObserver — both async, so no
 * synchronous setState-in-effect; the observer's initial delivery IS the
 * first measurement.
 */
function useStripTickWindow(rulerEl: HTMLElement | null): RulerWindow {
  const [tickWindow, setTickWindow] = useState<RulerWindow>(INITIAL_RULER_WINDOW);

  useEffect(() => {
    if (!rulerEl) return;
    const scroller = rulerEl.closest<HTMLElement>("[data-virtual-strip]");
    // Not inside a strip (defensive): the initial window stands, degrading to
    // the unwindowed behavior for the first few thousand pixels.
    if (!scroller) return;
    const update = () => {
      const chunk = RULER_WINDOW_CHUNK_PX;
      const startX = Math.max(0, (Math.floor(scroller.scrollLeft / chunk) - 1) * chunk);
      const endX = (Math.ceil((scroller.scrollLeft + scroller.clientWidth) / chunk) + 1) * chunk;
      setTickWindow((previous) =>
        previous.startX === startX && previous.endX === endX
          ? previous
          : { startX, endX },
      );
    };
    scroller.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => {
      scroller.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [rulerEl]);

  return tickWindow;
}

/**
 * A second-ruler over the strip. It reads the SAME piecewise time↔x map the
 * playhead uses (`buildPlayheadMap`), so a tick at t seconds lands exactly
 * where the playhead sits at t — the strip is NOT a linear time axis (media
 * width is duration·pps, but the inter-card gutter absorbs the pack gap and a
 * collection card is a FIXED width holding an arbitrary duration), so a
 * fixed-pixel-pitch ruler would drift off the cards.
 *
 * Media cards are ruled at nice second intervals. A collection card's interior
 * is left blank — ruling an arbitrary duration across its fixed width would
 * cram ticks into an unreadable smear — and only its start edge is ticked, so
 * the card still reads as one bracketed block on the ruler.
 *
 * Works with preview OFF too: without a manifest `spans` is null and
 * `childSpans` falls back to projection times, which is the honest clock then.
 * Rides the strip overlay (content coordinates), so scroll/auto-scroll and the
 * live-trim transform all apply for free.
 *
 * Ticks are WINDOWED to the strip's visible scroll range (chunk-quantized,
 * one chunk of overscan each side — see useStripTickWindow): tick count
 * follows the viewport, never the timeline's duration, so a thousands-of-
 * clips strip at high zoom stops minting thousands of offscreen tick divs.
 */
export function GraphRuler({
  focusedId,
  pixelsPerSecond,
}: Readonly<{ focusedId: string; pixelsPerSecond: number }>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  // State, not a ref: the tick-window hook needs the element on the render
  // pass after mount, and render-time ref reads are illegal.
  const [rulerEl, setRulerEl] = useState<HTMLElement | null>(null);
  const tickWindow = useStripTickWindow(rulerEl);
  const graph = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().graph,
    () => store.getSnapshot().graph,
  );
  const details = useSyncExternalStore(
    detailsStore.subscribe,
    () => detailsStore.read(),
    () => detailsStore.read(),
  );

  // Tick building is windowed AND pure (graph-playhead-model): only the
  // ticks inside the visible chunk range exist, so a long timeline at high
  // zoom no longer mints thousands of offscreen tick elements per commit —
  // tick count follows the VIEWPORT, not the duration. Scrolling recomputes
  // only on chunk crossings (tickWindow identity is stable between them).
  const { ticks, collectionSpans } = useMemo(() => {
    const clips = graphChildrenToClips(graph, details, focusedId);
    const cards = childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond));
    const isCollection = clips.map((clip) => clip.kind === "collection");
    return {
      ticks: buildRulerTicks(cards, isCollection, pixelsPerSecond, tickWindow),
      // A collection's interior gets no ticks (its width is not a time axis)
      // — fill its stretch of the band with the content duration instead
      // (R7 #4), same live-derived total the card badge shows.
      collectionSpans: buildRulerCollectionSpans(cards, isCollection, tickWindow),
    };
  }, [graph, details, spans, focusedId, pixelsPerSecond, tickWindow]);

  return (
    <div
      ref={setRulerEl}
      aria-hidden="true"
      data-graph-ruler
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[18px]"
    >
      {/* Opaque band: the ticks used to be thin translucent lines painted over
          the thumbnails and washed out against bright frames. A solid dark
          strip with a bright baseline keeps the whole ruler legible over ANY
          clip, at every zoom. */}
      <div className="absolute inset-x-0 top-0 h-[18px] border-b border-sky-400/50 bg-zinc-950/90" />
      {ticks.map((tick, index) => (
        <div key={index} className="absolute top-0" style={{ transform: `translateX(${tick.x}px)` }}>
          {/* Tier drives height + brightness: labeled majors run the full band
              and are brightest; each finer minor tier is shorter and dimmer. */}
          <div
            className={
              tick.level === 0
                ? "w-px bg-sky-300"
                : tick.level === 1
                  ? "w-px bg-sky-400/70"
                  : "w-px bg-sky-400/45"
            }
            style={{ height: RULER_TIER_HEIGHT_PX[tick.level] ?? RULER_TIER_HEIGHT_PX[3] }}
          />
          {tick.label ? (
            <span className="absolute left-[3px] top-[2px] whitespace-nowrap font-mono text-[9px] font-medium leading-none text-sky-100">
              {tick.label}
            </span>
          ) : null}
        </div>
      ))}
      {/* Collections carry no ticks, so their stretch of the band shows the
          content duration instead of sitting empty (R7 #4). Centred in the
          card's range; skipped when the card is too narrow for the label. */}
      {collectionSpans.map((span, index) =>
        span.width >= RULER_COLLECTION_LABEL_MIN_WIDTH_PX ? (
          <span
            key={`collection-${index}`}
            data-ruler-collection-duration
            className="absolute top-[2px] -translate-x-1/2 whitespace-nowrap font-mono text-[9px] font-medium leading-none text-sky-200/90"
            style={{ left: span.x + span.width / 2 }}
          >
            {formatRulerTick(Math.round(span.seconds * 10) / 10)}
          </span>
        ) : null,
      )}
    </div>
  );
}

export function GraphGridPlayhead({
  focusedId,
  channel,
  cellHeight,
  pixelsPerSecond,
  activeWindow,
}: Readonly<{
  focusedId: string;
  channel: PreviewTimeChannel;
  cellHeight: number;
  pixelsPerSecond: number;
  activeWindow?: Readonly<{ start: number; end: number }>;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  const lineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const line = lineRef.current;
    if (!line) return;
    const grid = line.closest<HTMLElement>("[data-virtual-grid]");
    let lastGraph: CollectionsGraph | null = null;
    let lastDetails: DetailsById | null = null;
    let lastColumns = 0;
    let lastCellWidth = 0;
    let map: GridPlayheadMap | null = null;

    // Rebuild the position map only when its geometry inputs change — graph or
    // details, plus the grid's live column count / cell width. Returns whether
    // it did, so store-driven callers can skip the DOM write when nothing the
    // playhead reads actually moved.
    const rebuildIfNeeded = (): boolean => {
      const graph = store.getSnapshot().graph;
      const details = detailsStore.read();
      const columns = Number(grid?.dataset.gridColumns) || 1;
      // Live rendered cell width (post fill-stretch) — VirtualGrid's own
      // pixel value, never a hardcoded constant: the app's GRID_CELL_WIDTH
      // is only a target for picking column count, not the rendered size.
      const cellWidth = Number(grid?.dataset.gridCellWidth) || 1;
      if (
        graph === lastGraph &&
        details === lastDetails &&
        columns === lastColumns &&
        cellWidth === lastCellWidth
      ) {
        return false;
      }
      lastGraph = graph;
      lastDetails = details;
      lastColumns = columns;
      lastCellWidth = cellWidth;
      map = buildGridPlayheadMap(
        childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond)),
        columns,
        cellWidth,
        cellHeight,
      );
      return true;
    };

    // Position-only style write, for the current clock time.
    const paint = () => {
      if (!map) return;
      const time = channel.get();
      const inside =
        !activeWindow || (time >= activeWindow.start - 0.04 && time <= activeWindow.end + 0.04);
      line.style.display = inside ? "" : "none";
      if (!inside) return;
      const { x, y } = map.posAt(time);
      // Reach up through the band's clearance so the stem meets its row
      // rail's underside (the strip line does the same via -top-1).
      line.style.transform = `translate(${x}px, ${y - SEEK_RAIL_BAND_INSET_PX}px)`;
      line.style.height = `${map.rowHeight + SEEK_RAIL_BAND_INSET_PX}px`;
    };

    // The clock moved: always reposition, cheaply picking up any pending
    // geometry change on the way (the rebuild is a no-op when nothing changed).
    const tick = () => {
      rebuildIfNeeded();
      paint();
    };
    // Store / details / resize notifications only matter when they changed the
    // geometry. Drag start/end, selection, and every drop-intent tick during a
    // drag leave the committed graph untouched, so this bails before any DOM
    // write — otherwise every mounted sub-timeline playhead repainted on each
    // of those, directly on the drag/INP hot path. A resize that alters
    // columns/cellWidth is caught here too.
    const onData = () => {
      if (rebuildIfNeeded()) paint();
    };

    tick();
    const unsubscribeTime = channel.subscribe(tick);
    const unsubscribeStore = store.subscribe(onData);
    const unsubscribeDetails = detailsStore.subscribe(onData);
    const observer = grid ? new ResizeObserver(onData) : null;
    if (grid && observer) observer.observe(grid);
    return () => {
      unsubscribeTime();
      unsubscribeStore();
      unsubscribeDetails();
      observer?.disconnect();
    };
  }, [store, detailsStore, focusedId, channel, cellHeight, spans, pixelsPerSecond, activeWindow]);

  // PASSIVE indicator: all scrubbing lives on the GraphSeekRail above the
  // grid (one obvious control), so the line paints position and takes no
  // pointer — cards keep every gesture underneath it. No cap on the line:
  // the row rail's circular thumb above IS the head (same as the strip's).
  return (
    <div
      ref={lineRef}
      data-graph-grid-playhead
      className="absolute left-0 top-0 w-0.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]"
    />
  );
}

/** Keyboard step for the seek rails: one nudge per arrow press. */
const SEEK_RAIL_STEP_SECONDS = 1;

/** The rail's slim track vs the BAND it rides (the grid's row gap; the
 *  strip's `pt-4` top padding). The track centres in the band, so the
 *  clearance on each side keeps the track and its thumb clear of the cards
 *  — rail and items never overlap, and a selected card's ring stays fully
 *  visible (the old design filled the band edge-to-edge and sat flush on
 *  the card tops). */
const SEEK_RAIL_TRACK_PX = 8;
const SEEK_RAIL_BAND_INSET_PX = (GRID_GAP - SEEK_RAIL_TRACK_PX) / 2;
/** The UNPLAYED groove is a slim centred line; the PLAYED fill grows to the
 *  full track height as the scrub sweeps through it, so the rail visibly
 *  thickens behind the thumb. The HIT TARGET is unchanged — the whole
 *  SEEK_RAIL_TRACK_PX-tall box stays grabbable; only this visible line is
 *  slim. */
const SEEK_RAIL_GROOVE_PX = 2;

type SeekRailGeometry = Readonly<{
  columns: number;
  cellWidth: number;
  /** The grid CONTENT origin relative to the rails' own root. */
  left: number;
  top: number;
}>;

/**
 * One row's seek rail: a slim slider lying in the gap directly above its
 * row of cells, spanning EXACTLY that row's cell geometry — so the thumb
 * rides in lockstep above the in-grid playhead line whenever the time is
 * inside this row, and the boundary ticks sit on the real cell edges
 * below. The rails together read as ONE segmented progress bar: rows the
 * playhead has passed show a full fill, rows ahead sit empty, and only
 * the row containing the current time carries the thumb. Pressing any
 * rail summons the playhead into that row.
 *
 * Pointer: press/drag anywhere (pointer capture keeps the drag smooth) —
 * and the drag CONTINUES past the rail's ends: seeking goes through the
 * whole timeline's unwrapped map at this row's offset, so overshooting
 * the row's tail scrubs on into the next row's clips (and dragging left
 * past its head backs into the previous row) at the same pixel rate.
 * Keyboard: a real `role="slider"` scoped to this row's time window —
 * arrows nudge by a second, Home/End jump to the row's ends.
 */
function SeekRailRow({
  rowCards,
  isLastRow,
  map,
  offsetX,
  cellWidth,
  x,
  y,
  channel,
  ariaLabel,
  rowIndex,
}: Readonly<{
  rowCards: readonly ChildSpan[];
  isLastRow: boolean;
  /** The WHOLE timeline's unwrapped cell map (all cards in one line). */
  map: GridPlayheadMap;
  /** This row's left edge inside that unwrapped line, in px. */
  offsetX: number;
  cellWidth: number;
  x: number;
  y: number;
  channel: PreviewTimeChannel;
  ariaLabel: string;
  rowIndex: number;
}>) {
  const railRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);

  const cells = rowCards.length;
  const pitch = cellWidth + GRID_GAP;
  const extent = Math.max(1, cells * pitch - GRID_GAP);
  const rowStart = rowCards[0].startTime;
  const rowEnd = rowCards[cells - 1].endTime;

  // Thumb/fill/aria track the channel imperatively — time moves at pointer
  // rate during a scrub, no reason to re-render. Deps cover everything the
  // closure reads, so map/window changes re-subscribe fresh.
  useEffect(() => {
    const rail = railRef.current;
    const fill = fillRef.current;
    const thumb = thumbRef.current;
    if (!rail || !fill || !thumb) return;
    const paint = () => {
      const time = channel.get();
      // A time exactly on a row boundary belongs to the NEXT row (its
      // cell's start), except the very end of the last row.
      const active = time >= rowStart && (isLastRow ? time <= rowEnd : time < rowEnd);
      thumb.style.visibility = active ? "" : "hidden";
      // Cumulative fill: clamping into the row's window paints a PASSED row
      // full (clamped = rowEnd → fraction 1) and a not-yet-reached row
      // empty (clamped = rowStart → fraction 0), so the stack of rails
      // reads as one continuous progress bar.
      const clamped = Math.min(rowEnd, Math.max(rowStart, time));
      const fraction = Math.min(1, Math.max(0, (map.posAt(clamped).x - offsetX) / extent));
      fill.style.width = `${fraction * 100}%`;
      thumb.style.left = `${fraction * 100}%`;
      rail.setAttribute("aria-valuenow", (clamped - rowStart).toFixed(1));
      rail.setAttribute(
        "aria-valuetext",
        `${(clamped - rowStart).toFixed(1)} of ${(rowEnd - rowStart).toFixed(1)} seconds`,
      );
    };
    paint();
    return channel.subscribe(paint);
  }, [channel, map, offsetX, extent, rowStart, rowEnd, isLastRow]);

  const seekToPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    // Deliberately UNCLAMPED to this rail: the pointer's x rides the whole
    // timeline's unwrapped line at this row's offset, so a drag that
    // overshoots either end keeps scrubbing into the neighbouring rows
    // (timeAt clamps to the timeline's own bounds).
    channel.set(map.timeAt(offsetX + (event.clientX - rect.left), 0));
  };

  return (
    <div
      ref={railRef}
      data-graph-seek-rail
      data-row={rowIndex}
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Number((rowEnd - rowStart).toFixed(1))}
      aria-valuenow={0}
      title="Drag to preview"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        pointerIdRef.current = event.pointerId;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointer without capture support: moves still arrive
          // while the pointer stays over the rail, which tests rely on.
        }
        seekToPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.pointerId === pointerIdRef.current) seekToPointer(event);
      }}
      onPointerUp={(event) => {
        if (event.pointerId === pointerIdRef.current) pointerIdRef.current = null;
      }}
      onPointerCancel={(event) => {
        if (event.pointerId === pointerIdRef.current) pointerIdRef.current = null;
      }}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const base = Math.min(rowEnd, Math.max(rowStart, channel.get()));
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          channel.set(Math.max(rowStart, base - SEEK_RAIL_STEP_SECONDS));
        } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          channel.set(Math.min(rowEnd, base + SEEK_RAIL_STEP_SECONDS));
        } else if (event.key === "Home") {
          channel.set(rowStart);
        } else if (event.key === "End") {
          channel.set(rowEnd);
        } else {
          return;
        }
        event.preventDefault();
      }}
      // Transparent HIT box (the whole track is grabbable); the visible rail
      // is the groove + fill within it. Blue throughout (was zinc-700, which
      // read as the scroll bar under the items — same neutral gray, same slim
      // pill): the groove and fill wear the playhead's own blue, the thumb is
      // the red playhead head, so the rail reads as the preview's scrubber.
      className="group pointer-events-auto absolute cursor-ew-resize touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      style={{
        left: x,
        top: y + SEEK_RAIL_BAND_INSET_PX,
        width: extent,
        height: SEEK_RAIL_TRACK_PX,
      }}
    >
      {/* UNPLAYED groove: a slim centred line. Solid, not translucent — a
          see-through track melted into the grid's dark backdrop (R7). */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-sky-900 shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)] ring-1 ring-sky-400/40 transition-shadow group-hover:ring-sky-300/60"
        style={{ height: SEEK_RAIL_GROOVE_PX }}
      />
      {/* PLAYED fill (full track height), then boundary ticks, then thumb. */}
      <div
        ref={fillRef}
        data-rail-fill
        aria-hidden="true"
        className="absolute inset-y-0 left-0 rounded-full bg-sky-300/80"
      />
      {rowCards.slice(1).map((_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="absolute inset-y-0 w-px bg-white/30"
          style={{ left: `${(((index + 1) * pitch - GRID_GAP / 2) / extent) * 100}%` }}
        />
      ))}
      {/* h-3: the head is visibly bigger than the slim track (2px past it
          each side), and the band's inset keeps even that overhang clear of
          the cards — thumb and items never touch. The whole rail is the hit
          target anyway. */}
      <div
        ref={thumbRef}
        data-rail-thumb
        aria-hidden="true"
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)] ring-2 ring-zinc-950 transition-transform group-hover:scale-110"
      />
    </div>
  );
}

/**
 * The grid's scrub control: one slim seek rail PER ROW (the video-player
 * idiom, one lane at a time), each lying in the 8px gap above its row —
 * row 0's rides the grid's own top padding, so nothing shifts when the
 * preview toggles. Per-row rails are what keep the thumb positionally in
 * lockstep with the in-grid playhead line on EVERY row of a multi-row
 * grid; a single bar over the grid could only ever align with row 0.
 *
 * Renders as an absolutely-positioned layer over the grid (a sibling, NOT
 * inside the aria-hidden overlay — rails are focusable) with pointer
 * events off everywhere except the rails themselves, so cards keep every
 * gesture: click selects, hold drags, the folder button drills.
 *
 * Geometry comes from the sibling grid's dataset (live column count and
 * exact rendered cell width) plus its border+padding, observed by BOTH a
 * ResizeObserver and a MutationObserver — resize alone settles one layout
 * stale, because it fires before VirtualGrid commits the fresh dataset
 * (React renders a frame later).
 */
export function GraphSeekRails({
  focusedId,
  channel,
  cellHeight,
  pixelsPerSecond,
  ariaLabel = "Seek preview",
}: Readonly<{
  focusedId: string;
  channel: PreviewTimeChannel;
  cellHeight: number;
  pixelsPerSecond: number;
  ariaLabel?: string;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  const rootRef = useRef<HTMLDivElement>(null);

  const graph = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().graph,
    () => store.getSnapshot().graph,
  );
  const details = useSyncExternalStore(
    detailsStore.subscribe,
    () => detailsStore.read(),
    () => detailsStore.read(),
  );
  const cards = useMemo(
    () => childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond)),
    [graph, details, spans, focusedId, pixelsPerSecond],
  );
  const cardCount = cards.length;

  const [geometry, setGeometry] = useState<SeekRailGeometry | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const grid = root.parentElement?.querySelector<HTMLElement>("[data-virtual-grid]");
    if (!grid) return;
    const update = () => {
      const columns = Number(grid.dataset.gridColumns) || 0;
      const cellWidth = Number(grid.dataset.gridCellWidth) || 0;
      if (columns <= 0 || cellWidth <= 0) {
        setGeometry(null);
        return;
      }
      const styles = getComputedStyle(grid);
      const rootRect = root.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();
      const left =
        gridRect.left -
        rootRect.left +
        parseFloat(styles.borderLeftWidth) +
        parseFloat(styles.paddingLeft);
      const top =
        gridRect.top -
        rootRect.top +
        parseFloat(styles.borderTopWidth) +
        parseFloat(styles.paddingTop);
      setGeometry((previous) =>
        previous &&
        previous.columns === columns &&
        previous.cellWidth === cellWidth &&
        previous.left === left &&
        previous.top === top
          ? previous
          : { columns, cellWidth, left, top },
      );
    };
    update();
    const resizes = new ResizeObserver(update);
    resizes.observe(grid);
    const mutations = new MutationObserver(update);
    mutations.observe(grid, {
      attributes: true,
      attributeFilter: ["data-grid-cell-width", "data-grid-columns"],
    });
    return () => {
      resizes.disconnect();
      mutations.disconnect();
    };
  }, [cardCount]);

  const rows = useMemo(() => {
    if (!geometry || cardCount === 0) return [] as (readonly ChildSpan[])[];
    const out: (readonly ChildSpan[])[] = [];
    for (let index = 0; index < cardCount; index += geometry.columns) {
      out.push(cards.slice(index, index + geometry.columns));
    }
    return out;
  }, [cards, cardCount, geometry]);

  // ONE unwrapped map for the whole timeline (every card in a single line):
  // each row's rail paints and seeks through it at its own offset, which is
  // what lets a drag run PAST a rail's ends into the neighbouring rows.
  const fullMap = useMemo(
    () =>
      geometry && cardCount > 0
        ? buildGridPlayheadMap(cards, cardCount, geometry.cellWidth, 1)
        : null,
    [cards, cardCount, geometry],
  );

  if (!geometry || !fullMap || rows.length === 0) {
    // Pre-measure (or empty timeline): nothing to place yet — the observer
    // pass lands within a frame of the grid reporting its layout.
    return <div ref={rootRef} className="pointer-events-none absolute inset-0" />;
  }

  return (
    <div ref={rootRef} data-graph-seek-rails className="pointer-events-none absolute inset-0 z-20">
      {rows.map((rowCards, row) => (
        <SeekRailRow
          key={row}
          rowCards={rowCards}
          isLastRow={row === rows.length - 1}
          map={fullMap}
          offsetX={row * geometry.columns * (geometry.cellWidth + GRID_GAP)}
          cellWidth={geometry.cellWidth}
          x={geometry.left}
          y={geometry.top + row * (cellHeight + GRID_GAP) - GRID_GAP}
          channel={channel}
          rowIndex={row}
          ariaLabel={rows.length > 1 ? `${ariaLabel}, row ${row + 1}` : ariaLabel}
        />
      ))}
    </div>
  );
}

/** How close to the scroller's edge (px) a rail drag starts auto-panning,
 *  and the fastest per-frame pan. Speed ramps with how deep into the edge
 *  zone (or past it) the pointer sits. */
const STRIP_RAIL_EDGE_PX = 32;
const STRIP_RAIL_MAX_PAN_PER_FRAME_PX = 16;

/**
 * The strip's seek rail: the same treatment as the grid's per-row rails —
 * a slim track in the strip's top padding band with fill, cell-boundary
 * ticks and a thumb in exact lockstep with the playhead line — but in the
 * STRIP's scrolling coordinate space: the rail's content is as wide as the
 * timeline and translates with the scroller, so ticks and thumb stay glued
 * to their cards.
 *
 * Because the timeline can be wider than the viewport, a drag that reaches
 * the scroller's edge AUTO-PANS: a rAF loop scrolls the strip in that
 * direction and re-seeks at the held pointer position each frame, so more
 * items keep arriving under a stationary pointer mid-scrub (and the same
 * leftward). Keyboard seeks pan the thumb back into view.
 *
 * Replaces the old invisible PlayheadScrubBand as the strip's scrub
 * surface. Renders as a SIBLING of the strip (focusable, so it must not
 * live in the aria-hidden overlay), viewport-fixed with a scroll-synced
 * inner strip.
 */
export function GraphStripSeekRail({
  focusedId,
  channel,
  pixelsPerSecond,
  ariaLabel = "Seek preview",
}: Readonly<{
  focusedId: string;
  channel: PreviewTimeChannel;
  pixelsPerSecond: number;
  ariaLabel?: string;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const lastClientXRef = useRef(0);
  const panFrameRef = useRef<number | null>(null);

  const graph = useSyncExternalStore(
    store.subscribe,
    () => store.getSnapshot().graph,
    () => store.getSnapshot().graph,
  );
  const details = useSyncExternalStore(
    detailsStore.subscribe,
    () => detailsStore.read(),
    () => detailsStore.read(),
  );
  const cards = useMemo(
    () => childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond)),
    [graph, details, spans, focusedId, pixelsPerSecond],
  );
  const map = useMemo(() => buildPlayheadMap(cards), [cards]);
  const start = cards.length > 0 ? cards[0].startTime : 0;
  const end = cards.length > 0 ? cards[cards.length - 1].endTime : 0;
  // The rail's content width ends at the LAST item's right edge, and the
  // interior ticks sit at the gap centres between cards — the strip twin of
  // the grid rails' cell-edge ticks.
  const { extent, ticks } = useMemo(() => {
    let cursor = 0;
    const tickXs: number[] = [];
    cards.forEach((card, index) => {
      if (index > 0) tickXs.push(cursor - STRIP_GAP_PX / 2);
      cursor += card.width + STRIP_GAP_PX;
    });
    return { extent: Math.max(1, cursor - STRIP_GAP_PX), ticks: tickXs };
  }, [cards]);

  // Window geometry over the scroller's padding band, measured like the
  // grid rails' (ResizeObserver; the strip has no dataset race — the map is
  // ours, not the virtualizer's).
  const [geometry, setGeometry] = useState<Readonly<{
    left: number;
    top: number;
    width: number;
    padLeft: number;
  }> | null>(null);
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const wrapper = outer.parentElement;
    const scroller = wrapper?.querySelector<HTMLElement>("[data-virtual-strip]");
    if (!wrapper || !scroller) return;
    const update = () => {
      const styles = getComputedStyle(scroller);
      const padLeft = parseFloat(styles.borderLeftWidth) + parseFloat(styles.paddingLeft);
      const padRight = parseFloat(styles.borderRightWidth) + parseFloat(styles.paddingRight);
      const scrollerRect = scroller.getBoundingClientRect();
      const wrapperRect = wrapper.getBoundingClientRect();
      const left = scrollerRect.left - wrapperRect.left + padLeft;
      // Centre the slim track in the scroller's top padding band (falls
      // back to flush-at-top if the padding is no taller than the track).
      const top =
        scrollerRect.top -
        wrapperRect.top +
        parseFloat(styles.borderTopWidth) +
        Math.max(0, (parseFloat(styles.paddingTop) - SEEK_RAIL_TRACK_PX) / 2);
      const width = Math.max(0, scroller.clientWidth - padLeft - padRight + 1);
      setGeometry((previous) =>
        previous &&
        previous.left === left &&
        previous.top === top &&
        previous.width === width &&
        previous.padLeft === padLeft
          ? previous
          : { left, top, width, padLeft },
      );
    };
    update();
    const resizes = new ResizeObserver(update);
    resizes.observe(scroller);
    return () => resizes.disconnect();
  }, [cards.length]);

  // Scroll sync + paint, both imperative (scroll and time move at pointer
  // rate). The inner strip translates against scrollLeft so its ticks,
  // fill and thumb stay glued to the cards they mark.
  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    const fill = fillRef.current;
    const thumb = thumbRef.current;
    if (!outer || !inner || !fill || !thumb) return;
    const scroller = outer.parentElement?.querySelector<HTMLElement>("[data-virtual-strip]");
    if (!scroller) return;

    // The thumb lives OUTSIDE the pill's clip in window coordinates
    // (content x − scrollLeft), so the circle stays whole at the timeline's
    // ends. It hides once fully past the window's edge (a detached head
    // floating beside the pill would read as a bug); `contentX` carries the
    // last painted position into scroll-only frames.
    let contentX = 0;
    const placeThumb = () => {
      const windowX = contentX - scroller.scrollLeft;
      thumb.style.left = `${windowX}px`;
      const overhang = thumb.offsetWidth / 2;
      const visible =
        thumb.dataset.active !== "false" &&
        windowX >= -overhang &&
        windowX <= outer.clientWidth + overhang;
      thumb.style.visibility = visible ? "" : "hidden";
    };
    const syncScroll = () => {
      inner.style.transform = `translateX(${-scroller.scrollLeft}px)`;
      placeThumb();
    };
    const paint = () => {
      const time = channel.get();
      thumb.dataset.active = String(time >= start && time <= end);
      const clamped = Math.min(end, Math.max(start, time));
      contentX = map.xAt(clamped);
      fill.style.width = `${contentX}px`;
      placeThumb();
      outer.setAttribute("aria-valuenow", (clamped - start).toFixed(1));
      outer.setAttribute(
        "aria-valuetext",
        `${(clamped - start).toFixed(1)} of ${(end - start).toFixed(1)} seconds`,
      );
    };
    syncScroll();
    paint();
    const unsubscribe = channel.subscribe(paint);
    scroller.addEventListener("scroll", syncScroll, { passive: true });
    return () => {
      unsubscribe();
      scroller.removeEventListener("scroll", syncScroll);
    };
  }, [channel, map, start, end]);

  const scrollerOf = (): HTMLElement | null =>
    outerRef.current?.parentElement?.querySelector<HTMLElement>("[data-virtual-strip]") ?? null;

  const seekAtClientX = (clientX: number) => {
    const scroller = scrollerOf();
    if (!scroller || !geometry) return;
    const rect = scroller.getBoundingClientRect();
    const contentX = clientX - rect.left - geometry.padLeft + scroller.scrollLeft;
    channel.set(map.timeAt(Math.min(extent, Math.max(0, contentX))));
  };

  const stopPanLoop = () => {
    if (panFrameRef.current !== null) cancelAnimationFrame(panFrameRef.current);
    panFrameRef.current = null;
  };
  const startPanLoop = () => {
    stopPanLoop();
    const step = () => {
      if (pointerIdRef.current === null) return;
      const scroller = scrollerOf();
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const clientX = lastClientXRef.current;
        const intoRight = clientX - (rect.right - STRIP_RAIL_EDGE_PX);
        const intoLeft = rect.left + STRIP_RAIL_EDGE_PX - clientX;
        let delta = 0;
        if (intoRight > 0) {
          delta = Math.min(STRIP_RAIL_MAX_PAN_PER_FRAME_PX, intoRight * 0.4);
        } else if (intoLeft > 0) {
          delta = -Math.min(STRIP_RAIL_MAX_PAN_PER_FRAME_PX, intoLeft * 0.4);
        }
        if (delta !== 0) {
          const before = scroller.scrollLeft;
          scroller.scrollLeft = before + delta;
          // Content moved under the (possibly stationary) pointer — the
          // scrub must keep following it, which is the whole point of
          // panning mid-drag.
          if (scroller.scrollLeft !== before) seekAtClientX(clientX);
        }
      }
      panFrameRef.current = requestAnimationFrame(step);
    };
    panFrameRef.current = requestAnimationFrame(step);
  };

  /** Keyboard seeks pan the thumb back into view (the pointer path pans by
   *  edge-holding instead). */
  const revealTime = (time: number) => {
    const scroller = scrollerOf();
    if (!scroller || !geometry) return;
    const x = map.xAt(time);
    const viewWidth = scroller.clientWidth - geometry.padLeft * 2;
    if (x < scroller.scrollLeft + 24) {
      scroller.scrollLeft = Math.max(0, x - 24);
    } else if (x > scroller.scrollLeft + viewWidth - 24) {
      scroller.scrollLeft = x - viewWidth + 24;
    }
  };

  if (cards.length === 0) return null;

  return (
    <div
      ref={outerRef}
      data-graph-seek-rail
      data-strip-rail
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Number((end - start).toFixed(1))}
      aria-valuenow={0}
      title="Drag to preview"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        pointerIdRef.current = event.pointerId;
        lastClientXRef.current = event.clientX;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic pointer without capture support: moves still arrive
          // while the pointer stays over the rail, which tests rely on.
        }
        seekAtClientX(event.clientX);
        startPanLoop();
      }}
      onPointerMove={(event) => {
        if (event.pointerId !== pointerIdRef.current) return;
        lastClientXRef.current = event.clientX;
        seekAtClientX(event.clientX);
      }}
      onPointerUp={(event) => {
        if (event.pointerId !== pointerIdRef.current) return;
        pointerIdRef.current = null;
        stopPanLoop();
      }}
      onPointerCancel={(event) => {
        if (event.pointerId !== pointerIdRef.current) return;
        pointerIdRef.current = null;
        stopPanLoop();
      }}
      onKeyDown={(event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const base = Math.min(end, Math.max(start, channel.get()));
        let next: number;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
          next = Math.max(start, base - SEEK_RAIL_STEP_SECONDS);
        } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
          next = Math.min(end, base + SEEK_RAIL_STEP_SECONDS);
        } else if (event.key === "Home") {
          next = start;
        } else if (event.key === "End") {
          next = end;
        } else {
          return;
        }
        channel.set(next);
        revealTime(next);
        event.preventDefault();
      }}
      // The pill wears the grid rail's exact chrome (rounded, solid track,
      // groove, ring) so both surfaces read as one control — the window IS
      // the visible track, and it ends at the LAST item when the timeline
      // fits (min with the extent, exactly like a grid rail). When the
      // timeline overflows, the pill spans the viewport and the content
      // layer slides inside it. The chrome lives on an INNER clip layer:
      // only fill and ticks clip to the pill, while the thumb rides the
      // unclipped outer in window coordinates — the circle stays whole at
      // the timeline's ends instead of being cut by the pill's corner.
      className="group absolute z-20 cursor-ew-resize touch-none rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      style={
        geometry
          ? {
              left: geometry.left,
              top: geometry.top,
              width: Math.min(extent, geometry.width),
              height: SEEK_RAIL_TRACK_PX,
            }
          : { left: 9, top: 1 + SEEK_RAIL_BAND_INSET_PX, right: 9, height: SEEK_RAIL_TRACK_PX }
      }
    >
      {/* UNPLAYED groove: a slim centred line across the visible rail (static
          — the track itself is uniform, only the fill scrolls). */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-sky-900 shadow-[inset_0_1px_2px_rgba(0,0,0,0.6)] ring-1 ring-sky-400/40 transition-shadow group-hover:ring-sky-300/60"
        style={{ height: SEEK_RAIL_GROOVE_PX }}
      />
      {/* PLAYED fill + ticks clip to the pill (full track height); transparent
          so the slim groove behind shows through the unplayed stretch. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 overflow-hidden rounded-full"
      >
        {/* Content-space layer: as wide as the timeline, translated against
            the scroller so fill and ticks stay glued to their cards. */}
        <div ref={innerRef} className="relative h-full" style={{ width: extent }}>
          <div
            ref={fillRef}
            data-rail-fill
            aria-hidden="true"
            className="absolute inset-y-0 left-0 rounded-full bg-sky-300/80"
          />
          {ticks.map((x, index) => (
            <span
              key={index}
              aria-hidden="true"
              className="absolute inset-y-0 w-px bg-white/30"
              style={{ left: x }}
            />
          ))}
        </div>
      </div>
      {/* h-3 like the grid rails: the head is visibly bigger than the slim
          track, and the band's inset keeps it clear of the cards. Window
          coordinates (painted as content x − scrollLeft), unclipped. */}
      <div
        ref={thumbRef}
        data-rail-thumb
        aria-hidden="true"
        className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)] ring-2 ring-zinc-950 transition-transform group-hover:scale-110"
      />
    </div>
  );
}

function GatewayDocumentsBridge() {
  const { registerTimelineDocument } = useTimelineDocuments();
  const seenRef = useRef<Readonly<Record<string, TimelineDocument>>>({});

  useEffect(() => {
    const sync = () => {
      const seen = seenRef.current;
      const current = graphDocumentsGateway.read();
      if (current === seen) return;
      for (const [id, document] of Object.entries(current)) {
        if (seen[id] !== document) registerTimelineDocument(document, { persist: false });
      }
      seenRef.current = current;
    };
    sync();
    return graphDocumentsGateway.subscribe(sync);
  }, [registerTimelineDocument]);

  return null;
}

// The stored manifest goes stale when a commit lands; refetch AFTER the
// write path has settled it server-side (900ms debounce + batch flight).
const MANIFEST_REFRESH_DELAY_MS = 2500;

type ManifestClipsState = Readonly<{
  clips: TimelineClip[];
  spans: PreviewCardSpans;
  forId: string;
}> | null;

/**
 * The server-compiled playback read model for the focused timeline: the
 * COMPLETE nested closure flattened into media leaves (see
 * timeline-domain/playback-manifest), so preview depth no longer depends on
 * what the session hydrated. Null until it lands (or when it can't load) —
 * the caller falls back to the live graph projection, which also covers the
 * refresh window after local edits.
 */
function useManifestClips(
  enabled: boolean,
  focusedId: string,
): Readonly<{ clips: TimelineClip[]; spans: PreviewCardSpans }> | null {
  const store = useCollectionsStore();
  const [state, setState] = useState<ManifestClipsState>(null);
  const [staleAt, setStaleAt] = useState(0);
  // Consecutive failed fetches, so a hard-down endpoint stops polling after
  // MAX_MANIFEST_FETCH_RETRIES (a good response resets it). A ref, not state:
  // it must survive the effect re-runs a retry triggers WITHOUT being a
  // dependency that would itself re-run the fetch.
  const failureCountRef = useRef(0);
  const lastFetchedIdRef = useRef(focusedId);

  // Disabling preview unsubscribes the effect below, so a commit made while
  // CLOSED would otherwise never clear the cached manifest — see
  // nextManifestClipsState's doc comment for why re-enabling must drop it.
  // Adjust during render when `enabled` flips (the repo's cascading-render-safe
  // pattern) rather than in an effect, which react-hooks/set-state-in-effect
  // forbids.
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (prevEnabled !== enabled) {
    setPrevEnabled(enabled);
    setState((prev) => nextManifestClipsState(prev, enabled));
  }

  // Reset the retry streak whenever preview toggles closed. Without this a
  // session that hit MAX_MANIFEST_FETCH_RETRIES left the count past the cap,
  // and reopening preview for the SAME focusedId (which does not trip the
  // focusedId-change reset in the fetch effect) inherited it — so the first
  // failed fetch after reopening scheduled no retry and the projection
  // fallback stood indefinitely. Done in an effect, not during render, because
  // the react-hooks rule forbids touching a ref while rendering; re-enabling
  // keeps the already-zeroed count so every reopen starts a fresh session.
  useEffect(() => {
    failureCountRef.current = nextManifestFailureCount(failureCountRef.current, enabled);
  }, [enabled]);

  // A committed change makes the held manifest STALE — discard it
  // immediately (the live projection is correct the instant the commit
  // lands and takes over), then refetch once the writes have settled. A
  // burst of edits coalesces into one delayed refetch.
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = store.subscribeToChanges(() => {
      setState(null);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => setStaleAt(Date.now()), MANIFEST_REFRESH_DELAY_MS);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [enabled, store]);

  useEffect(() => {
    if (!enabled) return;
    // Abort, not just a flag: the flag only protected state, leaving the
    // request itself running after unmount/refocus. Abort also rejects the
    // in-flight json() parse, so the signal check below is the single guard.
    const controller = new AbortController();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    // Only a retry (staleAt bump) keeps counting — a switch to a different
    // timeline starts its own streak, so timeline A's failures can't cap
    // timeline B before it has even tried.
    if (failureCountRef.current > 0 && lastFetchedIdRef.current !== focusedId) {
      failureCountRef.current = 0;
    }
    lastFetchedIdRef.current = focusedId;
    // A failed fetch (non-2xx or thrown) schedules the SAME delayed refetch as
    // the install guard, so a transient 500/network blip recovers on its own
    // while preview stays open — until the retry cap. An ABORT (our own
    // cleanup) is not a failure and must not retry, so it is filtered first.
    const scheduleRetryAfterFailure = () => {
      if (controller.signal.aborted) return;
      failureCountRef.current += 1;
      if (shouldRetryManifestFetch(failureCountRef.current)) {
        retryTimer = setTimeout(() => setStaleAt(Date.now()), MANIFEST_REFRESH_DELAY_MS);
      }
    };
    void (async () => {
      try {
        const response = await fetch(
          `/api/timelines/${encodeURIComponent(focusedId)}/preview-manifest`,
          { cache: "no-store", signal: controller.signal },
        );
        if (!response.ok) {
          scheduleRetryAfterFailure(); // projection fallback stands meanwhile
          return;
        }
        const result = (await response.json().catch(() => null)) as {
          manifest?: PlaybackManifest;
        } | null;
        if (controller.signal.aborted || !result?.manifest) return;
        // A good response ends the failure streak, whether it installs now or
        // waits behind the install guard below.
        failureCountRef.current = 0;
        // Install guard: a manifest compiled BEFORE this session's latest
        // accepted write to ANY document in the closure is pre-write server
        // state — never install it over the live projection; poll again once
        // the write has landed server-side. Per-document, not just the root:
        // a child edit bumps only the child's revision, and a stale compile
        // that installed here used to STICK until the next unrelated commit.
        // Pending writes count too: until the batch response lands, the
        // ledger can't name the revision the write will produce, so a compile
        // racing the write would pass the pure comparison — wait it out.
        if (
          manifestTrailsLedger(
            result.manifest,
            focusedId,
            (id) => graphDocumentsGateway.revisionOf(id),
            (id) => graphDocumentsGateway.hasPendingWrite(id),
          )
        ) {
          retryTimer = setTimeout(() => setStaleAt(Date.now()), MANIFEST_REFRESH_DELAY_MS);
          return;
        }
        setState({
          clips: manifestToClips(result.manifest),
          spans: cardSpansOf(result.manifest),
          forId: focusedId,
        });
      } catch {
        // projection fallback stands; retry unless this was our own abort
        scheduleRetryAfterFailure();
      }
    })();
    return () => {
      controller.abort();
      if (retryTimer !== null) clearTimeout(retryTimer);
    };
  }, [enabled, focusedId, staleAt]);

  return state !== null && state.forId === focusedId
    ? { clips: state.clips, spans: state.spans }
    : null;
}

/**
 * What the current selection adds up to — the numbers the board header shows
 * in place of the focused-timeline total while anything is selected.
 *
 * Duration comes from the SAME model the cards and the playhead use: a media
 * node's effective (trimmed) length, and for a collection the live hydrated
 * total when its subtree is loaded, falling back to the stored summary for a
 * placeholder — so a selected collection contributes what its card claims,
 * not zero. Descendants of another selected node are skipped: selecting a
 * collection and a clip inside it is one collection's worth of time, not
 * that time counted twice.
 */
export function useSelectionAggregate(): Readonly<{ count: number; seconds: number }> {
  const graph = useCollectionsSelector((snapshot) => snapshot.graph);
  const selectedIds = useCollectionsSelector((snapshot) => snapshot.interaction.selectedIds);
  const detailsStore = useGraphDetailsStore();
  const details = useSyncExternalStore(
    detailsStore.subscribe,
    detailsStore.read,
    detailsStore.read,
  );

  return useMemo(() => {
    const picked = [...selectedIds].filter((id) => graph.nodesById.has(id));
    // Drop anything already inside another selected node (the reducer prunes
    // the same way on a multi-node move).
    const selectedSet = new Set(picked);
    const roots = picked.filter((id) => {
      const seen = new Set<NodeId>();
      let parent = graph.parentById.get(id) ?? null;
      while (parent !== null && !seen.has(parent)) {
        if (selectedSet.has(parent)) return false;
        seen.add(parent);
        parent = graph.parentById.get(parent) ?? null;
      }
      return true;
    });
    let total = 0;
    for (const id of roots) {
      const node = graph.nodesById.get(id);
      if (!node) continue;
      if (node.kind === "collection") {
        const hydrated = hydratedCollectionDuration(graph, details, id);
        total += hydrated > 0 ? hydrated : (details[id as string]?.duration ?? 0);
      } else {
        total += mediaDurationSeconds(node);
      }
    }
    return { count: roots.length, seconds: total };
  }, [graph, selectedIds, details]);
}

export function PreviewShell({
  enabled,
  focusedId,
  channel,
  children,
}: Readonly<{
  enabled: boolean;
  focusedId: string;
  channel: PreviewTimeChannel;
  children: React.ReactNode;
}>) {
  const graph = useCollectionsSelector((snapshot) => snapshot.graph);
  const detailsStore = useGraphDetailsStore();
  const details = useSyncExternalStore(
    detailsStore.subscribe,
    detailsStore.read,
    detailsStore.read,
  );
  // Disabled clips are dropped and the rest repacked, matching what the
  // manifest compiles — otherwise the pane would play one timeline before the
  // manifest lands and a different one after.
  //
  // The filter lives HERE, not in `graphChildrenToClips`: that same function
  // is what graph-persistence writes to storage, so skipping clips inside it
  // would DELETE every disabled clip on the next commit.
  const projectionClips = useMemo<TimelineClip[]>(
    () =>
      enabled
        ? packTimelineClips(enabledClips(graphChildrenToClips(graph, details, focusedId)))
        : [],
    [enabled, graph, details, focusedId],
  );
  // The pane plays the manifest (full nested depth) once it lands; until
  // then — and for ~2.5s after an edit while the stored documents catch up
  // — the live focused-level projection plays. Same clock either way: the
  // projection's collection-card durations come from read-time summaries,
  // so both models agree on total time when the store is settled.
  const manifest = useManifestClips(enabled, focusedId);
  const clips = manifest?.clips ?? projectionClips;
  // Null while the pane is on the projection — the playhead's own projection
  // map is already the same clock then, so there is nothing to reconcile.
  const cardSpans = manifest?.spans ?? null;
  const [time, setTime] = useState(0);

  useEffect(() => channel.subscribe(() => setTime(channel.get())), [channel]);
  // Controlled playback: the channel is the source of truth (so play state
  // survives the pane toggling and can be set before it mounts). The surface
  // renders play/pause from `playing` and reports its own button/auto-stop
  // through `channel.setPlaying`.
  const playing = useSyncExternalStore(
    channel.subscribePlaying,
    channel.isPlaying,
    channel.isPlaying,
  );
  const handleTimeChange = useCallback(
    (next: number) => {
      setTime(next);
      channel.set(next);
    },
    [channel],
  );

  // Drilling changes focusedId: reset the scrub clock to the START of the
  // newly-focused collection. The playheads/rails read the channel, so this
  // alone moves them home; the pane itself is keyed by focusedId below so its
  // displayed FRAME resets too (otherwise the player holds the previous
  // collection's last frame across the swap — "it still shows the old one").
  useEffect(() => {
    channel.set(0);
  }, [channel, focusedId]);

  const totalDuration =
    clips.length > 0
      ? clips[clips.length - 1].startTime + clips[clips.length - 1].duration
      : 0;
  useEffect(() => {
    if (channel.get() > totalDuration) channel.set(totalDuration);
  }, [channel, totalDuration]);

  const [initialDocumentsState] = useState(() =>
    createTimelineDocumentsState({ ...graphDocumentsGateway.read() }, {}),
  );

  // Toggling the preview off UNMOUNTS the split pane, losing its height. Held
  // here (this component stays mounted) so reopening restores the height the
  // user last chose. A ref, not state — restoring only needs it at mount, and
  // the pane reports on every drag frame.
  const surfaceHeightRef = useRef<number | undefined>(undefined);
  const getInitialSurfaceHeight = useCallback(() => surfaceHeightRef.current, []);
  const handleSurfaceHeightChange = useCallback((height: number) => {
    surfaceHeightRef.current = height;
  }, []);

  // The pane's own close button goes through the SAME window event as the
  // sidebar's toggle, so `previewOn` in graph-timeline-view stays the one
  // owner of the state. Only reachable while open, so toggle IS close.
  const handleClose = useCallback(() => requestGraphPreviewToggle(), []);

  if (!enabled) return <>{children}</>;

  return (
    <TimelineDocumentsProvider initialState={initialDocumentsState}>
      <GatewayDocumentsBridge />
      {/* Test/debug witness for which read model the pane is playing. */}
      <span data-preview-source={manifest !== null ? "manifest" : "projection"} hidden />
      <WorkbenchSplitPane
        // NOT keyed by focusedId any more. That remount existed only to force
        // the player off the previous collection's frame; the surface now
        // repaints when its clip list changes, so a drill-in keeps the canvas,
        // the decoded media cache and the chosen height instead of tearing the
        // pane down and flashing black — the most visible part of "clicking
        // into a collection updates the whole screen".
        clips={clips}
        currentTime={time}
        onCurrentTimeChange={handleTimeChange}
        playing={playing}
        onPlayingChange={channel.setPlaying}
        getInitialSurfaceHeight={getInitialSurfaceHeight}
        onSurfaceHeightChange={handleSurfaceHeightChange}
        onClose={handleClose}
      >
        {/* The playhead and scrub band live in `children`; they read these
            spans so their time↔x mapping is the pane's clock, not their own. */}
        <PreviewCardSpansContext.Provider value={cardSpans}>
          {children}
        </PreviewCardSpansContext.Provider>
      </WorkbenchSplitPane>
    </TimelineDocumentsProvider>
  );
}

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
import { createPortal } from "react-dom";

import { DEFAULT_RENDER_FORMAT } from "@/lib/render/cut-list";

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
  hydratedCollectionPlayableDuration,
  hydratedCollectionPlayableSpan,
  manifestToClips,
  type DetailsById,
  type FlatItem,
  type PlaybackManifest,
} from "@storyboard/timeline-domain";

import {
  buildGridPlayheadMap,
  buildPlayheadMap,
  buildRulerCollectionSpans,
  buildRulerTicks,
  buildStripOverlay,
  cardSpansOf,
  childSpans,
  flatCardSpans,
  formatRulerTick,
  manifestTrailsLedger,
  nextManifestClipsState,
  nextManifestFailureCount,
  playableSpanSeconds,
  shouldRetryManifestFetch,
  STRIP_GAP_PX,
  type ChildSpan,
  type GridPlayheadMap,
  type LaneScope,
  type PlayheadMap,
  type PreviewCardSpans,
  type RulerWindow,
} from "./graph-playhead-model";

export type { PreviewCardSpans } from "./graph-playhead-model";
// Re-exported so existing importers keep working: these moved to their own
// modules to become testable, not to change anyone's import path.
export {
  createPreviewTimeChannel,
  type PreviewScrubPosition,
  type PreviewTimeChannel,
} from "./preview-time-channel";
export { collectionCardWidth } from "./preview-card-geometry";
// The seek rails moved to their own module (they were ~915 of this file's
// lines); re-exported so graph-board and graph-sub-timelines keep importing
// them from here.
export { GraphSeekRails, GraphStripSeekRail } from "./graph-seek-rails";
// The grid playhead sits in the same row gap the rails do, so it reads the
// rail inset rather than recomputing it — the two must not drift apart.
import { SEEK_RAIL_BAND_INSET_PX } from "./graph-seek-rails";
// The context seams live in their own module so the rails can read them
// without importing this file back (see preview-contexts).
export { FlatItemsProvider, useFlatItems, usePreviewCardSpans } from "./preview-contexts";

import {
  FlatItemsContext,
  PreviewCardSpansContext,
} from "./preview-contexts";
import {
  stripScrollerAbove,
  useScrollerTickWindow,
} from "./preview-scroller";

import { cardsFor, clipWidthAt, collectionCardWidth } from "./preview-card-geometry";
import type { PreviewScrubPosition, PreviewTimeChannel } from "./preview-time-channel";
import {
  WorkbenchDisplaySurface,
  WorkbenchSplitPane,
} from "@storyboard/ui/timeline/viewport/workbench-display-surface";
import {
  TimelineDocumentsProvider,
  useTimelineDocuments,
} from "@storyboard/ui/timeline/timeline-document-store";
import { createTimelineDocumentsState } from "@storyboard/ui/timeline/timeline-documents";
import { formatSeconds } from "@storyboard/ui/timeline/utils";
import { cloudinaryScrubProxySrc } from "@/lib/cloudinary-scrub-proxy";
import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";

import {
  peakMagnitude,
  peaksForWindow,
} from "@storyboard/ui/timeline/viewport/waveform-peaks";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { compileClientPlaybackManifest } from "@/lib/client-playback-manifest";
import { requestGraphPreviewToggle } from "@/lib/graph-view-events";
import { readPreviewSplit, writePreviewSplit } from "@/lib/preview-split-store";
import { useItemDetails } from "./graph-item-details-context";
import { PreviewScrubRail } from "./preview-scrub-rail";
import { sharedWaveformCache, type WaveformCache } from "@/lib/waveform-cache";

import {
  distinctWaveformKeys,
  waveformSourcesFor,
  type WaveformSource,
} from "./graph-waveform-model";

import { useGraphDetailsStore } from "./graph-details-context";
import {
  TrimPreviewProvider,
  useTrimPreviewFrame,
  useTrimPreviewStore,
} from "./graph-trim-preview";
import { GRID_GAP, TIMELINE_PPS } from "./graph-view-config";
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
  const flatItems = useContext(FlatItemsContext);
  return useMemo(() => {
    // 0 card height: this readout is counts and seconds, never geometry, so
    // the collection aspect floor has nothing to act on here.
    //
    // ALL lanes, unlike every other caller: a bed is a clip the user put on
    // this timeline whatever row it ended up on, so it belongs in the count —
    // and `playableSpanSeconds` takes the LONGEST lane, not their sum, so it
    // still reports what a viewer would sit through.
    const cards = cardsFor(graph, details, focusedId, spans, pixelsPerSecond, 0, flatItems, "all");
    // Enabled-only, both numbers: this readout says what a viewer would sit
    // through, which is NOT how far the playhead travels now that disabled
    // cards keep their span. The two disagree by design — the ruler runs
    // longer than the total claimed here whenever something is disabled.
    return {
      count: cards.filter((card) => card.disabled !== true).length,
      // FROM THE GRAPH, not from the card spans. `playableSpanSeconds` measures
      // what the strip DRAWS, and a card whose descendants are disabled keeps
      // its full slot — so this readout claimed 23:01 while its own three cards
      // summed to about 20:45. The spans carry no node id, so the playable
      // length cannot be recovered from them; it has to be walked.
      seconds: hydratedCollectionPlayableSpan(
        graph,
        details,
        focusedId as NodeId,
        graphDocumentsGateway.isKnownMissing,
      ),
    };
  }, [graph, details, focusedId, spans, pixelsPerSecond, flatItems]);
}


export function GraphPlayhead({
  focusedId,
  channel,
  pixelsPerSecond,
  cardHeight,
  activeWindow,
  laneScope = "all",
}: Readonly<{
  focusedId: string;
  channel: PreviewTimeChannel;
  pixelsPerSecond: number;
  /** "picture" when the strip below draws lanes as separate ROWS, so this
   *  measures the row it is actually over. Sub-timeline rows draw every child
   *  in ONE row and keep the default. */
  laneScope?: LaneScope;
  /** The strip's `itemHeight`. Feeds the collection aspect floor, so this
   *  marker lands on the same card edges the strip actually draws. */
  cardHeight: number;
  /** When set (sub-rows), the marker is hidden while the global clock is
   *  outside this collection's window — only the row the clock is currently
   *  inside shows it, so one clock appears to sweep through the tree. The
   *  focused row passes none and always shows it. */
  activeWindow?: Readonly<{ start: number; end: number }>;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  const flatItems = useContext(FlatItemsContext);
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
        cardsFor(
          graph,
          details,
          focusedId,
          spans,
          pixelsPerSecond,
          cardHeight,
          flatItems,
          laneScope,
        ),
      );
      return true;
    };
    // Position-only style write, for the current clock time — or, while this
    // surface is being scrubbed, for the POINTER (see PreviewScrubPosition:
    // an empty collection is width with no time, so time alone cannot say
    // where the pointer is inside it).
    const paint = () => {
      const line = lineRef.current;
      if (!line || !map) return;
      const scrub = channel.getScrub();
      const scrubX = scrub && scrub.surfaceId === focusedId ? scrub.x : null;
      const time = channel.get();
      // 40ms of slack so the marker doesn't blink off at the exact seam
      // between two adjacent collections.
      const inside =
        !activeWindow || (time >= activeWindow.start - 0.04 && time <= activeWindow.end + 0.04);
      line.style.display = inside ? "" : "none";
      if (inside) line.style.transform = `translateX(${scrubX ?? map.xAt(time)}px)`;
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
  }, [
    store,
    detailsStore,
    focusedId,
    channel,
    spans,
    pixelsPerSecond,
    cardHeight,
    activeWindow,
    flatItems,
    laneScope,
  ]);

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
/**
 * The chunk-quantized visible content-x range of a strip scroller — the window
 * every overlay on that strip builds against.
 *
 * Takes the SCROLLER rather than finding it, because its two callers reach it
 * differently: the ruler rides the strip's own overlay layer (so it climbs
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
  cardHeight,
  laneScope = "all",
}: Readonly<{
  focusedId: string;
  pixelsPerSecond: number;
  /** See GraphPlayhead: "picture" when the strip draws lanes as rows. */
  laneScope?: LaneScope;
  /** The strip's `itemHeight` — feeds the collection aspect floor so ticks
   *  and collection stretches land on the widths the strip draws. */
  cardHeight: number;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  // State, not a ref: the tick-window hook needs the scroller on the render
  // pass after mount, and render-time ref reads are illegal.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const rulerRef = useCallback(
    (element: HTMLElement | null) =>
      setScroller(element ? stripScrollerAbove(element) : null),
    [],
  );
  const tickWindow = useScrollerTickWindow(scroller);
  const flatItems = useContext(FlatItemsContext);
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
  const { ticks, collectionSpans, skips } = useMemo(() => {
    const cards = cardsFor(
      graph,
      details,
      focusedId,
      spans,
      pixelsPerSecond,
      cardHeight,
      flatItems,
      laneScope,
    );
    // A flat run holds no collections at all, so every card is ruled — the
    // blank-interior rule exists only for collection cards.
    const isCollection = flatItems
      ? cards.map(() => false)
      : graphChildrenToClips(graph, details, focusedId).map(
          (clip) => clip.kind === "collection",
        );
    return {
      ticks: buildRulerTicks(cards, isCollection, pixelsPerSecond, tickWindow),
      // A collection's interior gets no ticks (its width is not a time axis)
      // — fill its stretch of the band with the content duration instead
      // (R7 #4), same live-derived total the card badge shows.
      collectionSpans: buildRulerCollectionSpans(cards, isCollection, tickWindow),
      // Same segments the seek rail dims, so a skipped stretch reads as one
      // run down through the ruler and the scrubber — and windowed to the same
      // range as the ticks beside them.
      skips: buildStripOverlay(cards, tickWindow).skips,
    };
  }, [
    graph,
    details,
    spans,
    focusedId,
    pixelsPerSecond,
    cardHeight,
    tickWindow,
    flatItems,
    laneScope,
  ]);

  return (
    <div
      ref={rulerRef}
      aria-hidden="true"
      data-graph-ruler
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[18px]"
    >
      {/* Opaque band: the ticks used to be thin translucent lines painted over
          the thumbnails and washed out against bright frames. A solid dark
          strip with a bright baseline keeps the whole ruler legible over ANY
          clip, at every zoom. */}
      <div className="absolute inset-x-0 top-0 h-[18px] border-b border-sky-400/50 bg-zinc-950/90" />
      {/* Skipped stretches, under the ticks: the band goes flat and gray where
          playback will not travel, so the ruler reads as measuring a timeline
          with holes in it rather than one continuous run. */}
      {skips.map((segment) => (
        <div
          key={`skip-${segment.x}`}
          data-ruler-skip
          className="absolute top-0 h-[18px] bg-zinc-700/50"
          style={{ transform: `translateX(${segment.x}px)`, width: segment.width }}
        />
      ))}
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
            <span className="absolute left-[3px] top-[2px] whitespace-nowrap font-mono text-[11px] font-medium leading-none text-sky-100">
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
            className="absolute top-[2px] -translate-x-1/2 whitespace-nowrap font-mono text-[11px] font-medium leading-none text-sky-200/90"
            style={{ left: span.x + span.width / 2 }}
          >
            {formatRulerTick(Math.round(span.seconds * 10) / 10)}
          </span>
        ) : null,
      )}
    </div>
  );
}

/** Lane height. Tall enough that a pause reads as a gap rather than a wobble,
 *  short enough to sit under the ruler without eating card space. */
const WAVEFORM_BAND_HEIGHT_PX = 28;

/**
 * The scrubbing waveform: each card's audio drawn at the card's own width, so a
 * pause in the dialogue lines up with the frame it happens on.
 *
 * Modeled on `GraphRuler` above — same overlay layer, same windowing, same
 * content coordinates — with one difference that matters: it draws to a CANVAS.
 * Everything else in the rails is div + CSS, which is right for tens of ticks
 * and wrong for thousands of waveform columns.
 *
 * The canvas is sized to the VISIBLE WINDOW, not to the full extent: at high
 * zoom a long timeline's extent runs past the browser's maximum canvas width,
 * and allocating that much backing store to show 1200px of it is waste besides.
 */
export function GraphWaveformBand({
  focusedId,
  pixelsPerSecond,
  cardHeight,
  laneScope = "all",
  /** Injected so a story can supply synthetic peaks without decoding audio. */
  cache = sharedWaveformCache(),
}: Readonly<{
  focusedId: string;
  pixelsPerSecond: number;
  cardHeight: number;
  /** See GraphPlayhead: "picture" when the strip draws lanes as rows. The
   *  waveform sources are picture-only to match, so the two stay aligned. */
  laneScope?: LaneScope;
  cache?: WaveformCache;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const bandRef = useCallback(
    (element: HTMLElement | null) => setScroller(element ? stripScrollerAbove(element) : null),
    [],
  );
  const tickWindow = useScrollerTickWindow(scroller);
  const flatItems = useContext(FlatItemsContext);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
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
  // Bumped when a decode lands, purely to re-run the paint effect.
  const [peaksVersion, setPeaksVersion] = useState(0);
  useEffect(
    () => cache.subscribe(() => setPeaksVersion((version) => version + 1)),
    [cache],
  );

  const { cards, sources, extent } = useMemo(() => {
    const nextCards = cardsFor(
      graph,
      details,
      focusedId,
      spans,
      pixelsPerSecond,
      cardHeight,
      flatItems,
    );
    return {
      cards: nextCards,
      // Index-aligned with the cards by contract — see graph-waveform-model.
      sources: waveformSourcesFor(graph, details, focusedId, flatItems),
      extent: buildStripOverlay(nextCards).extent,
    };
  }, [graph, details, spans, focusedId, pixelsPerSecond, cardHeight, flatItems]);

  // Ask for the audio the VISIBLE cards need. Requesting the whole timeline
  // would fetch every file on mount; the cache coalesces and caps concurrency,
  // but the cheapest fetch is the one never issued.
  useEffect(() => {
    let cursor = 0;
    const wanted: WaveformSource[] = [];
    cards.forEach((card, index) => {
      const visible = cursor + card.width >= tickWindow.startX && cursor <= tickWindow.endX;
      const source = sources[index];
      if (visible && source) wanted.push(source);
      cursor += card.width + STRIP_GAP_PX;
    });
    for (const source of distinctWaveformKeys(wanted)) {
      void cache.request(source.key, source.src);
    }
  }, [cache, cards, sources, tickWindow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const windowWidth = Math.max(1, Math.min(extent, tickWindow.endX - tickWindow.startX));
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(windowWidth * ratio);
    const pixelHeight = Math.round(WAVEFORM_BAND_HEIGHT_PX * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, windowWidth, WAVEFORM_BAND_HEIGHT_PX);

    const midline = WAVEFORM_BAND_HEIGHT_PX / 2;
    let cursor = 0;
    let drawn = 0;

    cards.forEach((card, index) => {
      const cardStart = cursor;
      cursor += card.width + STRIP_GAP_PX;

      const source = sources[index];
      if (!source) return;
      if (cardStart + card.width < tickWindow.startX || cardStart > tickWindow.endX) return;

      const peaks = cache.peek(source.key);
      if (!peaks) return;

      const columns = Math.max(1, Math.round(card.width));
      const window_ = peaksForWindow(peaks, source.trimIn, source.trimOut, columns);
      const magnitude = peakMagnitude(window_);
      // Generated renders come out quiet and inconsistent, so normalise per
      // clip — raw amplitude makes a whole lane look flat. Silence stays flat
      // rather than being amplified into noise.
      const scale = magnitude > 0.001 ? (WAVEFORM_BAND_HEIGHT_PX / 2 - 1) / magnitude : 0;

      context.fillStyle = card.disabled === true ? "rgba(161,161,170,0.35)" : "rgba(125,211,252,0.85)";
      for (let column = 0; column < columns; column += 1) {
        // Peaks are written in min/max PAIRS; a half-written column is skipped
        // rather than drawn as a spike at zero.
        const rawMin = window_[column * 2];
        const rawMax = window_[column * 2 + 1];
        if (rawMin === undefined || rawMax === undefined) continue;
        const min = rawMin * scale;
        const max = rawMax * scale;
        const top = midline - Math.max(max, 0.5);
        const height = Math.max(1, Math.max(max, 0.5) - Math.min(min, -0.5));
        // Canvas x is window-relative: the element is translated to startX.
        context.fillRect(cardStart + column - tickWindow.startX, top, 1, height);
      }
      drawn += 1;
    });

    canvas.dataset.waveformCards = String(drawn);
  }, [cache, cards, sources, extent, tickWindow, peaksVersion]);

  return (
    <div
      ref={bandRef}
      aria-hidden="true"
      data-graph-waveform
      data-waveform-extent={Math.round(extent)}
      // BOTTOM of the card, not the top. The overlay spans the full card
      // height, so a lane at the top stacks under the ruler and eats a third of
      // every thumbnail; along the bottom edge it reads the way audio does in
      // any editor, over the least informative part of the frame.
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10"
      style={{ height: WAVEFORM_BAND_HEIGHT_PX }}
    >
      <div
        className="absolute inset-x-0 top-0 bg-gradient-to-t from-zinc-950/85 to-zinc-950/40"
        style={{ height: WAVEFORM_BAND_HEIGHT_PX }}
      />
      <canvas
        ref={canvasRef}
        data-testid="graph-waveform-canvas"
        className="absolute top-0"
        style={{
          transform: `translateX(${tickWindow.startX}px)`,
          width: Math.max(1, Math.min(extent, tickWindow.endX - tickWindow.startX)),
          height: WAVEFORM_BAND_HEIGHT_PX,
        }}
      />
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
        // 0 card height: grid cells are uniform and this map lays out by
        // `cellWidth`, never by the per-clip width, so the strip's collection
        // aspect floor has nothing to act on here.
        //
        // ALL lanes, and it must be: this map pairs cards to cells BY INDEX,
        // and a grid draws every child — it has no time axis, so nothing is
        // laid onto a lane there. Handing it the strip's picture-only cards
        // would shift every cell after the first layered clip and point the
        // marker at the wrong one.
        childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond, 0), "all"),
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
      // While THIS grid is being scrubbed the line rides the pointer rather
      // than the clock: a collection with no items is a full cell of width
      // holding no time, so `posAt` of that instant can only ever return the
      // cell's left edge (see PreviewScrubPosition).
      const scrub = channel.getScrub();
      const pos = map.posAt(time);
      const { x, y } =
        scrub && scrub.surfaceId === focusedId && scrub.y !== undefined
          ? { x: scrub.x, y: scrub.y }
          : pos;
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
      // WHITE, matching the preview's scrub line (PL16-006). It was red, which
      // is the editing convention for a playhead — but the two are the same
      // playhead seen in two places, and showing it in two colours said they
      // were different things. The glow goes white with it; a white line over a
      // red halo reads as a mistake rather than as emphasis.
      //
      // AND HALF-STRENGTH. The line crosses the CARDS — it runs down the
      // artwork someone is judging — while the rail's thumb above it sits on
      // chrome. At full white the line competed with the frames it was drawn
      // over; at half it still reads as one continuous mark without becoming
      // part of the picture.
      //
      // `opacity`, NOT `bg-white/50`. The glow has to fade with the line: a
      // full-strength halo around a half-strength mark reads as a rendering
      // fault rather than as emphasis, which is the same reason the colour was
      // unified above.
      //
      // THE HEAD KEEPS FULL STRENGTH, and is not this element — it is the seek
      // rail's circular thumb, on chrome above the grid. That is the part you
      // aim at, so it stays at full opacity deliberately.
      className="absolute top-0 left-0 w-0.5 bg-white opacity-50 shadow-[0_0_6px_rgba(255,255,255,0.9)]"
    />
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
  /** The last INSTALLED manifest and the `focusedId:staleAt` it was compiled
   *  for. Single slot: this exists for the close-and-reopen case, where the key
   *  is unchanged; switching timelines evicts, which is the honest bound on how
   *  much compiled state a preview panel should hold. */
  const manifestCacheRef = useRef<{ key: string; manifest: PlaybackManifest } | null>(null);

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

    // REUSE THE LAST MANIFEST when nothing it was compiled from has changed.
    //
    // Closing and reopening preview re-ran this effect and refetched identical
    // bytes — measured at ~149 document reads per toggle on a 143-collection
    // project, for a manifest that could not have changed because no commit
    // happened in between. The server has no cache, so every one of those
    // walked the whole closure again.
    //
    // `staleAt` is already the "content moved" signal: the subscription above
    // bumps it after every committed change (and a failed fetch bumps it to
    // retry). Keying on it means an edit invalidates the memo exactly when it
    // should, and a toggle does not.
    //
    // RE-CHECKED THROUGH THE INSTALL GUARD rather than trusted. A cached
    // manifest that passed `manifestTrailsLedger` when it arrived can still
    // fall behind it afterwards — a write that was pending then may have
    // settled since, moving the ledger without producing a commit of its own.
    // Running the same comparison keeps the guard's invariant intact instead of
    // carving an exception into it for cached values.
    // COMPILE IT HERE when this session provably holds the whole closure.
    //
    // The server route re-reads every document under the root to compile the
    // same thing — ~149 reads on a 143-collection project, repeated after every
    // edit while preview is open, all of it re-reading documents `ensureClosure`
    // primed on entry and the gateway has kept current since.
    //
    // Refuses and falls through to the fetch when anything under the root is
    // not loaded, or on a cycle. That guard is the whole reason this is safe:
    // the manifest exists so playback depth does not depend on how much of the
    // graph a session happens to have hydrated, and compiling from a partial
    // closure would silently play nothing for a collection below the hydration
    // depth. The server reads from storage and has no such limit.
    //
    // Installed WITHOUT `manifestTrailsLedger`, unlike a fetched manifest. That
    // guard catches a server compile that read pre-write state; this one is
    // compiled from the very documents this session's writes produced, so it
    // cannot trail them — it is the live projection, at full depth.
    const localManifest = compileClientPlaybackManifest(
      graphDocumentsGateway.read(),
      focusedId,
      (id) => graphDocumentsGateway.revisionOf(id),
      new Date().toISOString(),
      // Dangling references are the server's answer, remembered — without this
      // a project containing any (every export has them, since export drops
      // branches whose documents are gone) could never compile locally.
      (id) => graphDocumentsGateway.isKnownMissing(id),
    );
    if (localManifest !== null) {
      // Installed on a zero timer rather than straight from the effect body —
      // the same move, and the same reason, as the fetch kick-off below: this
      // sets state, and the cascading-render lint cannot see an await that
      // makes it asynchronous because there isn't one. Zero is immediate in
      // practice, and the timer is cleared on teardown so a focus change
      // cannot install a manifest for the timeline you just left.
      const installTimer = setTimeout(() => {
        setState({
          clips: manifestToClips(localManifest),
          spans: cardSpansOf(localManifest),
          forId: focusedId,
        });
      }, 0);
      return () => clearTimeout(installTimer);
    }

    const cacheKey = `${focusedId}:${staleAt}`;
    const cached = manifestCacheRef.current;
    if (
      cached !== null &&
      cached.key === cacheKey &&
      !manifestTrailsLedger(
        cached.manifest,
        focusedId,
        (id) => graphDocumentsGateway.revisionOf(id),
        (id) => graphDocumentsGateway.hasPendingWrite(id),
      )
    ) {
      setState({
        clips: manifestToClips(cached.manifest),
        spans: cardSpansOf(cached.manifest),
        forId: focusedId,
      });
      return;
    }

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
        // Cached only AFTER the install guard passed, so the memo can never
        // hold a manifest this session already judged pre-write.
        manifestCacheRef.current = { key: cacheKey, manifest: result.manifest };
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
export function useSelectionCount(): number {
  const graph = useCollectionsSelector((snapshot) => snapshot.graph);
  const selectedIds = useCollectionsSelector((snapshot) => snapshot.interaction.selectedIds);

  return useMemo(() => {
    const picked = [...selectedIds].filter((id) => graph.nodesById.has(id));
    // Drop anything already inside another selected node (the reducer prunes
    // the same way on a multi-node move), so the header counts what an action
    // would actually operate on rather than what was clicked.
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
    return roots.length;
  }, [graph, selectedIds]);
}

export function PreviewShell({
  enabled,
  focusedId,
  projectId,
  channel,
  header,
  children,
}: Readonly<{
  enabled: boolean;
  focusedId: string;
  /** Which project's remembered split to use. See `preview-split-store`. */
  projectId: string;
  channel: PreviewTimeChannel;
  /**
   * Pinned above the preview surface — the board's breadcrumb/select row.
   *
   * Passed straight through to the split pane's own slot rather than rendered
   * with `children`. React resolves context by where an element RENDERS, not
   * where it was created, and the pane sits inside the same providers as the
   * rest of the board — so the row keeps everything it reads today.
   */
  header?: React.ReactNode;
  children: React.ReactNode;
}>) {
  /**
   * THE DETAILS VIEW TAKES THE WHOLE CONTENT AREA, PANE INCLUDED (PL16-003).
   *
   * The pane is the top of this shell's sticky stack and the details view is
   * one of its children, so opening a clip from the grid built the view
   * UNDERNEATH a preview that stayed exactly where it was. The view is not a
   * panel inside the board — since PL15-029 it IS the content area — and a
   * content area with something else pinned above it is not one.
   *
   * STOOD DOWN RATHER THAN COVERED. Painting the view over a live pane would
   * leave a second video decoding behind it for the whole visit, and would
   * leave `usePublishTrimPreview` reporting that the pane had TAKEN the scrub
   * frame — which is what tells the deck not to show it. Both problems go away
   * if the pane is simply not there.
   *
   * The breadcrumb row is untouched: it is this shell's `header` slot, not its
   * child, and knowing where you are is exactly as useful inside a clip.
   */
  /**
   * THE PANE STAYS UP WHILE THE DETAILS VIEW IS OPEN, and the view covers it.
   *
   * There were two of these for a while — one that unmounted the pane for the
   * duration and one that painted over it — behind `?previewmode=` so they
   * could be compared on one build. Covering won: the pane is exactly where you
   * left it when you come back out, with no re-open, and the cost is one video
   * decoding behind something nobody can see. The switch and the other path are
   * gone rather than left as dead configuration.
   *
   * WHAT SURVIVES FROM THAT COMPARISON is the one thing that was held constant
   * across both: the pane stops TAKING the scrub frame while the view is up. A
   * covered pane would be showing it to nobody, and its reporting that it took
   * the frame is what tells the deck not to show one.
   */
  const { openId: detailsOpenId } = useItemDetails();
  const previewOwnsTrimFrame = enabled && detailsOpenId === null;

  const graph = useCollectionsSelector((snapshot) => snapshot.graph);
  const detailsStore = useGraphDetailsStore();
  const details = useSyncExternalStore(
    detailsStore.subscribe,
    detailsStore.read,
    detailsStore.read,
  );
  // Disabled clips ride through UNFILTERED and unrepacked, matching what the
  // manifest now compiles — otherwise the pane would play one timeline before
  // the manifest lands and a different one after. They already carry
  // `disabled` off the graph node (see graphChildrenToClips), and the display
  // surface is what acts on it: jump the span while playing, gray it while
  // scrubbing.
  const projectionClips = useMemo<TimelineClip[]>(
    () => (enabled ? graphChildrenToClips(graph, details, focusedId) : []),
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
  // Same pattern for audio. The server snapshot returns the DEFAULTS rather
  // than the stored preference: localStorage is unreadable during SSR, and
  // returning a different value there than on the client would hydrate-mismatch.
  const volume = useSyncExternalStore(channel.subscribeAudio, channel.getVolume, () => 1);
  const muted = useSyncExternalStore(channel.subscribeAudio, channel.isMuted, () => false);
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

  const lastClip = clips[clips.length - 1];
  const totalDuration =
    lastClip === undefined ? 0 : lastClip.startTime + lastClip.duration;
  /**
   * WHERE ONE CLIP BECOMES THE NEXT, as fractions of the whole.
   *
   * The scrubber cuts a gap through its bar at each of these, so a sequence
   * reads as a set of shots rather than one undifferentiated span. Drawn from
   * the same `clips` the pane plays, so they cannot drift from what a scrub
   * actually lands on.
   *
   * THE FIRST CLIP'S START IS NOT A BOUNDARY — it is the beginning of the bar,
   * and a tick there is a notch out of the left cap for no reason.
   */
  // STABLE IDENTITIES, both of them. The pane reads the getter once at mount
  // and holds the change callback in an effect dependency, so a new function on
  // every render would re-run that effect on every drag frame.
  const readInitialSplit = useCallback(() => readPreviewSplit(projectId), [projectId]);
  const persistSplit = useCallback(
    (height: number) => writePreviewSplit(projectId, height),
    [projectId],
  );
  const clipBoundaries = useMemo(
    () =>
      totalDuration <= 0
        ? []
        : clips
            .slice(1)
            .map((clip) => clip.startTime / totalDuration)
            .filter((at) => at > 0 && at < 1),
    [clips, totalDuration],
  );
  useEffect(() => {
    if (channel.get() > totalDuration) channel.set(totalDuration);
  }, [channel, totalDuration]);

  const [initialDocumentsState] = useState(() =>
    createTimelineDocumentsState({ ...graphDocumentsGateway.read() }, {}),
  );

  // The pane's own close button goes through the SAME window event as the
  // sidebar's toggle, so `previewOn` in graph-timeline-view stays the one
  // owner of the state. Only reachable while open, so toggle IS close.
  const handleClose = useCallback(() => requestGraphPreviewToggle(), []);

  // Owned HERE because both ends are here: the cards publish into it (through
  // the provider below) and the pane reads it as a prop (PL14-006).
  const trimStore = useTrimPreviewStore();
  const trimFrame = useTrimPreviewFrame(trimStore);

  return (
    <TimelineDocumentsProvider initialState={initialDocumentsState}>
      {enabled ? <GatewayDocumentsBridge /> : null}
      {/* Test/debug witness for which read model the pane is playing. */}
      {enabled ? (
        <span data-preview-source={manifest !== null ? "manifest" : "projection"} hidden />
      ) : null}
      <WorkbenchSplitPane
        header={header}
        // THE SPLIT SURVIVES THE SESSION (PL16-007).
        //
        // A GETTER, read once at mount, because the pane treats a remembered
        // height as the user's own and skips its one-time automatic fit — so
        // this has to answer before the first layout, not after it.
        getInitialSurfaceHeight={readInitialSplit}
        // WRITTEN ON EVERY DRAG FRAME, which is why the read side is a ref and
        // not state: this fires many times a second while the edge is moving,
        // and a `setState` here would re-render the whole board on each one.
        // `localStorage` writes are synchronous but cheap at this size.
        onSurfaceHeightChange={persistSplit}
        // The shell and lower pane stay mounted whether the surface is open or
        // closed. That keeps the virtual strip DOM node—and therefore its
        // horizontal scroll position—alive through the preview toggle.
        surface={
          enabled ? (
            <WorkbenchDisplaySurface
              clips={clips}
              // A small twin of each clip, seeked alongside the real element so
              // the picture keeps up with a dragging playhead. The surface has
              // no idea what Cloudinary is; it only knows some sources have a
              // faster one behind them.
              getScrubProxySrc={cloudinaryScrubProxySrc}
              // So a layered clip's inset lands where the RENDER will put it.
              // Its rectangle is normalized to the output frame, which is a
              // different box from the picture whenever the source's shape
              // differs from the render's.
              outputAspect={DEFAULT_RENDER_FORMAT.width / DEFAULT_RENDER_FORMAT.height}
              currentTime={time}
              onCurrentTimeChange={handleTimeChange}
              playing={playing}
              onPlayingChange={channel.setPlaying}
              volume={volume}
              onVolumeChange={channel.setVolume}
              muted={muted}
              onMutedChange={channel.setMuted}
              onClose={handleClose}
              // A trim drag hands the pane a frame to draw (PL14-006). Not an
              // overlay over the pane — the pane's own canvas, its own cached
              // video, its own geometry. `currentTime` above is untouched
              // throughout, which is what keeps the playhead where it was.
              frameOverride={trimFrame}
              // THE SCRUB LINE, in the surface's own band below the picture.
              // Through the slot rather than as an overlay: the picture is
              // `flex-1` in that column, so the line takes its height from the
              // picture and overlaps nothing — and the transport, which hangs
              // off the surface's bottom edge, does not move.
              underPicture={
                // 4px BELOW THE FRAME, 14px IN FROM EACH SIDE — the spec's own
                // numbers. The gap exists so the track never fuses with the
                // bottom of a bright clip; the inset lines the scrubber up with
                // the controls row beneath it.
                <div className="px-[14px] pt-1">
                <PreviewScrubRail
                  channel={channel}
                  totalSeconds={totalDuration}
                  boundaries={clipBoundaries}
                />
                </div>
              }
              className="h-full rounded-b-none border-b-0"
            />
          ) : null
        }
      >
        {/* The playhead and scrub band live in `children`; they read these
            spans so their time↔x mapping is the pane's clock, not their own. */}
        <PreviewCardSpansContext.Provider value={cardSpans}>
          {/* The board renders here, so every trim handle is inside this
              provider and can publish the frame it wants shown. */}
          <TrimPreviewProvider previewOpen={previewOwnsTrimFrame} store={trimStore}>
            {children}
          </TrimPreviewProvider>
        </PreviewCardSpansContext.Provider>
      </WorkbenchSplitPane>
    </TimelineDocumentsProvider>
  );
}

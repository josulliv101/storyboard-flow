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
  useCollectionsSelector,
  useCollectionsStore,
  type CollectionsGraph,
} from "@storyboard/ui/dnd-collections";
import {
  graphChildrenToClips,
  manifestToClips,
  type DetailsById,
  type PlaybackManifest,
} from "@storyboard/timeline-domain";

import {
  STRIP_GAP_PX,
  buildGridPlayheadMap,
  buildPlayheadMap,
  cardSpansOf,
  childSpans,
  manifestTrailsLedger,
  nextManifestClipsState,
  nextManifestFailureCount,
  shouldRetryManifestFetch,
  type GridPlayheadMap,
  type PlayheadMap,
  type PreviewCardSpans,
} from "./graph-playhead-model";

export type { PreviewCardSpans } from "./graph-playhead-model";
import { WorkbenchSplitPane } from "@storyboard/ui/timeline/viewport/workbench-display-surface";
import {
  TimelineDocumentsProvider,
  useTimelineDocuments,
} from "@storyboard/ui/timeline/timeline-document-store";
import { createTimelineDocumentsState } from "@storyboard/ui/timeline/timeline-documents";
import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";

import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";

import { useGraphDetailsStore } from "./graph-details-context";
import { GRID_GAP, TIMELINE_PPS } from "./graph-view-config";

export type PreviewTimeChannel = Readonly<{
  get: () => number;
  set: (time: number) => void;
  subscribe: (listener: () => void) => () => void;
}>;

export function createPreviewTimeChannel(): PreviewTimeChannel {
  let time = 0;
  const listeners = new Set<() => void>();
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
    const paint = () => {
      const graph = store.getSnapshot().graph;
      const details = detailsStore.read();
      if (graph !== lastGraph || details !== lastDetails) {
        lastGraph = graph;
        lastDetails = details;
        map = buildPlayheadMap(childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond)));
      }
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
    paint();
    const unsubscribeTime = channel.subscribe(paint);
    const unsubscribeStore = store.subscribe(paint);
    const unsubscribeDetails = detailsStore.subscribe(paint);
    return () => {
      unsubscribeTime();
      unsubscribeStore();
      unsubscribeDetails();
    };
  }, [store, detailsStore, focusedId, channel, spans, pixelsPerSecond, activeWindow]);

  return (
    <div
      ref={lineRef}
      data-graph-playhead
      className="absolute inset-y-0 left-0 w-0.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]"
    >
      <div className="absolute -left-[5px] -top-2 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-red-500" />
    </div>
  );
}

const RULER_LABEL_MIN_GAP_PX = 46;
const RULER_MINOR_MIN_GAP_PX = 6;
const RULER_NICE_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const RULER_MAX_SUBTIER = 3;
/** Tick height per tier: 0 = labeled major (full band), then progressively
 *  shorter minors (half / quarter / eighth). Index by `level`. */
const RULER_TIER_HEIGHT_PX = [18, 11, 8, 5];

/** The labeled (major) tick interval — the nicest whole-second count whose
 *  on-screen gap clears the label minimum at this zoom. */
function rulerMajorSpacing(pixelsPerSecond: number): number {
  const target = RULER_LABEL_MIN_GAP_PX / Math.max(1, pixelsPerSecond);
  return (
    RULER_NICE_SECONDS.find((step) => step >= target) ??
    RULER_NICE_SECONDS[RULER_NICE_SECONDS.length - 1]
  );
}

/** How many binary subdivisions of the major fit as MINOR ticks — major/2,
 *  /4, /8 (half, quarter, eighth of the major; at a 1s major these are the
 *  half/quarter/eighth SECOND ticks). Each tier is added only while its gap
 *  still clears the minor minimum, so zooming out drops the finest tiers. */
function rulerSubtierCount(majorSpacing: number, pixelsPerSecond: number): number {
  let tiers = 0;
  while (
    tiers < RULER_MAX_SUBTIER &&
    (majorSpacing / 2 ** (tiers + 1)) * pixelsPerSecond >= RULER_MINOR_MIN_GAP_PX
  ) {
    tiers += 1;
  }
  return tiers;
}

/** The tier a tick at finest-step index `n` belongs to: the COARSEST whose
 *  spacing divides it (more trailing power-of-two factors = coarser tier).
 *  0 is the labeled major. */
function rulerTickLevel(index: number, maxTier: number): number {
  if (index === 0) return 0;
  let trailing = 0;
  let value = index;
  while (trailing < maxTier && value % 2 === 0) {
    value /= 2;
    trailing += 1;
  }
  return maxTier - trailing;
}

function formatRulerTick(seconds: number): string {
  if (seconds < 60) return Number.isInteger(seconds) ? `${seconds}s` : `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
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
 */
export function GraphRuler({
  focusedId,
  pixelsPerSecond,
}: Readonly<{ focusedId: string; pixelsPerSecond: number }>) {
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

  const ticks = useMemo(() => {
    const clips = graphChildrenToClips(graph, details, focusedId);
    const cards = childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond));
    if (cards.length === 0) return [];
    const map = buildPlayheadMap(cards);
    const total = map.totalDurationSeconds;
    if (total <= 0) return [];

    // Card x-ranges + collection flag, in the SAME cumulative layout the map
    // walks — so a tick's x can be tested against the collection interiors.
    // Each card's left is the summed widths+gaps before it (no running
    // accumulator to mutate — keeps the memo body free of reassignment).
    const ranges = cards.map((card, index) => {
      const x0 = cards
        .slice(0, index)
        .reduce((sum, previous) => sum + previous.width + STRIP_GAP_PX, 0);
      return { x0, x1: x0 + card.width, isCollection: clips[index]?.kind === "collection" };
    });
    const inCollectionInterior = (cx: number) =>
      ranges.some((range) => range.isCollection && cx > range.x0 + 1 && cx <= range.x1);

    // Tiered ticks: a labeled MAJOR every `major` seconds, plus half / quarter
    // / eighth minors between them — as many tiers as clear the minor gap at
    // this zoom (item R6 #2). Stepping by the FINEST spacing and assigning each
    // step its coarsest tier keeps every tier aligned to the major grid.
    const major = rulerMajorSpacing(pixelsPerSecond);
    const maxTier = rulerSubtierCount(major, pixelsPerSecond);
    const finest = major / 2 ** maxTier;
    const steps = Math.floor((total + 1e-6) / finest);
    const out: Array<{ x: number; level: number; label: string }> = [];
    for (let n = 0; n <= steps; n += 1) {
      const t = n * finest;
      const cx = map.xAt(t);
      if (inCollectionInterior(cx)) continue;
      const level = rulerTickLevel(n, maxTier);
      out.push({ x: cx, level, label: level === 0 ? formatRulerTick(Math.round(t * 1000) / 1000) : "" });
    }
    // A minor edge tick bracketing each collection's blank interior.
    for (const range of ranges) {
      if (range.isCollection) out.push({ x: range.x0, level: 1, label: "" });
    }
    return out;
  }, [graph, details, spans, focusedId, pixelsPerSecond]);

  return (
    <div
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
    </div>
  );
}

export function PlayheadScrubBand({
  focusedId,
  channel,
  pixelsPerSecond,
}: Readonly<{
  focusedId: string;
  channel: PreviewTimeChannel;
  pixelsPerSecond: number;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  const bandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const band = bandRef.current;
    if (!band) return;
    // The strip element IS its own scroll container, and [data-virtual-strip]
    // is the package's documented selector contract — unlike the Tailwind
    // class this used to query, which any restyle would silently break.
    const scroller = band.parentElement?.querySelector<HTMLElement>("[data-virtual-strip]") ?? null;
    if (!scroller) return;

    let map: PlayheadMap | null = null;
    let mapGraph: CollectionsGraph | null = null;
    let mapDetails: DetailsById | null = null;
    const seek = (event: PointerEvent) => {
      const graph = store.getSnapshot().graph;
      const details = detailsStore.read();
      if (graph !== mapGraph || details !== mapDetails || !map) {
        mapGraph = graph;
        mapDetails = details;
        map = buildPlayheadMap(childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond)));
      }
      const rect = scroller.getBoundingClientRect();
      const styles = getComputedStyle(scroller);
      const contentX =
        event.clientX -
        rect.left -
        parseFloat(styles.borderLeftWidth) -
        parseFloat(styles.paddingLeft) +
        scroller.scrollLeft;
      channel.set(Math.max(0, Math.min(map.timeAt(contentX), map.totalDurationSeconds)));
    };

    let pointerId: number | null = null;
    const handleMove = (event: PointerEvent) => {
      if (event.pointerId === pointerId) seek(event);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    const handleDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      pointerId = event.pointerId;
      try {
        band.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer: window listeners still own the lifecycle.
      }
      seek(event);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    };

    band.addEventListener("pointerdown", handleDown);
    return () => {
      band.removeEventListener("pointerdown", handleDown);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [store, detailsStore, focusedId, channel, spans, pixelsPerSecond]);

  return (
    <div
      ref={bandRef}
      data-playhead-scrub
      aria-hidden="true"
      className="absolute inset-x-0 top-0 z-10 h-3 cursor-ew-resize"
    />
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

    const paint = () => {
      const graph = store.getSnapshot().graph;
      const details = detailsStore.read();
      const columns = Number(grid?.dataset.gridColumns) || 1;
      // Live rendered cell width (post fill-stretch) — VirtualGrid's own
      // pixel value, never a hardcoded constant: the app's GRID_CELL_WIDTH
      // is only a target for picking column count, not the rendered size.
      const cellWidth = Number(grid?.dataset.gridCellWidth) || 1;
      if (
        graph !== lastGraph ||
        details !== lastDetails ||
        columns !== lastColumns ||
        cellWidth !== lastCellWidth
      ) {
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
      }
      if (!map) return;
      const time = channel.get();
      const inside =
        !activeWindow || (time >= activeWindow.start - 0.04 && time <= activeWindow.end + 0.04);
      line.style.display = inside ? "" : "none";
      if (!inside) return;
      const { x, y } = map.posAt(time);
      line.style.transform = `translate(${x}px, ${y}px)`;
      line.style.height = `${map.rowHeight}px`;
    };

    paint();
    const unsubscribeTime = channel.subscribe(paint);
    const unsubscribeStore = store.subscribe(paint);
    const unsubscribeDetails = detailsStore.subscribe(paint);
    const observer = grid ? new ResizeObserver(paint) : null;
    if (grid && observer) observer.observe(grid);
    return () => {
      unsubscribeTime();
      unsubscribeStore();
      unsubscribeDetails();
      observer?.disconnect();
    };
  }, [store, detailsStore, focusedId, channel, cellHeight, spans, pixelsPerSecond, activeWindow]);

  return (
    <div
      ref={lineRef}
      data-graph-grid-playhead
      className="absolute left-0 top-0 w-0.5 bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.9)]"
    >
      <div className="absolute -left-[5px] -top-2 h-0 w-0 border-x-[6px] border-t-[8px] border-x-transparent border-t-red-500" />
    </div>
  );
}

export function GraphGridScrubSurface({
  focusedId,
  channel,
  cellHeight,
  pixelsPerSecond,
}: Readonly<{
  focusedId: string;
  channel: PreviewTimeChannel;
  cellHeight: number;
  pixelsPerSecond: number;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  const surfaceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const grid = surface.parentElement?.querySelector<HTMLElement>("[data-virtual-grid]") ?? null;
    if (!grid) return;

    let map: GridPlayheadMap | null = null;
    let mapGraph: CollectionsGraph | null = null;
    let mapDetails: DetailsById | null = null;
    let mapColumns = 0;
    let mapCellWidth = 0;
    const seek = (event: PointerEvent) => {
      const graph = store.getSnapshot().graph;
      const details = detailsStore.read();
      const columns = Number(grid.dataset.gridColumns) || 1;
      // Live rendered cell width (post fill-stretch) — see GraphGridPlayhead.
      const cellWidth = Number(grid.dataset.gridCellWidth) || 1;
      if (
        graph !== mapGraph ||
        details !== mapDetails ||
        columns !== mapColumns ||
        cellWidth !== mapCellWidth ||
        !map
      ) {
        mapGraph = graph;
        mapDetails = details;
        mapColumns = columns;
        mapCellWidth = cellWidth;
        map = buildGridPlayheadMap(
          childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond)),
          columns,
          cellWidth,
          cellHeight,
        );
      }
      const overlay = grid.querySelector<HTMLElement>("[data-virtual-grid-overlay]");
      const rect = (overlay ?? grid).getBoundingClientRect();
      channel.set(map.timeAt(event.clientX - rect.left, event.clientY - rect.top));
    };

    let pointerId: number | null = null;
    const handleMove = (event: PointerEvent) => {
      if (event.pointerId === pointerId) seek(event);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    const handleDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      pointerId = event.pointerId;
      try {
        surface.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic pointer: window listeners still own the lifecycle.
      }
      seek(event);
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    };
    // No wheel handler: grids are content-height (GRID_UNCAPPED_HEIGHT), so
    // there is no internal scroll to feed — the wheel keeps its default and
    // the PAGE scrolls, which the e2e suite pins. The forwarding handler this
    // surface used to carry could only ever no-op.
    surface.addEventListener("pointerdown", handleDown);
    return () => {
      surface.removeEventListener("pointerdown", handleDown);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [store, detailsStore, focusedId, channel, cellHeight, spans, pixelsPerSecond]);

  return (
    <div
      ref={surfaceRef}
      data-grid-scrub
      aria-hidden="true"
      className="absolute inset-0 z-10 cursor-crosshair"
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
  const handleTimeChange = useCallback(
    (next: number) => {
      setTime(next);
      channel.set(next);
    },
    [channel],
  );

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

  if (!enabled) return <>{children}</>;

  return (
    <TimelineDocumentsProvider initialState={initialDocumentsState}>
      <GatewayDocumentsBridge />
      {/* Test/debug witness for which read model the pane is playing. */}
      <span data-preview-source={manifest !== null ? "manifest" : "projection"} hidden />
      <WorkbenchSplitPane
        clips={clips}
        currentTime={time}
        onCurrentTimeChange={handleTimeChange}
        getInitialSurfaceHeight={getInitialSurfaceHeight}
        onSurfaceHeightChange={handleSurfaceHeightChange}
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

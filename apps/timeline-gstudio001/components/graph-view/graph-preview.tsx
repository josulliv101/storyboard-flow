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
  getChildren,
  parseNodeId,
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

type PlayheadMap = Readonly<{
  xAt: (time: number) => number;
  timeAt: (x: number) => number;
  totalDurationSeconds: number;
}>;

const STRIP_GAP_PX = 8;
const COLLECTION_CARD_PX = 128;

/**
 * Where each focused-level CARD begins and ends in the clock the preview pane
 * is actually playing, keyed by the child's graph node id.
 *
 * The pane plays the server manifest whenever it has one, and the live
 * projection only in the ~2.5s window after an edit. Those two disagree: the
 * projection re-derives collection-card durations from read-time summaries,
 * which drift from the stored document the manifest is compiled off. The
 * playhead used to map ALWAYS off the projection, so in the steady state it
 * placed the marker on a 75s clock over a pane playing 72s — far enough in
 * to sit over the wrong collection entirely.
 */
export type PreviewCardSpans = ReadonlyMap<string, Readonly<{ start: number; end: number }>>;

const PreviewCardSpansContext = createContext<PreviewCardSpans | null>(null);

function cardSpansOf(manifest: PlaybackManifest): PreviewCardSpans {
  const spans = new Map<string, { start: number; end: number }>();
  for (const leaf of manifest.leaves) {
    // collectionPath[0] is the focused collection itself; [1] is the child
    // whose CARD the strip draws. A leaf that is a direct media child of the
    // focused collection has no [1] — that leaf IS its own card.
    const key = leaf.collectionPath[1] ?? leaf.id;
    const end = leaf.timelineStart + leaf.timelineDuration;
    const current = spans.get(key);
    spans.set(
      key,
      current
        ? { start: Math.min(current.start, leaf.timelineStart), end: Math.max(current.end, end) }
        : { start: leaf.timelineStart, end },
    );
  }
  return spans;
}

type PlayheadCard = Readonly<{ width: number; startTime: number; endTime: number }>;

/**
 * One card per focused-level child: WIDTH from the projection (that is the
 * strip's own layout, which the pane has no say in) and TIME from the model
 * the pane is playing, so the marker can never point at a card the surface
 * is not showing.
 *
 * Zips by INDEX against `getChildren` rather than matching clip ids: a
 * projection clip reports `detail.sourceClipId` when one exists, which is not
 * the node id the manifest paths are built from. `graphChildrenToClips` maps
 * over the same `getChildren` array, so index alignment is guaranteed where
 * id equality is not.
 */
function buildPlayheadCards(
  graph: CollectionsGraph,
  details: DetailsById,
  focusedId: string,
  spans: PreviewCardSpans | null,
  pixelsPerSecond: number,
): PlayheadCard[] {
  const childIds = getChildren(graph, parseNodeId(focusedId));
  return graphChildrenToClips(graph, details, focusedId).map((clip, index) => {
    // Must use the LIVE scale, not the TIMELINE_PPS default: the strip lays
    // clips out at whatever the zoom slider says, so a hardcoded constant
    // would drift the marker from the cards at every non-default zoom.
    const width =
      clip.kind === "collection"
        ? Math.max(MIN_ITEM_WIDTH, COLLECTION_CARD_PX)
        : durationToWidth(clip.duration, pixelsPerSecond);
    // A card with no manifest span is one contributing no playback time (an
    // empty collection). Its projection span is the only thing left to say,
    // and it is bounded by the neighbours that DO carry manifest times.
    const span = spans?.get(childIds[index] as string);
    return {
      width,
      startTime: span ? span.start : clip.startTime,
      endTime: span ? span.end : clip.startTime + clip.duration,
    };
  });
}

function buildPlayheadMap(cards: readonly PlayheadCard[]): PlayheadMap {
  const times: number[] = [];
  const xs: number[] = [];
  let x = 0;
  for (const card of cards) {
    times.push(card.startTime, card.endTime);
    xs.push(x, x + card.width);
    x += card.width + STRIP_GAP_PX;
  }
  const count = times.length;
  const total = count > 0 ? times[count - 1] : 0;

  const interpolate = (value: number, from: number[], to: number[]): number => {
    if (count === 0) return 0;
    if (value <= from[0]) return to[0];
    if (value >= from[count - 1]) return to[count - 1];
    let low = 0;
    let high = count - 1;
    while (low < high - 1) {
      const middle = (low + high) >> 1;
      if (from[middle] <= value) low = middle;
      else high = middle;
    }
    const span = from[high] - from[low];
    const fraction = span > 0 ? (value - from[low]) / span : 0;
    return to[low] + fraction * (to[high] - to[low]);
  };

  return {
    xAt: (time) => interpolate(time, times, xs),
    timeAt: (offset) => interpolate(offset, xs, times),
    totalDurationSeconds: total,
  };
}

type GridPlayheadMap = Readonly<{
  posAt: (time: number) => { x: number; y: number };
  timeAt: (x: number, y: number) => number;
  totalDurationSeconds: number;
  rowHeight: number;
}>;

function buildGridPlayheadMap(
  clips: readonly TimelineClip[],
  cols: number,
  cellWidth: number,
  cellHeight: number,
): GridPlayheadMap {
  const columns = Math.max(1, cols);
  const starts: number[] = [];
  const ends: number[] = [];
  for (const clip of clips) {
    starts.push(clip.startTime);
    ends.push(clip.startTime + clip.duration);
  }
  const count = clips.length;
  const total = count > 0 ? ends[count - 1] : 0;
  const cellX = (index: number) => (index % columns) * (cellWidth + GRID_GAP);
  const cellY = (index: number) =>
    Math.floor(index / columns) * (cellHeight + GRID_GAP);
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

  return {
    rowHeight: cellHeight,
    totalDurationSeconds: total,
    posAt: (time) => {
      if (count === 0) return { x: 0, y: 0 };
      let low = 0;
      if (time >= starts[count - 1]) {
        low = count - 1;
      } else if (time > starts[0]) {
        let high = count - 1;
        while (low < high - 1) {
          const middle = (low + high) >> 1;
          if (starts[middle] <= time) low = middle;
          else high = middle;
        }
      }
      const span = ends[low] - starts[low];
      const fraction = span > 0 ? clamp01((time - starts[low]) / span) : 0;
      return { x: cellX(low) + fraction * cellWidth, y: cellY(low) };
    },
    timeAt: (x, y) => {
      if (count === 0) return 0;
      const row = Math.max(0, Math.floor(y / (cellHeight + GRID_GAP)));
      const column = Math.max(
        0,
        Math.min(columns - 1, Math.floor(x / (cellWidth + GRID_GAP))),
      );
      const index = Math.max(0, Math.min(count - 1, row * columns + column));
      const fraction = clamp01((x - cellX(index)) / cellWidth);
      return Math.min(
        total,
        Math.max(0, starts[index] + fraction * (ends[index] - starts[index])),
      );
    },
  };
}

export function GraphPlayhead({
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
        map = buildPlayheadMap(
          buildPlayheadCards(graph, details, focusedId, spans, pixelsPerSecond),
        );
      }
      const line = lineRef.current;
      if (line && map) line.style.transform = `translateX(${map.xAt(channel.get())}px)`;
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
  }, [store, detailsStore, focusedId, channel, spans, pixelsPerSecond]);

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
    const scroller = band.parentElement?.querySelector<HTMLElement>(".overflow-x-auto") ?? null;
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
        map = buildPlayheadMap(
          buildPlayheadCards(graph, details, focusedId, spans, pixelsPerSecond),
        );
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
}: Readonly<{
  focusedId: string;
  channel: PreviewTimeChannel;
  cellHeight: number;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
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
          graphChildrenToClips(graph, details, focusedId),
          columns,
          cellWidth,
          cellHeight,
        );
      }
      if (!map) return;
      const { x, y } = map.posAt(channel.get());
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
  }, [store, detailsStore, focusedId, channel, cellHeight]);

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
}: Readonly<{
  focusedId: string;
  channel: PreviewTimeChannel;
  cellHeight: number;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
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
          graphChildrenToClips(graph, details, focusedId),
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
    const handleWheel = (event: WheelEvent) => {
      const scale = event.deltaMode === 1 ? 32 : 1;
      const before = grid.scrollTop;
      const maximum = grid.scrollHeight - grid.clientHeight;
      const next = Math.max(0, Math.min(before + event.deltaY * scale, maximum));
      if (next !== before) {
        grid.scrollTop = next;
        event.preventDefault();
      }
    };

    surface.addEventListener("pointerdown", handleDown);
    surface.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      surface.removeEventListener("pointerdown", handleDown);
      surface.removeEventListener("wheel", handleWheel);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
  }, [store, detailsStore, focusedId, channel, cellHeight]);

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
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      try {
        const response = await fetch(
          `/api/timelines/${encodeURIComponent(focusedId)}/preview-manifest`,
          { cache: "no-store" },
        );
        if (!response.ok) return; // projection fallback stands
        const result = (await response.json().catch(() => null)) as {
          manifest?: PlaybackManifest;
        } | null;
        if (cancelled || !result?.manifest) return;
        // Install guard: a manifest compiled BEFORE this session's latest
        // accepted write (its revision trails the compare-and-set ledger)
        // is pre-write server state — never install it over the live
        // projection; poll again once the write has landed server-side.
        const ledger = graphDocumentsGateway.revisionOf(focusedId);
        if (ledger !== undefined && result.manifest.projectRevision < ledger) {
          retryTimer = setTimeout(() => setStaleAt(Date.now()), MANIFEST_REFRESH_DELAY_MS);
          return;
        }
        setState({
          clips: manifestToClips(result.manifest),
          spans: cardSpansOf(result.manifest),
          forId: focusedId,
        });
      } catch {
        /* projection fallback stands */
      }
    })();
    return () => {
      cancelled = true;
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

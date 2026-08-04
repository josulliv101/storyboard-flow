"use client";

// The SEEK RAILS — the grid's per-row sliders and the strip's single rail.
//
// ~915 lines lifted verbatim out of graph-preview.tsx, which was 2,297 lines
// and named in #281 as past the point where it could be reviewed. This is the
// largest self-contained block in it: a coherent feature (press/drag/keyboard
// seeking) with one entry point per layout and no callers inside the rest of
// the preview module.
//
// Deliberately a pure MOVE — no behaviour, wording or structure changed — so
// the diff stays readable and `graph-view` e2e is a meaningful check. The
// testable-logic extractions in this same change went to `.ts` modules
// (`preview-time-channel`, `preview-card-geometry`); this stays `.tsx` because
// it is JSX and event wiring, which this app's vitest cannot parse anyway.
//
// `graph-preview.tsx` re-exports both components, so no consumer's import path
// changed (graph-board.tsx and graph-sub-timelines.tsx both pull them from
// there).

import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { useCollectionsStore } from "@storyboard/ui/dnd-collections";
import { formatSeconds } from "@storyboard/ui/timeline/utils";

import { useGraphDetailsStore } from "@/components/graph-view/graph-details-context";

import {
  buildGridPlayheadMap,
  buildPlayheadMap,
  buildStripOverlay,
  childSpans,
  type ChildSpan,
  type GridPlayheadMap,
} from "./graph-playhead-model";
import { GRID_GAP } from "./graph-view-config";
import { cardsFor, clipWidthAt } from "./preview-card-geometry";
import { FlatItemsContext, PreviewCardSpansContext } from "./preview-contexts";
import { stripScrollerBeside, useScrollerTickWindow } from "./preview-scroller";
import type { PreviewTimeChannel } from "./preview-time-channel";

/** Keyboard step for the seek rails: one nudge per arrow press. */
const SEEK_RAIL_STEP_SECONDS = 1;

/** The rail's slim track vs the BAND it rides (the grid's row gap; the
 *  strip's `pt-4` top padding). The track centres in the band, so the
 *  clearance on each side keeps the track and its thumb clear of the cards
 *  — rail and items never overlap, and a selected card's ring stays fully
 *  visible (the old design filled the band edge-to-edge and sat flush on
 *  the card tops). */
const SEEK_RAIL_TRACK_PX = 8;
export const SEEK_RAIL_BAND_INSET_PX = (GRID_GAP - SEEK_RAIL_TRACK_PX) / 2;
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
  columns,
  rowPitchY,
  surfaceId,
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
  /** Columns and row pitch, so a pointer offset can be wrapped back into the
   *  grid's own {x, y} for the scrub position — the rail seeks along an
   *  UNWRAPPED line, the playhead paints on the wrapped grid. */
  columns: number;
  rowPitchY: number;
  /** The surface this rail scrubs, so its playhead (and no other) follows. */
  surfaceId: string;
}>) {
  const railRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  // Mounted only during a scrub (PL9-003); `scrubbing` is a paint dep so the
  // imperative writer below picks up the freshly mounted node.
  const [scrubbing, setScrubbing] = useState(false);

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
      const label = timeRef.current;
      if (label) {
        label.textContent = formatSeconds(clamped);
        label.style.visibility = active ? "" : "hidden";
        // VIEWPORT coordinates, because the label is portaled to the body —
        // read off the thumb it rides so it needs no knowledge of where the
        // rail sits. Clamped to the viewport (not the rail) for the same
        // reason it used to be clamped to the rail: it must stay legible at
        // both ends rather than hanging off the edge.
        const thumbRect = thumb.getBoundingClientRect();
        const half = label.offsetWidth / 2;
        const centre = thumbRect.left + thumbRect.width / 2;
        label.style.left = `${Math.min(window.innerWidth - half - 4, Math.max(half + 4, centre))}px`;
        label.style.top = `${thumbRect.top - 6}px`;
      }
      rail.setAttribute("aria-valuenow", (clamped - rowStart).toFixed(1));
      rail.setAttribute(
        "aria-valuetext",
        `${(clamped - rowStart).toFixed(1)} of ${(rowEnd - rowStart).toFixed(1)} seconds`,
      );
    };
    paint();
    return channel.subscribe(paint);
  }, [channel, map, offsetX, extent, rowStart, rowEnd, isLastRow, scrubbing]);

  const seekToPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    // Deliberately UNCLAMPED to this rail: the pointer's x rides the whole
    // timeline's unwrapped line at this row's offset, so a drag that
    // overshoots either end keeps scrubbing into the neighbouring rows
    // (timeAt clamps to the timeline's own bounds).
    const unwrapped = Math.max(0, offsetX + (event.clientX - rect.left));
    // Wrap that back onto the grid the playhead actually paints on. Position
    // FIRST, then time — both notify the same listeners, and the other order
    // paints one frame from the new time against a stale position.
    const pitch = cellWidth + GRID_GAP;
    const cell = Math.floor(unwrapped / pitch);
    const within = Math.min(cellWidth, unwrapped - cell * pitch);
    channel.setScrub({
      surfaceId,
      x: (cell % columns) * pitch + within,
      y: Math.floor(cell / columns) * rowPitchY,
    });
    channel.set(map.timeAt(unwrapped, 0));
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
        setScrubbing(true);
        seekToPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.pointerId === pointerIdRef.current) seekToPointer(event);
      }}
      onPointerUp={(event) => {
        if (event.pointerId !== pointerIdRef.current) return;
        pointerIdRef.current = null;
        setScrubbing(false);
        channel.setScrub(null);
      }}
      onPointerCancel={(event) => {
        if (event.pointerId !== pointerIdRef.current) return;
        pointerIdRef.current = null;
        setScrubbing(false);
        channel.setScrub(null);
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
      {/* SKIP marks: the cells playback will jump over. One per disabled card
          in THIS row, laid on the row's own cell pitch — a grid cell is a
          fixed width, so the mark is the cell, not a time range. */}
      {rowCards.map((card, index) =>
        card.disabled === true ? (
          <span
            key={`skip-${index}`}
            data-rail-skip
            aria-hidden="true"
            className="absolute inset-y-0 bg-zinc-600/70"
            style={{
              left: `${((index * pitch) / extent) * 100}%`,
              width: `${(cellWidth / extent) * 100}%`,
            }}
          />
        ) : null,
      )}
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
      {/* Where the playhead is HEADING, at the pointer — the transport's own
          clock is up in the preview chrome, too far to read mid-drag. Only
          during a drag: on hover it would follow a playhead nobody is moving.
          pointer-events-none so it can never take the drag's own pointer. */}
      {scrubbing &&
        createPortal(
          <span
            ref={timeRef}
            data-rail-time
            aria-hidden="true"
            // ABOVE the thumb (PL11-013), which is where the eye already is:
            // the pointer is on the rail, and a label under it sits behind
            // the hand. It could not live above while it was a CHILD of the
            // rail — the surfaces clip vertically and sit hard against the
            // sticky header, which is what put it below in PL9-007. Portaled
            // and FIXED, nothing clips it; the paint above positions it in
            // viewport coordinates. z-[70] clears the header it may overlap,
            // and pointer-events-none keeps it out of the drag's way.
            className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-zinc-900/95 px-1.5 py-0.5 font-mono text-[11px] text-zinc-100 shadow-sm ring-1 ring-zinc-700"
          />,
          document.body,
        )}
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
    // 0 card height, as in GraphGridPlayhead: the grid rails measure their
    // row from `cellWidth`, so per-clip widths never reach the geometry.
    () => childSpans(graph, details, focusedId, spans, clipWidthAt(pixelsPerSecond, 0)),
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
          columns={geometry.columns}
          rowPitchY={cellHeight + GRID_GAP}
          surfaceId={focusedId}
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
  cardHeight,
  ariaLabel = "Seek preview",
}: Readonly<{
  focusedId: string;
  channel: PreviewTimeChannel;
  pixelsPerSecond: number;
  /** The strip's `itemHeight` — feeds the collection aspect floor, keeping
   *  the rail's thumb in lockstep with the playhead line below it. */
  cardHeight: number;
  ariaLabel?: string;
}>) {
  const store = useCollectionsStore();
  const detailsStore = useGraphDetailsStore();
  const spans = useContext(PreviewCardSpansContext);
  const flatItems = useContext(FlatItemsContext);
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const lastClientXRef = useRef(0);
  const panFrameRef = useRef<number | null>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  // Rendered ONLY while a scrub drag is live (PL9-003). State, not a style
  // toggle, so the label does not exist to be measured or read the rest of
  // the time; the paint effect below lists it as a dep so the imperative
  // writer picks up the freshly mounted node.
  const [scrubbing, setScrubbing] = useState(false);

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
    () => cardsFor(graph, details, focusedId, spans, pixelsPerSecond, cardHeight, flatItems),
    [graph, details, spans, focusedId, pixelsPerSecond, cardHeight, flatItems],
  );
  const map = useMemo(() => buildPlayheadMap(cards), [cards]);
  const start = cards.length > 0 ? cards[0].startTime : 0;
  const end = cards.length > 0 ? cards[cards.length - 1].endTime : 0;
  // The rail is a SIBLING of the strip, so it queries across for the scroller
  // rather than climbing to it like the ruler does — same window, two routes.
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const setOuterRef = useCallback((element: HTMLDivElement | null) => {
    outerRef.current = element;
    setScroller(element ? stripScrollerBeside(element) : null);
  }, []);
  const tickWindow = useScrollerTickWindow(scroller);
  // The rail's content width ends at the LAST item's right edge, and the
  // interior ticks sit at the gap centres between cards — the strip twin of
  // the grid rails' cell-edge ticks.
  //
  // WINDOWED to the visible scroll range, like the ruler's ticks above it:
  // one tick per card boundary plus one mark per disabled card is a DOM node
  // PER ITEM, which is exactly what the strip's virtualizer exists to avoid.
  // `extent` stays the full width — it sizes the layer the marks live in.
  const { extent, boundaryTicks: ticks, skips } = useMemo(
    () => buildStripOverlay(cards, tickWindow),
    [cards, tickWindow],
  );

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
      // The scrub readout rides the thumb, ABOVE it, in viewport coordinates
      // (PL11-013) — it is portaled to the body, so rail-local pixels would
      // mean nothing. Clamped to the viewport so it stays legible at both
      // ends instead of hanging off the timeline, and hidden whenever the
      // thumb is: a time label with no thumb under it points at nothing.
      const label = timeRef.current;
      if (label) {
        label.style.visibility = visible ? "" : "hidden";
        const thumbRect = thumb.getBoundingClientRect();
        const half = label.offsetWidth / 2;
        const centre = thumbRect.left + thumbRect.width / 2;
        label.style.left = `${Math.min(window.innerWidth - half - 4, Math.max(half + 4, centre))}px`;
        label.style.top = `${thumbRect.top - 6}px`;
      }
    };
    const syncScroll = () => {
      inner.style.transform = `translateX(${-scroller.scrollLeft}px)`;
      placeThumb();
    };
    const paint = () => {
      const time = channel.get();
      thumb.dataset.active = String(time >= start && time <= end);
      const clamped = Math.min(end, Math.max(start, time));
      // Same rule as the playhead line: while THIS surface is being scrubbed
      // the head rides the pointer, so thumb, line and cursor stay together
      // across a collection that has width but no time.
      const scrub = channel.getScrub();
      contentX =
        scrub && scrub.surfaceId === focusedId ? scrub.x : map.xAt(clamped);
      fill.style.width = `${contentX}px`;
      if (timeRef.current) timeRef.current.textContent = formatSeconds(clamped);
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
  }, [channel, map, start, end, scrubbing, focusedId]);

  const scrollerOf = (): HTMLElement | null =>
    outerRef.current?.parentElement?.querySelector<HTMLElement>("[data-virtual-strip]") ?? null;

  const seekAtClientX = (clientX: number) => {
    const scroller = scrollerOf();
    if (!scroller || !geometry) return;
    const rect = scroller.getBoundingClientRect();
    const contentX = clientX - rect.left - geometry.padLeft + scroller.scrollLeft;
    const clamped = Math.min(extent, Math.max(0, contentX));
    // Position FIRST, then time: both notify the same listeners, and a
    // playhead that read the new time against a stale scrub x would paint one
    // frame in the wrong place at the start of every drag.
    channel.setScrub({ surfaceId: focusedId, x: clamped });
    channel.set(map.timeAt(clamped));
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
      ref={setOuterRef}
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
        setScrubbing(true);
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
        setScrubbing(false);
        channel.setScrub(null);
        stopPanLoop();
      }}
      onPointerCancel={(event) => {
        if (event.pointerId !== pointerIdRef.current) return;
        pointerIdRef.current = null;
        setScrubbing(false);
        channel.setScrub(null);
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
          {/* SKIP marks, over the fill: the stretches playback will jump. A
              neutral scrim rather than a colour of its own — the point is
              that this part of the rail is dead, and a dead stretch should
              look drained next to the live fill, not decorated. */}
          {/* Keyed by POSITION, not index: the list is windowed, so indices
              shift as the strip scrolls and index keys would remount every
              mark on each chunk crossing. */}
          {skips.map((segment) => (
            <span
              key={`skip-${segment.x}`}
              data-rail-skip
              aria-hidden="true"
              className="absolute inset-y-0 bg-zinc-600/70"
              style={{ left: segment.x, width: segment.width }}
            />
          ))}
          {ticks.map((x) => (
            <span
              key={x}
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
      {/* The scrub readout, twin of the strip rail's — see there for why it
          exists and why it is drag-only. */}
      {scrubbing &&
        createPortal(
          <span
            ref={timeRef}
            data-rail-time
            aria-hidden="true"
            // ABOVE the thumb (PL11-013), which is where the eye already is:
            // the pointer is on the rail, and a label under it sits behind
            // the hand. It could not live above while it was a CHILD of the
            // rail — the surfaces clip vertically and sit hard against the
            // sticky header, which is what put it below in PL9-007. Portaled
            // and FIXED, nothing clips it; the paint above positions it in
            // viewport coordinates. z-[70] clears the header it may overlap,
            // and pointer-events-none keeps it out of the drag's way.
            className="pointer-events-none fixed z-[70] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded bg-zinc-900/95 px-1.5 py-0.5 font-mono text-[11px] text-zinc-100 shadow-sm ring-1 ring-zinc-700"
          />,
          document.body,
        )}
    </div>
  );
}

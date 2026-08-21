"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

import {
  stripCentreOffset,
  stripPositionAt,
  type SeamStrip,
} from "./graph-seam-strip";

/**
 * The bar over the carousel: every clip in the collection as a box, with the
 * one you are looking at centred over the card in the middle.
 *
 * ── HOW IT DIFFERS FROM THE BAR IT REPLACES ──────────────────────────────
 *
 * The old bar drew the clock's own window — three clips and two leads —
 * stretched across the full width. Two consequences, both of which this
 * exists to undo. Its boxes had no fixed meaning: the same clip was wide in a
 * three-up view and narrow in a five-up one, because the width was a share of
 * whatever else was on screen. And advancing REBUILT it, so the boxes that
 * stayed jumped to new coordinates instead of moving.
 *
 * Here the layout is absolute (see `graph-seam-strip`) and the only thing that
 * changes on an advance is the transform. So a box is the size of its clip,
 * always; the clips that stay put travel exactly the distance the cards below
 * them travel; and the clips that arrive slide in from the edge rather than
 * appearing there.
 *
 * ── BRIGHT AND DIM ───────────────────────────────────────────────────────
 *
 * The strip covers the whole collection, but the CLOCK covers a window of it
 * — playing and scrubbing only ever reach the clips the carousel has on
 * screen. Rather than hide that, the bar states it: the clips inside the
 * window are lit and scrubbable, the rest are context you can see coming.
 * Pressing a dim one is not a scrub with nowhere to go; it advances the
 * carousel to that clip, which is the thing you were asking for.
 */
export function SeamStripBar({
  strip,
  centreClipId,
  liveClipIds,
  playheadPx,
  playing,
  dragShiftPx,
  onTogglePlay,
  onScrubTo,
  onOpenClip,
  onScrubbingChange,
}: Readonly<{
  strip: SeamStrip;
  /** The clip to centre — the one under the middle card. */
  centreClipId: string;
  /** The clips the clock can currently reach. */
  liveClipIds: ReadonlySet<string>;
  /** Where the playhead sits, in absolute strip pixels; null when untouched. */
  playheadPx: number | null;
  playing: boolean;
  /** Live coupling with a swipe in progress — see the carousel. */
  dragShiftPx: number;
  onTogglePlay: () => void;
  onScrubTo: (clipId: string, secondsIntoClip: number) => void;
  /**
   * Bring a clip to the middle. Currently UNUSED: it only steps one clip at a
   * time, and the bar's reach is the whole collection. Wiring the two together
   * needs the clock to span the collection too — the real fix for scrubbing
   * past what is on screen — rather than a jump the row cannot follow.
   */
  onOpenClip: (clipId: string) => void;
  /** True while a drag is live on the bar, false when it ends — the view
   *  grows the monitor for the duration. */
  onScrubbingChange?: (active: boolean) => void;
}>) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  // The container's width is half the centring arithmetic, so it has to be
  // measured rather than assumed — and re-measured, because the view count
  // and the window both change it.
  useEffect(() => {
    const element = trackRef.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      setTrackWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(element);
    setTrackWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  // WHERE "CENTRED" IS — computed, not measured off the moving cards.
  //
  // It is not the middle of this track: the play button and the readout inset
  // it, so its own middle sits ~30px left of the card it must sit above.
  //
  // It IS the middle of the LAYOUT viewport. The scrim centres the row and the
  // row's transform cancels the centre panel's own offset within it, so the
  // centre card lands on that middle by construction — and `clientWidth`
  // rather than `innerWidth` because the latter counts the scrollbar, which is
  // the entire 8px the first version of this was out by.
  //
  // Two earlier attempts measured the card instead, and both were wrong in the
  // same way: the card MOVES, so any read is a race with the row's slide. A
  // timer version stuck ~650px out after a count change; a settle-on-two-equal-
  // frames version stopped early mid-slide and drifted by thousands. The
  // geometry was knowable the whole time.
  const [centreAtPx, setCentreAtPx] = useState(0);
  useEffect(() => {
    const element = trackRef.current;
    if (element === null) return;
    const measure = () => {
      const track = element.getBoundingClientRect();
      setCentreAtPx(document.documentElement.clientWidth / 2 - track.left);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [trackWidth]);

  // `stripCentreOffset` centres within a container, so it is handed twice the
  // distance to the target — the one container width whose middle is exactly
  // where the card is.
  const offset =
    stripCentreOffset(strip, centreClipId, centreAtPx > 0 ? centreAtPx * 2 : trackWidth) +
    dragShiftPx;

  const resolve = useCallback(
    (clientX: number) => {
      const element = trackRef.current;
      if (element === null) return null;
      const x = clientX - element.getBoundingClientRect().left - offset;
      return stripPositionAt(strip, x);
    },
    [strip, offset],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      const at = resolve(event.clientX);
      if (at === null) return;
      // A dim clip is INERT for now, and this is a known gap rather than a
      // decision — see the note on `onOpenClip`.
      //
      // It used to jump the carousel to whatever was pressed, which broke
      // badly: `onOpenClip` advances by ONE, so a press five clips away moved
      // the subject five steps while the row animated one, leaving the cards
      // strewn across the viewport. A bar DRAG starts with a press, and a
      // press very often lands on a dim clip, so scrubbing routinely threw the
      // layout apart.
      if (!liveClipIds.has(at.clipId)) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Untrusted pointer (a story's synthetic sequence). Capture is an
        // optimisation for a real finger leaving the track mid-drag; without
        // it the drag still tracks every move that lands on the element, so
        // the gesture works and only the overshoot is lost. Throwing here
        // aborted the whole handler and took scrubbing with it.
      }
      setDragging(true);
      onScrubbingChange?.(true);
      onScrubTo(at.clipId, at.secondsIntoClip);
    },
    [resolve, liveClipIds, onOpenClip, onScrubTo, onScrubbingChange],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const at = resolve(event.clientX);
      // Dragging ACROSS a dim clip does not advance the carousel — that would
      // move the ground under a gesture in progress. It simply stops tracking
      // until the pointer comes back over something the clock can reach.
      if (at === null || !liveClipIds.has(at.clipId)) return;
      onScrubTo(at.clipId, at.secondsIntoClip);
    },
    [dragging, resolve, liveClipIds, onScrubTo],
  );

  const endDrag = useCallback(() => {
    setDragging(false);
    onScrubbingChange?.(false);
  }, [onScrubbingChange]);

  if (strip.totalPx <= 0) return null;

  const totalSeconds = strip.totalPx / strip.pxPerSecond;
  const atSeconds = playheadPx === null ? null : playheadPx / strip.pxPerSecond;

  return (
    <div data-seam-bar className="flex w-full items-center gap-3">
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={playing ? "Pause" : "Play across the cut"}
        className="shrink-0 rounded-full p-1.5 text-zinc-300 ring-1 ring-white/15 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
      >
        {playing ? (
          <Pause aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Play aria-hidden="true" className="h-4 w-4" />
        )}
      </button>

      <div
        ref={trackRef}
        data-seam-track
        data-seam-centre-at={Math.round(centreAtPx)}
        role="slider"
        tabIndex={0}
        aria-label="Scrub across the cut"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalSeconds * 100) / 100}
        aria-valuenow={Math.round((atSeconds ?? 0) * 100) / 100}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="relative h-9 flex-1 cursor-ew-resize overflow-hidden focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
      >
        <div
          data-seam-strip
          className="absolute inset-y-0 left-0 will-change-transform"
          style={{
            transform: `translateX(${offset}px)`,
            width: strip.totalPx,
            // NO TRANSITION WHILE A FINGER IS ON IT. During a swipe the shift
            // is already following the hand frame by frame; easing it too
            // would put the bar behind the cards it is supposed to move with.
            transition: dragShiftPx === 0 ? "transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1)" : "none",
          }}
        >
          {strip.segments.map((segment) => {
            if (segment.widthPx <= 0) return null;
            const live = liveClipIds.has(segment.clipId);
            return (
              <span
                key={segment.clipId}
                data-seam-segment={segment.clipId}
                data-seam-segment-live={live ? "" : undefined}
                aria-hidden="true"
                // Inset from BOTH sides, so the gap between boxes costs a
                // pixel either end and leaves the middle exactly where the
                // clip's middle is. Shrinking the width alone moved it.
                style={{ left: segment.leftPx + 1, width: Math.max(1, segment.widthPx - 2) }}
                className={[
                  "absolute inset-y-0 rounded-[3px]",
                  live ? "bg-blue-500/70" : "bg-zinc-700/70",
                ].join(" ")}
              />
            );
          })}
        </div>

        {playheadPx !== null && (
          <span
            data-seam-playhead
            aria-hidden="true"
            style={{ transform: `translateX(${playheadPx + offset}px)` }}
            className="absolute inset-y-0 left-0 w-0.5 -translate-x-1/2 bg-red-500"
          >
            {/* The head of the line, so the playhead reads as a position that
                was put there rather than a border between two boxes. */}
            <span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-red-500" />
          </span>
        )}
      </div>

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-400">
        <span className="text-blue-300">{(atSeconds ?? 0).toFixed(2)}s</span>
        {" / "}
        {totalSeconds.toFixed(2)}s
      </span>
    </div>
  );
}

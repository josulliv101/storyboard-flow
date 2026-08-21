"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

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
 * ── ONE BOX IS LIT, AND THE REST ARE TINTED BY COLLECTION ────────────────
 *
 * MARKED means centred — one box, the clip under the middle card, wearing a
 * check and a thin ring. It is not a colour, and that is the point: colour is
 * spoken for by the collection tints, so spending blue on "you are here" would
 * make one channel carry two meanings and quietly break the grouping. An
 * earlier version did exactly that, and before it lit every clip with a card
 * on screen — which answered a question nobody was asking, since you can see
 * which cards are up by looking at them.
 *
 * Everything else is tinted by the collection it came from, which is how the
 * bar can span the whole playback order without becoming an undifferentiated
 * run of boxes: a change of colour is a change of collection, and it lands
 * exactly where the row will cross into one.
 *
 * NESTING IS IN THE COLOUR ITSELF. A collection directly under the root takes
 * a hue far from its neighbours; every level below shifts a little from its
 * parent and lifts, so a collection inside an orange one is a near-orange.
 * Depth reads as a family, the top level reads as a difference, and none of it
 * costs a second channel — an earlier version drew the ancestors as bars
 * across the top of each box, which was a stripe explaining what the colour
 * had failed to say.
 *
 * The tints are deliberately MUTED and deliberately not blue. They are
 * grouping, not state — the only saturated thing on this bar should be the
 * box you are on, and the only red should be the playhead.
 */
/**
 * How far each box is pulled in from its clip's true extent, per side.
 *
 * The gap between two boxes is therefore twice this. It is an inset rather
 * than a margin because the box's MIDDLE has to stay exactly on the clip's
 * middle — that is what the centring arithmetic aligns to the card below —
 * and trimming only the width would shift it by half the gap.
 */
const BOX_INSET_PX = 2.5;

/**
 * How much shorter a box gets per level of nesting.
 *
 * Small on purpose: it is a second, quieter statement of what the colour
 * already says, and the point is that the run of boxes has a SHAPE you can
 * read at a glance — top-level items standing tallest — not that any one box
 * is measurably shorter than its neighbour.
 */
const DEPTH_STEP_PX = 4;

export function SeamStripBar({
  strip,
  centreClipId,
  styleOf,
  playheadPx,
  playing,
  onTogglePlay,
  onStepBack,
  onStepForward,
  onScrubTo,
  onScrubbingChange,
}: Readonly<{
  strip: SeamStrip;
  /** The clip to centre — the one under the middle card. */
  centreClipId: string;
  /** Each clip's box colour and nesting depth, derived from where its
   *  collection sits in the tree — see `clipStyleOf` in the carousel. */
  styleOf: ReadonlyMap<string, { colour: string; depth: number }>;

  /** Where the playhead sits, in absolute strip pixels; null when untouched. */
  playheadPx: number | null;
  playing: boolean;
  onTogglePlay: () => void;
  /** Step the carousel one clip. Null at the end it cannot go. */
  onStepBack: (() => void) | null;
  onStepForward: (() => void) | null;
  onScrubTo: (clipId: string, secondsIntoClip: number) => void;
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
  const offset = stripCentreOffset(strip, centreClipId, centreAtPx > 0 ? centreAtPx * 2 : trackWidth);

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
      // EVERY box scrubs, including the ones with no card on screen — the
      // clock covers the whole collection now, so there is nowhere on this bar
      // that means nothing. The monitor shows whatever you land on; the row
      // stays where it is.
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
    [resolve, onScrubTo, onScrubbingChange],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      const at = resolve(event.clientX);
      if (at === null) return;
      onScrubTo(at.clipId, at.secondsIntoClip);
    },
    [dragging, resolve, onScrubTo],
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
        className="shrink-0 rounded-full p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {playing ? (
          <Pause aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Play aria-hidden="true" className="h-4 w-4" />
        )}
      </button>

      {/* STEP ONE CLIP, either way.
          The bar is a map of the whole order and the cards move by gesture —
          swipe, or click a neighbour — which is fine when the next clip is on
          screen and awkward when you just want the next one. Two arrows are
          the plainest possible statement of "one forward, one back", and they
          bracket the thing they move.
          Disabled rather than hidden at the ends: a control that vanishes
          takes its own position with it and shifts the bar sideways. */}
      <button
        type="button"
        data-seam-step="back"
        disabled={onStepBack === null}
        onClick={() => onStepBack?.()}
        aria-label="Previous clip"
        title="Previous clip"
        className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-25 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
      >
        <ChevronLeft aria-hidden="true" className="h-4 w-4" />
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
        // `outline-none` on the BASE, not only on focus-visible. It is a
        // role="slider" with a tabIndex, so pressing it focuses it — and the
        // browser's own focus ring was drawing a pale outline around the whole
        // track the moment you touched it, which read as a border the bar did
        // not have a second earlier. Keyboard focus still gets a visible ring,
        // in blue, from the focus-visible rule.
        //
        className="relative h-9 flex-1 cursor-ew-resize overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <div
          data-seam-strip
          className="absolute inset-y-0 left-0 will-change-transform"
          style={{
            transform: `translateX(${offset}px)`,
            width: strip.totalPx,
            // ONE MOVE PER CLIP, and none at all while the hand is down.
            //
            // The first version followed the drag frame by frame, spending the
            // same fraction of a step the row spent. It was faithful and it
            // read badly: the bar twitched under a gesture that had not
            // decided anything yet, and a swipe that fell short left it easing
            // back from nowhere. The bar answers "which clip am I on", which
            // is a question with no answer mid-drag — so it waits for the
            // commit and then makes one smooth move to centred.
            transition: "transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          }}
        >
          {strip.segments.map((segment) => {
            if (segment.widthPx <= 0) return null;
            const isCentre = segment.clipId === centreClipId;
            const style = styleOf.get(segment.clipId) ?? { colour: "hsl(220 8% 34%)", depth: 0 };
            // SHORTER THE DEEPER IT SITS, sharing a baseline so the tops step
            // down and the run reads as an outline of the tree. Capped at four
            // levels: past that a box would be a sliver, and the colour is
            // already carrying depth as well.
            const depthInsetPx = Math.min(style.depth, 4) * DEPTH_STEP_PX;
            return (
              <span
                key={segment.clipId}
                data-seam-segment={segment.clipId}
                data-seam-segment-live={isCentre ? "" : undefined}
                aria-hidden="true"
                // Inset from BOTH sides — see BOX_INSET_PX. The floor keeps a
                // very short clip as a visible sliver rather than letting the
                // gap eat it.
                style={{
                  left: segment.leftPx + BOX_INSET_PX,
                  width: Math.max(2, segment.widthPx - BOX_INSET_PX * 2),
                  backgroundColor: style.colour,
                  top: depthInsetPx,
                  bottom: 0,
                }}
                className={[
                  "absolute flex items-center justify-center overflow-hidden rounded-[3px]",
                  // NO RING. The centred box was outlined as well as checked,
                  // which at a box's width read as two stray white edges
                  // rather than as an outline — the corners round away and
                  // only the left and right sides survive. The check alone
                  // says it, and the box keeps its collection's colour because
                  // colour is spoken for: it says which collection a clip
                  // belongs to, and one channel cannot carry two meanings.
                ].join(" ")}
              >
                {/* WHICH ONE YOU ARE ON, as a mark rather than a hue. Hidden
                    on a box too narrow to hold it: a check crushed into 10px
                    is a smudge, and the ring already says the same thing. */}
                {isCentre && segment.widthPx >= 16 ? (
                  // HALF STRENGTH. It marks a position on a map you are
                  // scanning, not a control you are hunting for, and at full
                  // white it was the brightest thing on the bar — louder than
                  // the playhead, which is the mark that actually moves.
                  <Check className="h-3 w-3 text-white/50" strokeWidth={2.5} />
                ) : null}
              </span>
            );
          })}
        </div>

        {playheadPx !== null && (
          <span
            data-seam-playhead
            aria-hidden="true"
            style={{ transform: `translateX(${playheadPx + offset}px)` }}
            // A HAIRLINE. One physical pixel wherever the display allows it:
            // the playhead's job is to name an instant, and a 2px line spans
            // two of them at this scale. `w-px` rather than a fraction of a
            // rem so it does not thicken with the type scale.
            className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-red-500"
          >
            {/* The head of the line, so the playhead reads as a position that
                was put there rather than a border between two boxes. */}
            <span className="absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-red-500" />
          </span>
        )}
      </div>

      <button
        type="button"
        data-seam-step="forward"
        disabled={onStepForward === null}
        onClick={() => onStepForward?.()}
        aria-label="Next clip"
        title="Next clip"
        className="shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-25 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
      >
        <ChevronRight aria-hidden="true" className="h-4 w-4" />
      </button>

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-400">
        <span className="text-blue-300">{(atSeconds ?? 0).toFixed(2)}s</span>
        {" / "}
        {totalSeconds.toFixed(2)}s
      </span>
    </div>
  );
}

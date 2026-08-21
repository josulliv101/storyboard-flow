"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

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

/** Travel before a drag across the boxes counts as a swipe. */
const BOXES_SWIPE_PX = 28;

/**
 * How far one swipe across the BOXES moves the carousel.
 *
 * Three, because this gesture only exists to be coarser than the one below it.
 * The cards move a clip per swipe; if the bar did the same there would be two
 * controls for one step and no reason to reach past the nearer one.
 */
const BOXES_SWIPE_CLIPS = 3;

export function SeamStripBar({
  strip,
  centreClipId,
  colourOf,
  playheadPx,
  playing,
  onTogglePlay,
  onStepBack,
  onStepForward,
  onScrubSeconds,
  onStepBy,
  onScrubbingChange,
}: Readonly<{
  strip: SeamStrip;
  /** The clip to centre — the one under the middle card. */
  centreClipId: string;
  /** Each clip's box colour, derived from where its collection sits in the
   *  tree — see `clipColourOf` in the carousel. */
  colourOf: ReadonlyMap<string, string>;

  /** Where the playhead sits, in absolute strip pixels; null when untouched. */
  playheadPx: number | null;
  playing: boolean;
  onTogglePlay: () => void;
  /** Step the carousel one clip. Null at the end it cannot go. */
  onStepBack: (() => void) | null;
  onStepForward: (() => void) | null;
  /** Scrub to an absolute point on the timeline, in seconds. */
  onScrubSeconds: (seconds: number) => void;
  /** Move the carousel by `delta` clips — the boxes swipe in threes. */
  onStepBy: (delta: number) => void;
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

  // ── THE BOXES SWIPE; THEY DO NOT SCRUB ──────────────────────────────────
  //
  // Pressing a box used to scrub to it, which put two jobs on one surface: the
  // bar was both the map and the control, and a press had to mean either "go
  // there" or "look there" without any way to say which. Scrubbing moved to
  // its own rail below, and the boxes became what they look like — a filmstrip
  // you push.
  //
  // THREE AT A TIME, because the boxes are a coarse view: the cards below move
  // one clip per swipe and this is the gesture you reach for when one is not
  // enough. Same threshold as the cards' own swipe so the two feel like one
  // instruction at two scales.
  const swipeRef = useRef<{ pointerId: number; x: number } | null>(null);

  const onBoxesPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    swipeRef.current = { pointerId: event.pointerId, x: event.clientX };
  }, []);

  const onBoxesPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const swipe = swipeRef.current;
      swipeRef.current = null;
      if (swipe === null || event.pointerId !== swipe.pointerId) return;
      const dx = event.clientX - swipe.x;
      if (Math.abs(dx) < BOXES_SWIPE_PX) return;
      // Dragged LEFT pulls the strip forward, the same direction the cards
      // move for the same gesture.
      onStepBy(dx < 0 ? BOXES_SWIPE_CLIPS : -BOXES_SWIPE_CLIPS);
    },
    [onStepBy],
  );

  // ── THE RAIL SCRUBS ─────────────────────────────────────────────────────
  //
  // A plain proportional slider over the whole timeline: the clock spans every
  // clip, so a fraction of the rail is a fraction of the running time and
  // needs none of the strip's transform arithmetic.
  const railRef = useRef<HTMLDivElement | null>(null);
  const [scrubbing, setScrubbing] = useState(false);

  const secondsAt = useCallback(
    (clientX: number, totalSeconds: number) => {
      const rail = railRef.current;
      if (rail === null) return null;
      const box = rail.getBoundingClientRect();
      if (box.width <= 0) return null;
      const ratio = (clientX - box.left) / box.width;
      return Math.min(Math.max(ratio, 0), 1) * totalSeconds;
    },
    [],
  );


  if (strip.totalPx <= 0) return null;

  const totalSeconds = strip.totalPx / strip.pxPerSecond;
  const atSeconds = playheadPx === null ? null : playheadPx / strip.pxPerSecond;
  // Where the ball sits on its rail: the same instant the playhead marks on
  // the boxes, expressed against the whole running time instead of against
  // the strip's pixels.
  const railFraction =
    totalSeconds > 0 && atSeconds !== null
      ? Math.min(Math.max(atSeconds / totalSeconds, 0), 1)
      : 0;

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
        // `outline-none` on the BASE, not only on focus-visible. It is a
        // role="slider" with a tabIndex, so pressing it focuses it — and the
        // browser's own focus ring was drawing a pale outline around the whole
        // track the moment you touched it, which read as a border the bar did
        // not have a second earlier. Keyboard focus still gets a visible ring,
        // in blue, from the focus-visible rule.
        className="relative flex-1 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <div
          data-seam-boxes
          onPointerDown={onBoxesPointerDown}
          onPointerUp={onBoxesPointerUp}
          onPointerCancel={() => { swipeRef.current = null; }}
          className="relative h-9 cursor-grab overflow-hidden active:cursor-grabbing"
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
            const colour = colourOf.get(segment.clipId) ?? "hsl(220 8% 34%)";
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
                  backgroundColor: colour,
                }}
                className={[
                  "absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-[3px]",
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
                  // A DISC, NOT A GLYPH. A check said "done" — a state this
                  // clip is not in — and being white it was the brightest
                  // thing on the bar, louder than the playhead, which is the
                  // mark that actually moves. A hole punched in the box reads
                  // as "this one" without introducing a second shape or a
                  // second colour: it is black at half strength, so the clip's
                  // own colour comes through it and the disc stays a shade of
                  // the box rather than a mark laid on top of it.
                  <span
                    data-seam-marker
                    className="h-3 w-3 rounded-full bg-black/50"
                  />
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

        {/* THE SCRUBBER: a rail and a ball.
            Separated from the boxes so each surface does one thing — the boxes
            are a filmstrip you push, this is a control you drag. It spans the
            whole timeline, so a fraction of the rail is a fraction of the
            running time and none of the strip's transform arithmetic applies.
        */}
        <div
          ref={railRef}
          data-seam-rail
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            try {
              event.currentTarget.setPointerCapture(event.pointerId);
            } catch {
              /* untrusted pointer (stories) — the moves still arrive here */
            }
            setScrubbing(true);
            onScrubbingChange?.(true);
            const at = secondsAt(event.clientX, totalSeconds);
            if (at !== null) onScrubSeconds(at);
          }}
          onPointerMove={(event) => {
            if (!scrubbing) return;
            const at = secondsAt(event.clientX, totalSeconds);
            if (at !== null) onScrubSeconds(at);
          }}
          onPointerUp={() => {
            setScrubbing(false);
            onScrubbingChange?.(false);
          }}
          onPointerCancel={() => {
            setScrubbing(false);
            onScrubbingChange?.(false);
          }}
          className="relative mt-1.5 flex h-4 cursor-ew-resize items-center"
        >
          <span aria-hidden="true" className="absolute inset-x-0 h-0.5 rounded-full bg-white/20" />
          {/* Played so far, so the rail reads as a clock and not only as a
              track with a dot on it. */}
          <span
            aria-hidden="true"
            style={{ width: `${railFraction * 100}%` }}
            className="absolute left-0 h-0.5 rounded-full bg-white/45"
          />
          <span
            data-seam-ball
            aria-hidden="true"
            style={{ left: `${railFraction * 100}%` }}
            className="absolute h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
          />
        </div>
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

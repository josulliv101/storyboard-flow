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

/** Travel that turns a press on the boxes from a click into a pan. */
const CLICK_SLOP_PX = 4;

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
  onCommitClip,
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
  /** A box was CLICKED — make that clip the centred one. */
  onCommitClip: (clipId: string) => void;

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


  const [panPx, setPanPx] = useState<number | null>(null);
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ pointerId: number; x: number; from: number; moved: boolean } | null>(null);

  // PARKED ONCE, THEN LEFT ALONE.
  //
  // The centring is computed against the clip the view OPENED on, captured
  // here and never updated. It used to follow the subject, which sounds
  // helpful and is not: the bar jumped under the hand every time the cards
  // moved, and a strip you had just pushed somewhere useful threw your
  // position away. The active clip does not need to be in the middle — it is
  // marked, which is what makes it findable.
  //
  // A state initialiser rather than an effect that freezes it later: an effect
  // would set state during the first commit, which is a cascading render, and
  // the compiler's lint refuses it outright.
  const [parkedOn] = useState(centreClipId);
  const centredOffset = stripCentreOffset(
    strip,
    parkedOn,
    centreAtPx > 0 ? centreAtPx * 2 : trackWidth,
  );
  const offset = panPx ?? centredOffset;

  const onBoxesPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* untrusted pointer (stories) — moves still arrive on the element */
      }
      panRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        from: offset,
        moved: false,
      };
      setPanning(true);
    },
    [offset],
  );

  const onBoxesPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan === null || event.pointerId !== pan.pointerId) return;
    const travel = event.clientX - pan.x;
    if (Math.abs(travel) > CLICK_SLOP_PX) pan.moved = true;
    setPanPx(pan.from + travel);
  }, []);

  const endPan = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pan = panRef.current;
      panRef.current = null;
      setPanning(false);
      if (pan === null || pan.moved) return;
      // A PRESS THAT DID NOT TRAVEL IS A CLICK, and a click on a box makes
      // that clip active. Distinguished by travel rather than by timing,
      // because the surface's other job is a pan and a slow deliberate push
      // must not also count as a tap on wherever it started.
      const rail = railRef.current;
      if (rail === null) return;
      const stripX = event.clientX - rail.getBoundingClientRect().left - offset;
      const landedOn = stripPositionAt(strip, stripX)?.clipId ?? null;
      if (landedOn !== null && landedOn !== centreClipId) onCommitClip(landedOn);
    },
    [strip, centreClipId, onCommitClip, offset],
  );







  // ── THE BOXES ARE PUSHED, NOT STEPPED ──────────────────────────────────
  //
  // Grab and shove: the strip follows the hand for as far as it is dragged and
  // stays where it is let go. It briefly moved three clips per swipe, which
  // was wrong twice over — it did not work at all (the gesture only fired on a
  // clean release past a threshold, so a slow drag did nothing), and tying it
  // to a NUMBER was the wrong idea anyway. This is a map you are moving
  // around, not a control that advances.
  //
  // The pan is REMEMBERED once touched. Until then the strip auto-centres on
  // the subject; after, it stays where it was put, and only a change of
  // subject re-centres it.

  // ── THE RAIL SCRUBS ─────────────────────────────────────────────────────
  //
  // A plain proportional slider over the whole timeline: the clock spans every
  // clip, so a fraction of the rail is a fraction of the running time and
  // needs none of the strip's transform arithmetic.
  const railRef = useRef<HTMLDivElement | null>(null);

  const [scrubbing, setScrubbing] = useState(false);

  // THE RAIL SHARES THE STRIP'S COORDINATES, which is what makes the ball sit
  // under the playhead.
  //
  // It was a proportional slider over the whole timeline: a fraction of the
  // rail meant a fraction of the running time. That is a perfectly good
  // scrubber and it did not LINE UP — the boxes above are drawn at a fixed
  // scale and panned, so the same instant was at two different x positions and
  // the ball drifted away from the mark it was supposed to be holding.
  //
  // Now a point on the rail is converted through the strip's own transform, so
  // the two agree by construction at any pan.
  const secondsAt = useCallback(
    (clientX: number) => {
      const rail = railRef.current;
      if (rail === null || strip.pxPerSecond <= 0) return null;
      const box = rail.getBoundingClientRect();
      const stripX = clientX - box.left - offset;
      return Math.min(Math.max(stripX / strip.pxPerSecond, 0), strip.totalPx / strip.pxPerSecond);
    },
    [strip, offset],
  );

  const releaseScrub = useCallback(() => {
    setScrubbing(false);
    onScrubbingChange?.(false);
    // LETTING GO CHOOSES NOTHING. It briefly made whatever the scrub landed on
    // the active clip, which put a decision on the end of a gesture whose
    // whole purpose is to look around: you could not check what was coming up
    // and then go back to what you were doing, because looking had already
    // moved you. Scrubbing is a look; a CLICK on a box is how you commit to
    // one, and the arrows are how you step.
  }, [onScrubbingChange]);


  if (strip.totalPx <= 0) return null;

  const totalSeconds = strip.totalPx / strip.pxPerSecond;
  const atSeconds = playheadPx === null ? null : playheadPx / strip.pxPerSecond;
  // Where the ball sits: exactly under the playhead, because it is the same
  // number — the playhead's x on the strip, which the rail now measures in too.
  const ballPx = playheadPx === null ? null : playheadPx + offset;

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
          onPointerMove={onBoxesPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
          className="relative h-9 cursor-grab overflow-hidden active:cursor-grabbing"
        >
        <div
          data-seam-strip
          className="absolute inset-y-0 left-0 will-change-transform"
          style={{
            transform: `translateX(${offset}px)`,
            width: strip.totalPx,
            // EASED WHEN IT MOVES ITSELF, INSTANT WHEN YOU MOVE IT.
            //
            // A change of subject re-centres the strip, and that should glide.
            // A hand pushing it should not: with the transition left on, every
            // pointer move started a 260ms animation toward a target the next
            // move replaced, so the strip lagged the hand and — measured — a
            // second shove inside that window looked like no movement at all.
            transition: panning ? "none" : "transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1)",
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
            const at = secondsAt(event.clientX);
            if (at !== null) onScrubSeconds(at);
          }}
          onPointerMove={(event) => {
            if (!scrubbing) return;
            const at = secondsAt(event.clientX);
            if (at !== null) onScrubSeconds(at);
          }}
          onPointerUp={releaseScrub}
          onPointerCancel={releaseScrub}
          className="relative mt-1.5 flex h-4 cursor-ew-resize items-center"
        >
          <span aria-hidden="true" className="absolute inset-x-0 h-0.5 rounded-full bg-white/20" />
          {/* Played so far, so the rail reads as a clock and not only as a
              track with a dot on it. */}
          {ballPx !== null && (
            <>
              {/* Played so far, so the rail reads as a clock and not only as a
                  track with a dot on it. */}
              <span
                aria-hidden="true"
                style={{ width: Math.max(0, ballPx) }}
                className="absolute left-0 h-0.5 rounded-full bg-white/45"
              />
              <span
                data-seam-ball
                aria-hidden="true"
                style={{ left: ballPx }}
                className="absolute h-3 w-3 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.6)]"
              />
            </>
          )}
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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

import {
  BAR_COLLECTION_COLOURS_ENABLED,
  BAR_NEUTRAL_COLOUR,
} from "@/lib/bar-collection-colours-flag";

import {
  fitPixelsPerSecond,
  offsetAfterZoom,
  seamRulerTicks,
  snapToCut,
  zoomByWheel,
  type SeamBarClip,
} from "./graph-seam-bar-layout";
import { SeamLane, type SeamHover } from "./graph-seam-lane";
import { SeamMinimap } from "./graph-seam-minimap";
import { SeamRuler } from "./graph-seam-ruler";
import {
  buildSeamStrip,
  stripCentreOffset,
  stripPositionAt,
  stripXFor,
} from "./graph-seam-strip";

/**
 * The bar over the carousel: the whole project in playback order, as a
 * zoomable, pannable, scrubbable timeline.
 *
 * ── ONE SURFACE, THREE GESTURES, EACH WITH ITS OWN INPUT ─────────────────
 *
 * DRAG THE BOXES TO SCRUB. The film is the control — you put the playhead on
 * the frame you want by pointing at it, and it snaps to a cut when you land
 * near one. There was a rail and ball under the boxes doing this, on the
 * theory that a filmstrip and a scrubber are different objects; they are not,
 * and separating them cost a whole second strip to say what the boxes were
 * already showing.
 *
 * WHEEL TO PAN. Panning is the gesture you make while reading, so it belongs
 * on the input you can use without committing to anything — and it frees the
 * press for the job above.
 *
 * ⌘ OR CTRL AND WHEEL TO ZOOM, about the pointer, so the clip you were
 * looking at when you started is the clip you are looking at when you stop.
 * This is the part the bar could not do at all before: at one fixed scale a
 * four-minute project is either a smear or a thing you can see a tenth of,
 * and which you get depends on nothing but the length of the project.
 *
 * ── AND THREE THINGS THAT SAY WHERE YOU ARE ─────────────────────────────
 *
 * A RULER, because a box's width means "this long" only against a scale, and
 * the scale now moves. It carries the collection names too, and with the
 * collection tint parked behind a flag (see `bar-collection-colours-flag`)
 * those names and the dashed dividers are the ONLY landmarks on a run of
 * boxes that otherwise looks the same throughout — which is why both are
 * structural rather than decorative.
 *
 * A MINIMAP, because the bar is a window and that is most of the reason to
 * have one. It shows the whole sequence, always, with a rectangle marking the
 * part the bar is currently drawing.
 *
 * A HOVER PREVIEW, because a box is anonymous. Pointing at one and being told
 * what it is answers "is that the shot I want" without moving the playhead to
 * find out.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────
 *
 * LETTING GO CHOOSES NOTHING. A scrub is a look: you check what is coming up
 * and go back to what you were doing, and a release that made the landing
 * point the active clip would have already moved you. A CLICK on a box is how
 * you commit to one, and the arrows are how you step.
 *
 * THE ACTIVE CLIP IS NOT DRAGGED TO THE MIDDLE. A change of subject brings
 * the new clip into VIEW if it is off the side, and otherwise leaves the bar
 * exactly where you put it.
 */

/**
 * How near an end of the track the pointer has to get before the strip starts
 * travelling under it, and how fast it goes when it does.
 *
 * The speed ramps with depth into the zone rather than being a constant, so
 * the edge is a throttle and not a switch: a pointer resting just inside it
 * creeps along at a readable pace, one pushed hard against the very end runs
 * at `MAX`, and the two are the same gesture at different depths.
 */
const EDGE_PAN_ZONE_PX = 40;
const EDGE_PAN_MAX_PX_PER_FRAME = 16;
const EDGE_PAN_GAIN = 0.4;

/** Travel that turns a press on the boxes from a click into a scrub. */
const CLICK_SLOP_PX = 4;

/**
 * How much clear track the playhead keeps either side of it while the bar is
 * following playback. Wider on the trailing side because playback runs that
 * way and the point of following is to show what is COMING.
 */
const FOLLOW_LEAD_PX = 56;
const FOLLOW_TRAIL_PX = 72;

function edgePanVelocity(clientX: number, track: DOMRect): number {
  const intoLeft = track.left + EDGE_PAN_ZONE_PX - clientX;
  if (intoLeft > 0) return -Math.min(EDGE_PAN_MAX_PX_PER_FRAME, intoLeft * EDGE_PAN_GAIN);
  const intoRight = clientX - (track.right - EDGE_PAN_ZONE_PX);
  if (intoRight > 0) return Math.min(EDGE_PAN_MAX_PX_PER_FRAME, intoRight * EDGE_PAN_GAIN);
  return 0;
}

function readSeconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

export function SeamStripBar({
  clips,
  centreClipId,
  colourOf,
  playheadAt,
  playing,
  onTogglePlay,
  onStepBack,
  onStepForward,
  onScrubSeconds,
  onCommitClip,
  onScrubEnd,
  onScrubbingChange,
}: Readonly<{
  /** Every clip the bar can reach, in playback order. */
  clips: readonly SeamBarClip[];
  /** The clip under the middle card — marked, not centred. */
  centreClipId: string;
  /** Each clip's box colour, derived from where its collection sits in the
   *  tree — see `clipColourOf` in the carousel. */
  colourOf: ReadonlyMap<string, string>;
  /** Where playback is, as the clock reports it; null when untouched. */
  playheadAt: Readonly<{ clipId: string; secondsIntoClip: number }> | null;
  playing: boolean;
  onTogglePlay: () => void;
  /** Step the carousel one clip. Null at the end it cannot go. */
  onStepBack: (() => void) | null;
  onStepForward: (() => void) | null;
  /** Scrub to an absolute point on the timeline, in seconds. */
  onScrubSeconds: (value: number) => void;
  /** A box was CLICKED — make that clip the centred one. */
  onCommitClip: (clipId: string) => void;
  /**
   * A DRAG ENDED. No clip id, deliberately: where the playhead finished is not
   * always under the pointer — holding at an edge runs the strip along while
   * the hand stays put — so the bar would have to re-derive a position it does
   * not own. The view already resolves the playhead to a clip and a time; this
   * only tells it when to act on that.
   */
  onScrubEnd?: () => void;
  /** True while a drag is live on the bar, false when it ends — the view
   *  grows the monitor for the duration. */
  onScrubbingChange?: (active: boolean) => void;
}>) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);

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
  // It is not the middle of this track: the transport and the readout inset
  // it, so its own middle sits ~30px left of the card it must sit above.
  //
  // It IS the middle of the LAYOUT viewport. The scrim centres the row and the
  // row's transform cancels the centre panel's own offset within it, so the
  // centre card lands on that middle by construction — and `clientWidth`
  // rather than `innerWidth` because the latter counts the scrollbar, which is
  // the entire 8px the first version of this was out by.
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

  // ── SCALE ────────────────────────────────────────────────────────────────
  //
  // Null until the track has been measured, because the opening scale is a
  // question about width and there is no honest answer before there is one.
  const [pxPerSecond, setPxPerSecond] = useState<number | null>(null);

  const totalSeconds = useMemo(
    () => clips.reduce((sum, clip) => sum + Math.max(0, clip.showingSeconds), 0),
    [clips],
  );

  // OPENS FITTED TO THE COLLECTION YOU ARE IN, not to the whole project.
  //
  // The bar spans everything, and everything is the wrong unit for a first
  // glance: on a fifty-minute project a fit-to-all scale draws the shot you
  // opened as two pixels. The collection is the sequence you are working on,
  // so it gets the width — and at 1.65 trackfuls a little of it is off each
  // side, which is how the bar says there is more.
  const subjectCollectionSeconds = useMemo(() => {
    const subject = clips.find((clip) => clip.id === centreClipId);
    if (subject === undefined) return totalSeconds;
    const sum = clips
      .filter((clip) => clip.collectionId === subject.collectionId)
      .reduce((total, clip) => total + Math.max(0, clip.showingSeconds), 0);
    return sum > 0 ? sum : totalSeconds;
  }, [clips, centreClipId, totalSeconds]);

  useEffect(() => {
    if (trackWidth <= 0) return;
    // ONCE. Re-fitting on every width change would undo a zoom whenever the
    // window moved, and re-fitting on a change of subject would undo one every
    // time you stepped a clip.
    setPxPerSecond(
      (current) => current ?? fitPixelsPerSecond(subjectCollectionSeconds, trackWidth),
    );
  }, [trackWidth, subjectCollectionSeconds]);

  const scale = pxPerSecond ?? 9;
  const strip = useMemo(() => buildSeamStrip(clips, scale), [clips, scale]);

  // ONE NEUTRAL FOR EVERY BOX unless the tint is switched on. Substituted here
  // rather than at the derivation, so the collection tones are still computed
  // and still handed over — the flag decides whether the bar PAINTS with them,
  // which is what makes turning it back on one environment variable. Both the
  // strip and the minimap read this, so they cannot end up disagreeing about
  // whether the bar is a coloured object.
  const boxColourOf = useMemo(() => {
    if (BAR_COLLECTION_COLOURS_ENABLED) return colourOf;
    return new Map(clips.map((clip) => [clip.id, BAR_NEUTRAL_COLOUR] as const));
  }, [clips, colourOf]);

  // ── PAN ──────────────────────────────────────────────────────────────────
  //
  // Null until something places it, then owned outright by the user. The
  // fallback centres the subject, which is the right thing to do exactly once
  // — on open. After that the bar stays where it was put.
  const [panPx, setPanPx] = useState<number | null>(null);
  const centredOffset = stripCentreOffset(
    strip,
    centreClipId,
    centreAtPx > 0 ? centreAtPx * 2 : trackWidth,
  );
  const offset = panPx ?? centredOffset;

  // Set by any deliberate pan, cleared by any deliberate seek. While it is
  // set, playback stops dragging the bar around under the reader.
  const [followSuspended, setFollowSuspended] = useState(false);

  const [scrubbing, setScrubbing] = useState(false);
  const [snapKey, setSnapKey] = useState(0);
  const [hover, setHover] = useState<SeamHover | null>(null);

  const playheadPx =
    playheadAt === null
      ? null
      : stripXFor(strip, playheadAt.clipId, playheadAt.secondsIntoClip);
  const playheadSeconds = playheadPx === null || scale <= 0 ? null : playheadPx / scale;

  // ── MIRRORS ──────────────────────────────────────────────────────────────
  //
  // So the frame loop and the native wheel listener can read live values
  // without listing them as dependencies and re-arming themselves between
  // frames. Several of these props are inline arrows in the view — a new
  // function on every render — and depending on one would do exactly that.
  const pointerXRef = useRef(0);
  const panPxRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const scaleRef = useRef(9);
  const totalPxRef = useRef(0);
  const onScrubSecondsRef = useRef(onScrubSeconds);
  useEffect(() => {
    panPxRef.current = panPx;
    offsetRef.current = offset;
    scaleRef.current = scale;
    totalPxRef.current = strip.totalPx;
    panLimitRef.current = panLimit;
    onScrubSecondsRef.current = onScrubSeconds;
  });

  // HOW FAR THE STRIP MAY BE PUSHED EITHER WAY.
  //
  // A native scroller clamps at both ends for free, and the bar's transform
  // does not — without this a firm two-finger swipe throws the whole strip off
  // the side of the track and leaves you looking at an empty bar, with the
  // minimap as the only clue where it went.
  //
  // The bound is the CENTRE OF THE TRACK rather than its edges: the opening
  // position centres the marked box, so an early clip legitimately sits with
  // the strip pushed right and empty space before it — that space is the truth
  // that there is nothing before the first clip. Clamping to zero would undo
  // the one alignment the bar exists to hold.
  const panLimit = Math.max(trackWidth / 2, centreAtPx);
  const panLimitRef = useRef(0);

  /** Move the pan without waiting for a render to tell the loops about it. */
  const setOffset = useCallback((next: number) => {
    const most = panLimitRef.current;
    const clamped = Math.min(most, Math.max(most - totalPxRef.current, next));
    offsetRef.current = clamped;
    panPxRef.current = clamped;
    setPanPx(clamped);
  }, []);

  const seekToStripX = useCallback((stripX: number) => {
    if (scaleRef.current <= 0) return;
    const at = Math.min(Math.max(stripX, 0), totalPxRef.current);
    onScrubSecondsRef.current(at / scaleRef.current);
  }, []);

  /** Local x within the track, which is the space every gesture works in. */
  const localX = useCallback((clientX: number) => {
    const element = trackRef.current;
    if (element === null) return 0;
    return clientX - element.getBoundingClientRect().left;
  }, []);

  // ── SCRUBBING ────────────────────────────────────────────────────────────
  const pressRef = useRef<{ pointerId: number; x: number; moved: boolean } | null>(null);
  const lastSnapRef = useRef<number | null>(null);

  const scrubToClientX = useCallback(
    (clientX: number) => {
      const raw = localX(clientX) - offsetRef.current;
      const snapped = snapToCut(strip, raw);
      // ACKNOWLEDGE A SNAP ONCE, not on every frame that stays on it. A
      // playhead twitching sixty times a second while the hand sat still
      // would be a fault indicator, not a confirmation.
      if (snapped === raw) {
        lastSnapRef.current = null;
      } else if (lastSnapRef.current !== snapped) {
        lastSnapRef.current = snapped;
        setSnapKey((key) => key + 1);
      }
      seekToStripX(snapped);
    },
    [localX, seekToStripX, strip],
  );

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* untrusted pointer (stories) — the moves still arrive here */
      }
      pressRef.current = { pointerId: event.pointerId, x: event.clientX, moved: false };
      pointerXRef.current = event.clientX;
      lastSnapRef.current = null;
      setHover(null);
      setScrubbing(true);
      setFollowSuspended(false);
      onScrubbingChange?.(true);
      scrubToClientX(event.clientX);
    },
    [onScrubbingChange, scrubToClientX],
  );

  const showHover = useCallback(
    (clientX: number) => {
      const stripX = localX(clientX) - offsetRef.current;
      const at = stripPositionAt(strip, stripX);
      const clip = at === null ? undefined : clips.find((candidate) => candidate.id === at.clipId);
      if (at === null || clip === undefined) {
        setHover(null);
        return;
      }
      setHover({
        x: stripX,
        name: clip.name,
        meta: `${clip.collectionName === null ? "" : `${clip.collectionName} · `}${readSeconds(
          at.secondsIntoClip,
        )} / ${readSeconds(clip.showingSeconds)}`,
        ...(clip.posterSrc === undefined ? {} : { posterSrc: clip.posterSrc }),
      });
    },
    [clips, localX, strip],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      if (press === null) {
        showHover(event.clientX);
        return;
      }
      if (event.pointerId !== press.pointerId) return;
      if (Math.abs(event.clientX - press.x) > CLICK_SLOP_PX) press.moved = true;
      pointerXRef.current = event.clientX;
      scrubToClientX(event.clientX);
    },
    [scrubToClientX, showHover],
  );

  const endPress = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      pressRef.current = null;
      if (press === null) return;
      setScrubbing(false);
      onScrubbingChange?.(false);
      // A PRESS THAT DID NOT TRAVEL IS A CLICK, and a click on a box makes
      // that clip active. Distinguished by travel rather than by timing,
      // because a slow deliberate scrub must not also count as a tap on
      // wherever it started.
      if (press.moved) {
        // A DRAG NOW LANDS TOO. Letting go used to leave the row where it was
        // and only the monitor travelling, so the shot you had scrubbed to was
        // on screen but not the one you were working on — you had to go and
        // fetch it. Releasing is the commit.
        onScrubEnd?.();
        return;
      }
      const stripX = localX(event.clientX) - offsetRef.current;
      const landedOn = stripPositionAt(strip, stripX)?.clipId ?? null;
      if (landedOn !== null && landedOn !== centreClipId) onCommitClip(landedOn);
    },
    [centreClipId, localX, onCommitClip, onScrubEnd, onScrubbingChange, strip],
  );

  // ── HOLDING AT AN EDGE RUNS THE STRIP UNDER THE POINTER ──────────────────
  //
  // The track only spans what is on screen, so without this the end of it is
  // the end of the timeline you can reach in one gesture, with the rest of the
  // order sitting an inch off the side.
  //
  // A FRAME LOOP RATHER THAN THE POINTER MOVES, because the hand is STILL —
  // holding at an edge fires no further pointermove events at all, and an
  // implementation reading the moves would travel only while the hand
  // jittered.
  useEffect(() => {
    if (!scrubbing) return;
    let frame = requestAnimationFrame(function tick() {
      frame = requestAnimationFrame(tick);
      const element = trackRef.current;
      if (element === null || scaleRef.current <= 0) return;
      const box = element.getBoundingClientRect();
      const velocity = edgePanVelocity(pointerXRef.current, box);
      if (velocity === 0) return;

      const next = offsetRef.current - velocity;
      // IT STOPS AT THE ENDS BY ASKING WHERE THE POINTER NOW POINTS, not by
      // clamping the transform. The offset that puts the last clip under the
      // pointer is a function of the pan, the track width and the scale, and
      // the one number that has to stay in range is the time being scrubbed
      // to — so that is the number the guard is written against.
      const stripX = pointerXRef.current - box.left - next;
      if (stripX < 0 || stripX > totalPxRef.current) return;

      // THE FILM MOVED UNDER THE POINTER, so this is a drag even though the
      // hand never left the spot it landed on. Without this an edge-scrub
      // across half the project would end in a CLICK — committing to whatever
      // clip happened to arrive under a stationary finger.
      const press = pressRef.current;
      if (press !== null) press.moved = true;

      setOffset(next);
      seekToStripX(stripX);
    });
    return () => cancelAnimationFrame(frame);
  }, [scrubbing, seekToStripX, setOffset]);

  // ── WHEEL: PAN, OR ZOOM ABOUT THE POINTER ────────────────────────────────
  //
  // A NATIVE, NON-PASSIVE LISTENER. React registers `onWheel` passively at the
  // root, so `preventDefault` from a synthetic handler is ignored — which
  // would leave a zoom gesture also zooming the browser and a pan gesture also
  // scrolling the dialog behind the bar.
  useEffect(() => {
    const element = laneRef.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setFollowSuspended(true);
      setHover(null);
      if (event.ctrlKey || event.metaKey) {
        const from = scaleRef.current;
        const to = zoomByWheel(from, event.deltaY);
        if (to === from) return;
        const anchorLocalX = event.clientX - element.getBoundingClientRect().left;
        setPxPerSecond(to);
        setOffset(offsetAfterZoom({ anchorLocalX, offset: offsetRef.current, from, to }));
        return;
      }
      // The dominant axis, so a trackpad's horizontal swipe and a mouse
      // wheel's vertical notch both mean the same thing on a horizontal bar.
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (delta === 0) return;
      setOffset(offsetRef.current - delta);
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [setOffset]);

  // ── KEEPING THE PLAYHEAD IN VIEW ─────────────────────────────────────────
  //
  // NUDGED, NOT CENTRED, and only once it has actually reached an edge. A bar
  // that recentres every frame is a bar whose contents are permanently
  // sliding, which makes the one thing it is for — reading where you are —
  // the one thing it is bad at.
  const nudgeIntoView = useCallback(
    (targetPx: number) => {
      const width = trackRef.current?.getBoundingClientRect().width ?? trackWidth;
      if (width <= 0) return;
      const current = offsetRef.current;
      const onScreen = targetPx + current;
      let next = current;
      if (onScreen < FOLLOW_LEAD_PX) next = FOLLOW_LEAD_PX - targetPx;
      else if (onScreen > width - FOLLOW_TRAIL_PX) next = width - FOLLOW_TRAIL_PX - targetPx;
      if (next === current) return;
      setOffset(next);
    },
    [setOffset, trackWidth],
  );

  useEffect(() => {
    if (!playing || followSuspended || playheadPx === null) return;
    nudgeIntoView(playheadPx);
  }, [playing, followSuspended, playheadPx, nudgeIntoView]);

  // A CHANGE OF SUBJECT BRINGS THE NEW CLIP INTO VIEW — and no further. It
  // does not get dragged to the middle: the bar is a map you have positioned,
  // and stepping a clip is not a request to throw that away. Skipped while the
  // pan is still null, because the fallback is already centring it.
  const [broughtIntoView, setBroughtIntoView] = useState(centreClipId);
  useEffect(() => {
    if (broughtIntoView === centreClipId) return;
    setBroughtIntoView(centreClipId);
    setFollowSuspended(false);
    if (panPxRef.current === null) return;
    const segment = strip.segments.find((candidate) => candidate.clipId === centreClipId);
    if (segment === undefined) return;
    nudgeIntoView(segment.leftPx + segment.widthPx / 2);
  }, [broughtIntoView, centreClipId, nudgeIntoView, strip]);

  const ticks = useMemo(() => seamRulerTicks({ strip, clips }), [strip, clips]);

  const panToSeconds = useCallback(
    (value: number) => {
      const width = trackRef.current?.getBoundingClientRect().width ?? trackWidth;
      setFollowSuspended(true);
      setOffset(width / 2 - value * scaleRef.current);
    },
    [setOffset, trackWidth],
  );

  if (strip.totalPx <= 0) return null;

  const atSeconds = playheadSeconds ?? 0;
  const windowFromSeconds = scale <= 0 ? 0 : -offset / scale;
  const windowToSeconds = scale <= 0 ? 0 : (-offset + trackWidth) / scale;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const seekBy = (delta: number) => {
      event.preventDefault();
      setFollowSuspended(false);
      onScrubSeconds(Math.min(Math.max(atSeconds + delta, 0), totalSeconds));
    };
    if (event.code === "Space") {
      event.preventDefault();
      onTogglePlay();
    } else if (event.key === "ArrowLeft") {
      if (event.shiftKey) {
        event.preventDefault();
        onStepBack?.();
      } else seekBy(-1);
    } else if (event.key === "ArrowRight") {
      if (event.shiftKey) {
        event.preventDefault();
        onStepForward?.();
      } else seekBy(1);
    } else if (event.key === "Home") {
      seekBy(-Infinity);
    } else if (event.key === "End") {
      seekBy(Infinity);
    }
  };

  return (
    <div data-seam-bar className="flex w-full items-start gap-3">
      <div className="flex shrink-0 items-center gap-1">
        {/* STEP ONE CLIP, either way, bracketing the thing they move.
            Disabled rather than hidden at the ends: a control that vanishes
            takes its own position with it and shifts the bar sideways. */}
        <button
          type="button"
          data-seam-step="back"
          disabled={onStepBack === null}
          onClick={() => onStepBack?.()}
          aria-label="Previous clip"
          title="Previous clip (⇧←)"
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-25"
        >
          <ChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          aria-label={playing ? "Pause" : "Play across the cut"}
          title="Play / pause (space)"
          className="rounded-full p-1.5 text-zinc-300 outline-none hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          {playing ? (
            <Pause aria-hidden="true" className="h-4 w-4" />
          ) : (
            <Play aria-hidden="true" className="h-4 w-4" />
          )}
        </button>
        <button
          type="button"
          data-seam-step="forward"
          disabled={onStepForward === null}
          onClick={() => onStepForward?.()}
          aria-label="Next clip"
          title="Next clip (⇧→)"
          className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-25"
        >
          <ChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={trackRef}
        data-seam-track
        data-seam-centre-at={Math.round(centreAtPx)}
        data-seam-pps={Math.round(scale * 100) / 100}
        role="slider"
        tabIndex={0}
        aria-label="Scrub across the cut"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalSeconds * 100) / 100}
        aria-valuenow={Math.round(atSeconds * 100) / 100}
        onKeyDown={onKeyDown}
        // `outline-none` on the BASE, not only on focus-visible. It is a
        // role="slider" with a tabIndex, so pressing it focuses it — and the
        // browser's own focus ring drew a pale outline around the whole track
        // the moment you touched it, which read as a border the bar did not
        // have a second earlier.
        className="relative flex-1 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <SeamLane
          laneRef={laneRef}
          strip={strip}
          clips={clips}
          colourOf={boxColourOf}
          centreClipId={centreClipId}
          offset={offset}
          playheadPx={playheadPx}
          snapKey={snapKey}
          ghostX={hover === null ? null : hover.x}
          hover={scrubbing ? null : hover}
          chip={scrubbing ? readSeconds(atSeconds) : null}
          handlers={{
            onPointerDown,
            onPointerMove,
            onPointerUp: endPress,
            onPointerCancel: endPress,
            onPointerLeave: () => setHover(null),
          }}
        />

        {/* THERE IS MORE THAT WAY. The boxes are clipped hard at the track's
            edges, and a hard edge is indistinguishable from an end — these say
            which of the two you are looking at, and disappear when there is
            nothing beyond. */}
        <span
          aria-hidden="true"
          data-seam-fade="left"
          hidden={offset >= -0.5}
          className="pointer-events-none absolute top-0 left-0 h-9 w-6 bg-gradient-to-r from-zinc-950 to-transparent"
        />
        <span
          aria-hidden="true"
          data-seam-fade="right"
          hidden={strip.totalPx + offset <= trackWidth + 0.5}
          className="pointer-events-none absolute top-0 right-0 h-9 w-6 bg-gradient-to-l from-zinc-950 to-transparent"
        />

        <SeamRuler ticks={ticks} offset={offset} />

        <SeamMinimap
          clips={clips}
          colourOf={boxColourOf}
          totalSeconds={totalSeconds}
          windowFromSeconds={windowFromSeconds}
          windowToSeconds={windowToSeconds}
          playheadSeconds={playheadSeconds}
          onPanToSeconds={panToSeconds}
        />
      </div>

      <span className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-400">
        <span className="text-blue-300">{readSeconds(atSeconds)}</span>
        {" / "}
        {readSeconds(totalSeconds)}
      </span>
    </div>
  );
}

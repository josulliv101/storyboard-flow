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
  zoomByWheel,
  type SeamBarClip,
} from "./graph-seam-bar-layout";
import { SEAM_LANE_HEIGHT_PX, SeamLane, type SeamHover } from "./graph-seam-lane";
import { SeamMinimap } from "./graph-seam-minimap";
import { SEAM_RULER_HEIGHT_PX, SeamRuler } from "./graph-seam-ruler";
import {
  buildSeamStrip,
  stripCentreOffset,
  stripPositionAt,
  stripXFor,
} from "./graph-seam-strip";
import { formatClock } from "@/lib/format-duration";
import { monitorPosterUrl } from "@/lib/video-frame-url";
import type { PreviewAnchor } from "./graph-seam-preview-anchor";

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
 * How long the pointer has to rest on a box before its preview appears.
 *
 * Long enough that crossing the bar on the way to grabbing it shows nothing,
 * short enough that stopping to look does not feel like waiting. Only the
 * first appearance waits; after that the card follows live.
 */
const HOVER_DWELL_MS = 220;

/** Travel that turns a press on the boxes from a grab into a pan. Below it the
 *  press is a CLICK, and a click still chooses a clip. */
const CLICK_SLOP_PX = 4;

/**
 * How much clear track the playhead keeps either side of it while the bar is
 * following playback. Wider on the trailing side because playback runs that
 * way and the point of following is to show what is COMING.
 */
const FOLLOW_LEAD_PX = 56;
const FOLLOW_TRAIL_PX = 72;

/**
 * ── THE FLICK, AND HOW IT DIES ──────────────────────────────────────────────
 *
 * How much of its speed the glide keeps per millisecond. Applied as
 * `v *= DECAY ** dt`, so the curve is the same on a 60Hz panel and a 120Hz
 * one — a per-FRAME factor would make the strip travel twice as far on the
 * faster display, which is the usual way this is got wrong.
 *
 * 0.9965 is roughly a third of the speed left after 300ms: long enough that a
 * flick clearly carries, short enough that the film never feels like it is
 * getting away from you. The bar is a thing you read, not a wheel you spin.
 */
const GLIDE_DECAY_PER_MS = 0.9965;

/** Below this the glide is over — a fifth of a pixel per frame is not motion,
 *  it is a rounding error keeping a rAF alive. */
const GLIDE_MIN_PX_PER_MS = 0.012;

/**
 * How much of the release has to be a THROW before anything glides.
 *
 * A pan that is placed — pulled somewhere and set down — ends slow, and
 * carrying it on past where it was put would be the strip disagreeing with the
 * hand. Only a release still moving at this speed reads as thrown.
 */
const GLIDE_MIN_LAUNCH_PX_PER_MS = 0.35;

/**
 * How far back the launch speed is measured.
 *
 * The last two events are too few — a pointer that stalls for one frame before
 * release reports zero and the flick dies on the spot — and the whole gesture
 * is too many, since a drag that paused in the middle and then flicked would
 * launch at its average rather than its parting speed. ~70ms is about four
 * frames: enough to survive one stutter, short enough to be the END of the
 * gesture rather than a summary of it.
 */
const GLIDE_SAMPLE_MS = 70;

function readSeconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

/**
 * What the two fit buttons aim at.
 *
 * `clip` is the collection the subject belongs to — the sequence being worked
 * on, and the scale the bar already opens at. `all` is everything the reach
 * window covers. They are the two questions worth one press: "show me this
 * scene" and "show me the lot".
 *
 * Null once a wheel zoom has happened, because at that point neither is true
 * and lighting one would be claiming a scale the bar is not at.
 */
type FitMode = "clip" | "all";

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
  onPreviewingChange,
  atStart,
  atEnd,
  settingsLeft,
  settingsRight,
  previewAnchor = "follow",
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
   * True while the hover card is up.
   *
   * The view pulls the panels back for it — the card is a picture big enough
   * to judge, and it now overlaps the row it is drawn over, so three bright
   * panels behind it are competing with the one thing being looked at.
   *
   * Reported as a BOOLEAN rather than the hover itself: the row does not care
   * which clip is under the pointer, only that something is, and handing it
   * the hover would re-render every panel on every pointer move across the
   * bar.
   */
  onPreviewingChange?: (active: boolean) => void;
  /** Whether the bar's first and last clips are the project's — the reach can
   *  crop the window short of either, and then there IS more either side. */
  atStart: boolean;
  atEnd: boolean;
  /**
   * The view's own settings, dropped into the controls row either side of the
   * transport.
   *
   * SLOTS RATHER THAN PROPS, because what belongs there is not the bar's
   * business: it is `frames` and `reach` today and could be neither tomorrow,
   * and the bar would have to grow a prop and a branch for each one. What the
   * bar DOES own is the row — that the transport is centred in it, that the
   * clock sits with the controls, and that the whole thing lands between the
   * scrub bar and the minimap — and none of that changes with what is passed.
   */
  settingsLeft?: React.ReactNode;
  settingsRight?: React.ReactNode;
  /** Whether the hover card follows the pointer or parks under the middle of
   *  the bar — see `graph-seam-preview-anchor`. */
  previewAnchor?: PreviewAnchor;
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

  // THE OPENING FIT IS A FALLBACK, NOT A WRITE.
  //
  // It used to be an effect that set the scale once the track had been
  // measured, which is a setState in an effect — a cascading render, and the
  // thing the lint rule is right about. Derived instead, exactly as the pan
  // below is: `pxPerSecond` stays null until somebodyZOOMS or presses `fit`,
  // and until then the scale is computed from the width. Same "once" guarantee
  // with no second render — a re-measure cannot undo a zoom, because once
  // there IS a zoom the fallback is not consulted.
  const scale =
    pxPerSecond ??
    (trackWidth > 0 ? fitPixelsPerSecond(subjectCollectionSeconds, trackWidth) : 9);
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

  const [hover, setHover] = useState<SeamHover | null>(null);
  // A SHORT DWELL BEFORE THE CARD APPEARS.
  //
  // Most trips across this bar are on the way to grabbing it. Popping a 264px
  // card up the instant the pointer touches a box means every reach for the
  // film flashes something you did not ask for and then takes it away — the
  // interface twitching at a gesture that had not started yet.
  //
  // ONLY THE FIRST APPEARANCE WAITS. Once the card is up it tracks the pointer
  // with no delay at all: the dwell is asking "did you mean to look at this",
  // and once answered it must not be asked again on every box you cross.
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverPendingRef = useRef<SeamHover | null>(null);
  const hoverShownRef = useRef(false);
  const cancelHover = useCallback(() => {
    if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    hoverPendingRef.current = null;
    hoverShownRef.current = false;
    setHover(null);
  }, []);
  useEffect(() => cancelHover, [cancelHover]);
  // WHICH FIT THE BAR IS SITTING AT, if any. Seeded to `clip` because that is
  // what the opening fit does — the button is lit on arrival because it
  // describes where you already are, not somewhere you could go.
  const [fitMode, setFitMode] = useState<FitMode | null>("clip");
  // A WHEEL IS A GESTURE, and it has no end event.
  //
  // The minimap's window rectangle eases to a new place, which is right for a
  // fit or a step and wrong for a pan: during a wheel the bar has to be
  // exactly where the hand put it, and an eased rectangle would trail it. A
  // press has a pointerup to switch this back off; a wheel only stops, so it
  // is switched off on a short timer after the last notch.
  const [wheeling, setWheeling] = useState(false);
  const wheelStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (wheelStopRef.current !== null) clearTimeout(wheelStopRef.current);
    },
    [],
  );

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
  const panPxRef = useRef<number | null>(null);
  const offsetRef = useRef(0);
  const scaleRef = useRef(9);
  const totalPxRef = useRef(0);
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
  const onScrubSecondsRef = useRef(onScrubSeconds);
  useEffect(() => {
    panPxRef.current = panPx;
    offsetRef.current = offset;
    scaleRef.current = scale;
    totalPxRef.current = strip.totalPx;
    panLimitRef.current = panLimit;
    onScrubSecondsRef.current = onScrubSeconds;
  });


  /** Move the pan without waiting for a render to tell the loops about it. */
  const setOffset = useCallback((next: number) => {
    const most = panLimitRef.current;
    const clamped = Math.min(most, Math.max(most - totalPxRef.current, next));
    offsetRef.current = clamped;
    panPxRef.current = clamped;
    setPanPx(clamped);
  }, []);

  // ── INERTIA ──────────────────────────────────────────────────────────────
  //
  // A flick keeps going. The strip stopped dead on release, which is fine for
  // a short pull and wrong for a long one: reaching the far end of a
  // four-minute cut meant a row of separate drags, each one re-grabbing film
  // that was already still.
  //
  // A rAF LOOP rather than a CSS transition, because the distance is not known
  // when the hand leaves: the glide has to stop early if it reaches a pan
  // limit, and a transition that has already been handed a destination cannot.
  const glideRef = useRef<number | null>(null);
  /** Recent pointer positions, for the speed the hand left at. */
  const samplesRef = useRef<{ x: number; t: number }[]>([]);

  const stopGlide = useCallback(() => {
    if (glideRef.current === null) return;
    cancelAnimationFrame(glideRef.current);
    glideRef.current = null;
  }, []);
  // Nothing outlives the bar: a rAF still holding a closure over `setOffset`
  // after unmount is a setState on a dead component every frame until it
  // decays.
  useEffect(() => stopGlide, [stopGlide]);

  const startGlide = useCallback(
    (velocityPxPerMs: number) => {
      stopGlide();
      // REDUCED MOTION TAKES THE GLIDE, not the pan. The strip still goes
      // exactly where it is dragged; it simply stops when the hand does, which
      // is what someone asking for less motion is asking for.
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) return;
      if (Math.abs(velocityPxPerMs) < GLIDE_MIN_LAUNCH_PX_PER_MS) return;
      let velocity = velocityPxPerMs;
      let previous = performance.now();
      const step = (now: number) => {
        const dt = Math.min(64, now - previous);
        previous = now;
        velocity *= GLIDE_DECAY_PER_MS ** dt;
        if (Math.abs(velocity) < GLIDE_MIN_PX_PER_MS) {
          glideRef.current = null;
          return;
        }
        const before = offsetRef.current;
        setOffset(before + velocity * dt);
        // CLAMPED IS STOPPED. `setOffset` holds the pan inside its limits, so
        // a glide that has run into one would otherwise spend its remaining
        // speed asking for a position it cannot have — the strip sitting still
        // while a loop insists it is moving.
        if (Math.abs(offsetRef.current - before) < 0.01) {
          glideRef.current = null;
          return;
        }
        glideRef.current = requestAnimationFrame(step);
      };
      glideRef.current = requestAnimationFrame(step);
    },
    [setOffset, stopGlide],
  );

  /** Local x within the track, which is the space every gesture works in. */
  const localX = useCallback((clientX: number) => {
    const element = trackRef.current;
    if (element === null) return 0;
    return clientX - element.getBoundingClientRect().left;
  }, []);

  // ── SCRUBBING ────────────────────────────────────────────────────────────
  const pressRef = useRef<{
    pointerId: number;
    x: number;
    /** The pan the strip was at when the hand landed. Every move is measured
     *  from here rather than accumulated, so a dropped event cannot make the
     *  film drift away from the pointer over a long drag. */
    offset: number;
    moved: boolean;
  } | null>(null);
  // A HAND IS ON THE FILM. Distinct from a wheel pan: this one has an end
  // event, so it does not need the timer `wheeling` does.
  const [panning, setPanning] = useState(false);
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.isPrimary || event.button !== 0) return;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* untrusted pointer (stories) — the moves still arrive here */
      }
      // GRAB THE FILM. A press used to put the playhead where you pointed and
      // drag it from there, which made the middle card a monitor for the
      // duration — so reaching for the bar to look further along the sequence
      // changed what you were working on and had to be undone afterwards.
      //
      // Dragging now moves the STRIP, the way you would pull a length of film
      // along a bench: the playhead stays where it is, nothing below changes,
      // and letting go commits to nothing. Clicking a box still chooses one,
      // which is the gesture that always meant "go here".
      // CATCHING A GLIDING STRIP STOPS IT, exactly like putting a hand on
      // moving film. Before the press records its origin, because that origin
      // is `offsetRef` and a glide is still writing to it.
      stopGlide();
      samplesRef.current = [];
      pressRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        offset: offsetRef.current,
        moved: false,
      };
      cancelHover();
      setPanning(true);
      // A DELIBERATE PAN, so playback stops dragging the bar back under the
      // hand — the same rule the wheel already follows.
      setFollowSuspended(true);
    },
    [cancelHover, stopGlide],
  );

  const showHover = useCallback(
    (clientX: number) => {
      const stripX = localX(clientX) - offsetRef.current;
      const at = stripPositionAt(strip, stripX);
      const clip = at === null ? undefined : clips.find((candidate) => candidate.id === at.clipId);
      if (at === null || clip === undefined) {
        cancelHover();
        return;
      }
      const next: SeamHover = {
        x: stripX,
        name: clip.name,
        meta: `${clip.collectionName === null ? "" : `${clip.collectionName} · `}${readSeconds(
          at.secondsIntoClip,
        )} / ${readSeconds(clip.showingSeconds)}`,
        // THE FRAME UNDER THE POINTER, not the clip's opening frame.
        //
        // It showed `posterSrc` — one picture per clip — so moving along a
        // ten-second take changed the time in the caption and nothing else.
        // The card is answering "what is HERE", and a still of the shot's first
        // frame answers "what is this clip", which the box's own strip already
        // said. Reading across a long take is most of what the hover is for.
        //
        // QUANTISED TO A QUARTER SECOND. The URL is a Cloudinary frame grab, so
        // every distinct time is a distinct fetch, and a pointer crossing a
        // wide box at sixty frames a second would ask for a few hundred of
        // them. A quarter second is finer than the eye tracks while sweeping
        // and coarse enough that a second pass over the same clip is answered
        // from cache.
        //
        // VIDEO ONLY. A still has one image and no timeline to sample; asking
        // for a frame offset into it would rewrite a perfectly good image URL
        // into one that names a moment the file does not have.
        ...(clip.posterSrcs === undefined
          ? clip.posterSrc === undefined
            ? {}
            : { posterSrc: clip.posterSrc }
          : {
              posterSrc:
                monitorPosterUrl(
                  clip.posterSrcs[0],
                  Math.round(((clip.trimInSeconds ?? 0) + at.secondsIntoClip) * 4) / 4,
                ) ?? clip.posterSrc,
            }),
      };
      // Already up: follow immediately. The dwell is a question about
      // INTENT, and it has been answered.
      if (hoverShownRef.current) {
        setHover(next);
        return;
      }
      hoverPendingRef.current = next;
      if (hoverTimerRef.current !== null) return;
      hoverTimerRef.current = setTimeout(() => {
        hoverTimerRef.current = null;
        const pending = hoverPendingRef.current;
        if (pending === null) return;
        hoverShownRef.current = true;
        setHover(pending);
      }, HOVER_DWELL_MS);
    },
    [cancelHover, clips, localX, strip],
  );

  /**
   * The RULER's move handler, and the only thing that raises the preview.
   *
   * Hovering used to be the lane's job, which meant the card appeared over the
   * frames it was reporting on with the pointer sitting on them. It answers
   * from the ruler now — the same x, since both are translated by the same
   * offset, so the clip under the mark is the clip the card describes.
   *
   * DEAD WHILE A DRAG IS RUNNING. The lane captures the pointer on press, so
   * moves during a scrub are delivered here only if the finger travels up over
   * the ruler; showing a card mid-drag would put a picture over the film at
   * exactly the moment the film is the thing being watched.
   */
  const onRulerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (pressRef.current !== null) return;
      showHover(event.clientX);
    },
    [showHover],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      // NO LONGER THE HOVER PATH. A move over the boxes with nothing pressed
      // is now simply nothing — the ruler above answers that, see
      // `onRulerMove`.
      if (press === null) return;
      if (event.pointerId !== press.pointerId) return;
      if (Math.abs(event.clientX - press.x) > CLICK_SLOP_PX) press.moved = true;
      // THE LAST FEW MILLISECONDS OF THE HAND, kept so the release knows how
      // fast it was going. Trimmed to the window rather than accumulated: the
      // launch speed is the end of the gesture, not its average.
      const now = performance.now();
      const samples = samplesRef.current;
      samples.push({ x: event.clientX, t: now });
      while (samples.length > 2 && now - samples[0]!.t > GLIDE_SAMPLE_MS) samples.shift();
      // THE FILM FOLLOWS THE HAND, ONE TO ONE. Measured from where the press
      // landed rather than accumulated per event, so the point of film under
      // the finger stays under it however long the drag runs — an accumulating
      // version drifts by whatever a dropped or coalesced move was worth.
      setOffset(press.offset + (event.clientX - press.x));
    },
    [setOffset],
  );

  const endPress = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      pressRef.current = null;
      const samples = samplesRef.current;
      samplesRef.current = [];
      if (press === null) return;
      setPanning(false);
      // LET GO OF A MOVING FILM AND IT KEEPS GOING. Measured across the
      // window rather than between the final pair, so one stalled frame
      // before release does not report a dead stop — see `GLIDE_SAMPLE_MS`.
      // Only a drag glides: a click has no speed to carry and the branch
      // below turns it into a choice of clip instead.
      if (press.moved && samples.length >= 2) {
        const first = samples[0]!;
        const last = samples[samples.length - 1]!;
        const elapsed = last.t - first.t;
        if (elapsed > 0) startGlide((last.x - first.x) / elapsed);
      }
      // A PRESS THAT DID NOT TRAVEL IS A CLICK, and a click on a box makes
      // that clip active. Distinguished by travel rather than by timing,
      // because a slow deliberate pan must not also count as a tap on whatever
      // it started over.
      //
      // A DRAG COMMITS TO NOTHING. That is the whole point of it being a pan:
      // you pull the film along to see what is there, and what you were
      // working on is exactly where you left it. Letting go used to land the
      // row on wherever the playhead had reached, which meant a look cost you
      // your place and a trip back.
      if (press.moved) return;
      const stripX = localX(event.clientX) - offsetRef.current;
      const landedOn = stripPositionAt(strip, stripX)?.clipId ?? null;
      if (landedOn !== null && landedOn !== centreClipId) onCommitClip(landedOn);
    },
    [centreClipId, localX, onCommitClip, startGlide, strip],
  );


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
      // A WHEEL IS A NEW INSTRUCTION, so it takes over from a glide rather
      // than adding to one — otherwise the strip is being moved by two things
      // at once and lands where neither asked.
      stopGlide();
      setFollowSuspended(true);
      cancelHover();
      setWheeling(true);
      if (wheelStopRef.current !== null) clearTimeout(wheelStopRef.current);
      // Long enough to bridge the gap between notches of one scroll, short
      // enough that letting go feels like letting go.
      wheelStopRef.current = setTimeout(() => setWheeling(false), 160);
      if (event.ctrlKey || event.metaKey) {
        const from = scaleRef.current;
        const to = zoomByWheel(from, event.deltaY);
        if (to === from) return;
        const anchorLocalX = event.clientX - element.getBoundingClientRect().left;
        setPxPerSecond(to);
        // NEITHER FIT IS TRUE ANY MORE. Leaving one lit after a zoom would be
        // the control lying about the scale it names.
        setFitMode(null);
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
  }, [cancelHover, setOffset, stopGlide]);

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
  // A REF, NOT STATE. Nothing renders from this — it only remembers which
  // subject has already been brought into view so the nudge runs once per
  // change. As state it was a setState inside an effect, which is a second
  // render for a value no one draws.
  const broughtIntoViewRef = useRef(centreClipId);
  useEffect(() => {
    if (broughtIntoViewRef.current === centreClipId) return;
    broughtIntoViewRef.current = centreClipId;
    setFollowSuspended(false);
    if (panPxRef.current === null) return;
    const segment = strip.segments.find((candidate) => candidate.clipId === centreClipId);
    if (segment === undefined) return;
    nudgeIntoView(segment.leftPx + segment.widthPx / 2);
  }, [centreClipId, nudgeIntoView, strip]);

  // DERIVED, NOT ANNOUNCED AT EACH SITE. `hover` is cleared from four places —
  // pointer down, pointer leave, a wheel, and a position that resolves to no
  // clip — and a missed one would leave the panels dimmed with no card up to
  // explain why. Watching the value catches all of them.
  const previewing = hover !== null;
  useEffect(() => {
    onPreviewingChange?.(previewing);
  }, [previewing, onPreviewingChange]);

  const ticks = useMemo(() => seamRulerTicks({ strip, clips }), [strip, clips]);

  /**
   * Re-scale so a span fills the track, and put the subject back under the
   * card.
   *
   * BOTH HALVES, because a fit that only changed the scale would leave the bar
   * showing whatever stretch happened to be under the old offset at the new
   * zoom — usually nowhere near the clip being worked on. Fitting is a request
   * to see something, so it re-centres as well as re-scales, which is the one
   * place the bar deliberately overrides "stay where you were put".
   */
  const fitTo = useCallback(
    (mode: FitMode) => {
      const width = trackRef.current?.getBoundingClientRect().width ?? trackWidth;
      if (width <= 0) return;
      const span = mode === "clip" ? subjectCollectionSeconds : totalSeconds;
      if (span <= 0) return;
      const next = fitPixelsPerSecond(span, width);
      setPxPerSecond(next);
      setFitMode(mode);
      setFollowSuspended(false);
      // Re-centre with the NEW scale rather than the ref's old one — the ref
      // is refreshed by an effect after render, so it is still the pre-fit
      // value at this point and would centre against a scale that no longer
      // exists.
      const rebuilt = buildSeamStrip(clips, next);
      const segment = rebuilt.segments.find((found) => found.clipId === centreClipId);
      if (segment === undefined) return;
      const target = centreAtPx > 0 ? centreAtPx : width / 2;
      setOffset(target - (segment.leftPx + segment.widthPx / 2));
    },
    [
      centreAtPx,
      centreClipId,
      clips,
      setOffset,
      subjectCollectionSeconds,
      totalSeconds,
      trackWidth,
    ],
  );

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
    <div data-seam-bar className="flex w-full flex-col gap-2">
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
        // `z-30`, so what OVERFLOWS this element paints above the minimap and
        // the controls below it. The hover card is absolutely positioned inside
        // the lane and now hangs well past the track's own 52px; without a
        // stacking order the two later siblings would paint over it, since DOM
        // order decides among elements that never asked. The track's own box
        // does not reach them, and the card is `pointer-events-none`, so
        // nothing under it stops being clickable.
        className="relative z-30 flex-1 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        {/* THE SCALE, ABOVE THE FILM IT MEASURES — and the hover target.
            See `graph-seam-ruler` for both: a ruler belongs against what it
            measures, and a preview card belongs somewhere other than on top
            of the frames it is reporting on. */}
        <SeamRuler
          ticks={ticks}
          offset={offset}
          // The same x the lane's ghost uses, so the two are one line. Dropped
          // while panning for the same reason the lane drops its card: the bar
          // is moving under the pointer, and a mark claiming to be "here" is
          // the one thing that is not true mid-drag.
          ghostX={hover === null || panning ? null : hover.x}
          handlers={{ onPointerMove: onRulerMove, onPointerLeave: cancelHover }}
        />

        <SeamLane
          laneRef={laneRef}
          strip={strip}
          clips={clips}
          colourOf={boxColourOf}
          centreClipId={centreClipId}
          atStart={atStart}
          atEnd={atEnd}
          offset={offset}
          playheadPx={playheadPx}
          ghostX={hover === null ? null : hover.x}
          hover={panning ? null : hover}
          previewAnchor={previewAnchor}
          handlers={{
            onPointerDown,
            onPointerMove,
            onPointerUp: endPress,
            onPointerCancel: endPress,
          }}
        />

        {/* THERE IS MORE THAT WAY. The boxes are clipped hard at the track's
            edges, and a hard edge is indistinguishable from an end — these say
            which of the two you are looking at, and disappear when there is
            nothing beyond. */}
        {/* THERE IS MORE THAT WAY, over the FILM only.
            Offset by the ruler's height rather than pinned to the track's top:
            the strip no longer starts there, and a fade left at `top-0` would
            wash out the row of labels instead of the frames. One number, from
            the ruler itself, so the two cannot drift. */}
        <span
          aria-hidden="true"
          data-seam-fade="left"
          hidden={offset >= -0.5}
          style={{ top: SEAM_RULER_HEIGHT_PX, height: SEAM_LANE_HEIGHT_PX }}
          className="pointer-events-none absolute left-0 w-6 bg-gradient-to-r from-zinc-950 to-transparent"
        />
        <span
          aria-hidden="true"
          data-seam-fade="right"
          hidden={strip.totalPx + offset <= trackWidth + 0.5}
          style={{ top: SEAM_RULER_HEIGHT_PX, height: SEAM_LANE_HEIGHT_PX }}
          className="pointer-events-none absolute right-0 w-6 bg-gradient-to-l from-zinc-950 to-transparent"
        />
      </div>

      {/* THE WHOLE PROJECT, DIRECTLY UNDER THE FILM STRIP.
          The two are the same object at two scales — this cut, and where that
          cut is in the project — and reading one against the other is the
          whole point of having both. They were separated by the controls row,
          which put a line of buttons between a window and the map of what it
          is a window ONTO: the rectangle and the boxes it corresponds to were
          the two things furthest apart in the block.
          Nothing lands between them now, so the eye can go straight from a box
          to its place in the sequence. */}
      <SeamMinimap
        clips={clips}
        colourOf={boxColourOf}
        centreClipId={centreClipId}
        totalSeconds={totalSeconds}
        windowFromSeconds={windowFromSeconds}
        windowToSeconds={windowToSeconds}
        playheadSeconds={playheadSeconds}
        onPanToSeconds={panToSeconds}
        // EASE THE WINDOW WHEN NOTHING IS DRIVING IT. A hand on the film and
        // a wheel both move the strip directly, and the rectangle has to arrive
        // exactly where they put it — easing would leave it trailing the film
        // it is supposed to be reporting. A fit, a step or a landing moves it
        // somewhere else in a single frame, and that is the jump worth
        // animating.
        settled={!panning && !wheeling}
      />

      {/* THE CONTROLS UNDER BOTH BARS, and the transport in the middle of it.
          They sat between the two, on the reasoning that a row driving both
          belongs equally close to each. What that missed is that the two bars
          are more use to each other than either is to the buttons: one is a
          window and the other is the map it moves over, so anything between
          them is between a thing and its own index. The controls are the row
          you reach for, not the row you read, and they lose nothing by sitting
          under what they act on.

          A THREE-COLUMN GRID, not a flex row with `justify-between`. The
          transport has to be centred on the BAR, and a flex row centres it
          between whatever happens to be either side of it — so it would drift
          left and right as the settings changed width, which is exactly what a
          play button must not do. `1fr auto 1fr` puts it in the middle of the
          track above it and leaves it there. */}
      <div
        data-seam-controls
        // `pb-2` MATCHES THE `gap-2` ABOVE. This row is the last child of the
        // bar's column, so it had 8px of stack gap over it and nothing under —
        // which put the ensemble visibly high in its own band even though the
        // row itself was centred. Equal air on both sides is what makes it look
        // centred, and only one of those two numbers existed.
        className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 pb-2"
      >
        {/* HIDDEN, NOT WRAPPED, on a narrow view. Wrapping this row costs the
            strip below a line of height it has to be told about — see the
            scrim's top padding — and the two settings here are set once, while
            the transport and the clock are used continuously. The row keeps
            what is being USED. */}
        <div className="hidden min-w-0 items-center gap-1 md:flex">{settingsLeft}</div>

        {/* THE TRANSPORT, AS ONE OBJECT AND THE BIGGEST THING IN THE ROW.
            It was three small icon buttons with the same weight as the
            settings either side of it, spaced like them and indistinguishable
            from them at a glance — so the one control this view is actually
            for looked like another toggle. It is now an ensemble: a single
            rounded ground holding all three, which says they belong to each
            other and not to the badges beside them.

            AND IT LINES UP WITH THE PANEL IT DRIVES. The row is a
            `1fr auto 1fr` grid so this sits on the middle of the TRACK, and the
            track's middle is what the row below centres its subject on — so
            the play button and the clip it plays are on the same vertical, and
            stay there when a setting changes width. */}
        <div
          data-seam-transport
          // DROPPED CLEAR OF THE BARS ABOVE. `mt-9` is 36px, on the assembly
          // rather than on the row: the badges either side keep sitting where
          // the ruler leaves them, and only the transport takes the air.
          //
          // Landed at 20 first and went to 36. Whatever this number becomes,
          // the scrim's top padding owes it TWICE over — see the note there.
          className="mt-9 flex items-center gap-1.5 rounded-full border border-zinc-700/80 bg-zinc-900/70 p-1.5"
        >
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
            className="grid h-7 w-7 place-items-center rounded-full text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>

          {/* THE CENTREPIECE. Filled rather than ghosted, and half again the
              size of its neighbours: of everything in this row it is the one
              control with a single obvious meaning, and the only one anyone
              reaches for without reading first. Big enough to be that, and no
              bigger — at 44px it stopped reading as a control in a row and
              started reading as a button the row was arranged around.

              ONE NUMBER FOR ALL THE AIR AROUND IT. The ring's padding and the
              gaps between the three buttons are the same 6px, so the play
              button has equal space on every side rather than 6px outside and
              4px in — a difference small enough to read as "not quite centred"
              without being large enough to name. */}
          <button
            type="button"
            data-seam-play
            onClick={onTogglePlay}
            aria-label={playing ? "Pause" : "Play across the cut"}
            title="Play / pause (space)"
            className="grid h-8 w-8 place-items-center rounded-full bg-zinc-100 text-zinc-900 shadow-sm transition-colors outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {playing ? (
              <Pause aria-hidden="true" className="h-4 w-4" />
            ) : (
              // Nudged right by a hair: a triangle's optical centre is left of
              // its bounding box, so a centred play glyph reads as sitting
              // slightly back in the circle.
              <Play aria-hidden="true" className="h-4 w-4 translate-x-[1px]" />
            )}
          </button>

          <button
            type="button"
            data-seam-step="forward"
            disabled={onStepForward === null}
            onClick={() => onStepForward?.()}
            aria-label="Next clip"
            title="Next clip (⇧→)"
            className="grid h-7 w-7 place-items-center rounded-full text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-3">
          {/* THE CLOCK, which came from the far right of the scrub bar. It
              belongs with the transport rather than with the track: it says
              where playback IS, which is the same question the play button
              answers, and reading the two together is why it moved. */}
          {/* CLOCK NOTATION, NOT SECONDS. `252.90s` is accurate and unusable —
              nobody can place it in a four-minute cut without doing division.
              Tenths rather than hundredths because this number MOVES: the
              second decimal is a blur at playback speed, and the first is
              exactly enough to see time passing. */}
          <span
            data-seam-clock
            className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-500"
          >
            <span className="text-blue-400">{formatClock(atSeconds)}</span>
            {" / "}
            <span className="text-blue-400/70">{formatClock(totalSeconds)}</span>
          </span>

          {/* FIT: the two scales worth one press.
              Zoom was ⌘-wheel and nothing else, which meant the two scales
              anyone actually wants — this scene, and the lot — were reachable
              only by rolling until they happened to arrive. Both are one
              `fitPixelsPerSecond` call the bar was already making on open;
              this just gives them a button. */}
          <div
            data-seam-fit
            role="group"
            aria-label="Fit the bar to"
            className="hidden shrink-0 items-center gap-1 md:flex"
          >
            <span className="mr-1 font-mono text-[10px] text-zinc-500">fit</span>
            {(["clip", "all"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={mode === fitMode}
                onClick={() => fitTo(mode)}
                title={
                  mode === "clip"
                    ? "Fit this clip's collection"
                    : "Fit everything the bar reaches"
                }
                className={[
                  "min-w-7 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors",
                  mode === fitMode
                    ? "bg-zinc-100 text-zinc-900"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                ].join(" ")}
              >
                {mode}
              </button>
            ))}
          </div>

          <div className="hidden min-w-0 items-center gap-1 md:flex">{settingsRight}</div>
        </div>
      </div>

    </div>
  );
}

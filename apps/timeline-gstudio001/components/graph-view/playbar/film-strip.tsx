"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { TvMinimal } from "lucide-react";

import {
  REFERENCE_SHOTS,
  placeSections,
  placeShots,
  type FilmStripShot,
  type PlacedShot,
} from "./film-strip-data";
import { PIXELS_PER_SECOND as PXS, clamp, timecode } from "./playbar-model";
import {
  MOMENTUM_MAX,
  advanceMomentum,
  momentumSpent,
  releaseVelocity,
  smoothVelocity,
  willFling,
} from "./playbar-motion";
import { PlaybarFrame } from "./playbar-frame";
import { PLAYBAR_CSS, PLAYBAR_PAGE_CLASS, PLAYBAR_SCOPE } from "./playbar-styles";

/** Read at the moment of the move rather than at mount, because the setting can
 *  change under a long-lived view and a cached answer would outlive it. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * THE REFERENCE DESIGN'S FILM STRIP, ported to React (PL15-030).
 *
 * The ruler and its section lanes, the strip of shots, the playhead with its
 * timecode chip, and the minimap. Panning, scrubbing, flinging, jumping and
 * playback are all here; the stylesheet is the reference's own, extracted
 * rather than retyped (see `playbar-styles`).
 *
 * SCROLL IS IMPERATIVE, AND THAT IS DELIBERATE. The pan, the fling, the
 * minimap drag and the playhead's follow all write `viewport.scrollLeft`
 * directly, and the sticky section labels and the minimap window are written
 * from a scroll handler rather than from state. Routing sixty scroll positions
 * a second through React would re-render 17 shots and 121 ticks to move two
 * boxes — the static parts are memoised precisely so they do not.
 *
 * WHAT STATE IS FOR: the clock, whether it is playing, which shot is selected,
 * and where the hover ghost is. Those change on human timescales.
 */

/** A press that moves less than this is a tap, not a pan. */
/** A trimmed shot may not vanish; a tenth of a second is the floor, the same
 *  one the deck's handles use. */
const TRIM_FLOOR_SECONDS = 0.1;

/**
 * The canonical handle's own numbers, from `GraphTrimHandle`: 8px wide, and
 * gone entirely once two of them would take more than a quarter of the clip.
 *
 * That second rule matters far more here than on a card. A card is a fixed
 * width; a box on this strip is its DURATION, so a two-second shot next to a
 * twenty-second one is a tenth of the width — and handles that cover the shot
 * they are trimming hide the thing being judged. Below the threshold the card
 * is where the trim is made, which is where it was made before this existed.
 */
const TRIM_HANDLE_PX = 8;
const MAX_HANDLE_SHARE = 0.25;

/** Breathing room between the playhead's top and the skim card below it. */
const SKIM_GAP_PX = 10;
/** How close the card may come to the window's edges before it is held back. */
const SKIM_EDGE_PX = 8;

const TAP_SLOP_PX = 4;

type Pan = {
  startX: number;
  startScroll: number;
  lastX: number;
  lastAt: number;
  velocity: number;
  moved: boolean;
  shotIndex: number | null;
};

/** The card the strip floats above the playhead while a scrub is running. */
export type FilmStripSkimPreview = Readonly<{
  /** A frame grab at the scrubbed moment. Absent for audio, which has no
   *  picture, and for anything whose poster could not be addressed. */
  posterSrc?: string;
  name: string;
  meta: string;
}>;

export type FilmStripProps = Readonly<{
  /** The sequence to draw. Defaults to the reference design's own. */
  shots?: readonly FilmStripShot[];
  /** Where playback is. CONTROLLED when given — the strip reports scrubs
   *  through `onScrub` and never moves the clock behind the caller's back. */
  seconds?: number;
  playing?: boolean;
  /** The shot drawn as the subject. */
  selectedId?: string | null;
  onScrub?: (seconds: number) => void;
  /**
   * The time under a running scrub, and `null` the moment it ends.
   *
   * Separate from `onScrub` because they answer different questions. `onScrub`
   * moves the clock and is the edit; this is "a pointer is dragging the
   * playhead and it is HERE", which is what decides whether a preview should be
   * up at all. Folding them together would leave the caller unable to tell a
   * scrub that finished from one parked on the same frame.
   */
  onSkim?: (seconds: number | null) => void;
  /**
   * Commit a trim on the shot the strip was dragging, in SOURCE seconds.
   *
   * The same shape the deck's handles report, so one handler in the caller
   * serves both surfaces and the two cannot drift into disagreeing about what
   * a trim is.
   */
  onTrim?: (id: string, next: Readonly<{ in: number; out: number }>) => void;
  /**
   * What to draw above the playhead while scrubbing, or `null` to draw nothing.
   *
   * THE CALLER DECIDES, because only it knows whether the preview pane is open
   * and took the frame instead — `usePublishTrimPreview` returns exactly that,
   * and the rule it was built around is that precisely one of the two is ever
   * showing. The strip does not get an opinion; it is handed a card or it is
   * not.
   */
  skimPreview?: FilmStripSkimPreview | null;
  onTogglePlay?: () => void;
  onSelect?: (id: string) => void;
  /**
   * ON ITS OWN PAGE, or embedded in one.
   *
   * Standalone (the default) brings the reference's stage: the ink background,
   * the centring, the meta line above the bar. Embedded brings none of it —
   * the app has its own header and its own ground, and a component that
   * repainted them would be claiming a page it does not own.
   */
  standalone?: boolean;
  className?: string;
}>;

export function FilmStrip({
  shots: shotsProp,
  seconds: secondsProp,
  playing: playingProp,
  selectedId,
  onScrub,
  onSkim,
  onTrim,
  skimPreview,
  onTogglePlay,
  onSelect,
  standalone = true,
  className,
}: FilmStripProps) {
  const shots = useMemo(() => placeShots(shotsProp ?? REFERENCE_SHOTS), [shotsProp]);
  const sections = useMemo(() => placeSections(shots), [shots]);
  const DUR = shots.length === 0 ? 0 : shots[shots.length - 1]!.end;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const windowRef = useRef<HTMLDivElement | null>(null);

  const panRef = useRef<Pan | null>(null);
  const momentumRef = useRef<{ velocity: number; last: number; raf: number } | null>(null);
  const scrubbingRef = useRef(false);
  const minimapDragRef = useRef<{ x: number; scroll: number } | null>(null);

  // CONTROLLED WHEN THE CALLER SAYS SO, and self-driving otherwise — the story
  // renders the design with no owner, the app owns the clock. `onScrub` is the
  // only way the clock moves when controlled, so the two can never disagree.
  const [ownTime, setOwnTime] = useState(0);
  const [ownPlaying, setOwnPlaying] = useState(false);
  const [ownSelectedId, setOwnSelectedId] = useState<string | null>(null);
  const time = secondsProp ?? ownTime;
  const playing = playingProp ?? ownPlaying;
  const setTime = useCallback(
    (next: number | ((current: number) => number)) => {
      const value =
        typeof next === "function" ? (next as (current: number) => number)(time) : next;
      if (secondsProp === undefined) setOwnTime(value);
      onScrub?.(value);
    },
    [onScrub, secondsProp, time],
  );
  const setPlaying = useCallback(
    (next: boolean | ((current: boolean) => boolean)) => {
      const value =
        typeof next === "function" ? (next as (current: boolean) => boolean)(playing) : next;
      if (playingProp === undefined) setOwnPlaying(value);
      if (value !== playing) onTogglePlay?.();
    },
    [onTogglePlay, playing, playingProp],
  );
  const activeId = selectedId ?? ownSelectedId;
  const setSelected = useCallback(
    (index: number) => {
      const shot = shots[index];
      if (shot === undefined) return;
      if (selectedId === undefined) setOwnSelectedId(shot.id);
      onSelect?.(shot.id);
    },
    [onSelect, selectedId, shots],
  );
  const [trimming, setTrimming] = useState<{
    id: string;
    seconds: number;
    shift: number;
  } | null>(null);
  const trimmingRef = useRef<{ id: string; seconds: number; shift: number } | null>(null);

  const [ghostX, setGhostX] = useState<number | null>(null);
  const [hot, setHot] = useState(false);

  /* ── the parts that never change with the clock ──────────────────────── */

  const ticks = useMemo(
    () =>
      Array.from({ length: Math.floor(DUR) + 1 }, (_, i) => {
        const kind = i % 10 === 0 ? " t10" : i % 2 === 0 ? " t2" : "";
        return (
          <span key={`tick-${i}`}>
            <div data-seam-tick className={`tick${kind}`} style={{ left: i * PXS }} />
            {i % 2 === 0 && i < DUR ? (
              <span
                className={`tlabel${i % 10 === 0 ? " big" : ""}`}
                style={{ left: i * PXS }}
              >
                {i}s
              </span>
            ) : null}
          </span>
        );
      }),
    [DUR],
  );


  const scrollToSection = useCallback((startSeconds: number) => {
    viewportRef.current?.scrollTo({ left: startSeconds * PXS - 24, behavior: "smooth" });
  }, []);

  /**
   * THE SELECTED SHOT IS BROUGHT INTO VIEW.
   *
   * Opening a clip's details used to leave the strip at scrollLeft 0 whichever
   * clip was opened — measured, clip 1 of 13 and clip 11 of 13 both showed the
   * head of the sequence, so the one shot the whole view is about was often
   * off-screen entirely.
   *
   * JUMPS the first time and glides after. On open there is nothing to follow,
   * so an animation would only be a scroll the reader did not ask for; once the
   * strip is on screen, a change of subject should be traceable by eye.
   *
   * THE HAND ALWAYS WINS: a pan or a coast in progress is left alone rather
   * than yanked back, which is what made this worth a guard rather than a
   * `scrollIntoView`.
   */
  const centredForRef = useRef<{ id: string; at: number } | null>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport === null || content === null) return;
    if (activeId === null || activeId === undefined) return;

    const bring = () => {
      // THE HAND ALWAYS WINS: a pan or a coast in progress is left alone.
        // THE HAND ALWAYS WINS, and a trim is a hand too.
      //
      // This watches the strip for boxes MOVING, and a trim drag moves one on
      // every pointer event — so centring would run mid-drag, scroll the
      // viewport, and shift the very coordinate base the drag measures travel
      // against. Measured: a 50px pull on the in edge was read as 77px, and the
      // box narrowed from both sides instead of holding its out point.
      if (trimmingRef.current !== null) return;
      if (panRef.current !== null || momentumRef.current !== null) return;

      // FOUND BY COMPARING ATTRIBUTES, not by building a selector. A node id is
      // any string, so interpolating one into `querySelector` is a parse away
      // from throwing on the first clip whose id contains a delimiter.
      const box = Array.from(
        content.querySelectorAll<HTMLElement>("[data-seam-segment]"),
      ).find((candidate) => candidate.getAttribute("data-seam-segment") === activeId);
      if (box === undefined) return;

      const furthest = viewport.scrollWidth - viewport.clientWidth;
      // Not laid out yet — leave the marker unset so a later pass still does it.
      if (furthest <= 0) return;

      // MEASURED OFF THE DOM RATHER THAN COMPUTED FROM THE DATA.
      //
      // Deriving the centre from `shot.start`/`shot.end` measured wrong: it put
      // the subject 368px off centre while the arithmetic said it was exact,
      // because the placement the effect read and the placement on screen were
      // a beat apart while durations were still arriving. The box knows where
      // it is; asking it removes the whole class of disagreement.
      //
      // Scroll-invariant on purpose — the scrollLeft added back cancels the one
      // in the rect — so the guard below compares like with like.
      const rect = box.getBoundingClientRect();
      const view = viewport.getBoundingClientRect();
      const centre = rect.x - view.x + viewport.scrollLeft + rect.width / 2;

      const previous = centredForRef.current;
      if (previous !== null && previous.id === activeId && Math.abs(previous.at - centre) < 1) {
        return;
      }
      const first = previous === null;
      centredForRef.current = { id: activeId, at: centre };
      viewport.scrollTo({
        left: clamp(centre - viewport.clientWidth / 2, 0, furthest),
        // A re-place is a correction, not a journey: animating each settling
        // pass would read as the bar sliding around on its own. Only a genuine
        // change of subject is worth following by eye.
        behavior:
          first || prefersReducedMotion() || previous?.id === activeId ? "auto" : "smooth",
      });
    };

    bring();

    // THE SETTLING IS THE POINT, AND IT IS A MOVE, NOT A RESIZE.
    //
    // Clip durations arrive after first paint, so the strip re-places its boxes
    // under a centring that has already run — measured, the subject sat 368px
    // off on load while a selection made later landed exactly. A
    // `ResizeObserver` on the content could not see it: the content's width is
    // the sequence's whole clock and never changes, only the boxes INSIDE it
    // move, and they move by inline `left`. So watch for that directly.
    //
    // Cheap at rest and safe during playback: the playhead's own transform is
    // in this subtree and mutates every frame while running, but `bring()`
    // recomputes the same centre and returns at the guard.
    const moved = new MutationObserver(bring);
    if (stripRef.current !== null) {
      moved.observe(stripRef.current, {
        subtree: true,
        attributes: true,
        attributeFilter: ["style"],
      });
    }
    // A narrower viewport re-centres too — the target is the middle of whatever
    // width there is now, not the width there was when the view opened.
    const resized = new ResizeObserver(bring);
    resized.observe(viewport);
    return () => {
      moved.disconnect();
      resized.disconnect();
    };
  }, [activeId, shots]);

  /* ── scroll-driven chrome, written directly ─────────────────────────── */

  // WHERE THE CARD SITS, in the bar's own pixels rather than the film's.
  //
  // Written straight onto the node, like the section labels and the minimap
  // window above it: this has to follow both the clock and the scroll, and a
  // re-render per pointer move to move one box is the cost this component
  // avoids everywhere else.
  const skimRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef(time);
  const placeSkim = useCallback(() => {
    const card = skimRef.current;
    const viewport = viewportRef.current;
    if (card === null || viewport === null) return;
    // ABOVE THE PLAYHEAD, IN VIEWPORT COORDINATES.
    //
    // FIXED AND PORTALLED, because the details view clips: sitting inside it,
    // a card tall enough to be worth reading had its top cut off, which is the
    // "truncated off the top" fault. Nothing inside a clipping box can hang
    // above that box, so it stops being inside one.
    //
    // Never off the top of the WINDOW either. The bar is ~162px down at a
    // 910-tall window and the card is ~147, which fits — but a shorter window
    // or a taller header would not, so the top is clamped rather than trusted.
    // Clamping costs a few pixels of overlap with the bar in the worst case;
    // being unreadable costs the whole feature.
    const content = contentRef.current;
    const box = viewport.getBoundingClientRect();
    const height = card.offsetHeight;
    const above = (content ?? viewport).getBoundingClientRect().top - SKIM_GAP_PX - height;
    card.style.top = `${Math.max(SKIM_EDGE_PX, above)}px`;

    const half = card.offsetWidth / 2;
    // The playhead's own place on screen: content pixels, less the scroll, plus
    // where the film's window starts.
    const x = box.left + (timeRef.current * PXS - viewport.scrollLeft);
    // KEPT ON SCREEN. Near either end a card centred on the playhead would hang
    // off the side — worst exactly where the picture is the whole point.
    card.style.left = `${clamp(
      x,
      half + SKIM_EDGE_PX,
      Math.max(half + SKIM_EDGE_PX, window.innerWidth - half - SKIM_EDGE_PX),
    )}px`;
  }, []);

  useEffect(() => {
    timeRef.current = time;
    placeSkim();
  }, [time, placeSkim, skimPreview]);

  const syncToScroll = useCallback(() => {
    placeSkim();
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const lane = laneRef.current;
    const win = windowRef.current;
    if (viewport === null || content === null) return;
    const scroll = viewport.scrollLeft;

    // Labels stay pinned to the viewport edge while their section is in view.
    if (lane !== null) {
      const labels = lane.querySelectorAll<HTMLElement>(".seclabel");
      labels.forEach((label, i) => {
        const section = sections[i];
        if (section === undefined) return;
        const min = section.start * PXS + 4;
        const max = Math.max(min, section.end * PXS - label.offsetWidth - 12);
        label.style.transform = `translateX(${clamp(scroll + 30, min, max)}px)`;
      });
    }

    if (win !== null) {
      const width = content.offsetWidth;
      win.style.left = `${(scroll / width) * 100}%`;
      win.style.width = `${(viewport.clientWidth / width) * 100}%`;
    }
  }, [sections, placeSkim]);

  useEffect(() => {
    syncToScroll();
    const viewport = viewportRef.current;
    if (viewport === null) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(syncToScroll);
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("scroll", onScroll);
    };
  }, [syncToScroll]);

  /* ── inertia ────────────────────────────────────────────────────────── */

  const cancelMomentum = useCallback(() => {
    const momentum = momentumRef.current;
    if (momentum !== null) cancelAnimationFrame(momentum.raf);
    momentumRef.current = null;
  }, []);

  const startMomentum = useCallback((velocity: number) => {
    if (!willFling(velocity)) return;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport === null || content === null) return;

    const state = { velocity, last: performance.now(), raf: 0 };
    momentumRef.current = state;
    const step = (now: number) => {
      if (momentumRef.current !== state) return;
      const next = advanceMomentum(state.velocity, now - state.last);
      state.last = now;
      viewport.scrollLeft += next.scrollDelta;
      state.velocity = next.velocity;
      if (momentumSpent(state.velocity, viewport.scrollLeft, content.offsetWidth - viewport.clientWidth)) {
        momentumRef.current = null;
        return;
      }
      state.raf = requestAnimationFrame(step);
    };
    state.raf = requestAnimationFrame(step);
  }, []);

  useEffect(() => cancelMomentum, [cancelMomentum]);

  /* ── scrubbing ──────────────────────────────────────────────────────── */

  // ONE conversion, used by both the seek and the skim, so the card can never
  // describe a different moment from the one the playhead landed on.
  const secondsAtClientX = useCallback((clientX: number): number | null => {
    const viewport = viewportRef.current;
    if (viewport === null) return null;
    const box = viewport.getBoundingClientRect();
    return clamp((clientX - box.left + viewport.scrollLeft) / PXS, 0, DUR);
  }, []);

  const seekToClientX = useCallback(
    (clientX: number) => {
      const at = secondsAtClientX(clientX);
      if (at === null) return;
      setTime(at);
    },
    [secondsAtClientX],
  );

  /**
   * THE OUT HANDLE (PL15-030).
   *
   * ONLY THE OUT EDGE, and only on the subject. The in edge would be ambiguous
   * here in a way it is not on a card: the card shows the whole SOURCE with the
   * discarded parts shaded, so you can see what a trim is doing, while a box on
   * this strip is only the USED length and has no room to depict a source.
   * Dragging its left edge right and its right edge left would look identical
   * and mean different things. The card remains where the in point is set.
   *
   * DOWNSTREAM SHOTS HOLD STILL FOR THE DRAG. The strip's clock is cumulative —
   * boxes are laid end to end and a width IS a duration — so a committed trim
   * ripples: everything after it moves and the total changes. Doing that live
   * would slide the whole sequence under a pointer that is trying to land on an
   * edge, and take the playhead with it. So the drag resizes this box alone,
   * raised above its neighbours, and the re-flow happens once on release when
   * the store answers.
   */
  /**
   * BOTH EDGES (PL15-030).
   *
   * `seconds` is the length the box previews; `shift` is how far its LEFT edge
   * has moved while an in-drag is running, and is always 0 for an out-drag.
   *
   * The two edges do genuinely different things, and the shift is what makes
   * that visible. Trimming the OUT point holds the left edge and moves the
   * right. Trimming the IN point holds the source's out point, so the used
   * length changes from the FRONT: the edge under the pointer moves and the
   * right edge stays put. Without the shift both gestures would resize the box
   * from the right and look identical — which is exactly the ambiguity that
   * made me build the out edge first.
   *
   * WHAT SNAPS BACK ON RELEASE, said plainly: a box's place on this strip is
   * the sum of the durations before it, and trimming this shot's head does not
   * change any of those. So the left edge returns to where it was pinned and
   * the box is simply shorter — the drag moved it, the commit does not. That
   * is the honest picture of a ripple edit, and it is why the drag previews
   * rather than re-flows.
   */

  const onTrimHandleDown =
    (shot: PlacedShot, edge: "in" | "out") => (event: React.PointerEvent) => {
      if (event.button !== 0) return;
      if (shot.sourceSeconds === undefined || shot.trimInSeconds === undefined) return;
      // The strip is a pan surface and a scrub surface; neither may claim this.
      event.stopPropagation();
      event.preventDefault();
      cancelMomentum();

      const viewport = viewportRef.current;
      if (viewport === null) return;
      const source = shot.sourceSeconds;
      const trimIn = shot.trimInSeconds;
      const used = shot.seconds;
      // Where the used part ends in the SOURCE. Fixed for an in-drag: trimming
      // the head is not slipping the clip.
      const outPoint = trimIn + used;

      const secondsUnderPointer = (clientX: number) => {
        const box = viewport.getBoundingClientRect();
        return (clientX - box.left + viewport.scrollLeft) / PXS;
      };
      const startedAt = secondsUnderPointer(event.clientX);

      const measure = (clientX: number) => {
        const travelled = secondsUnderPointer(clientX) - startedAt;
        if (edge === "out") {
          // Cannot cross itself, and cannot reach past the end of the source.
          const longest = Math.max(TRIM_FLOOR_SECONDS, source - trimIn);
          const seconds = clamp(used + travelled, TRIM_FLOOR_SECONDS, longest);
          return { seconds, shift: 0, next: { in: trimIn, out: trimIn + seconds } };
        }
        // Dragging the head right shortens; dragging it left RECOVERS material,
        // as far back as the source's own start.
        const nextIn = clamp(trimIn + travelled, 0, outPoint - TRIM_FLOOR_SECONDS);
        return {
          seconds: outPoint - nextIn,
          shift: nextIn - trimIn,
          next: { in: nextIn, out: outPoint },
        };
      };

      const move = (moveEvent: PointerEvent) => {
        const at = measure(moveEvent.clientX);
        const next = { id: shot.id, seconds: at.seconds, shift: at.shift };
        trimmingRef.current = next;
        setTrimming(next);
      };
      const up = (upEvent: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", up);
        const moved = trimmingRef.current !== null;
        trimmingRef.current = null;
        setTrimming(null);
        // A press that never travelled is not an edit. Committing one would put
        // an identical window on the undo stack for every accidental tap.
        if (!moved) return;
        // ONE EDIT FOR THE WHOLE DRAG. Dispatching per pointer move would fill
        // the undo stack with a hundred steps nobody took.
        onTrim?.(shot.id, measure(upEvent.clientX).next);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
    };

  // BELOW THE DRAG IT READS FROM. The boxes were declared above `cancelMomentum`
  // and the trim state; a memo cannot close over bindings that do not exist yet,
  // and React Compiler says so rather than letting it through.
  const shotBoxes = useMemo(
    () =>
      shots.map((shot, index) => {
        const selected = shot.id === activeId;
        // THE PREVIEW LENGTH, this box alone. Its neighbours keep the places
        // they already have until the store answers — see `onTrimOutDown`.
        const dragging = trimming !== null && trimming.id === shot.id;
        const seconds = dragging ? trimming.seconds : shot.seconds;
        // A handle only where a window means anything, and only on the subject:
        // an edge on every box would be two dozen grab targets on a surface
        // whose main gesture is a pan across all of them.
        const trimmable =
          selected &&
          shot.sourceSeconds !== undefined &&
          shot.trimInSeconds !== undefined &&
          // Measured against the width the box will HAVE, so a shot being
          // dragged narrow loses its handles at the same point a resting one
          // would rather than at the width it started from.
          (2 * TRIM_HANDLE_PX) / Math.max(1, seconds * PXS) <= MAX_HANDLE_SHARE;
        return (
          <div
            key={shot.id}
            className={`shot${selected ? " selected" : ""}${dragging ? " trimming" : ""}`}
            data-i={index}
            data-seam-segment={shot.id}
            data-seam-segment-live={selected ? "" : undefined}
            style={{
              // The shift moves the LEFT edge during an in-drag and is zero for
              // everything else, so an out-drag and a resting box are laid out
              // exactly as they always were.
              left: (shot.start + (dragging ? trimming.shift : 0)) * PXS + 2,
              width: seconds * PXS - 4,
            }}
          >
            {shot.frames.map((frame, k) => (
              <div
                key={k}
                data-seam-thumbnail
                className="frame"
                style={{ width: `${100 / shot.frames.length}%`, background: frame }}
              />
            ))}
            <span className="tag">{shot.label}</span>
            {!trimmable ? null : (
              <>
                <i
                  data-seam-trim-in={shot.id}
                  className="s-edge s-in"
                  title="Drag to change where this shot starts"
                  onPointerDown={onTrimHandleDown(shot, "in")}
                />
                <i
                  data-seam-trim-out={shot.id}
                  className="s-edge s-out"
                  title="Drag to change where this shot ends"
                  onPointerDown={onTrimHandleDown(shot, "out")}
                />
                {/* THE LENGTH IT WILL BE, while a drag is running. A box's width
                    is its duration on this strip, but a width is not a number
                    you can read — and the thing being chosen here is a number.
                    Shown only during the drag, so the film is not carrying a
                    readout nobody asked for the rest of the time. */}
                {dragging ? <span className="s-read">{seconds.toFixed(2)}s</span> : null}
              </>
            )}
          </div>
        );
      }),
    // `activeId` BELONGS IN HERE. The boxes were memoised on `shots` alone
    // while reading `activeId` inside, so the array was reused across a
    // selection change and every box kept the mark it had when the memo last
    // ran. `data-seam-segment-live` was already going stale that way; the
    // `selected` class would have joined it.
    [shots, activeId, trimming],
  );

  const edgeScroll = useCallback((clientX: number) => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const box = viewport.getBoundingClientRect();
    if (clientX < box.left + 50) viewport.scrollLeft -= (box.left + 50 - clientX) * 0.35;
    else if (clientX > box.right - 50) viewport.scrollLeft += (clientX - (box.right - 50)) * 0.35;
  }, []);

  /* ── pointer ────────────────────────────────────────────────────────── */

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    cancelMomentum();
    // Capture is an ENHANCEMENT, not a requirement: it keeps the drag alive when
    // the pointer leaves the element. A browser that refuses it (or a
    // synthesised pointer, which has no capture to take) must still pan, so a
    // failure here cannot be allowed to abort the gesture.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // No capture; the window-level listeners still see the drag through.
    }
    const target = event.target as HTMLElement;
    const shot = target.closest<HTMLElement>(".shot");

    if (target.closest(".strip") !== null) {
      // A drag pans with momentum; a press that does not move is still a tap
      // that selects and seeks — see `onPointerUp`.
      panRef.current = {
        startX: event.clientX,
        startScroll: viewportRef.current?.scrollLeft ?? 0,
        lastX: event.clientX,
        lastAt: performance.now(),
        velocity: 0,
        moved: false,
        shotIndex: shot === null ? null : Number(shot.dataset.i),
      };
      stripRef.current?.classList.add("panning");
      setHot(false);
      setGhostX(null);
      return;
    }
    scrubbingRef.current = true;
    setGhostX(null);
    seekToClientX(event.clientX);
    onSkim?.(secondsAtClientX(event.clientX));
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    const viewport = viewportRef.current;
    if (pan !== null && viewport !== null) {
      const now = performance.now();
      const dt = now - pan.lastAt;
      // Smoothed px/ms, so one jittery sample cannot decide the throw.
      pan.velocity = smoothVelocity(pan.velocity, event.clientX - pan.lastX, dt);
      pan.lastX = event.clientX;
      pan.lastAt = now;
      viewport.scrollLeft = pan.startScroll - (event.clientX - pan.startX);
      if (!pan.moved && Math.abs(event.clientX - pan.startX) > TAP_SLOP_PX) pan.moved = true;
      return;
    }
    if (viewport === null) return;

    const box = viewport.getBoundingClientRect();
    const x = clamp(event.clientX - box.left + viewport.scrollLeft, 0, DUR * PXS);
    if (scrubbingRef.current) {
      setHot(true);
      edgeScroll(event.clientX);
      seekToClientX(event.clientX);
      // AFTER the edge scroll, so a skim near the edge reports the frame the
      // playhead actually reached rather than the one under the pointer before
      // the strip moved beneath it.
      onSkim?.(secondsAtClientX(event.clientX));
      return;
    }
    if (momentumRef.current !== null) return; // coasting — keep overlays hidden
    const target = event.target as HTMLElement;
    if (target.closest(".lane, .ruler, .ph-chip") === null) {
      setHot(false);
      setGhostX(null);
      return;
    }
    setHot(true);
    setGhostX(x);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan !== null) {
      stripRef.current?.classList.remove("panning");
      if (!pan.moved) {
        if (pan.shotIndex !== null) setSelected(pan.shotIndex);
        seekToClientX(event.clientX);
      } else {
        // Held still before release: the hand stopped, so the strip should too.
        startMomentum(releaseVelocity(pan.velocity, performance.now() - pan.lastAt));
      }
      panRef.current = null;
    }
    if (scrubbingRef.current) onSkim?.(null);
    scrubbingRef.current = false;
  };

  const onPointerLeave = () => {
    setHot(false);
    setGhostX(null);
  };

  /* ── wheel pans horizontally ────────────────────────────────────────── */

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    // Non-passive, because it preventDefaults — React's onWheel is passive and
    // cannot, so the page would scroll underneath the strip.
    const onWheel = (event: WheelEvent) => {
      cancelMomentum();
      viewport.scrollLeft += event.deltaY + event.deltaX;
      event.preventDefault();
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [cancelMomentum]);

  /* ── minimap: drag the window to pan, click to jump ─────────────────── */

  const onMinimapDown = (event: React.PointerEvent<HTMLDivElement>) => {
    cancelMomentum();
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const track = minimapRef.current;
    if (viewport === null || content === null || track === null) return;
    if (event.target !== windowRef.current) {
      const ratio = (event.clientX - track.getBoundingClientRect().left) / track.clientWidth;
      viewport.scrollLeft = ratio * content.offsetWidth - viewport.clientWidth / 2;
    }
    minimapDragRef.current = { x: event.clientX, scroll: viewport.scrollLeft };
    track.setPointerCapture(event.pointerId);
    track.classList.add("dragging");
  };

  const onMinimapMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = minimapDragRef.current;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const track = minimapRef.current;
    if (drag === null || viewport === null || content === null || track === null) return;
    viewport.scrollLeft =
      drag.scroll + (event.clientX - drag.x) * (content.offsetWidth / track.clientWidth);
  };

  const onMinimapUp = () => {
    minimapDragRef.current = null;
    minimapRef.current?.classList.remove("dragging");
  };

  /* ── playback ───────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const next = (now - last) / 1000;
      last = now;
      setTime((current) => {
        const value = current + next;
        if (value >= DUR) {
          setPlaying(false);
          return DUR;
        }
        // Follow: keep the playhead in view without re-centring on every frame.
        const viewport = viewportRef.current;
        if (viewport !== null) {
          const width = viewport.clientWidth;
          const x = value * PXS;
          if (x > viewport.scrollLeft + width * 0.82) viewport.scrollLeft = x - width * 0.82;
          else if (x < viewport.scrollLeft + 40) viewport.scrollLeft = Math.max(0, x - 40);
        }
        return value;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.code === "Space") {
      event.preventDefault();
      setPlaying((value) => !value);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const forward = event.key === "ArrowRight";
      if (event.shiftKey) {
        // SHIFT STEPS A CLIP, plain arrows move a second. The two ways of
        // asking for the same step must not drift, so this is the same call
        // tapping a box makes.
        const at = shots.findIndex((shot) => shot.id === activeId);
        const next = at < 0 ? (forward ? 0 : shots.length - 1) : at + (forward ? 1 : -1);
        if (next >= 0 && next < shots.length) setSelected(next);
        return;
      }
      setTime((value) => clamp(value + (forward ? 1 : -1), 0, DUR));
    } else if (event.key === "Home") {
      event.preventDefault();
      setTime(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setTime(DUR);
    }
  };

  const selectedShot = shots.find((shot) => shot.id === activeId) ?? null;

  return (
    <div
      className={[PLAYBAR_SCOPE, standalone ? PLAYBAR_PAGE_CLASS : "", className ?? ""]
        .join(" ")
        .trim()}
    >
      <style>{PLAYBAR_CSS}</style>
      <PlaybarFrame standalone={standalone}>
          {standalone ? (
          <div className="meta">
            <div className="meta-l">
              <span className="dot" />
              Seq 04 — Night Drive
              <span className="sep">/</span>
              <span style={{ color: "#525a66" }}>Act I</span>
            </div>
            <div className="meta-r">{`24 fps · ${shots.length} shots · ${timecode(DUR)}`}</div>
          </div>
          ) : null}

          <section
            data-seam-bar
            className={`playbar${hot ? " top-hot" : ""}${playing ? " is-playing" : ""}`}
            aria-label="Storyboard timeline"
            tabIndex={0}
            onKeyDown={onKeyDown}
          >
            {/* THE SKIM CARD, PORTALLED OUT OF THE VIEW ENTIRELY.
                Two boxes clip it otherwise: `.viewport` scrolls on one axis so
                it clips the other, and the details view clips its own overflow.
                A card that hangs ABOVE the bar cannot live inside either, so it
                goes to the body and is positioned in viewport pixels — which is
                why `syncToScroll` moves it, the strip travelling under a still
                pointer having to carry the card with it.

                Wrapped in the scope class because the stylesheet is scoped:
                out here there is no `.pb` ancestor, so `.pb .skim` would not
                match and the design tokens would not inherit. `display:
                contents` so the wrapper itself lays nothing out. */}
            {skimPreview == null || typeof document === "undefined"
              ? null
              : createPortal(
                  <div className={PLAYBAR_SCOPE} style={{ display: "contents" }}>
                    <div ref={skimRef} className="skim" aria-hidden="true">
                      <div className="skim-shot">
                        {skimPreview.posterSrc === undefined ? null : (
                          // `contain` on a dark ground rather than `cover`: a
                          // preview that crops answers the question with part of
                          // the answer missing. The box is a fixed shape so the
                          // card cannot resize under a pointer once it is up.
                          <img src={skimPreview.posterSrc} alt="" draggable={false} />
                        )}
                      </div>
                      <span className="skim-name">{skimPreview.name}</span>
                      <span className="skim-meta">{skimPreview.meta}</span>
                    </div>
                  </div>,
                  document.body,
                )}
            <div data-seam-viewport className="viewport" ref={viewportRef}>
              <div
                // THE SAME HOOKS THE OLD BAR PUBLISHED, kept on purpose.
                //
                // `data-seam-*` names the strip's PARTS — the boxes, the
                // ruler, the playhead, a segment, a thumbnail — and those
                // concepts survived the swap even though the component drawing
                // them did not. Renaming them would have churned a hundred
                // references in the stories to say the same things about the
                // same parts, and the tests that then broke would be the ones
                // whose FEATURE is gone, which is exactly the signal worth
                // keeping clear.
                //
                // The scrub surface is also a slider, as it was: the keyboard
                // stories read `aria-valuenow` to say where the playhead is.
                data-seam-boxes
                data-seam-track
                role="slider"
                tabIndex={0}
                aria-label="Playhead"
                aria-valuemin={0}
                aria-valuemax={DUR}
                aria-valuenow={time}
                className="content"
                ref={contentRef}
                style={{ width: DUR * PXS }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={onPointerLeave}
              >
                <div data-seam-lane className="lane" ref={laneRef}>
                  {sections.map((section) => (
                    <div
                      key={`label-${section.start}`}
                      data-seam-tick-name
                      className="seclabel"
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={() => scrollToSection(section.start)}
                    >
                      <LayersIcon />
                      <span>{section.name}</span>
                    </div>
                  ))}
                </div>

                <div data-seam-ruler className="ruler">
                  {sections.map((section) => (
                    <div
                      key={`base-${section.start}`}
                      data-seam-ruler-block={section.name}
                      className="rbase"
                      style={{
                        left: section.start * PXS + 3,
                        width: (section.end - section.start) * PXS - 6,
                      }}
                    />
                  ))}
                  {ticks}
                  {/* NO SECOND MARK IN THE RULER.
                      The reference marks the subject twice — a 5px gradient
                      range under the ruler AND the underline beneath the film —
                      and two rules a few pixels apart say one thing twice while
                      reading as a band of their own. The underline is the one
                      that stays: it sits against the boxes, so it points at the
                      shot rather than at the scale above it. */}
                </div>

                {sections.slice(1).map((section) => (
                  <div
                    key={`div-${section.start}`}
                    className="secdiv"
                    style={{ left: section.start * PXS }}
                  />
                ))}

                <div data-seam-strip className="strip" ref={stripRef}>
                  {shotBoxes}
                  {selectedShot === null ? null : (
                    <div
                      // NAMES THE CLIP IT BELONGS TO, as the lane's mark does,
                      // so "the active one" cannot drift to a neighbour without
                      // a test noticing.
                      data-seam-active-mark={selectedShot.id}
                      className="underline"
                      style={{
                        left: selectedShot.start * PXS + 2,
                        width: (selectedShot.end - selectedShot.start) * PXS - 4,
                      }}
                    />
                  )}
                </div>

                <div
                  className={`ghost${ghostX === null ? "" : " on"}`}
                  style={{ left: ghostX ?? 0 }}
                />

                {/* ALWAYS DRAWN, as the reference draws it.

                    This was hidden while stopped on the reasoning that the
                    playhead is the only saturated thing on the bar and a
                    permanent alarm colour stops meaning anything. That was
                    right about the CHIP, which is `--chip`, and wrong about the
                    playhead as a whole: the line is plain white, and it is the
                    part that answers "where am I in the sequence" — a question
                    a stopped transport still has an answer to. Hiding it took
                    the reader's place marker away whenever they were not
                    playing, which is most of the time.

                    The saturation concern keeps the reference's own answer
                    instead of a bespoke one: `is-playing` on the bar glows the
                    chip while the transport runs, so playing and stopped stay
                    distinguishable without the marker going away. */}
                <div
                  data-seam-playhead
                  className="playhead"
                  style={{ transform: `translateX(${time * PXS}px)` }}
                >
                  <div className="ph-chip">
                    {/* THE SAME MONITOR AS THE PREVIEW TOGGLE, deliberately the
                        same glyph rather than a second one that means the same
                        thing: the chip is the clock the pane is showing, so it
                        wears the pane's own mark. Sized and coloured to the
                        chip — it inherits `currentColor`, which is the chip's
                        dark ink on its light ground, so it cannot drift from
                        the text beside it. */}
                    <TvMinimal className="ph-tv" aria-hidden="true" />
                    {timecode(time)}
                  </div>
                  <div className="ph-tri" />
                  <div className="ph-line" />
                </div>
              </div>
            </div>

            <div className="minimap">
              <div
                data-seam-minimap
                className="mm-track"
                ref={minimapRef}
                aria-label="Sequence navigator"
                onPointerDown={onMinimapDown}
                onPointerMove={onMinimapMove}
                onPointerUp={onMinimapUp}
                onPointerCancel={onMinimapUp}
              >
                {shots.map((shot) => (
                  <div
                    key={shot.id}
                    // THE SUBJECT IS MARKED ON THE MAP TOO, which the reference
                    // does not do and this app decided it should: the two
                    // strips answer different questions — which shot, and where
                    // in the project that shot is — and the subject is the fact
                    // they share. Marked on only one of them, the map shows a
                    // window a dozen clips wide and leaves you to work out
                    // which is yours.
                    //
                    // WHITE AND AT FULL STRENGTH, not an edge: a segment here
                    // can be a pixel wide, and a border would eat into a width
                    // that means duration.
                    data-seam-mini-segment={shot.id}
                    data-seam-mini-segment-live={shot.id === activeId ? "" : undefined}
                    className="mm-shot"
                    style={{
                      ...(shot.id === activeId
                        ? { background: "#ffffff", opacity: 1 }
                        : {}),
                      left: `${(shot.start / DUR) * 100}%`,
                      width: `calc(${((shot.end - shot.start) / DUR) * 100}% - 2px)`,
                    }}
                  />
                ))}
                {sections.slice(1).map((section) => (
                  <div
                    key={`notch-${section.start}`}
                    className="mm-sec"
                    style={{ left: `${(section.start / DUR) * 100}%` }}
                  />
                ))}
                <div data-seam-mini-window className="mm-window" ref={windowRef} />
                <div className="mm-ph" style={{ left: `${(time / DUR) * 100}%` }}>
                  <i />
                </div>
              </div>
            </div>
          </section>
      </PlaybarFrame>
    </div>
  );
}

function LayersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 2 9 5-9 5-9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </svg>
  );
}


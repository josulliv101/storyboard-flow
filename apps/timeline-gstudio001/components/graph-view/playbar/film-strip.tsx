"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  REFERENCE_SHOTS,
  placeSections,
  placeShots,
  type FilmStripShot,
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

  const shotBoxes = useMemo(
    () =>
      shots.map((shot, index) => {
        const seconds = shot.seconds;
        return (
          <div
            key={shot.id}
            className={shot.id === activeId ? "shot selected" : "shot"}
            data-i={index}
            data-seam-segment={shot.id}
            data-seam-segment-live={shot.id === activeId ? "" : undefined}
            style={{ left: shot.start * PXS + 2, width: seconds * PXS - 4 }}
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
          </div>
        );
      }),
    // `activeId` BELONGS IN HERE. The boxes were memoised on `shots` alone
    // while reading `activeId` inside, so the array was reused across a
    // selection change and every box kept the mark it had when the memo last
    // ran. `data-seam-segment-live` was already going stale that way; the
    // `selected` class would have joined it.
    [shots, activeId],
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

  const syncToScroll = useCallback(() => {
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
  }, [sections]);

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

  const seekToClientX = useCallback((clientX: number) => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const box = viewport.getBoundingClientRect();
    setTime(clamp((clientX - box.left + viewport.scrollLeft) / PXS, 0, DUR));
  }, []);

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
                  {selectedShot === null ? null : (
                    <div
                      // THE ONLY SATURATED THING IN THE BAND, which is what
                      // makes the subject findable on a scale of two dozen.
                      data-seam-ruler-block-live={selectedShot.id}
                      className="range"
                      style={{
                        left: selectedShot.start * PXS + 2,
                        width: (selectedShot.end - selectedShot.start) * PXS - 4,
                      }}
                    />
                  )}
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
                      data-seam-active-mark
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
                  <div className="ph-chip">{timecode(time)}</div>
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


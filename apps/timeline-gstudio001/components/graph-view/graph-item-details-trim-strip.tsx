"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  TrimOverviewStrip,
  type AudioMediaNode,
  type MediaNode,
  type VideoMediaNode,
} from "@storyboard/ui/dnd-collections";

import { formatSeconds } from "@/lib/format-duration";
import { TEXT_VALUE_DIM } from "./graph-details-design";
import { TrimNumbers } from "./graph-item-details-trim-fields";

/**
 * The narrowest panel that still gets a filmstrip — 18rem, unchanged.
 *
 * IN JAVASCRIPT RATHER THAN AS A CONTAINER QUERY, which is the whole point.
 * The panel's width ANIMATES across a step, so a CSS gate is swept through
 * mid-movement: measured on an iPad at 1024, a neighbour is 252px and the
 * subject 441px, so every single step crosses 288px in both directions. The
 * incoming card's filmstrip mounted halfway through the slide — blank, then
 * filling in as its frames decoded — and the outgoing card's vanished at the
 * same moment. On a slowed recording that frame changed three times as much
 * as its neighbours.
 *
 * The measured width this compares against is frozen while the row is moving
 * (see `stepping`), so the gate cannot flip mid-step in either direction. The
 * strip appears, or goes, once — at rest.
 */
// 18rem OF PANEL, less the 2rem of padding it sits inside — the container
// query this replaces measured the panel, and this measures the slot, so the
// number has to be restated in the slot's terms or the gate silently moves 32px.
const TRIM_STRIP_MIN_PX = 288 - 32;

/**
 * THE SOURCE, THE WINDOW ON IT, AND THE TWO EDGES AS NUMBERS.
 *
 * Everything about a clip's DURATION, which is a different subject from the
 * picture above it: the whole source as a filmstrip, the showing window with
 * its grips, and the typed in/out points that reach an exact frame a pointer
 * cannot. Lifted out of the panel with the width measurement it depends on,
 * because that measurement exists only to size the strip.
 */
export function ItemDetailsTrimStrip({
  node,
  windowed,
  video,
  trimIn,
  trimOut,
  showing,
  live,
  playhead,
  stepping = false,
}: Readonly<{
  node: MediaNode;
  /** The clip when it windows into a longer source — video and audio both. */
  windowed: VideoMediaNode | AudioMediaNode | null;
  /** Video only: the strip draws frames, and audio has none to draw. */
  video: VideoMediaNode | null;
  trimIn: number;
  trimOut: number;
  showing: number;
  /** Non-null while an edge is being dragged, which disables the fields. */
  live: unknown;
  /** Where the seam clock sits inside this clip, 0..1, or null when it is
   *  somewhere else entirely. */
  playhead: number | null;
  /**
   * Whether the row is mid-step, in which case this strip holds still.
   *
   * The panel's width animates across a step, and this strip is gated on a
   * container query at 18rem — so a card growing into the subject SWEEPS that
   * threshold and the whole filmstrip mounts halfway through the movement,
   * blank, then fills in as its frames decode. Caught on a slowed recording:
   * one frame changed three times as much as its neighbours.
   *
   * It also re-measured on every frame of the animation, re-rendering the panel
   * sixty times a step to lay the same frames out at sixty slightly different
   * widths.
   *
   * So measurement pauses while the row is moving and happens once when it
   * stops. The strip arrives at rest, in one piece.
   */
  stepping?: boolean;
}>) {
  // HOW WIDE THE STRIP MAY DRAW, measured from the slot it lands in rather
  // than assumed: the panel's width is a container query away from this file,
  // and the strip needs a NUMBER to lay frames out with.
  //
  // OBSERVED, NOT MEASURED ONCE. A bare ref callback fires when the element
  // MOUNTS and never again, and every width this panel can have arrives after
  // that: the same element is a neighbour one moment and the centre the next
  // as the strip advances — and the centre is deliberately wider — so the
  // number was whichever role the panel happened to mount in. Changing the
  // view count and resizing the window are the same story.
  //
  // Both directions were visible at once. A panel that mounted narrow and
  // became the centre drew a strip short of its container; measured on the
  // five-up story, one that mounted wide and narrowed drew 581px of film into
  // a 357px slot — 224px of overflow.
  const [stripWidth, setStripWidth] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);
  const slotRef = useRef<HTMLElement | null>(null);
  // Read through a ref so the observer callback and the settle effect below
  // are looking at the same answer without either re-subscribing.
  const steppingRef = useRef(stepping);
  const measure = useCallback(() => {
    const element = slotRef.current;
    if (element === null) return;
    {
      const next = element.getBoundingClientRect().width;
      // UNCHANGED IS NOT A RENDER. A ResizeObserver fires for boxes that
      // settled on the same number, and setting state from it would re-render
      // every panel on any mutation that touched layout — the cost #468
      // measured on the two effects that do exactly this.
      setStripWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
    }
  }, []);

  const stripSlot = useCallback(
    (element: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      slotRef.current = element;
      if (element === null) {
        setStripWidth(0);
        return;
      }
      measure();
      const observer = new ResizeObserver(() => {
        // NOT WHILE THE ROW IS MOVING. Every frame of the width animation
        // fires this, and answering re-lays the film out at a width that is
        // already stale — and crosses the mount threshold mid-flight.
        if (steppingRef.current) return;
        measure();
      });
      observer.observe(element);
      observerRef.current = observer;
    },
    [measure],
  );

  // ONE MEASUREMENT WHEN THE ROW STOPS, which is the one that was worth taking.
  useEffect(() => {
    const wasStepping = steppingRef.current;
    steppingRef.current = stepping;
    if (wasStepping && !stepping) measure();
  }, [stepping, measure]);

  /* The whole source, with the showing window and its grips — the trim
        handles, at a width the board could never give them.

        THE FIRST THING TO GO WHEN THE PANEL NARROWS, and by some distance
        the biggest: a filmstrip, a draggable window, two grips and a pair
        of number fields. Below about 26rem they stop being controls and
        become texture — the grips are a few pixels apart, the fields
        collide — and at that width the panel is there to show you a frame
        beside its neighbours, which is the thing you came for. Trimming
        stays available on the board and in a wider view. */
  return (
    <div className="flex flex-col gap-2">
    {windowed ? (
      <>
        {/* FRAMES, so video only — an audio clip has a source window but
            nothing to paint in it. Its numbers below are the same. */}
        {/* THE FILMSTRIP IS WHAT GOES, NOT TRIMMING ITSELF.
            A source map with two grips and forty poster frames needs the
            width. But dropping the whole block took the ability to trim
            with it, and a panel you cannot trim from is a panel you have
            to leave to do the work — the numbers below stay at every width
            for exactly that reason. They are two fields and an arrow, they
            fit, and typing an exact in and out was always the more precise
            of the two routes anyway.

            THE GATE IS 18rem, NOT 30. Thirty was chosen while nine-up
            existed, where a panel really is a column; with five as the
            widest view a panel is 19.2rem on a 1357px window — under the
            old gate, so the filmstrip vanished at the exact density the
            view is now for, and the grips went with it. Measured rather
            than guessed: five-up is the density that has to keep them, so
            the gate sits below it and a genuinely tiny panel still sheds
            the strip. */}
        {video && (
          <div
            ref={stripSlot}
            // The box the strip is measured FROM, named so a test can compare
            // the two without walking the DOM by parentElement — the whole
            // bug was the strip disagreeing with this element's width.
            data-trim-strip-slot
            // Always laid out, so there is always something to measure — the
            // gate below is what decides whether film is drawn in it.
            className="w-full"
          >
            {stripWidth >= TRIM_STRIP_MIN_PX ? (
              <div className="relative">
                {/* WHITE, because this view is a filmstrip.
                    The board's strip layout keeps the blue selection frame —
                    there the window is one selected thing among many. Here the
                    panel is a row of frames under a bar of frames, and a blue
                    rectangle would be the only object on screen that is not
                    part of the film. A white frame line says the same thing in
                    the vocabulary everything around it is written in. */}
                <TrimOverviewStrip
                  node={video}
                  width={stripWidth}
                  trimInSeconds={trimIn}
                  trimOutSeconds={trimOut}
                  tone="film"
                />
                {/* WHERE PLAY IS, in this clip. Absent — not parked at an
                    edge — when the playhead is in another clip: a line at
                    0% reads as "playing here, from the very start", which
                    is a different and wrong claim from "not playing here".
                    Its position is measured against the whole trimmed
                    clip, so the run-up into the previous clip puts the
                    line near this strip's right-hand END. */}
                {playhead !== null && (
                  <span
                    data-seam-playhead-line
                    aria-hidden="true"
                    style={{ left: `${playhead * 100}%` }}
                    className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-red-500"
                  />
                )}
              </div>
            ) : null}
          </div>
        )}

        {/* TYPED in/out (PL11-006). Dragging resolves to whatever a pixel
            is worth — ~0.11s here, and coarser on the board — so an exact
            edge was simply unreachable by pointer. These are the same
            `update-media` command the grips dispatch, so undo, the live
            channel and the write path all behave identically. */}
        <TrimNumbers
          node={windowed}
          trimIn={trimIn}
          trimOut={trimOut}
          disabled={live !== null}
          durationLabel={formatSeconds(showing)}
        />
        {/* THE INSTRUCTIONS ARE GONE, and they were the single biggest
            thing making this end of the panel unreadable: a full sentence
            of prose — "drag the amber edges to trim, the film to move the
            window" — sitting under every panel. At three that is three
            copies of it on screen; at nine it is nine, and none of them is
            telling you anything the visible grips and the resize cursor
            are not. A hint you have read once is furniture from then on.

            What it also carried is kept: a voiceover has to say it is one,
            since a waveformless black card and a still look alike. That is
            two words now, on the row that was already there. */}
        {!video && (
          <span className={TEXT_VALUE_DIM}>sound · {formatSeconds(showing)} long</span>
        )}
      </>
    ) : (
      // This branch is everything that is NOT video, which is images AND
      // audio — so it cannot say "still" for both. A voiceover is not a
      // still, and calling it one is the kind of wrong label nobody
      // reports and everybody notices.
      <span className={TEXT_VALUE_DIM}>
        {node.mediaKind === "audio"
          ? `sound · ${formatSeconds(showing)} long`
          : `still · ${formatSeconds(showing)} on screen`}
      </span>
    )}
    </div>
  );
}

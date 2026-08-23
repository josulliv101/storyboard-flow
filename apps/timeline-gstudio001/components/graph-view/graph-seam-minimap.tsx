"use client";

import { useCallback, useRef, useState } from "react";

import { BAR_NEUTRAL_COLOUR } from "@/lib/bar-collection-colours-flag";

import { collectionSeams, type SeamBarClip } from "./graph-seam-bar-layout";

/**
 * THE WHOLE SEQUENCE, IN MINIATURE — and the only thing on screen that is.
 *
 * The bar above it is a window: it zooms, it pans, and at any useful scale
 * most of the project is off the sides of it. That is the right trade for
 * working on a cut and the wrong one for knowing where you are, so the two
 * questions get two objects. This one never zooms and never scrolls; every
 * clip in playback order is always on it, at a width proportional to its
 * length, tinted by the collection it belongs to.
 *
 * The rectangle is what the bar above is currently showing. Reading the two
 * together is the whole point: the boxes tell you about this cut, the
 * rectangle tells you which twentieth of the project this cut is in.
 *
 * DRAG IT TO GO THERE. It is a map, so pressing a point on it means "show me
 * that part" — a pan, not a seek. Scrubbing is the bar's job and moving the
 * playhead from here would make one gesture do two things depending on which
 * strip your finger happened to land on.
 */
export function SeamMinimap({
  clips,
  colourOf,
  centreClipId,
  totalSeconds,
  windowFromSeconds,
  windowToSeconds,
  playheadSeconds,
  onPanToSeconds,
  settled = true,
}: Readonly<{
  clips: readonly SeamBarClip[];
  colourOf: ReadonlyMap<string, string>;
  /**
   * The clip the middle panel is on — marked here as well as on the bar.
   *
   * The two strips answer different questions and the subject is the one fact
   * they share: the bar says which shot you are on, and this says WHERE in the
   * project that shot is. Marked on only one of them, the second question went
   * unanswered — the map showed the window's position, which at most zooms is
   * a stretch of a dozen clips, and left you to work out which of them was
   * yours.
   */
  centreClipId: string;
  totalSeconds: number;
  /** The span the bar above is showing, in absolute seconds. */
  windowFromSeconds: number;
  windowToSeconds: number;
  playheadSeconds: number | null;
  /** Put this second in the middle of the bar above. */
  onPanToSeconds: (seconds: number) => void;
  /**
   * Whether the window rectangle should EASE to its new place.
   *
   * False while a gesture is driving the bar — a drag or a wheel has to track
   * the hand exactly, and easing it would put the rectangle a fixed distance
   * behind wherever the bar actually is, which reads as lag rather than as
   * smoothing. True for everything else, which is where it earns its place:
   * pressing `fit`, stepping a clip, letting go of a scrub and playback
   * nudging the window along all move it somewhere else in one frame, and a
   * jump that size cannot be told apart from a redraw.
   */
  settled?: boolean;
}>) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<number | null>(null);
  // ITS OWN DRAG COUNTS TOO. The bar cannot see this one — it only hears the
  // seconds this asks it to pan to — so the rectangle has to know for itself
  // that the hand on it is its own.
  const [dragging, setDragging] = useState(false);

  const panTo = useCallback(
    (clientX: number) => {
      const rail = railRef.current;
      if (rail === null || totalSeconds <= 0) return;
      const box = rail.getBoundingClientRect();
      if (box.width <= 0) return;
      const fraction = Math.min(Math.max((clientX - box.left) / box.width, 0), 1);
      onPanToSeconds(fraction * totalSeconds);
    },
    [onPanToSeconds, totalSeconds],
  );

  if (totalSeconds <= 0) return null;

  const seams = new Set(collectionSeams(clips));
  const asPercent = (seconds: number) =>
    `${Math.min(Math.max((seconds / totalSeconds) * 100, 0), 100)}%`;
  const windowWidth = Math.max(
    0.8,
    ((windowToSeconds - windowFromSeconds) / totalSeconds) * 100,
  );

  return (
    <div
      ref={railRef}
      data-seam-minimap
      aria-hidden="true"
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* untrusted pointer (stories) — the moves still arrive here */
        }
        draggingRef.current = event.pointerId;
        setDragging(true);
        panTo(event.clientX);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current !== event.pointerId) return;
        panTo(event.clientX);
      }}
      onPointerUp={() => {
        draggingRef.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        draggingRef.current = null;
        setDragging(false);
      }}
      className="relative mt-1.5 h-3.5 cursor-grab touch-none select-none active:cursor-grabbing"
    >
      <div className="absolute inset-x-0 top-1 flex h-1.5 gap-px">
        {clips.map((clip, index) => {
          if (clip.showingSeconds <= 0) return null;
          const isCentre = clip.id === centreClipId;
          return (
            <span
              key={clip.id}
              data-seam-mini-segment={clip.id}
              data-seam-mini-segment-live={isCentre ? "" : undefined}
              style={{
                flexGrow: clip.showingSeconds,
                // THE SUBJECT IS WHITE, and that is the whole mark.
                //
                // COLOUR RATHER THAN AN EDGE, because a segment here can be a
                // single pixel wide: a border eats into a width that means
                // duration, and an outline around a one-pixel clip is a ring
                // standing in for the thing rather than marking it. Changing
                // what the pixel IS works at every width.
                //
                // White because that is what the bar above marks its active
                // clip with — the triangle and its rule. The same claim in the
                // same ink, said twice at two scales, rather than a second
                // colour to learn.
                backgroundColor: isCentre
                  ? "rgb(250, 250, 250)"
                  : (colourOf.get(clip.id) ?? BAR_NEUTRAL_COLOUR),
                // A real gap where the collection changes, so the runs read
                // as runs at a scale far too small for a label.
                marginLeft: index > 0 && seams.has(index) ? 3 : undefined,
              }}
              className={[
                "min-w-px flex-shrink rounded-[1px]",
                // Full strength as well, so the white is white rather than a
                // 70% wash of it against the dimmed run either side.
                //
                // AND SLIGHTLY TALLER. `-my-px` rather than a height, so it
                // grows a pixel BOTH WAYS and stays on the same centre line as
                // the run it sits in — a segment that only grew downward would
                // read as hanging off the strip rather than as the one raised
                // out of it. 6px to 8px inside a 14px rail, so it has the room
                // and nothing clips.
                isCentre ? "-my-px opacity-100" : "opacity-70",
              ].join(" ")}
            />
          );
        })}
      </div>

      {/* WHAT THE BAR IS SHOWING. A floor on the width because at a hundred
          clips a single-clip window rounds to nothing, and a rectangle you
          cannot see is worse than no rectangle: it says the bar is nowhere. */}
      <span
        data-seam-mini-window
        data-seam-mini-window-eased={settled && !dragging ? "" : undefined}
        style={{ left: asPercent(windowFromSeconds), width: `${windowWidth}%` }}
        className={[
          "absolute inset-y-0 rounded-[3px] border border-white/30 bg-white/8",
          // BOTH EDGES, not just the position: a fit changes the window's
          // WIDTH as much as its place, and easing one while cutting the other
          // makes the rectangle appear to stretch from a corner.
          settled && !dragging
            ? "transition-[left,width] duration-300 ease-out motion-reduce:transition-none"
            : "",
        ].join(" ")}
      />

      {playheadSeconds !== null && (
        <span
          data-seam-mini-playhead
          style={{ left: asPercent(playheadSeconds) }}
          className="absolute inset-y-0 w-px -translate-x-1/2 bg-red-500"
        />
      )}
    </div>
  );
}

"use client";

import { useCallback, useRef } from "react";

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
  totalSeconds,
  windowFromSeconds,
  windowToSeconds,
  playheadSeconds,
  onPanToSeconds,
}: Readonly<{
  clips: readonly SeamBarClip[];
  colourOf: ReadonlyMap<string, string>;
  totalSeconds: number;
  /** The span the bar above is showing, in absolute seconds. */
  windowFromSeconds: number;
  windowToSeconds: number;
  playheadSeconds: number | null;
  /** Put this second in the middle of the bar above. */
  onPanToSeconds: (seconds: number) => void;
}>) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<number | null>(null);

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
        panTo(event.clientX);
      }}
      onPointerMove={(event) => {
        if (draggingRef.current !== event.pointerId) return;
        panTo(event.clientX);
      }}
      onPointerUp={() => {
        draggingRef.current = null;
      }}
      onPointerCancel={() => {
        draggingRef.current = null;
      }}
      className="relative mt-1.5 h-3.5 cursor-grab touch-none select-none active:cursor-grabbing"
    >
      <div className="absolute inset-x-0 top-1 flex h-1.5 gap-px">
        {clips.map((clip, index) => {
          if (clip.showingSeconds <= 0) return null;
          return (
            <span
              key={clip.id}
              data-seam-mini-segment={clip.id}
              style={{
                flexGrow: clip.showingSeconds,
                backgroundColor: colourOf.get(clip.id) ?? BAR_NEUTRAL_COLOUR,
                // A real gap where the collection changes, so the runs read
                // as runs at a scale far too small for a label.
                marginLeft: index > 0 && seams.has(index) ? 3 : undefined,
              }}
              className="min-w-px flex-shrink rounded-[1px] opacity-70"
            />
          );
        })}
      </div>

      {/* WHAT THE BAR IS SHOWING. A floor on the width because at a hundred
          clips a single-clip window rounds to nothing, and a rectangle you
          cannot see is worse than no rectangle: it says the bar is nowhere. */}
      <span
        data-seam-mini-window
        style={{ left: asPercent(windowFromSeconds), width: `${windowWidth}%` }}
        className="absolute inset-y-0 rounded-[3px] border border-white/30 bg-white/8"
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

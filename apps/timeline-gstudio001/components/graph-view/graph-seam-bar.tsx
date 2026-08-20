"use client";

import { useCallback, useEffect, useRef } from "react";
import { Pause, Play } from "lucide-react";

import type { SeamTimeline } from "./graph-seam-scrub";

/**
 * The scrub bar that runs across the whole strip: one clock for the cut rather
 * than one per clip.
 *
 * It spans the panels because the thing it measures does — a cut is the join
 * between two clips, and a bar that stopped at a panel edge would make the
 * question unaskable exactly where it matters. Dragging anywhere on it moves
 * the playhead; the seams are marked, so the boundary you are trying to judge
 * is a place you can aim at rather than a value you have to find.
 */
export function SeamBar({
  timeline,
  seconds,
  playing,
  onScrub,
  onTogglePlay,
}: Readonly<{
  timeline: SeamTimeline;
  seconds: number;
  playing: boolean;
  onScrub: (seconds: number) => void;
  onTogglePlay: () => void;
}>) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const total = timeline.totalSeconds;

  const scrubTo = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || total <= 0) return;
      const box = track.getBoundingClientRect();
      if (box.width <= 0) return;
      const ratio = (clientX - box.left) / box.width;
      onScrub(Math.min(Math.max(ratio, 0), 1) * total);
    },
    [onScrub, total],
  );

  // POINTER CAPTURE, so a drag that leaves the bar keeps scrubbing. Without it
  // the gesture dies the moment the pointer crosses onto a panel — which is
  // most of the screen, and precisely where someone dragging toward a cut is
  // looking. The same reason the trim grips capture.
  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
      scrubTo(event.clientX);
    },
    [scrubTo],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      scrubTo(event.clientX);
    },
    [scrubTo],
  );

  // Arrow keys step a frame at 25fps, shift steps a second — the bar is
  // focusable because judging a cut frame by frame with a pointer is a fight.
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 1 : 1 / 25;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onScrub(Math.min(total, seconds + step));
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onScrub(Math.max(0, seconds - step));
      } else if (event.key === " ") {
        event.preventDefault();
        onTogglePlay();
      }
    },
    [onScrub, onTogglePlay, seconds, total],
  );

  if (total <= 0) return null;
  const pct = (value: number) => `${(value / total) * 100}%`;

  return (
    <div data-seam-bar className="flex w-full items-center gap-3">
      <button
        type="button"
        onClick={onTogglePlay}
        aria-label={playing ? "Pause" : "Play across the cut"}
        className="shrink-0 rounded p-1.5 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
      >
        {playing ? (
          <Pause aria-hidden="true" className="h-4 w-4" />
        ) : (
          <Play aria-hidden="true" className="h-4 w-4" />
        )}
      </button>

      <div
        ref={trackRef}
        data-seam-track
        role="slider"
        tabIndex={0}
        aria-label="Scrub across the cut"
        aria-valuemin={0}
        aria-valuemax={Math.round(total * 100) / 100}
        aria-valuenow={Math.round(seconds * 100) / 100}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
        className="relative h-8 flex-1 cursor-ew-resize rounded bg-zinc-800/80 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
      >
        {/* THE SEAMS, marked. The cut is the thing being judged, so it gets a
            position on the bar you can aim a pointer at — otherwise finding it
            means dragging until the picture changes, which is the very
            observation being made. Each span but the first opens with one. */}
        {timeline.spans.slice(1).map((span) => (
          <span
            key={span.clipId}
            data-seam-mark
            aria-hidden="true"
            style={{ left: pct(span.from) }}
            className="absolute inset-y-0 w-px bg-white/40"
          />
        ))}

        {/* Played-so-far, purely so the bar reads as a clock rather than a
            slider with a dot on it. */}
        <span
          aria-hidden="true"
          style={{ width: pct(seconds) }}
          className="absolute inset-y-0 left-0 rounded-l bg-blue-500/25"
        />

        <span
          data-seam-playhead
          aria-hidden="true"
          style={{ left: pct(seconds) }}
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-blue-400"
        />
      </div>

      <span className="w-20 shrink-0 text-right font-mono text-[11px] tabular-nums text-zinc-400">
        {seconds.toFixed(2)}s
      </span>
    </div>
  );
}

/**
 * The transport: advances `seconds` in real time while playing.
 *
 * A rAF LOOP RATHER THAN AN INTERVAL, and it reads the wall clock each frame
 * instead of adding a fixed step. A timer that adds 1/60 per tick drifts as
 * soon as a frame is late — and frames are late exactly when this matters,
 * because decoding a video across a cut is the expensive moment. Reading
 * elapsed time means a dropped frame costs smoothness, never sync.
 *
 * IT OWNS NO TIME OF ITS OWN. The number lives with the caller and this only
 * pushes it forward, so scrubbing mid-play is not a fight between two writers:
 * a drag sets the value, and the next frame carries on from wherever it landed.
 */
export function useSeamTransport({
  playing,
  totalSeconds,
  seconds,
  onTick,
  onEnded,
}: Readonly<{
  playing: boolean;
  totalSeconds: number;
  seconds: number;
  onTick: (seconds: number) => void;
  onEnded: () => void;
}>): void {
  // Read through refs so the effect below does not restart every frame — it
  // depends only on WHETHER it is playing, not on where the playhead is. A loop
  // that tore down and rebuilt on every tick would reset its own `last`
  // timestamp sixty times a second, which is a clock that cannot measure
  // anything.
  //
  // WRITTEN IN AN EFFECT, not during render. Assigning a ref while rendering is
  // a side effect in a function React is allowed to call speculatively and
  // throw away, so the value written may belong to a render that never
  // happened. An effect with no dependency array runs after every committed
  // render, which is exactly "keep these current" without the lie.
  const secondsRef = useRef(seconds);
  const tickRef = useRef(onTick);
  const endedRef = useRef(onEnded);
  useEffect(() => {
    secondsRef.current = seconds;
    tickRef.current = onTick;
    endedRef.current = onEnded;
  });

  useEffect(() => {
    if (!playing || totalSeconds <= 0) return;
    let frame = 0;
    let last = performance.now();

    const step = (now: number) => {
      const elapsed = (now - last) / 1000;
      last = now;
      const next = secondsRef.current + elapsed;
      if (next >= totalSeconds) {
        tickRef.current(totalSeconds);
        endedRef.current();
        return;
      }
      tickRef.current(next);
      frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, totalSeconds]);
}

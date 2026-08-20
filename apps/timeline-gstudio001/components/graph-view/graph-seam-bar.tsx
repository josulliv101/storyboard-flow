"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
/**
 * A square chip, not a filmstrip frame.
 *
 * It went in at 71x40 — a 16:9 still filling the bar's height — and that made
 * the bar a row of pictures with a scrubber behind it. The job here is to say
 * WHICH clip a section belongs to, which a 26px square does; anything larger
 * is competing with the monitor for the same glance. Square rather than
 * widescreen because it is a marker, and `object-cover` means it still shows
 * the middle of the frame.
 */
const THUMB_WIDTH_PX = 26;

export function SeamBar({
  timeline,
  seconds,
  playing,
  onScrub,
  onTogglePlay,
  onScrubbingChange,
}: Readonly<{
  timeline: SeamTimeline;
  seconds: number;
  playing: boolean;
  onScrub: (seconds: number) => void;
  onTogglePlay: () => void;
  /** Fires true while a drag is in progress on the bar, false when it ends.
   *  The view uses it to make the monitor worth looking at. */
  onScrubbingChange?: (active: boolean) => void;
}>) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const total = timeline.totalSeconds;

  // MEASURED, so a span can be asked whether it has room for a thumbnail.
  // Percentages alone cannot answer that: the same 8% of the bar is a wide
  // section on a monitor and forty pixels on a phone, and a thumbnail crammed
  // into forty pixels is a smear that makes the bar harder to read rather
  // than easier.
  const [trackWidth, setTrackWidth] = useState(0);
  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const measure = () => setTrackWidth(track.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

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
  //
  // GUARDED, because `setPointerCapture` THROWS for a pointer the browser has
  // no active record of — an untrusted event, or one already released — and an
  // exception here kills the whole gesture before it starts. The same guard the
  // trim grips and the seek rails carry.
  //
  // WHETHER TO SCRUB IS TRACKED SEPARATELY rather than read back from
  // `hasPointerCapture`, which answers false whenever the capture did not take
  // and would silently make the bar undraggable in exactly those cases. With a
  // flag, a failed capture costs only the ability to follow the pointer off the
  // bar; moves across it still scrub.
  const draggingRef = useRef(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        /* untrusted or already-released pointer — moves over the bar suffice */
      }
      draggingRef.current = true;
      onScrubbingChange?.(true);
      scrubTo(event.clientX);
    },
    [scrubTo, onScrubbingChange],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      scrubTo(event.clientX);
    },
    [scrubTo],
  );

  const endDrag = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    onScrubbingChange?.(false);
  }, [onScrubbingChange]);

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
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        // h-9: enough to hold a 26px chip with air around it, and no more. It
        // briefly ran at h-12 to fit a full-height still, which turned the bar
        // into a row of pictures with a scrubber behind it.
        className="relative h-9 flex-1 cursor-ew-resize overflow-hidden rounded bg-zinc-800/80 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none"
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

        {/* ONE FRAME PER SECTION, tucked into its right-hand end.
            The bar divides into one span per clip and, until this, the only
            thing telling them apart was a hairline — you could see THAT the
            run of time was three clips without seeing WHICH. A still says it
            at a glance and needs no legend.

            RIGHT-HAND END, because that is where the section meets its cut:
            the frame sits against the seam it is about to hand over at, which
            is the thing the bar exists to let you judge. It is the clip's
            poster rather than the exact frame under the playhead — a still
            that changed as you scrubbed would be a second monitor competing
            with the real one.

            Only when the section is wide enough to hold one. */}
        {trackWidth > 0 &&
          timeline.spans.map((span) => {
            const spanWidth = ((span.to - span.from) / total) * trackWidth;
            if (span.posterSrc === undefined || spanWidth < THUMB_WIDTH_PX + 8) return null;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`thumb-${span.clipId}`}
                data-seam-thumb={span.clipId}
                src={span.posterSrc}
                alt=""
                aria-hidden="true"
                draggable={false}
                style={{ left: pct(span.to), width: THUMB_WIDTH_PX, height: THUMB_WIDTH_PX }}
                className="pointer-events-none absolute top-1/2 -translate-x-[calc(100%+4px)] -translate-y-1/2 rounded-sm object-cover opacity-90 ring-1 ring-black/60 select-none"
              />
            );
          })}

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
          className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-red-500"
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

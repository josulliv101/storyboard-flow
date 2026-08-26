"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

import { formatTimecode } from "@storyboard/ui/timeline/utils";

import type { PreviewTimeChannel } from "./preview-time-channel";

/**
 * THE PREVIEW'S SCRUBBER (PL16-007, to the transport-bar spec).
 *
 * A full-width strip below the picture: a 4px track, a white fill for the
 * elapsed part, a round handle at the playhead, ticks cut through it at every
 * clip boundary, and a tooltip that follows the cursor.
 *
 * NOTHING HERE OWNS THE CLOCK, and that is what makes it agree with everything
 * else by construction rather than by keeping two things in step.
 * `PreviewTimeChannel` is the one clock: this subscribes to it for where the
 * handle goes and writes to it when dragged. The film strip, a board scrub, the
 * transport and this rail all read and write the same value, so none of them
 * can disagree — there is no second copy of the time to drift.
 *
 * ON CHROME, NEVER OVER THE FRAME. The spec's reason is legibility: a control
 * drawn on footage changes contrast with every clip, so none of them are. That
 * is also why the strip keeps a 4px gap below the picture — without it the
 * track fuses with a bright frame's bottom edge.
 *
 * `setScrub` IS DELIBERATELY NOT CALLED. That publishes a pointer position on a
 * BOARD surface so the card under it can raise a hint — it carries a
 * `surfaceId` — and this rail is not one.
 */
export type PreviewScrubRailProps = Readonly<{
  channel: PreviewTimeChannel;
  /** The reachable length of the focused timeline, in seconds. Zero is a
   *  legitimate resting state — an empty collection — and draws the strip with
   *  the handle parked at its start rather than refusing to render. */
  totalSeconds: number;
  /**
   * Clip boundaries as fractions of the total, 0..1, excluding the ends.
   *
   * Fractions rather than seconds because that is what they are drawn as, and
   * converting once here would leave two representations of the same fact for
   * the next reader to reconcile.
   */
  boundaries?: readonly number[];
  /**
   * One frame, in seconds — what an arrow key steps by.
   *
   * A PROP because the spec is explicit that stepping must match the sequence's
   * real rate, and this component has no way to know it. The default is the
   * prototype's 24fps assumption and is exactly that: an assumption, to be
   * replaced the moment the caller can answer properly.
   */
  frameSeconds?: number;
}>;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** The gap BETWEEN two shots on the bar — real background, not a painted notch. */
const SEGMENT_GAP_PX = 4;

/**
 * How bright an unplayed shot sits.
 *
 * 0.35, UP FROM THE 0.15 THE SPEC ASKED FOR, and the reason is that 0.15 is
 * what made the cuts invisible: at that level the bar is so close to the page
 * behind it that there is no shape for a gap to interrupt. Swept 0.15 / 0.25 /
 * 0.35 / 0.45 side by side at 6x — below 0.3 the separation does not survive
 * being looked at normally, and by 0.45 the bar reads as a bright band
 * competing with the picture above it, which is the thing the spec was
 * protecting when it picked a low number.
 */
const TRACK_ALPHA = 0.35;

export function PreviewScrubRail({
  channel,
  totalSeconds,
  boundaries = [],
  frameSeconds = 1 / 24,
}: PreviewScrubRailProps) {
  const time = useSyncExternalStore(channel.subscribe, channel.get, () => 0);
  const stripRef = useRef<HTMLDivElement | null>(null);
  // A CLASS, not just `:hover`, because a fast drag leaves the strip — the
  // pointer is captured so the scrub continues, and the grown track has to
  // continue with it or the control appears to let go mid-gesture.
  const [dragging, setDragging] = useState(false);
  const [hoverFraction, setHoverFraction] = useState<number | null>(null);

  const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const fraction = total === 0 ? 0 : clamp01(time / total);

  const fractionAt = useCallback((clientX: number): number | null => {
    const strip = stripRef.current;
    if (strip === null) return null;
    const rect = strip.getBoundingClientRect();
    if (rect.width === 0) return null;
    return clamp01((clientX - rect.left) / rect.width);
  }, []);

  const seekTo = useCallback(
    (clientX: number) => {
      const next = fractionAt(clientX);
      if (next !== null && total > 0) channel.set(next * total);
    },
    [channel, fractionAt, total],
  );

  // The track and fill grow from 4px to 6px together, so they are expressed
  // once and shared rather than kept in step in two places.
  // EVERY SHOT AS ITS OWN PIECE. The boundaries are the cuts; the bar is what
  // lies between them, plus the two ends.
  const segments = (() => {
    const edges = [0, ...boundaries.map(clamp01).filter((at) => at > 0 && at < 1), 1];
    const out: { start: number; end: number }[] = [];
    for (let i = 0; i < edges.length - 1; i += 1) {
      out.push({ start: edges[i]!, end: edges[i + 1]! });
    }
    return out;
  })();

  const grown = dragging || hoverFraction !== null;
  const barGeometry = grown ? { top: 7, height: 6 } : { top: 8, height: 4 };

  return (
    <div
      data-preview-scrub-rail
      data-dragging={dragging ? "" : undefined}
      // 20px OF POINTER, 4px OF PAINT. The strip is the target — pressing
      // anywhere on it seeks and the drag continues from under the pointer —
      // while what is drawn stays thin enough not to compete with the picture.
      // `touch-action: none` so a vertical flick on a touchscreen scrubs rather
      // than scrolling the page out from under the gesture.
      className="relative h-5 w-full shrink-0 cursor-pointer"
      style={{ touchAction: "none" }}
      role="slider"
      tabIndex={0}
      aria-label="Preview position"
      aria-valuemin={0}
      aria-valuemax={Math.round(total * 100) / 100}
      aria-valuenow={Math.round(time * 100) / 100}
      aria-valuetext={`${formatTimecode(time)} of ${formatTimecode(total)}`}
      ref={stripRef}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // POINTER CAPTURE, so a drag that leaves the strip keeps scrubbing.
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        setDragging(true);
        seekTo(event.clientX);
      }}
      onPointerMove={(event) => {
        const at = fractionAt(event.clientX);
        if (at !== null) setHoverFraction(at);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) seekTo(event.clientX);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        setDragging(false);
      }}
      onPointerLeave={() => setHoverFraction(null)}
      // A SLIDER HAS TO BE OPERABLE FROM THE KEYBOARD, and the spec is specific
      // about the units: an arrow is one FRAME, not one second, because the
      // thing being placed is a cut. Shift takes it to a second for crossing
      // ground. Home and End are the sequence's own ends.
      onKeyDown={(event) => {
        if (total === 0) return;
        const step = event.shiftKey ? 1 : frameSeconds;
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          channel.set(Math.max(0, time - step));
        } else if (event.key === "ArrowRight") {
          event.preventDefault();
          channel.set(Math.min(total, time + step));
        } else if (event.key === "Home") {
          event.preventDefault();
          channel.set(0);
        } else if (event.key === "End") {
          event.preventDefault();
          channel.set(total);
        }
      }}
    >
      {/* ONE PIECE PER SHOT, not one bar with notches painted in it.

          THE NOTCHES WERE INVISIBLE WHERE THEY MATTERED. They were painted in
          the surface's own colour so they would read as gaps — which works on
          the elapsed side, where the fill is white, and fails completely on the
          unplayed side, because the track there is itself nearly that colour.
          A dark notch in a nearly-dark bar is nothing. Measured at 4x before
          changing anything: the cuts simply were not there to the right of the
          playhead.

          Real gaps with the page showing through cannot go quiet that way, and
          rounded caps make each piece read as a unit rather than as a bar that
          happens to have a scratch in it. */}
      {segments.map((segment) => {
        const within =
          segment.end === segment.start
            ? 0
            : clamp01((fraction - segment.start) / (segment.end - segment.start));
        const leftPad = segment.start > 0 ? SEGMENT_GAP_PX / 2 : 0;
        const rightPad = segment.end < 1 ? SEGMENT_GAP_PX / 2 : 0;
        return (
          <div
            key={segment.start}
            data-preview-scrub-segment
            className="absolute overflow-hidden rounded-full transition-[height,top] duration-100"
            style={{
              backgroundColor: `rgba(255, 255, 255, ${TRACK_ALPHA})`,
              top: barGeometry.top,
              height: barGeometry.height,
              left: `calc(${segment.start * 100}% + ${leftPad}px)`,
              width: `calc(${(segment.end - segment.start) * 100}% - ${leftPad + rightPad}px)`,
            }}
          >
            <div
              data-preview-scrub-segment-fill
              className="h-full rounded-full bg-white"
              style={{ width: `${within * 100}%` }}
            />
          </div>
        );
      })}
      {/* THE HANDLE. No pointer events of its own — the strip is the target, so
          a press 3px away from a 12px dot still lands. */}
      <span
        data-preview-scrub-thumb
        aria-hidden="true"
        className="pointer-events-none absolute block h-3 w-3 rounded-full bg-white transition-transform duration-100"
        style={{
          top: 10,
          left: `${fraction * 100}%`,
          transform: `translate(-50%, -50%) scale(${grown ? 1.2 : 1})`,
        }}
      />
      {/* THE TOOLTIP, showing the time UNDER THE CURSOR rather than the
          playhead's — the question it answers is "what is here", which is what
          you need before deciding to go there. */}
      {hoverFraction !== null && total > 0 && (
        <span
          data-preview-scrub-tip
          aria-hidden="true"
          className="pointer-events-none absolute bottom-5 -translate-x-1/2 rounded-md border border-white/15 bg-[#17181c] px-[7px] py-0.5 font-mono text-[11px] whitespace-nowrap text-white"
          style={{ left: `${hoverFraction * 100}%` }}
        >
          {formatTimecode(hoverFraction * total)}
        </span>
      )}
    </div>
  );
}

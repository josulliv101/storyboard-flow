"use client";

import { useCallback, useRef, useSyncExternalStore } from "react";

import type { PreviewTimeChannel } from "./preview-time-channel";

/**
 * THE PREVIEW'S SCRUB LINE (PL16-006).
 *
 * A thin white line across the preview, with the playhead on it as a ball.
 * Drag the ball — or press anywhere on the line — to move the picture; play, or
 * scrub anywhere else, and it moves itself.
 *
 * NOTHING HERE OWNS THE CLOCK, and that is what makes "always in unison" true
 * by construction rather than by keeping two things in step.
 * `PreviewTimeChannel` is the one clock: this subscribes to it for where the
 * ball goes and writes to it when dragged. The film strip, a board scrub, the
 * transport and this rail all read and write the same value, so none of them
 * can disagree — there is no second copy of the time to drift.
 *
 * NOT `GraphSeekRails`, which already exists and is a different shape. That
 * draws a rail PER GRID ROW mapped onto the cells beneath it (`rowCards`,
 * `offsetX`, `cellWidth`, `columns`); the strip's is the same idea against a
 * scroller. This is the whole timeline as one uninterrupted line, with no cells
 * to map onto and no scroller to follow. Sharing the CLOCK is the reuse that
 * matters here; sharing geometry built for a grid would not be.
 *
 * `setScrub` IS DELIBERATELY NOT CALLED. That publishes a pointer position on a
 * BOARD surface so the card under it can raise a hint — it carries a
 * `surfaceId` — and this rail is not one.
 */
export type PreviewScrubRailProps = Readonly<{
  channel: PreviewTimeChannel;
  /** The reachable length of the focused timeline, in seconds. Zero is a
   *  legitimate resting state — an empty collection — and draws the line with
   *  the ball parked at its start rather than refusing to render. */
  totalSeconds: number;
}>;

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/** Arrow-key steps. A second is the unit people think in when placing a cut;
 *  Shift takes it to ten for crossing a sequence. */
const ARROW_STEP_SECONDS = 1;
const ARROW_STEP_COARSE_SECONDS = 10;

export function PreviewScrubRail({ channel, totalSeconds }: PreviewScrubRailProps) {
  const time = useSyncExternalStore(channel.subscribe, channel.get, () => 0);
  const trackRef = useRef<HTMLDivElement | null>(null);

  const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const fraction = total === 0 ? 0 : clamp01(time / total);

  const seekTo = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (track === null || total === 0) return;
      const rect = track.getBoundingClientRect();
      if (rect.width === 0) return;
      channel.set(clamp01((clientX - rect.left) / rect.width) * total);
    },
    [channel, total],
  );

  return (
    <div
      data-preview-scrub-rail
      // THE WHOLE BAND IS THE TARGET, not just the ball. A 10px ball is hard to
      // catch with a mouse and unreasonable with a finger, and pressing
      // anywhere on a progress line to jump there is the gesture people already
      // expect — the drag then continues from under the pointer.
      //
      // IN FLOW, and that is the point of it. It renders through the display
      // surface's `underPicture` slot, where it is a sibling of a `flex-1`
      // picture — so its height comes out of the PICTURE and it overlaps
      // nothing. The transport hangs off the surface's bottom edge and is
      // untouched.
      // EXACTLY 4px ABOVE THE DIVIDER, and that number is asked for rather than
      // arrived at — `pb-1`. The line belongs to the divider below it, not to
      // the picture above, so all the clearance goes above it.
      //
      // Twice this was set by eye and twice it was too far: centred in the band
      // it sat 10px clear, then 6px. The e2e now asserts the 4 exactly, so the
      // next person changing the band's height cannot move it by accident.
      //
      // The ball overhangs it — 5px radius at rest, 6px hovered — which is why
      // the band does not clip: it is `overflow` visible, and the ball reaching
      // a couple of pixels over the divider's own clearance is what makes it
      // read as sitting ON the line rather than above it.
      // PAINTED 20px LOWER THAN ITS LAYOUT BOX, which is the whole trick.
      //
      // The divider is a 44px HIT TARGET whose visible gray bar sits 20px below
      // its top edge — measured: box top 306, bar top 326. So a gap measured
      // against the BOX is 20px larger than the gap anyone can see, which is
      // how this was set to "4px" twice and looked like 24.
      //
      // `top-3` shifts the paint 12px down onto the divider's empty top
      // clearance without moving the layout box, so the picture above is
      // unaffected and the line lands 12px above the BAR. Twelve, not the four
      // tried first: at four the line read as part of the divider rather than
      // as its own control.
      //
      // No background: the band it now paints over belongs to the divider, and
      // filling it would put a black strip across the divider's own ground.
      className="group/rail relative top-3 z-10 flex h-4 w-full shrink-0 cursor-pointer items-end px-3 pb-1"
      role="slider"
      tabIndex={0}
      aria-label="Preview position"
      aria-valuemin={0}
      aria-valuemax={Math.round(total * 100) / 100}
      aria-valuenow={Math.round(time * 100) / 100}
      aria-valuetext={`${time.toFixed(2)} of ${total.toFixed(2)} seconds`}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        // POINTER CAPTURE, so a drag that leaves the band keeps scrubbing — the
        // same thing the seam bar does, and for the same reason: a hand moving
        // at any speed leaves a 16px band immediately.
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        seekTo(event.clientX);
      }}
      onPointerMove={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        seekTo(event.clientX);
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onKeyDown={(event) => {
        if (total === 0) return;
        const step = event.shiftKey ? ARROW_STEP_COARSE_SECONDS : ARROW_STEP_SECONDS;
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
      {/* THE LINE. Continuous across the whole width — it is the sequence, not
          a set of clips, so nothing divides it. One pixel: it is a reference
          for the ball to sit on, not a bar to read a value off. */}
      <div ref={trackRef} data-preview-scrub-track className="relative h-px w-full bg-white/70">
        {/* THE BALL, white like the line because it is the same object — where
            you are on it. A second hue would read as a different kind of thing.

            `translate(-50%, -50%)` on both axes so its CENTRE sits on the
            value; anchored by its left edge it would lie by a radius, which at
            these scales is a frame or more. */}
        <span
          data-preview-scrub-thumb
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 block h-2.5 w-2.5 rounded-full bg-white transition-[height,width] group-hover/rail:h-3 group-hover/rail:w-3"
          style={{ left: `${fraction * 100}%`, transform: "translate(-50%, -50%)" }}
        />
      </div>
    </div>
  );
}

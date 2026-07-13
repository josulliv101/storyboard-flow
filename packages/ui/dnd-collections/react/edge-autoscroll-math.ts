// Pure geometry + timing for edge auto-scroll, split out of the hook so it can
// be unit tested without a DOM or a rAF loop. `use-edge-autoscroll.ts` owns
// the listeners, the rect, and the scrolling; this owns the numbers.

// Baseline frame at 60fps. Velocities are expressed per-60fps-frame so the
// historical `maxSpeed` default keeps its feel; `frameScaledDistance` turns a
// per-frame velocity into a per-elapsed-time distance so the scroll speed no
// longer depends on the display's refresh rate (a 120Hz screen used to scroll
// twice as fast as a 60Hz one).
export const AUTO_SCROLL_FRAME_MS = 1000 / 60;

// Cap the catch-up after a long gap (backgrounded tab, jank) so the strip eases
// instead of lurching a full stall's worth of scroll into one frame.
export const AUTO_SCROLL_MAX_CATCHUP_FRAMES = 4;

/**
 * Per-frame scroll velocity (px, signed) for a pointer at `position` on a
 * [start, end] axis. Negative in the band near `start` (scroll toward the
 * origin), positive in the band near `end`, zero in the dead zone between and
 * at/outside the ends. `edge` is the band width in px; `maxSpeed` the velocity
 * at the very edge, ramping linearly to zero at the band's inner boundary.
 */
export function edgeScrollVelocity(
  position: number,
  start: number,
  end: number,
  edge: number,
  maxSpeed: number
): number {
  if (position <= start || position >= end) return 0;
  if (position < start + edge) return -maxSpeed * (1 - (position - start) / edge);
  if (position > end - edge) return maxSpeed * (1 - (end - position) / edge);
  return 0;
}

/**
 * Distance to scroll for a frame of `elapsedMs`, given a per-60fps-frame
 * `velocityPerFrame`. Frame-rate independent: two 8.3ms ticks travel the same
 * distance as one 16.7ms tick. Negative/zero elapsed contributes nothing, and
 * a long elapsed is clamped so a stall cannot lurch.
 */
export function frameScaledDistance(velocityPerFrame: number, elapsedMs: number): number {
  const frames = Math.min(
    Math.max(elapsedMs, 0) / AUTO_SCROLL_FRAME_MS,
    AUTO_SCROLL_MAX_CATCHUP_FRAMES
  );
  return velocityPerFrame * frames;
}

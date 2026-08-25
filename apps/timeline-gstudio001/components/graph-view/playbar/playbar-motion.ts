/**
 * THE FLING'S ARITHMETIC, separated from the DOM that shows it (PL15-030).
 *
 * Pulled out because the behaviour is not otherwise testable here: momentum
 * runs on `requestAnimationFrame`, and rAF does not tick in a page that is not
 * compositing — measured, a hidden tab ran ZERO frames in 250ms, which reads
 * from outside as "the strip has no inertia" no matter how correct the code is.
 * A pure function can be asked the same questions without a browser.
 *
 * The numbers are the reference design's own, kept exactly: smoothing at
 * 0.7/0.3, friction 0.94 per 16.7ms, a 3.5px/ms cap, and a throw abandoned if
 * the hand was still for 80ms before letting go.
 */

/** Smoothing weight kept from the previous sample. */
const VELOCITY_SMOOTHING = 0.7;
/** Exponential friction, applied per 16.7ms of travel. */
export const MOMENTUM_FRICTION = 0.94;
/** Below this a fling is a twitch, not a throw. */
export const MOMENTUM_MIN_LAUNCH = 0.05;
/** Below this it has stopped. */
export const MOMENTUM_MIN = 0.02;
/** A flick across a trackpad must not slingshot the strip. */
export const MOMENTUM_MAX = 3.5;
/** Still for this long before release and the throw is abandoned. */
export const MOMENTUM_STALE_MS = 80;
/** A frame longer than this is a tab that was away; do not teleport. */
export const MAX_FRAME_MS = 50;

/**
 * Fold one pointer sample into a running velocity, in px/ms.
 *
 * SMOOTHED, so one jittery sample cannot decide the throw — a pointer that
 * stutters for a frame at the end of a drag would otherwise launch the strip
 * at whatever that frame happened to say.
 */
export function smoothVelocity(previous: number, deltaPx: number, dtMs: number): number {
  if (dtMs <= 0) return previous;
  return previous * VELOCITY_SMOOTHING + (deltaPx / dtMs) * (1 - VELOCITY_SMOOTHING);
}

/**
 * The velocity a release actually launches with.
 *
 * Zero when the hand had stopped: letting go of something stationary should
 * not throw it, and without this a drag that ends with a pause still coasts.
 */
export function releaseVelocity(sampled: number, msSinceLastMove: number): number {
  if (msSinceLastMove > MOMENTUM_STALE_MS) return 0;
  return Math.min(MOMENTUM_MAX, Math.max(-MOMENTUM_MAX, sampled));
}

/** Whether a release is worth animating at all. */
export function willFling(velocity: number): boolean {
  return Math.abs(velocity) >= MOMENTUM_MIN_LAUNCH;
}

/**
 * One frame of coasting: how far the scroll moves, and what is left of the
 * velocity afterwards.
 *
 * The scroll moves AGAINST the velocity because a drag to the left (negative
 * px/ms) is a scroll to the right — the content follows the hand.
 */
export function advanceMomentum(
  velocity: number,
  dtMs: number,
): Readonly<{ scrollDelta: number; velocity: number }> {
  const dt = Math.min(dtMs, MAX_FRAME_MS);
  return {
    scrollDelta: -velocity * dt,
    velocity: velocity * Math.pow(MOMENTUM_FRICTION, dt / 16.7),
  };
}

/** Has the coast finished — either spent, or run into an end? */
export function momentumSpent(
  velocity: number,
  scrollLeft: number,
  maxScroll: number,
): boolean {
  return Math.abs(velocity) < MOMENTUM_MIN || scrollLeft <= 0 || scrollLeft >= maxScroll - 0.5;
}

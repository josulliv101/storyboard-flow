import { describe, expect, it } from "vitest";

import {
  MOMENTUM_MAX,
  advanceMomentum,
  momentumSpent,
  releaseVelocity,
  smoothVelocity,
  willFling,
} from "./playbar-motion";

/**
 * THE FLING, TESTED WITHOUT A BROWSER (PL15-030).
 *
 * Momentum runs on `requestAnimationFrame`, and rAF does not tick in a page
 * that is not compositing — measured, a hidden tab ran ZERO frames in 250ms.
 * From outside that is indistinguishable from "the strip has no inertia",
 * which is exactly the wrong conclusion to draw twice. These ask the physics
 * the same questions directly.
 */

describe("velocity from a drag", () => {
  it("is smoothed, so one stuttering sample cannot decide the throw", () => {
    // A steady drag settles toward its true speed rather than jumping to it.
    let velocity = 0;
    for (let i = 0; i < 8; i++) velocity = smoothVelocity(velocity, -45, 16);
    expect(velocity).toBeLessThan(-2);
    expect(velocity).toBeGreaterThan(-45 / 16);

    // One bad frame at the end moves it, but nowhere near all the way.
    const jittered = smoothVelocity(velocity, -400, 16);
    expect(jittered).toBeGreaterThan(-400 / 16 / 2);
  });

  it("ignores a sample with no time between it and the last", () => {
    expect(smoothVelocity(-2, -50, 0)).toBe(-2);
  });
});

describe("what a release launches with", () => {
  it("throws when the hand was still moving", () => {
    expect(releaseVelocity(-2.4, 8)).toBeCloseTo(-2.4, 5);
    expect(willFling(-2.4)).toBe(true);
  });

  it("does NOT throw when the hand had stopped", () => {
    // Letting go of something stationary must not launch it — without this a
    // drag that ends in a pause still coasts away under the finger.
    expect(releaseVelocity(-2.4, 200)).toBe(0);
    expect(willFling(0)).toBe(false);
  });

  it("caps a flick so it cannot slingshot", () => {
    expect(releaseVelocity(-99, 8)).toBe(-MOMENTUM_MAX);
    expect(releaseVelocity(99, 8)).toBe(MOMENTUM_MAX);
  });

  it("treats a twitch as no throw at all", () => {
    expect(willFling(0.04)).toBe(false);
    expect(willFling(0.05)).toBe(true);
  });
});

describe("coasting", () => {
  it("scrolls AGAINST the drag, because the content follows the hand", () => {
    // Dragging left is a negative velocity and must scroll right.
    expect(advanceMomentum(-2, 16).scrollDelta).toBeGreaterThan(0);
    expect(advanceMomentum(2, 16).scrollDelta).toBeLessThan(0);
  });

  it("decays, and always toward zero", () => {
    const first = advanceMomentum(-2, 16.7);
    expect(Math.abs(first.velocity)).toBeLessThan(2);
    const second = advanceMomentum(first.velocity, 16.7);
    expect(Math.abs(second.velocity)).toBeLessThan(Math.abs(first.velocity));
  });

  it("comes to rest rather than coasting forever", () => {
    let velocity = -MOMENTUM_MAX;
    let scroll = 1000;
    let frames = 0;
    while (!momentumSpent(velocity, scroll, 4000) && frames < 1000) {
      const next = advanceMomentum(velocity, 16.7);
      scroll += next.scrollDelta;
      velocity = next.velocity;
      frames++;
    }
    expect(frames).toBeLessThan(1000);
    expect(frames).toBeGreaterThan(5); // it does actually travel
  });

  it("does not teleport after a frame that took a second", () => {
    // A backgrounded tab comes back with an enormous delta; the step is capped
    // so the strip does not jump the length of the sequence.
    const long = advanceMomentum(-2, 1000);
    const capped = advanceMomentum(-2, 50);
    expect(long.scrollDelta).toBeCloseTo(capped.scrollDelta, 5);
  });

  it("stops at either end", () => {
    expect(momentumSpent(-2, 0, 4000)).toBe(true);
    expect(momentumSpent(-2, 4000, 4000)).toBe(true);
    expect(momentumSpent(-2, 2000, 4000)).toBe(false);
  });
});

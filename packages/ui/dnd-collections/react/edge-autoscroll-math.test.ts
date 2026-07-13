import { describe, expect, it } from "vitest";

import {
  AUTO_SCROLL_FRAME_MS,
  AUTO_SCROLL_MAX_CATCHUP_FRAMES,
  edgeScrollVelocity,
  frameScaledDistance,
} from "./edge-autoscroll-math";

describe("edgeScrollVelocity", () => {
  it("is zero in the dead zone between the edge bands", () => {
    expect(edgeScrollVelocity(100, 0, 200, 40, 14)).toBe(0);
  });

  it("is zero at or outside the axis ends", () => {
    expect(edgeScrollVelocity(0, 0, 200, 40, 14)).toBe(0);
    expect(edgeScrollVelocity(200, 0, 200, 40, 14)).toBe(0);
    expect(edgeScrollVelocity(-10, 0, 200, 40, 14)).toBe(0);
    expect(edgeScrollVelocity(999, 0, 200, 40, 14)).toBe(0);
  });

  it("ramps toward the origin near the start (full speed at the very edge)", () => {
    expect(edgeScrollVelocity(0.001, 0, 200, 40, 14)).toBeCloseTo(-14, 1);
    // Halfway into a 40px band -> half speed, still negative (toward origin).
    expect(edgeScrollVelocity(20, 0, 200, 40, 14)).toBe(-7);
  });

  it("ramps toward the end near the end", () => {
    expect(edgeScrollVelocity(199.999, 0, 200, 40, 14)).toBeCloseTo(14, 1);
    expect(edgeScrollVelocity(180, 0, 200, 40, 14)).toBe(7);
  });
});

describe("frameScaledDistance", () => {
  it("equals the per-frame velocity at exactly one 60fps frame", () => {
    expect(frameScaledDistance(14, AUTO_SCROLL_FRAME_MS)).toBeCloseTo(14, 10);
  });

  it("is frame-rate independent: two half-frames travel the same as one full frame", () => {
    const full = frameScaledDistance(14, AUTO_SCROLL_FRAME_MS);
    const twoHalves = frameScaledDistance(14, AUTO_SCROLL_FRAME_MS / 2) * 2;
    const fourQuarters = frameScaledDistance(14, AUTO_SCROLL_FRAME_MS / 4) * 4;
    expect(twoHalves).toBeCloseTo(full, 10);
    expect(fourQuarters).toBeCloseTo(full, 10);
  });

  it("clamps a long stall so it cannot lurch", () => {
    expect(frameScaledDistance(14, 100_000)).toBe(14 * AUTO_SCROLL_MAX_CATCHUP_FRAMES);
  });

  it("treats zero or negative elapsed as no movement", () => {
    expect(frameScaledDistance(14, 0)).toBe(0);
    expect(frameScaledDistance(14, -5)).toBe(0);
  });
});

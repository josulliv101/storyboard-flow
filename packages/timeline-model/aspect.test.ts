import { describe, expect, it } from "vitest";

import { aspectFromDimensions } from "./documents";

describe("aspectFromDimensions", () => {
  it("measures the real shapes this project actually contains", () => {
    // The four that disproved "every source is 16:9" — a claim read off the
    // stored `aspect` field, which was a default nobody had measured.
    expect(aspectFromDimensions(2864, 1204)).toBeCloseTo(2.379, 3);
    expect(aspectFromDimensions(896, 384)).toBeCloseTo(2.333, 3);
    expect(aspectFromDimensions(1152, 480)).toBeCloseTo(2.4, 6);
    expect(aspectFromDimensions(832, 480)).toBeCloseTo(1.733, 3);
  });

  it("is undefined for anything that cannot be divided by", () => {
    // `aspect` is a DIVISOR in layout and inset geometry — a zero is an
    // infinity and a negative inverts the box — so a bad reading has to become
    // "no answer" and let the caller keep its own default.
    for (const [w, h] of [
      [0, 480],
      [1152, 0],
      [-1152, 480],
      [1152, -480],
      [Number.NaN, 480],
      [1152, Number.POSITIVE_INFINITY],
    ] as const) {
      expect(aspectFromDimensions(w, h)).toBeUndefined();
    }
  });

  it("is undefined for a missing or non-numeric reading", () => {
    for (const bad of [undefined, null, "1152", {}]) {
      expect(aspectFromDimensions(bad, 480)).toBeUndefined();
      expect(aspectFromDimensions(1152, bad)).toBeUndefined();
    }
  });

  it("keeps the full ratio rather than snapping to a known one", () => {
    // 1.733 is not 16:9 and must not be rounded into it — the whole point is
    // that the real shape reaches the inset geometry.
    expect(aspectFromDimensions(832, 480)).not.toBeCloseTo(16 / 9, 2);
  });
});

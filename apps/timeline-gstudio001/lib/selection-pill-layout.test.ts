import { describe, expect, it } from "vitest";

import { PILL_MINIMUM_WIDTH, resolvePillLayout } from "./selection-pill-layout";

// The card sizes these thresholds actually meet, so a change to either is
// measured against the real thing rather than round numbers:
//   grid cells  132 (xs) · 168 (sm) · 216 (md) · 280 (lg) · 360 (xl)
//   strip clips duration x zoom — a 4s clip at default zoom is ~200px, a 1s
//               clip is 50px, and the floor is 12px.

describe("resolvePillLayout", () => {
  it("shows everything on a large grid card", () => {
    const layout = resolvePillLayout(360);

    expect(layout.visible).toBe(true);
    expect(layout.showCount).toBe(true);
    expect(layout.inline).toEqual(["open", "details", "copy", "cut"]);
  });

  it("folds from the RIGHT, so surviving actions keep their positions", () => {
    // The muscle-memory rule: whatever is still there is where it was. Folding
    // from the left would slide every remaining action.
    const wide = resolvePillLayout(360).inline;
    const narrow = resolvePillLayout(216).inline;

    expect(narrow.length).toBeLessThan(wide.length);
    expect(wide.slice(0, narrow.length)).toEqual(narrow);
  });

  it("narrows monotonically — never regains an action as the card shrinks", () => {
    // The bug this exists for: budgeting the COUNT before the actions meant a
    // narrower card could free the count's width and fit one more action, so
    // the pill grew a control as its card shrank.
    let previous = Number.POSITIVE_INFINITY;
    for (let width = 400; width >= PILL_MINIMUM_WIDTH; width -= 1) {
      const count = resolvePillLayout(width).inline.length;
      expect(count, `width ${width}`).toBeLessThanOrEqual(previous);
      previous = count;
    }
  });

  it("drops the count group before it drops the last action", () => {
    // The count is a readout and the header carries the same number at all
    // times; an ACTION that folds away costs a click to reach.
    const countGoesAt = (() => {
      for (let width = 400; width >= PILL_MINIMUM_WIDTH; width -= 1) {
        if (!resolvePillLayout(width).showCount) return width;
      }
      return PILL_MINIMUM_WIDTH;
    })();

    expect(resolvePillLayout(countGoesAt).inline.length).toBeGreaterThan(0);
    expect(resolvePillLayout(400).showCount).toBe(true);
  });

  it("collapses to the overflow alone rather than showing delete by itself", () => {
    // A row of one destructive button reads as broken; a lone menu button
    // reads as deliberate.
    const layout = resolvePillLayout(PILL_MINIMUM_WIDTH + 4);

    expect(layout.visible).toBe(true);
    expect(layout.inline).toEqual([]);
    expect(layout.showDelete).toBe(false);
    expect(layout.showCount).toBe(false);
  });

  it("renders no pill at all below the minimum", () => {
    // A 12px strip clip has nowhere to put even a menu button. The header's
    // overflow is the fallback, which is what it was built for.
    expect(resolvePillLayout(PILL_MINIMUM_WIDTH - 1).visible).toBe(false);
    expect(resolvePillLayout(12).visible).toBe(false);
    expect(resolvePillLayout(0).visible).toBe(false);
  });

  it("keeps delete and the overflow at every width that shows a row", () => {
    for (let width = 400; width >= PILL_MINIMUM_WIDTH; width -= 1) {
      const layout = resolvePillLayout(width);
      if (layout.inline.length === 0) continue;
      expect(layout.showDelete, `width ${width}`).toBe(true);
    }
  });

  it("treats an unmeasured card as no pill rather than a full one", () => {
    // The ResizeObserver reports 0 before its first measurement; guessing
    // "full" there would flash a pill wider than its card.
    expect(resolvePillLayout(Number.NaN).visible).toBe(false);
  });

  it("gives every grid size a usable pill", () => {
    // The floor that matters in practice: even the smallest grid cell offers
    // more than a bare menu button.
    for (const width of [132, 168, 216, 280, 360]) {
      const layout = resolvePillLayout(width);
      expect(layout.visible, `grid ${width}`).toBe(true);
      expect(layout.inline.length, `grid ${width}`).toBeGreaterThan(0);
    }
  });
});

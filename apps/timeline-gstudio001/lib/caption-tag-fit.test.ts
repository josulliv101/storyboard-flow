import { describe, expect, it } from "vitest";

import { CAPTION_TAG_GAP_PX, fittedTagCount } from "./caption-tag-fit";

// #281: this arithmetic lived inside `CaptionTagRow`, and the app's vitest
// cannot parse `.tsx` — so the fold rules had never been tested. They are the
// interesting part of that component; the JSX around them is not.

const GAP = CAPTION_TAG_GAP_PX;

describe("fittedTagCount", () => {
  it("shows every chip when they all fit with no counter", () => {
    // 3 chips of 20 + 2 gaps = 68.
    expect(fittedTagCount({ widths: [20, 20, 20], budget: 68, counterWidth: 30 })).toBe(3);
  });

  it("asks pass one against the FULL budget, not one reduced by the counter", () => {
    // Exactly 68 of room and a fat counter. Reserving for a "+N" that will
    // never be drawn would fold a row that fits — the bug the two passes exist
    // to prevent.
    expect(fittedTagCount({ widths: [20, 20, 20], budget: 68, counterWidth: 999 })).toBe(3);
  });

  it("reserves the counter's width once something folds", () => {
    // 4 chips need 92; the budget is 70, so pass one fails. Pass two fits
    // against 70 - 30 - 4 = 36: two chips (20 + 4 + 20 = 44) is too much, so
    // one.
    expect(fittedTagCount({ widths: [20, 20, 20, 20], budget: 70, counterWidth: 30 })).toBe(1);
  });

  it("counts the gaps BETWEEN chips, not after the last one", () => {
    // Two 20s with one gap is 44. A budget of 44 fits; 43 does not.
    expect(fittedTagCount({ widths: [20, 20], budget: 44, counterWidth: 0 })).toBe(2);
    expect(fittedTagCount({ widths: [20, 20], budget: 43, counterWidth: 0 })).toBeLessThan(2);
  });

  it("keeps at least one chip even when nothing fits", () => {
    // A row reading only "+4" says there are tags without showing one.
    expect(fittedTagCount({ widths: [500, 500], budget: 40, counterWidth: 30 })).toBe(1);
  });

  it("reports NO OPINION for an unlaid-out row rather than folding to nothing", () => {
    // budget 0 = the caption is display:none while the strip shows. The caller
    // keeps its last answer; a count here would be a wrong one.
    expect(fittedTagCount({ widths: [20, 20], budget: 0, counterWidth: 10 })).toBeNull();
  });

  it("is 0 for no tags, which is not the same as no opinion", () => {
    expect(fittedTagCount({ widths: [], budget: 100, counterWidth: 10 })).toBe(0);
  });

  it("does not oscillate: the answer is stable when fed back its own outcome", () => {
    // The one-way property. Fold once, then re-ask with the same inputs — a
    // rule that reserved the counter in pass one could flip between 3 and 2
    // forever as the "+N" appeared and disappeared.
    const inputs = { widths: [30, 30, 30, 30], budget: 100, counterWidth: 24 } as const;
    const first = fittedTagCount(inputs);
    expect(fittedTagCount(inputs)).toBe(first);
    expect(first).toBeLessThan(4);
  });

  it("rounds the counter UP, so a fractional measurement cannot overflow the row", () => {
    // getBoundingClientRect returns fractions; truncating would leave the row
    // a sub-pixel over budget and wrap.
    const fractional = fittedTagCount({ widths: [30, 30], budget: 70, counterWidth: 29.4 });
    const rounded = fittedTagCount({ widths: [30, 30], budget: 70, counterWidth: 30 });
    expect(fractional).toBe(rounded);
  });

  it("honours a caller-supplied gap", () => {
    // 2 chips of 20 with a 20px gap is 60 — fits exactly at 60, not at 59.
    expect(fittedTagCount({ widths: [20, 20], budget: 60, counterWidth: 0, gap: 20 })).toBe(2);
    expect(fittedTagCount({ widths: [20, 20], budget: 59, counterWidth: 0, gap: 20 })).toBe(1);
  });
});

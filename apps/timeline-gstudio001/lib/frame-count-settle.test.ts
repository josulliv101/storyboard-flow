import { describe, expect, it } from "vitest";

import { settleFrameCountStep, visibleFrameCount } from "./frame-count-settle";

// #281: this state machine lived inside `useSettledFrameCount`, and the app's
// vitest cannot parse `.tsx` — so the sentinel's two meanings had never been
// pinned. Getting either wrong is invisible in review and obvious on screen:
// a blank filmstrip, or every `<img>` src swapping several times per drag.

describe("settleFrameCountStep", () => {
  it("adopts the FIRST real measurement immediately", () => {
    // A freshly (re)mounted card — virtualization remounts included — must not
    // wait out 400ms before it shows a filmstrip at all.
    expect(settleFrameCountStep({ settled: 0, measured: 6 })).toBe("adopt-now");
  });

  it("debounces a later CHANGE", () => {
    // A drag sweeps the width→count ratio through several integers; adopting
    // each crossing re-times every slot and swaps every src.
    expect(settleFrameCountStep({ settled: 6, measured: 7 })).toBe("debounce");
  });

  it("holds when the measurement has not changed", () => {
    expect(settleFrameCountStep({ settled: 6, measured: 6 })).toBe("hold");
  });

  it("HOLDS an unmeasured card rather than adopting a zero", () => {
    // The ordering rule: equality is checked before the sentinel. Reversed,
    // `settled: 0, measured: 0` would report "adopt-now" and the card would
    // commit to a zero-frame filmstrip — an empty band, not a picture.
    expect(settleFrameCountStep({ settled: 0, measured: 0 })).toBe("hold");
  });

  it("does not ALSO debounce while the render-time adoption is in flight", () => {
    // The sentinel's second meaning. The effect runs in the same pass that
    // adopted during render; if this said "debounce", a remount would
    // double-schedule the same value.
    expect(settleFrameCountStep({ settled: 0, measured: 9 })).not.toBe("debounce");
  });

  it("debounces a shrink as well as a growth", () => {
    // Narrowing a card is the same churn in the other direction.
    expect(settleFrameCountStep({ settled: 9, measured: 3 })).toBe("debounce");
  });
});

describe("visibleFrameCount", () => {
  it("shows the MEASURED value while nothing is settled", () => {
    // So the card paints on the first frame it can, rather than waiting for
    // the adoption to round-trip through state.
    expect(visibleFrameCount({ settled: 0, measured: 6 })).toBe(6);
  });

  it("shows the SETTLED value once there is one", () => {
    // Mid-debounce the card keeps the old count — that steadiness is the whole
    // point of the delay.
    expect(visibleFrameCount({ settled: 6, measured: 7 })).toBe(6);
  });

  it("is zero only when nothing has been measured at all", () => {
    expect(visibleFrameCount({ settled: 0, measured: 0 })).toBe(0);
  });
});

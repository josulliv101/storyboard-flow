import { describe, expect, it } from "vitest";

import {
  clamp,
  formatTimecode,
  getSourceTimeFromClientX,
  getTrimHandleSourceTime,
} from "./utils";

describe("timeline utilities", () => {
  it("clamps values to a range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(12, 0, 10)).toBe(10);
  });

  it("writes a playhead's time as m:ss.d", () => {
    // The spec's own worked example.
    expect(formatTimecode(71.1)).toBe("1:11.1");
    // Under a minute still carries the minute, so the column never shifts.
    expect(formatTimecode(0)).toBe("0:00.0");
    expect(formatTimecode(4.25)).toBe("0:04.2");
    // Seconds are zero-padded and minutes are not — 9 and 10 must not change
    // the width of the seconds field.
    expect(formatTimecode(59.9)).toBe("0:59.9");
    expect(formatTimecode(60)).toBe("1:00.0");
    // FLOORED. 9.99 is not yet 10, and a clock that said so would read as
    // past a cut it is parked on.
    expect(formatTimecode(9.99)).toBe("0:09.9");
    // Nothing sensible to say gets the resting value rather than "NaN:aN.N".
    expect(formatTimecode(-3)).toBe("0:00.0");
    expect(formatTimecode(Number.NaN)).toBe("0:00.0");
    expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe("0:00.0");
  });

  it("maps browser coordinates into source time", () => {
    expect(getSourceTimeFromClientX({
      clientX: 150,
      rectLeft: 100,
      rectWidth: 200,
      sourceDuration: 20,
    })).toBe(5);
  });

  it("reports trim handle preview times inside the source boundary", () => {
    const clip = {
      id: "clip-0",
      index: 0,
      kind: "video" as const,
      src: "/fixture.mp4",
      alt: "Fixture",
      aspect: 16 / 9,
      trackIndex: 0,
      startTime: 0,
      duration: 4,
      sourceDuration: 10,
      trimIn: 3,
      trimOut: 3,
    };

    expect(getTrimHandleSourceTime(clip, "left")).toBe(3);
    expect(getTrimHandleSourceTime(clip, "right")).toBe(7);
  });
});

import { describe, expect, it } from "vitest";

import { clamp, getSourceTimeFromClientX, getTrimHandleSourceTime } from "./utils";

describe("timeline utilities", () => {
  it("clamps values to a range", () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(12, 0, 10)).toBe(10);
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

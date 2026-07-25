import { describe, expect, it } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/timeline-model/types";

import { describeTimelineForAgent } from "./mcp-timeline-summary";

function image(id: string, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: `https://cdn.test/${id}.jpg`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
    ...overrides,
  } as TimelineClip;
}

const doc = (clips: TimelineClip[]): TimelineDocument => ({
  id: "doc",
  title: "Scene",
  clips,
});

describe("describeTimelineForAgent", () => {
  it("says nothing about disabling when nothing is disabled", () => {
    const summary = describeTimelineForAgent(doc([image("a"), image("b")]));
    expect(summary).toBe('"Scene" — 2 clips: image, image');
    expect(summary).not.toContain("disabled");
  });

  it("marks each disabled clip AND counts them", () => {
    const summary = describeTimelineForAgent(
      doc([image("a"), image("b", { disabled: true })]),
    );
    expect(summary).toContain("(1 disabled, skipped in playback and totals)");
    expect(summary).toContain("image [disabled]");
  });

  it("still reports disabled clips that fall past the elision", () => {
    // The whole reason the count is separate from the per-clip markers: the
    // list stops at 8, so a disabled clip in position 9 is invisible to the
    // markers alone. A caller reading only "10 clips" would assume all ten play.
    const clips = Array.from({ length: 10 }, (_, index) =>
      image(`c${index}`, index === 9 ? { disabled: true } : {}),
    );
    const summary = describeTimelineForAgent(doc(clips));
    expect(summary).toContain("(1 disabled");
    expect(summary).toContain("…");
    expect(summary).not.toContain("[disabled]");
  });

  it("degrades on an empty or clip-less document rather than throwing", () => {
    expect(describeTimelineForAgent(doc([]))).toBe('"Scene" — 0 clips: (empty)');
    expect(
      describeTimelineForAgent({ id: "d", title: "Scene" } as TimelineDocument),
    ).toBe('"Scene" — 0 clips: (empty)');
  });

  it("names a collection by title", () => {
    const collection = {
      ...image("col"),
      kind: "collection",
      title: "Bank Heist",
      childTimelineId: "child",
      itemCount: 3,
      disabled: true,
    } as unknown as TimelineClip;
    expect(describeTimelineForAgent(doc([collection]))).toContain(
      "Bank Heist (collection) [disabled]",
    );
  });
});

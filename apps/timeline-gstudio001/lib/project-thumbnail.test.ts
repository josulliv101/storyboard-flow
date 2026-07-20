import { describe, expect, it } from "vitest";

import type { TimelineClip } from "@storyboard/timeline-model/types";

import { firstFrameUrl } from "./project-thumbnail";

const base = {
  index: 0,
  alt: "",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 3,
  sourceDuration: 3,
  trimIn: 0,
  trimOut: 0,
};

function image(id: string, src: string): TimelineClip {
  return { ...base, id, kind: "image", src };
}

function video(id: string, src: string, poster?: string): TimelineClip {
  return { ...base, id, kind: "video", src, poster };
}

function collection(
  id: string,
  previewItems: NonNullable<
    Extract<TimelineClip, { kind: "collection" }>["previewItems"]
  >,
): TimelineClip {
  return {
    ...base,
    id,
    kind: "collection",
    title: id,
    childTimelineId: `child-${id}`,
    itemCount: previewItems.length,
    previewItems,
  };
}

describe("firstFrameUrl", () => {
  it("takes the first image clip's src", () => {
    expect(firstFrameUrl([image("a", "https://cdn.test/a.jpg")])).toBe(
      "https://cdn.test/a.jpg",
    );
  });

  it("prefers a video's poster over its src", () => {
    expect(
      firstFrameUrl([video("a", "https://cdn.test/a.mp4", "https://cdn.test/a.jpg")]),
    ).toBe("https://cdn.test/a.jpg");
  });

  it("falls back to a video's src when it has no poster", () => {
    expect(firstFrameUrl([video("a", "https://cdn.test/a.mp4")])).toBe(
      "https://cdn.test/a.mp4",
    );
  });

  // The regression this module exists for: a project organised into scenes
  // holds ONLY collection clips, so a kind === image|video scan returned
  // undefined and the card rendered the empty placeholder.
  it("reads a collection's first preview item when no media clip is present", () => {
    const clips = [
      collection("Bank Heist", [
        { id: "p1", kind: "image", src: "https://cdn.test/heist.jpg", alt: "p1" },
        { id: "p2", kind: "image", src: "https://cdn.test/other.jpg", alt: "p2" },
      ]),
      collection("Car Chase", [
        { id: "p3", kind: "image", src: "https://cdn.test/chase.jpg", alt: "p3" },
      ]),
    ];
    expect(firstFrameUrl(clips)).toBe("https://cdn.test/heist.jpg");
  });

  it("uses a collection preview video's poster", () => {
    const clips = [
      collection("Scene", [
        {
          id: "p1",
          kind: "video",
          src: "https://cdn.test/p1.mp4",
          poster: "https://cdn.test/p1.jpg",
          alt: "p1",
        },
      ]),
    ];
    expect(firstFrameUrl(clips)).toBe("https://cdn.test/p1.jpg");
  });

  it("skips collections that carry no preview items", () => {
    const clips = [collection("Empty", []), image("a", "https://cdn.test/a.jpg")];
    expect(firstFrameUrl(clips)).toBe("https://cdn.test/a.jpg");
  });

  it("returns undefined when nothing can supply a frame", () => {
    expect(firstFrameUrl([])).toBeUndefined();
    expect(firstFrameUrl([collection("Empty", [])])).toBeUndefined();
  });
});

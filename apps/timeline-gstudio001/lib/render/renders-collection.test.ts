import { describe, expect, it } from "vitest";

import type { TimelineClip } from "@storyboard/timeline-model/types";

import {
  RENDERS_COLLECTION_NAME,
  findRendersCollectionId,
  renderClipName,
} from "./renders-collection";

function collectionClip(
  title: string,
  childTimelineId: string,
  clipId = childTimelineId,
): TimelineClip {
  return {
    id: clipId,
    index: 0,
    kind: "collection",
    childTimelineId,
    title,
    itemCount: 0,
    previewItems: [],
    alt: `${title} collection`,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
  } as unknown as TimelineClip;
}

function mediaClip(id: string): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: "https://cdn.test/a.png",
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 4,
    sourceDuration: 4,
    trimIn: 0,
    trimOut: 0,
  } as unknown as TimelineClip;
}

describe("findRendersCollectionId", () => {
  it("finds the Renders collection and returns its CHILD timeline id", () => {
    const clips = [mediaClip("a"), collectionClip("Renders", "timeline-renders")];
    expect(findRendersCollectionId(clips)).toBe("timeline-renders");
  });

  it("is null when the project has none", () => {
    expect(findRendersCollectionId([mediaClip("a"), collectionClip("Scene 1", "t1")])).toBeNull();
  });

  it("is null for an empty project", () => {
    expect(findRendersCollectionId([])).toBeNull();
  });

  it("matches case- and whitespace-insensitively, because a human typed it", () => {
    // Creating a second collection over a capital letter would quietly split
    // a project's output in two.
    for (const title of ["renders", "RENDERS", " Renders ", "ReNdErS"]) {
      expect(findRendersCollectionId([collectionClip(title, "t-r")])).toBe("t-r");
    }
  });

  it("does not match a name that merely contains it", () => {
    expect(findRendersCollectionId([collectionClip("Old Renders", "t-r")])).toBeNull();
    expect(findRendersCollectionId([collectionClip("Renders 2024", "t-r")])).toBeNull();
  });

  it("IGNORES a duplicate reference — writing there files renders under another project", () => {
    // clip id != childTimelineId is a reference to a collection owned
    // elsewhere. The first render into it would look fine.
    const clips = [collectionClip("Renders", "timeline-elsewhere", "ref-clip-1")];
    expect(findRendersCollectionId(clips)).toBeNull();
  });

  it("prefers the owning placement when a reference sits beside it", () => {
    const clips = [
      collectionClip("Renders", "timeline-elsewhere", "ref-clip-1"),
      collectionClip("Renders", "timeline-mine"),
    ];
    expect(findRendersCollectionId(clips)).toBe("timeline-mine");
  });

  it("ignores media clips that happen to share the name", () => {
    const named = { ...mediaClip("Renders"), alt: "Renders" } as TimelineClip;
    expect(findRendersCollectionId([named])).toBeNull();
  });

  it("uses the same name it looks for", () => {
    expect(findRendersCollectionId([collectionClip(RENDERS_COLLECTION_NAME, "t-r")])).toBe("t-r");
  });
});

describe("renderClipName", () => {
  it("stamps the cut so a stack of renders is tellable apart", () => {
    expect(renderClipName("Joe", "2026-08-14T23:45:05.123Z")).toBe("Joe — 2026-08-14 23:45");
  });

  it("sorts in the order the cuts were made", () => {
    const names = ["2026-08-14T09:00:00Z", "2026-08-14T23:45:00Z", "2026-08-15T01:00:00Z"].map(
      (iso) => renderClipName("Joe", iso),
    );
    expect([...names].sort()).toEqual(names);
  });

  it("falls back rather than producing a name that starts with a dash", () => {
    expect(renderClipName("   ", "2026-08-14T23:45:05Z")).toBe("Timeline — 2026-08-14 23:45");
  });
});

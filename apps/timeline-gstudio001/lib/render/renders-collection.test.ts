import { describe, expect, it } from "vitest";

import type { TimelineClip } from "@storyboard/timeline-model/types";

import {
  RENDERS_COLLECTION_NAME,
  RENDERS_COLLECTION_ROLE,
  findRendersCollection,
  findRendersCollectionId,
  renderClipName,
} from "./renders-collection";

function collectionClip(
  title: string,
  childTimelineId: string,
  clipId = childTimelineId,
  role?: "renders",
): TimelineClip {
  return {
    id: clipId,
    index: 0,
    kind: "collection",
    childTimelineId,
    title,
    ...(role === undefined ? {} : { role }),
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

describe("findRendersCollection — the role marker", () => {
  it("finds a marked collection whatever it is called", () => {
    // THE BUG THIS CLOSES. Renaming the collection used to send the next
    // render into a newly created "Renders" beside it, splitting the output.
    const clips = [collectionClip("Final cuts", "timeline-renders", "timeline-renders", "renders")];
    expect(findRendersCollection(clips)).toEqual({
      id: "timeline-renders",
      matchedBy: "role",
    });
  });

  it("reports a title match as one, so the caller knows to stamp it", () => {
    expect(findRendersCollection([collectionClip("Renders", "t-r")])).toEqual({
      id: "t-r",
      matchedBy: "title",
    });
  });

  it("prefers the MARKED collection over one merely named Renders", () => {
    // The other half of the bug: naming any top-level collection "Renders"
    // used to capture the project's output. Order matters here — the impostor
    // is first, so a single pass that took the first match would fail.
    const clips = [
      collectionClip("Renders", "timeline-impostor"),
      collectionClip("Final cuts", "timeline-real", "timeline-real", "renders"),
    ];
    expect(findRendersCollection(clips)?.id).toBe("timeline-real");
  });

  it("ignores a marker on a duplicate REFERENCE, like the title pass does", () => {
    // clip id != childTimelineId: writing here files renders under a timeline
    // this project does not own. A role does not buy past that.
    const clips = [
      collectionClip("Renders", "timeline-elsewhere", "ref-clip-1", "renders"),
    ];
    expect(findRendersCollection(clips)).toBeNull();
  });

  it("falls back to the title for every project that predates the marker", () => {
    expect(findRendersCollectionId([collectionClip("Renders", "t-r")])).toBe("t-r");
  });

  it("looks for the role the app stamps", () => {
    const clips = [collectionClip("anything", "t-r", "t-r", RENDERS_COLLECTION_ROLE)];
    expect(findRendersCollection(clips)?.matchedBy).toBe("role");
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

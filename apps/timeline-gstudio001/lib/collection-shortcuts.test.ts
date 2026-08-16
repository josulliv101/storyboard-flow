import { describe, expect, it } from "vitest";

import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";

import { collectionShortcuts } from "./collection-shortcuts";

const base = {
  index: 0,
  alt: "",
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  duration: 4,
  sourceDuration: 4,
  trimIn: 0,
  trimOut: 0,
} as const;

const collection = (over: Record<string, unknown> = {}): TimelineClip =>
  ({
    ...base,
    kind: "collection",
    id: "scenes",
    title: "Scenes",
    childTimelineId: "scenes",
    itemCount: 3,
    ...over,
  }) as TimelineClip;

const media = (over: Record<string, unknown> = {}): TimelineClip =>
  ({ ...base, kind: "video", id: "shot", src: "https://cdn.test/a.mp4", ...over }) as TimelineClip;

const doc = (clips: TimelineClip[]): TimelineDocument =>
  ({ id: "project", title: "Project", clips }) as TimelineDocument;

describe("collectionShortcuts", () => {
  it("takes the collections in board order and leaves media alone", () => {
    const result = collectionShortcuts(
      doc([
        media({ id: "loose" }),
        collection({ id: "a", title: "Scenes" }),
        collection({ id: "b", title: "Locations" }),
      ]),
    );
    expect(result.map((s) => [s.nodeId, s.title])).toEqual([
      ["a", "Scenes"],
      ["b", "Locations"],
    ]);
  });

  it("navigates by the CLIP id, not the child timeline id", () => {
    // `openTimeline` resolves `duplicateOfTimelineId ?? id`, so the clip id is
    // what opens the placement that was clicked. The two are equal for an
    // ordinary collection, which is why taking the wrong one would look right
    // until someone duplicated a collection.
    const result = collectionShortcuts(
      doc([collection({ id: "placement-2", childTimelineId: "scenes" })]),
    );
    expect(result[0]!.nodeId).toBe("placement-2");
  });

  it("prefers a preview's POSTER over its src", () => {
    // A video's src is the whole file. Pointing an <img> at it downloads a clip
    // to show one frame, once per collection in the project.
    const result = collectionShortcuts(
      doc([
        collection({
          previewItems: [
            { id: "p", kind: "video", src: "https://cdn.test/big.mp4", poster: "https://cdn.test/p.jpg", alt: "Shot one" },
          ],
        }),
      ]),
    );
    expect(result[0]!.thumbnail).toBe("https://cdn.test/p.jpg");
    expect(result[0]!.thumbnailAlt).toBe("Shot one");
  });

  it("falls back to src when a preview carries no poster", () => {
    const result = collectionShortcuts(
      doc([
        collection({
          previewItems: [{ id: "p", kind: "image", src: "https://cdn.test/a.png", alt: "A" }],
        }),
      ]),
    );
    expect(result[0]!.thumbnail).toBe("https://cdn.test/a.png");
  });

  it("takes the FIRST preview, not the first pretty one", () => {
    // The previews are already in the collection's own order. Skipping one to
    // find a better frame would make the rail disagree with the card about
    // which shot opens the collection.
    const result = collectionShortcuts(
      doc([
        collection({
          previewItems: [
            { id: "1", kind: "image", src: "https://cdn.test/first.png", alt: "first" },
            { id: "2", kind: "image", src: "https://cdn.test/second.png", poster: "https://cdn.test/second.jpg", alt: "second" },
          ],
        }),
      ]),
    );
    expect(result[0]!.thumbnail).toBe("https://cdn.test/first.png");
  });

  it("reports NO thumbnail for a collection with nothing in it yet", () => {
    // Not an empty string — the caller draws a stand-in, and `src=""` would
    // make the browser re-request the page as an image.
    const empty = collectionShortcuts(doc([collection({ itemCount: 0, previewItems: [] })]));
    expect(empty[0]!.thumbnail).toBeUndefined();
    const absent = collectionShortcuts(doc([collection({ itemCount: 0 })]));
    expect(absent[0]!.thumbnail).toBeUndefined();
  });

  it("ignores a preview whose src is an empty string", () => {
    const result = collectionShortcuts(
      doc([collection({ previewItems: [{ id: "p", kind: "image", src: "", alt: "" }] })]),
    );
    expect(result[0]!.thumbnail).toBeUndefined();
  });

  it("always yields a title, so no button is nameless", () => {
    // A nameless button cannot be reached by voice and reads as blank in the
    // expanded rail.
    expect(collectionShortcuts(doc([collection({ title: "" })]))[0]!.title).toBe(
      "Untitled collection",
    );
    expect(
      collectionShortcuts(doc([collection({ title: "", alt: "Joe collection" })]))[0]!.title,
    ).toBe("Joe collection");
  });

  // THE NEW-PROJECT CASE, which decides whether a separator is drawn at all.
  // A rule with nothing under it reads as something that failed to load.
  it.each([
    ["a project with only media", doc([media()])],
    ["an empty project", doc([])],
    ["a document that has not loaded", undefined],
    ["a document with no clips array", { id: "p", title: "P" } as TimelineDocument],
  ])("returns nothing for %s", (_name, input) => {
    expect(collectionShortcuts(input)).toEqual([]);
  });
});

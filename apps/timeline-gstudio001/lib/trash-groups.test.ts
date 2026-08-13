import { describe, expect, it } from "vitest";

import type { TimelineClip } from "@storyboard/timeline-model/types";

import {
  groupTrashClips,
  isUntouchedEmptyCollection,
  visibleTrashClips,
} from "./trash-groups";
import { at } from "../lib/test-support/at";

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

const CLOUDINARY = { providerId: "cloudinary", assetId: "gstudio/u/pic-1" };

describe("groupTrashClips", () => {
  it("groups by sourceAsset, even when the ids differ", () => {
    // The real case: a duplicated clip gets a fresh id but keeps the
    // provenance of the file it points at.
    const groups = groupTrashClips([
      image("a", { sourceAsset: CLOUDINARY }),
      image("b", { sourceAsset: CLOUDINARY }),
    ]);
    expect(groups).toHaveLength(1);
    expect(at(groups, 0).clips.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("falls back to src for clips minted before provenance was tracked", () => {
    const groups = groupTrashClips([
      image("old-1", { src: "https://cdn.test/same.jpg" }),
      image("old-2", { src: "https://cdn.test/same.jpg" }),
      image("other", { src: "https://cdn.test/different.jpg" }),
    ]);
    expect(groups.map((g) => g.clips.length)).toEqual([2, 1]);
  });

  it("does NOT group two clips that merely lack a src", () => {
    // A collection has no src. Grouping on its absence would collapse every
    // unrelated collection in the bin into one row.
    const groups = groupTrashClips([
      { ...image("col-1"), kind: "collection", src: undefined } as unknown as TimelineClip,
      { ...image("col-2"), kind: "collection", src: undefined } as unknown as TimelineClip,
    ]);
    expect(groups).toHaveLength(2);
  });

  it("prefers sourceAsset over src, so a re-hosted file still groups", () => {
    const groups = groupTrashClips([
      image("a", { sourceAsset: CLOUDINARY, src: "https://cdn.test/v1.jpg" }),
      image("b", { sourceAsset: CLOUDINARY, src: "https://cdn.test/v2.jpg" }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("keeps first-appearance order, so the bin still reads chronologically", () => {
    const groups = groupTrashClips([
      image("first", { src: "https://cdn.test/1.jpg" }),
      image("second", { src: "https://cdn.test/2.jpg" }),
      image("first-again", { src: "https://cdn.test/1.jpg" }),
    ]);
    expect(groups.map((g) => at(g.clips, 0).id)).toEqual(["first", "second"]);
    expect(at(groups, 0).clips).toHaveLength(2);
  });

  it("keeps EVERY copy in the group — restoring the row restores them all", () => {
    // The grouping is display-only. Dropping the extras here would be the
    // data loss that deduplicating the document would be.
    const groups = groupTrashClips([
      image("a", { sourceAsset: CLOUDINARY }),
      image("b", { sourceAsset: CLOUDINARY }),
      image("c", { sourceAsset: CLOUDINARY }),
    ]);
    expect(at(groups, 0).clips.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves a single clip as a group of one, and an empty bin as nothing", () => {
    expect(at(groupTrashClips([image("solo")]), 0).clips).toHaveLength(1);
    expect(groupTrashClips([])).toEqual([]);
  });
});

function collection(
  id: string,
  overrides: Partial<TimelineClip> = {},
): TimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title: "New Timeline",
    childTimelineId: `${id}-doc`,
    itemCount: 0,
    trackIndex: 0,
    startTime: 0,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
    ...overrides,
  } as TimelineClip;
}

describe("visibleTrashClips", () => {
  // PL14-008. The bin exists to give WORK back, and an untouched empty
  // collection is not work — it is what a mis-clicked Collection tool leaves
  // behind. Hidden from the drawer only: the node is still trashed, undo still
  // restores it, emptying still takes it.

  it("hides a collection that is empty AND still has its minted name", () => {
    expect(visibleTrashClips([collection("shell")])).toEqual([]);
    expect(isUntouchedEmptyCollection(collection("shell"))).toBe(true);
  });

  it("SHOWS an empty collection that was renamed — the name is the work", () => {
    const named = collection("named", { title: "Act One" });
    expect(visibleTrashClips([named])).toHaveLength(1);
    expect(isUntouchedEmptyCollection(named)).toBe(false);
  });

  it("SHOWS a collection that held content, which travels into the bin with it", () => {
    const full = collection("full", { itemCount: 2 });
    expect(visibleTrashClips([full])).toHaveLength(1);
    expect(isUntouchedEmptyCollection(full)).toBe(false);
  });

  it("never hides media, however empty it looks", () => {
    expect(isUntouchedEmptyCollection(image("pic"))).toBe(false);
    expect(visibleTrashClips([image("pic")])).toHaveLength(1);
  });

  it("keeps the rest of the bin in order when it drops a shell from the middle", () => {
    const visible = visibleTrashClips([
      image("a"),
      collection("shell"),
      image("b"),
    ]);
    expect(visible.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("treats a whitespace-padded minted title as untouched", () => {
    // The seeded title round-trips through a document; a stray space is not a
    // rename.
    expect(isUntouchedEmptyCollection(collection("s", { title: "  New Timeline " }))).toBe(true);
  });
});

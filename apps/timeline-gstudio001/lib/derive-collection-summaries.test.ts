import { describe, expect, it } from "vitest";

import type {
  CollectionTimelineClip,
  TimelineClip,
  TimelineDocument,
} from "@storyboard/timeline-model/types";

import {
  collectionChildIds,
  deriveClosureSummaries,
  deriveCollectionSummaries,
} from "./derive-collection-summaries";

function mediaClip(
  id: string,
  { startTime = 0, duration = 4 }: { startTime?: number; duration?: number } = {},
): TimelineClip {
  return {
    id,
    index: 0,
    kind: "image",
    src: `https://cdn.test/${id}.jpg`,
    alt: id,
    aspect: 16 / 9,
    trackIndex: 0,
    startTime,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  };
}

function collectionClip(
  id: string,
  childTimelineId: string,
  overrides: Partial<CollectionTimelineClip> = {},
): CollectionTimelineClip {
  return {
    id,
    index: 0,
    kind: "collection",
    title: "Stored Title",
    childTimelineId,
    itemCount: 0,
    alt: "Stored Title collection",
    aspect: 16 / 9,
    trackIndex: 0,
    startTime: 0,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
    ...overrides,
  };
}

function docOf(id: string, clips: TimelineClip[], title = `Timeline ${id}`): TimelineDocument {
  return { id, title, clips };
}

describe("deriveCollectionSummaries", () => {
  it("derives title, itemCount, previewItems, and duration from the loaded child", () => {
    const child = docOf(
      "child-1",
      [mediaClip("m1", { startTime: 0, duration: 4 }), mediaClip("m2", { startTime: 5, duration: 6 })],
      "Fresh Child Title",
    );
    const parent = docOf("parent", [collectionClip("col", "child-1")]);

    const { document, changed } = deriveCollectionSummaries(
      parent,
      new Map([["child-1", child]]),
    );

    expect(changed).toBe(true);
    const summary = document.clips[0] as CollectionTimelineClip;
    expect(summary.title).toBe("Fresh Child Title");
    expect(summary.alt).toBe("Fresh Child Title collection");
    expect(summary.itemCount).toBe(2);
    // last.startTime + last.duration + leading padding (0)
    expect(summary.duration).toBe(11);
    expect(summary.sourceDuration).toBe(11);
    expect(summary.previewItems).toEqual([
      { id: "m1", kind: "image", src: "https://cdn.test/m1.jpg", poster: undefined, alt: "m1" },
      { id: "m2", kind: "image", src: "https://cdn.test/m2.jpg", poster: undefined, alt: "m2" },
    ]);
  });

  it("uses first/middle/last media when the child holds more than three clips", () => {
    const child = docOf("child-1", [
      mediaClip("m1"),
      mediaClip("m2"),
      mediaClip("m3"),
      mediaClip("m4"),
      mediaClip("m5"),
    ]);
    const parent = docOf("parent", [collectionClip("col", "child-1")]);

    const { document } = deriveCollectionSummaries(parent, new Map([["child-1", child]]));
    const summary = document.clips[0] as CollectionTimelineClip;
    expect(summary.previewItems?.map((item) => item.id)).toEqual(["m1", "m3", "m5"]);
  });

  it("summarizes an empty child as duration 3 with no preview items", () => {
    const child = docOf("child-1", []);
    const parent = docOf("parent", [
      collectionClip("col", "child-1", { itemCount: 5, duration: 20, sourceDuration: 20 }),
    ]);

    const { document, changed } = deriveCollectionSummaries(parent, new Map([["child-1", child]]));
    expect(changed).toBe(true);
    const summary = document.clips[0] as CollectionTimelineClip;
    expect(summary.itemCount).toBe(0);
    expect(summary.duration).toBe(3);
    expect(summary.previewItems).toEqual([]);
  });

  it("keeps the stored title when the child's title is empty", () => {
    const child = docOf("child-1", [], "");
    const parent = docOf("parent", [collectionClip("col", "child-1", { itemCount: 1 })]);

    const { document } = deriveCollectionSummaries(parent, new Map([["child-1", child]]));
    expect((document.clips[0] as CollectionTimelineClip).title).toBe("Stored Title");
  });

  it("returns the same document unchanged when every summary is already in sync", () => {
    const child = docOf("child-1", [mediaClip("m1", { startTime: 0, duration: 5 })], "Synced");
    const parent = docOf("parent", [
      collectionClip("col", "child-1", {
        title: "Synced",
        itemCount: 1,
        duration: 5,
        sourceDuration: 5,
        previewItems: [
          { id: "m1", kind: "image", src: "https://cdn.test/m1.jpg", poster: undefined, alt: "m1" },
        ],
      }),
    ]);

    const result = deriveCollectionSummaries(parent, new Map([["child-1", child]]));
    expect(result.changed).toBe(false);
    expect(result.document).toBe(parent);
  });

  it("leaves the stored summary for missing or unloadable children — stale beats blank", () => {
    const parent = docOf("parent", [
      collectionClip("col-a", "child-absent", { itemCount: 4, duration: 12, sourceDuration: 12 }),
      collectionClip("col-b", "child-null", { itemCount: 2, duration: 7, sourceDuration: 7 }),
    ]);

    const result = deriveCollectionSummaries(parent, new Map([["child-null", null]]));
    expect(result.changed).toBe(false);
    expect(result.document).toBe(parent);
  });

  it("repacks the document when a derived duration moves the following clips", () => {
    const child = docOf("child-1", [mediaClip("m1", { startTime: 0, duration: 11 })], "Grown");
    const parent = docOf("parent", [
      collectionClip("col", "child-1", { startTime: 0, duration: 3, sourceDuration: 3 }),
      mediaClip("after", { startTime: 3.12, duration: 4 }),
    ]);

    const { document, changed } = deriveCollectionSummaries(parent, new Map([["child-1", child]]));
    expect(changed).toBe(true);
    expect(document.clips[0].duration).toBe(11);
    expect(document.clips[0].startTime).toBe(0);
    // duration + CLIP_GAP_SECONDS
    expect(document.clips[1].startTime).toBeCloseTo(11.12, 10);
    expect(document.clips.map((entry) => entry.index)).toEqual([0, 1]);
  });
});

describe("deriveClosureSummaries", () => {
  const closureOf = (...docs: TimelineDocument[]) =>
    Object.fromEntries(docs.map((doc) => [doc.id, doc]));

  it("propagates a deep child's growth up EVERY level in one pass", () => {
    // The case one-level derivation cannot reach: "grandchild" grew, so
    // "child"'s stored summary of it is short, so "root"'s summary of
    // "child" — derived from that stored child — is short too.
    const grandchild = docOf("grandchild", [mediaClip("g1", { startTime: 0, duration: 10 })]);
    const child = docOf("child", [
      collectionClip("gc-ref", "grandchild", { duration: 4, sourceDuration: 4 }),
    ]);
    const root = docOf("root", [collectionClip("c-ref", "child", { duration: 4, sourceDuration: 4 })]);

    const closure = deriveClosureSummaries(closureOf(root, child, grandchild));

    expect(closure.child.clips[0].duration).toBe(10);
    expect(closure.root.clips[0].duration).toBe(10);
  });

  it("keeps the stored summary for ids the loader could not resolve", () => {
    // The closure loader substitutes an unloadable branch with an EMPTY
    // document so it falls silent; deriving from that would overwrite a real
    // stored summary with "empty collection".
    const ghost = docOf("ghost", [], "");
    const root = docOf("root", [
      collectionClip("ghost-ref", "ghost", { itemCount: 6, duration: 18, sourceDuration: 18 }),
    ]);

    const closure = deriveClosureSummaries(closureOf(root, ghost), new Set(["ghost"]));

    const summary = closure.root.clips[0] as CollectionTimelineClip;
    expect(summary.duration).toBe(18);
    expect(summary.itemCount).toBe(6);
    expect(closure.root).toBe(root);
  });

  it("resolves a reference cycle to the stored documents instead of looping", () => {
    const a = docOf("a", [collectionClip("to-b", "b")]);
    const b = docOf("b", [collectionClip("to-a", "a")]);

    const closure = deriveClosureSummaries(closureOf(a, b));

    expect(Object.keys(closure).sort()).toEqual(["a", "b"]);
  });

  it("leaves a closure whose summaries are already in sync untouched", () => {
    const child = docOf("child", [mediaClip("m1", { startTime: 0, duration: 5 })], "Synced");
    const root = docOf("root", [
      collectionClip("c-ref", "child", {
        title: "Synced",
        itemCount: 1,
        duration: 5,
        sourceDuration: 5,
        previewItems: [
          { id: "m1", kind: "image", src: "https://cdn.test/m1.jpg", poster: undefined, alt: "m1" },
        ],
      }),
    ]);

    const closure = deriveClosureSummaries(closureOf(root, child));

    expect(closure.root).toBe(root);
    expect(closure.child).toBe(child);
  });
});

describe("collectionChildIds", () => {
  it("collects unique child ids from collection clips only", () => {
    const parent = docOf("parent", [
      collectionClip("col-a", "child-1"),
      mediaClip("m1"),
      collectionClip("col-b", "child-2"),
      collectionClip("col-c", "child-1"),
    ]);

    expect(collectionChildIds(parent)).toEqual(["child-1", "child-2"]);
  });
});

describe("disabled clips split geometry from the readouts", () => {
  it("keeps a disabled child in `duration` but out of the readouts", () => {
    const child = docOf("child-1", [
      mediaClip("keep", { startTime: 0, duration: 4 }),
      { ...mediaClip("skip", { startTime: 4.12, duration: 6 }), disabled: true },
    ]);
    const parent = docOf("parent", [collectionClip("col", "child-1")]);

    const { document } = deriveCollectionSummaries(parent, new Map([["child-1", child]]));
    const col = document.clips[0] as CollectionTimelineClip;

    // LAYOUT: the full 4 + gap + 6 span. The collection's slot has to cover
    // its disabled child, or the manifest's window math would squeeze the
    // child's real content into a shorter parent span and play it fast.
    expect(col.duration).toBeCloseTo(10.12, 6);
    // READOUTS: what a viewer would actually see.
    expect(col.playableDuration).toBeCloseTo(4, 6);
    expect(col.itemCount).toBe(1);
    expect(col.previewItems?.map((item) => item.id)).toEqual(["keep"]);
  });

  it("propagates a DEEP disable up every ancestor in one bottom-up pass", () => {
    // This is the property that makes descendants free: nothing here walks
    // upward or maintains a reverse index — deriveClosureSummaries resolves
    // children first, so a change three levels down is already reflected in
    // the summary its parent derives from.
    const documents = {
      root: docOf("root", [collectionClip("mid-ref", "mid")]),
      mid: docOf("mid", [collectionClip("leaf-ref", "leaf")]),
      leaf: docOf("leaf", [
        mediaClip("a", { startTime: 0, duration: 4 }),
        { ...mediaClip("b", { startTime: 4.12, duration: 4 }), disabled: true },
      ]),
    };

    const derived = deriveClosureSummaries(documents);

    const leafSummary = derived.mid.clips[0] as CollectionTimelineClip;
    expect(leafSummary.itemCount).toBe(1);
    expect(leafSummary.duration).toBeCloseTo(8.12, 6);
    expect(leafSummary.playableDuration).toBeCloseTo(4, 6);

    // The grandparent's PLAYABLE time shrank too, without knowing why — while
    // its layout span still covers everything below it. This is the assertion
    // that pins the propagation THROUGH a collection child: mid's playable
    // time has to read leaf-ref's playableDuration (4), not its layout
    // duration (8.12), or a deep disable would stop one level up.
    const midSummary = derived.root.clips[0] as CollectionTimelineClip;
    expect(midSummary.itemCount).toBe(1);
    expect(midSummary.playableDuration).toBeCloseTo(4, 6);
    expect(midSummary.duration).toBeCloseTo(8.12, 6);
  });

  it("omits playableDuration entirely when nothing is disabled", () => {
    // The field must not appear on documents that never use the feature —
    // same convention as `disabled` itself.
    const child = docOf("child-1", [mediaClip("a", { startTime: 0, duration: 4 })]);
    const parent = docOf("parent", [collectionClip("col", "child-1")]);

    const { document } = deriveCollectionSummaries(parent, new Map([["child-1", child]]));
    const col = document.clips[0] as CollectionTimelineClip;

    expect("playableDuration" in col).toBe(false);
  });

  it("clears a stale playableDuration once the child is re-enabled", () => {
    // The derivation spreads the previous clip, so re-enabling must DELETE the
    // key rather than leave the old playable time sitting there.
    const child = docOf("child-1", [mediaClip("a", { startTime: 0, duration: 4 })]);
    const parent = docOf("parent", [
      { ...collectionClip("col", "child-1"), playableDuration: 2 },
    ]);

    const { document } = deriveCollectionSummaries(parent, new Map([["child-1", child]]));
    const col = document.clips[0] as CollectionTimelineClip;

    expect(col.playableDuration).toBeUndefined();
  });

  it("gives an all-disabled collection the same PLAYABLE time as an empty one", () => {
    // Deliberate: all-disabled and empty are the same thing to a reader. Their
    // layout spans differ, though — the all-disabled one still has a child
    // occupying room on the board.
    const child = docOf("child-1", [
      { ...mediaClip("x", { duration: 4 }), disabled: true },
    ]);
    const parent = docOf("parent", [collectionClip("col", "child-1")]);
    const empty = docOf("child-2", []);
    const parent2 = docOf("parent", [collectionClip("col", "child-2")]);

    const allDisabled = deriveCollectionSummaries(parent, new Map([["child-1", child]]));
    const isEmpty = deriveCollectionSummaries(parent2, new Map([["child-2", empty]]));

    const a = allDisabled.document.clips[0] as CollectionTimelineClip;
    const b = isEmpty.document.clips[0] as CollectionTimelineClip;
    expect(a.itemCount).toBe(b.itemCount);
    expect(a.playableDuration ?? a.duration).toBe(b.duration);
    expect(a.duration).toBeGreaterThan(b.duration);
  });

  it("keeps the PARENT's own disabled clip in place", () => {
    // Summaries are derived from the child; the parent's own clip list is
    // only repacked. A disabled clip in the parent keeps its slot — the board
    // still shows it — so it must survive this pass.
    const parent = docOf("parent", [
      { ...mediaClip("off", { duration: 4 }), disabled: true },
      collectionClip("col", "child-1", { startTime: 4.12 }),
    ]);
    const child = docOf("child-1", [mediaClip("m", { duration: 5 })]);

    const { document } = deriveCollectionSummaries(parent, new Map([["child-1", child]]));

    expect(document.clips.map((clip) => clip.id)).toEqual(["off", "col"]);
    expect(document.clips[0].disabled).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { buildGraph, type GraphNodeSpec } from "@storyboard/collections-core";
import type { PlaybackLeaf, PlaybackManifest } from "@storyboard/timeline-domain";

import {
  buildPlayheadMap,
  cardSpansOf,
  childSpans,
  manifestTrailsLedger,
  mediaSpanKey,
  nextManifestClipsState,
  type PreviewCardSpans,
} from "./graph-playhead-model";

const media = (id: string, durationSeconds: number): GraphNodeSpec => ({
  kind: "media",
  id,
  name: id,
  durationSeconds,
});

const collection = (
  id: string,
  children: readonly GraphNodeSpec[] = [],
): GraphNodeSpec => ({ kind: "collection", id, name: id, children });

function graphOf(roots: readonly GraphNodeSpec[]) {
  const result = buildGraph(roots);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

function leaf(
  id: string,
  collectionPath: readonly string[],
  timelineStart: number,
  timelineDuration: number,
): PlaybackLeaf {
  return {
    id,
    collectionPath,
    kind: "image",
    src: `https://cdn.test/${id}.jpg`,
    timelineStart,
    timelineDuration,
    sourceStart: 0,
    playbackRate: 1,
  };
}

function manifestOf(leaves: readonly PlaybackLeaf[]): PlaybackManifest {
  const last = leaves[leaves.length - 1];
  return {
    projectId: "root",
    projectRevision: 1,
    durationSeconds: last ? last.timelineStart + last.timelineDuration : 0,
    leaves,
    compiledAt: "2026-07-20T00:00:00.000Z",
  };
}

const flatWidth = () => 100;

describe("childSpans", () => {
  // The regression this clamp exists for: a span-less card (an empty
  // collection contributes no manifest leaves) speaks the PROJECTION clock
  // while its manifest-timed neighbours speak the pane's. The projection
  // packs A(4s) then E at 4.12 ending 7.12 — but the manifest, whose clock
  // runs behind, starts B at 4.62. Unclamped, the card times read
  // [0,4, 4.12,7.12, 4.62,8.62]: NOT sorted, and the map's binary search
  // silently interpolates garbage.
  it("clamps a projection-timed card monotonic against manifest-timed neighbours", () => {
    const graph = graphOf([
      collection("root", [media("a", 4), collection("e"), media("b", 4)]),
    ]);
    const spans: PreviewCardSpans = new Map([
      [mediaSpanKey("root", "a"), { start: 0, end: 4 }],
      [mediaSpanKey("root", "b"), { start: 4.62, end: 8.62 }],
    ]);

    const cards = childSpans(graph, {}, "root", spans, flatWidth);

    expect(cards.map((card) => [card.startTime, card.endTime])).toEqual([
      [0, 4],
      [4.12, 7.12], // E: projection times, already past A's end
      [7.12, 8.62], // B: manifest start 4.62 raised to E's end
    ]);
    // The invariant the map's binary search requires.
    const times = cards.flatMap((card) => [card.startTime, card.endTime]);
    expect([...times].sort((left, right) => left - right)).toEqual(times);
  });

  it("passes manifest spans through untouched when they are already ordered", () => {
    const graph = graphOf([collection("root", [media("a", 4), media("b", 4)])]);
    const spans: PreviewCardSpans = new Map([
      [mediaSpanKey("root", "a"), { start: 0, end: 3.9 }],
      [mediaSpanKey("root", "b"), { start: 3.95, end: 7.9 }],
    ]);

    const cards = childSpans(graph, {}, "root", spans, flatWidth);

    expect(cards.map((card) => [card.startTime, card.endTime])).toEqual([
      [0, 3.9],
      [3.95, 7.9],
    ]);
  });

  it("yields a monotonic x mapping across the mixed-clock seam", () => {
    const graph = graphOf([
      collection("root", [media("a", 4), collection("e"), media("b", 4)]),
    ]);
    const spans: PreviewCardSpans = new Map([
      [mediaSpanKey("root", "a"), { start: 0, end: 4 }],
      [mediaSpanKey("root", "b"), { start: 4.62, end: 8.62 }],
    ]);
    const map = buildPlayheadMap(childSpans(graph, {}, "root", spans, flatWidth));

    let previousX = -Infinity;
    for (let time = 0; time <= map.totalDurationSeconds; time += 0.25) {
      const x = map.xAt(time);
      expect(x).toBeGreaterThanOrEqual(previousX);
      previousX = x;
    }
  });
});

describe("cardSpansOf", () => {
  it("keys each leaf under its parent and folds it into every collection on its path", () => {
    const spans = cardSpansOf(
      manifestOf([
        leaf("m1", ["root", "sceneA"], 0, 4),
        leaf("m2", ["root", "sceneA"], 4.12, 3),
        leaf("m3", ["root"], 7.24, 5),
      ]),
    );

    expect(spans.get(mediaSpanKey("sceneA", "m1"))).toEqual({ start: 0, end: 4 });
    expect(spans.get("sceneA")).toEqual({ start: 0, end: 7.12 });
    expect(spans.get("root")).toEqual({ start: 0, end: 12.24 });
    expect(spans.get(mediaSpanKey("root", "m3"))).toEqual({ start: 7.24, end: 12.24 });
  });

  // Leaf ids repeat across documents (one clip referenced from two
  // collections). A flat id key merged both occurrences into one span
  // covering both, so either row's card mapped time across the union window.
  it("keeps a duplicated leaf id distinct per parent collection", () => {
    const graph = graphOf([
      collection("root", [
        collection("sceneA", [media("shared", 4)]),
        collection("sceneB", []),
      ]),
    ]);
    const spans = cardSpansOf(
      manifestOf([
        leaf("shared", ["root", "sceneA"], 0, 4),
        leaf("shared", ["root", "sceneB"], 10, 4),
      ]),
    );

    // sceneA's card gets ITS occurrence's window, not the 0..14 union.
    const cards = childSpans(graph, {}, "sceneA", spans, flatWidth);
    expect(cards.map((card) => [card.startTime, card.endTime])).toEqual([[0, 4]]);
  });
});

describe("manifestTrailsLedger", () => {
  const revisionOf = (ledger: Record<string, number>) => (id: string) => ledger[id];

  it("flags a manifest whose CHILD compile predates the session's write", () => {
    // The root's revision is current — only per-document checking catches it.
    const manifest = { projectRevision: 5, documentRevisions: { root: 5, kid: 2 } };
    expect(manifestTrailsLedger(manifest, "root", revisionOf({ root: 5, kid: 3 }))).toBe(true);
  });

  it("accepts a manifest at or ahead of every known revision", () => {
    const manifest = { projectRevision: 5, documentRevisions: { root: 5, kid: 3 } };
    expect(manifestTrailsLedger(manifest, "root", revisionOf({ root: 5, kid: 3 }))).toBe(false);
    expect(manifestTrailsLedger(manifest, "root", revisionOf({}))).toBe(false);
  });

  it("falls back to the root-only check when documentRevisions is absent", () => {
    expect(manifestTrailsLedger({ projectRevision: 4 }, "root", revisionOf({ root: 5 }))).toBe(true);
    expect(manifestTrailsLedger({ projectRevision: 5 }, "root", revisionOf({ root: 5 }))).toBe(false);
  });

  // The race the revision comparison alone cannot see: a write still in the
  // debounce window (or in a batch whose response hasn't landed) has not
  // bumped the ledger, so a manifest compiled server-side BEFORE the write
  // carries revisions that look current. A pending write on any document the
  // compile read must veto the install until the write settles.
  it("rejects a revision-current manifest while a read-set document has a pending write", () => {
    const manifest = { projectRevision: 5, documentRevisions: { root: 5, kid: 3 } };
    const ledger = revisionOf({ root: 5, kid: 3 });
    expect(manifestTrailsLedger(manifest, "root", ledger, (id) => id === "kid")).toBe(true);
    expect(manifestTrailsLedger(manifest, "root", ledger, () => false)).toBe(false);
  });

  it("waits on a pending ROOT write even without documentRevisions", () => {
    const manifest = { projectRevision: 5 };
    expect(manifestTrailsLedger(manifest, "root", revisionOf({ root: 5 }), (id) => id === "root")).toBe(true);
  });
});

describe("nextManifestClipsState", () => {
  const cached = { forId: "timeline-1" };

  it("keeps the cached manifest while preview stays enabled", () => {
    expect(nextManifestClipsState(cached, true)).toBe(cached);
  });

  // The regression this guards: an edit made while preview is CLOSED never
  // clears `state` (the commit-driven discard effect only subscribes while
  // enabled), so re-enabling used to hand back a manifest compiled before
  // that edit. Disabling must drop the cache so re-enabling always starts
  // from the live projection.
  it("drops the cached manifest the instant preview disables", () => {
    expect(nextManifestClipsState(cached, false)).toBeNull();
  });

  it("is a no-op on an already-empty cache either way", () => {
    expect(nextManifestClipsState(null, true)).toBeNull();
    expect(nextManifestClipsState(null, false)).toBeNull();
  });
});

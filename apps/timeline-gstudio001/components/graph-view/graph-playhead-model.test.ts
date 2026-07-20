import { describe, expect, it } from "vitest";

import { buildGraph, type GraphNodeSpec } from "@storyboard/collections-core";
import type { PlaybackLeaf, PlaybackManifest } from "@storyboard/timeline-domain";

import {
  buildPlayheadMap,
  cardSpansOf,
  childSpans,
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
      ["a", { start: 0, end: 4 }],
      ["b", { start: 4.62, end: 8.62 }],
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
      ["a", { start: 0, end: 3.9 }],
      ["b", { start: 3.95, end: 7.9 }],
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
      ["a", { start: 0, end: 4 }],
      ["b", { start: 4.62, end: 8.62 }],
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
  it("keys each leaf by id and folds it into every collection on its path", () => {
    const spans = cardSpansOf(
      manifestOf([
        leaf("m1", ["root", "sceneA"], 0, 4),
        leaf("m2", ["root", "sceneA"], 4.12, 3),
        leaf("m3", ["root"], 7.24, 5),
      ]),
    );

    expect(spans.get("m1")).toEqual({ start: 0, end: 4 });
    expect(spans.get("sceneA")).toEqual({ start: 0, end: 7.12 });
    expect(spans.get("root")).toEqual({ start: 0, end: 12.24 });
    expect(spans.get("m3")).toEqual({ start: 7.24, end: 12.24 });
  });
});

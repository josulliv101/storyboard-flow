import { describe, expect, it } from "vitest";

import { packTimelineClips } from "@storyboard/ui/timeline/timeline-documents";
import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";

import { buildFocusedGraph } from "./adapter";
import { buildGraph, parseNodeId, type CollectionsGraph, type GraphNodeSpec } from "./engine";
import { flattenMediaOrder, resolveFlatDropTarget } from "./flat-order";
import { compilePlaybackManifest } from "./playback-manifest";

const base = {
  index: 0,
  aspect: 16 / 9,
  trackIndex: 0,
  startTime: 0,
  playbackStartTime: undefined,
  playbackDuration: undefined,
} as const;

function image(id: string, duration: number): TimelineClip {
  return {
    ...base,
    id,
    kind: "image",
    alt: `${id} alt`,
    src: `https://example.com/${id}.jpg`,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  };
}

function collectionClip(id: string, childTimelineId: string, title: string): TimelineClip {
  return {
    ...base,
    id,
    kind: "collection",
    title,
    childTimelineId,
    itemCount: 2,
    alt: `${title} collection`,
    duration: 30,
    sourceDuration: 30,
    trimIn: 0,
    trimOut: 0,
  };
}

const media = (id: string, durationSeconds = 4): GraphNodeSpec => ({
  kind: "media",
  id,
  name: id,
  durationSeconds,
});

const collection = (
  id: string,
  children: readonly GraphNodeSpec[] = [],
  extra: Partial<GraphNodeSpec> = {},
): GraphNodeSpec => ({ kind: "collection", id, name: id, children, ...extra });

function graphOf(roots: readonly GraphNodeSpec[]): CollectionsGraph {
  const result = buildGraph(roots);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

const idsOf = (graph: CollectionsGraph, focused: string) =>
  flattenMediaOrder(graph, parseNodeId(focused)).map((item) => String(item.nodeId));

describe("flattenMediaOrder", () => {
  it("emits media depth-first in child order, walking THROUGH collections", () => {
    const graph = graphOf([
      collection("root", [
        media("a"),
        collection("scene", [media("s1"), media("s2")]),
        media("b"),
      ]),
    ]);

    // "scene" itself never appears — a flat run has no collections in it.
    expect(idsOf(graph, "root")).toEqual(["a", "s1", "s2", "b"]);
  });

  it("descends any depth, and each item carries its parent chain", () => {
    const graph = graphOf([
      collection("root", [
        collection("mid", [collection("deep", [media("d1")]), media("m1")]),
      ]),
    ]);

    expect(flattenMediaOrder(graph, parseNodeId("root")).map((item) => ({
      id: String(item.nodeId),
      path: item.collectionPath.map(String),
    }))).toEqual([
      { id: "d1", path: ["mid", "deep"] },
      { id: "m1", path: ["mid"] },
    ]);
  });

  it("gives a direct child of the focused timeline an EMPTY path", () => {
    // Nothing sits between it and the view's root, so there is no collection
    // to name on its card.
    const graph = graphOf([collection("root", [media("a")])]);
    expect(flattenMediaOrder(graph, parseNodeId("root"))[0].collectionPath).toEqual([]);
  });

  it("walks THROUGH a disabled collection rather than skipping it", () => {
    // Disabling changes what plays, not what the timeline contains — the
    // children still show, muted, exactly as on the nested board.
    const graph = graphOf([
      collection("root", [
        collection("off", [media("x"), media("y")], { disabled: true }),
        media("z"),
      ]),
    ]);
    expect(idsOf(graph, "root")).toEqual(["x", "y", "z"]);
  });

  it("flattens from the FOCUSED collection, not the project root", () => {
    const graph = graphOf([
      collection("root", [media("a"), collection("scene", [media("s1")])]),
    ]);
    expect(idsOf(graph, "scene")).toEqual(["s1"]);
  });

  it("is empty for an empty collection", () => {
    expect(idsOf(graphOf([collection("root", [])]), "root")).toEqual([]);
  });

  it("stops at maxDepth instead of recursing forever", () => {
    const graph = graphOf([
      collection("root", [collection("l1", [collection("l2", [media("deep")])])]),
    ]);
    // Depth 1 reaches l1's own media (none) but not l2's.
    expect(flattenMediaOrder(graph, parseNodeId("root"), 1)).toEqual([]);
    expect(flattenMediaOrder(graph, parseNodeId("root"), 2).map((i) => String(i.nodeId))).toEqual([
      "deep",
    ]);
  });
});

describe("manifest parity", () => {
  // The invariant that keeps the flat strip and the preview telling the same
  // story about what comes next.
  function docs(): Record<string, TimelineDocument> {
    return {
      root: {
        id: "root",
        title: "Root",
        clips: packTimelineClips([
          image("a", 4),
          collectionClip("clip-scene", "scene", "Scene"),
          image("b", 4),
        ]),
      },
      scene: {
        id: "scene",
        title: "Scene",
        clips: packTimelineClips([image("s1", 4), image("s2", 4)]),
      },
    };
  }

  it("orders media exactly as the manifest orders its leaves", () => {
    const documents = docs();
    const focused = buildFocusedGraph(documents, "root");
    if (!focused.ok) throw new Error(focused.error);

    const manifest = compilePlaybackManifest(documents, "root", 1, "2026-07-26T00:00:00.000Z");
    const manifestOrder = manifest.leaves.map((leaf) => leaf.id);
    const flatOrder = idsOf(focused.value.graph, "root");

    expect(flatOrder).toEqual(manifestOrder);
    expect(flatOrder).toEqual(["a", "s1", "s2", "b"]);
  });

  it("keeps the manifest a SUBSEQUENCE when a collection is trimmed", () => {
    // The deliberate membership difference: the manifest windows a trimmed
    // collection down to what plays, while the flat strip is an editing
    // surface and must still show what was trimmed away. Order is shared;
    // membership is not — so the manifest's ids must appear in the flat list
    // in the same relative order, not equal it.
    const documents = docs();
    const sceneClip = documents.root.clips.find((clip) => clip.kind === "collection")!;
    // Show only the first half of the scene.
    Object.assign(sceneClip, { sourceDuration: 8, trimIn: 0, trimOut: 4, duration: 4 });

    const focused = buildFocusedGraph(documents, "root");
    if (!focused.ok) throw new Error(focused.error);
    const manifest = compilePlaybackManifest(documents, "root", 1, "2026-07-26T00:00:00.000Z");

    const flatOrder = idsOf(focused.value.graph, "root");
    const manifestOrder = manifest.leaves.map((leaf) => leaf.id);

    // STRICTLY fewer, asserted first: without this the subsequence check
    // below would pass vacuously if the trim never took effect, and the test
    // would prove nothing about the difference it exists to describe.
    expect(manifestOrder).toEqual(["a", "s1", "b"]);
    expect(flatOrder).toEqual(["a", "s1", "s2", "b"]);

    // Subsequence check: walk the flat list once, consuming manifest ids.
    let cursor = 0;
    for (const id of flatOrder) if (id === manifestOrder[cursor]) cursor += 1;
    expect(cursor).toBe(manifestOrder.length);
  });
});

describe("resolveFlatDropTarget", () => {
  const graph = graphOf([
    collection("root", [
      media("a"),
      collection("scene", [media("s1"), media("s2")]),
      media("b"),
    ]),
  ]);
  const items = flattenMediaOrder(graph, parseNodeId("root"));
  const resolve = (boundary: number) => {
    const target = resolveFlatDropTarget(graph, items, parseNodeId("root"), boundary);
    return { parent: String(target.parentId), index: target.index };
  };

  it("sends a drop at the very start to the head of the FOCUSED timeline", () => {
    // No left neighbour to inherit a collection from.
    expect(resolve(0)).toEqual({ parent: "root", index: 0 });
  });

  it("lands in the left neighbour's collection, right after it", () => {
    // Flat order is [a, s1, s2, b]. After s1 — which lives in "scene", not
    // root — the drop belongs to scene at index 1.
    expect(resolve(2)).toEqual({ parent: "scene", index: 1 });
    // After s2, still scene, now at its end.
    expect(resolve(3)).toEqual({ parent: "scene", index: 2 });
  });

  it("uses the FOCUSED timeline when the left neighbour is a direct child", () => {
    expect(resolve(1)).toEqual({ parent: "root", index: 1 });
  });

  it("clamps a boundary past the ends", () => {
    expect(resolve(-5)).toEqual({ parent: "root", index: 0 });
    // Past the last item: after "b", which is root's third child.
    expect(resolve(99)).toEqual({ parent: "root", index: 3 });
  });

  it("appends when the flat list is stale against the graph", () => {
    const stale = [{ nodeId: parseNodeId("ghost"), collectionPath: [parseNodeId("scene")] }];
    const target = resolveFlatDropTarget(graph, stale, parseNodeId("root"), 1);
    expect(String(target.parentId)).toBe("scene");
    expect(target.index).toBe(2);
  });
});

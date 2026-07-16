import { describe, expect, it } from "vitest";

import {
  createInitialTimelineDocuments,
  packTimelineClips,
} from "@storyboard/ui/timeline/timeline-documents";
import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";

import {
  buildFocusedGraph,
  buildHydrationSpecs,
  collectAffectedCollectionIds,
  graphChildrenToClips,
} from "./adapter";
import {
  findGraphInvariantViolation,
  getChildren,
  hydrateCollection,
  parseNodeId,
} from "./engine";

// The adapter is the storage/hydration seam of the graph architecture: real
// TimelineDocuments in, a valid focused graph + side-table out, and clips
// back with packing parity. These tests run it against hand fixtures AND the
// app's actual initial documents.

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
    poster: `https://example.com/${id}-poster.jpg`,
    duration,
    sourceDuration: duration,
    trimIn: 0,
    trimOut: 0,
  };
}

function video(id: string, sourceDuration: number, trimIn: number, trimOut: number): TimelineClip {
  return {
    ...base,
    id,
    kind: "video",
    alt: `${id} alt`,
    src: `https://example.com/${id}.mp4`,
    poster: `https://example.com/${id}-poster.jpg`,
    duration: sourceDuration - trimIn - trimOut,
    sourceDuration,
    trimIn,
    trimOut,
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
    previewItems: [
      { id: "p1", kind: "image", src: "https://example.com/p1.jpg", alt: "p1" },
    ],
    alt: `${title} collection`,
    duration: 3,
    sourceDuration: 3,
    trimIn: 0,
    trimOut: 0,
  };
}

const CHILD_DOC: TimelineDocument = {
  id: "child",
  title: "Child timeline",
  clips: packTimelineClips([
    image("c-img", 2),
    collectionClip("c-nested-clip", "grandchild", "Grandchild"),
  ]),
};

const GRANDCHILD_DOC: TimelineDocument = {
  id: "grandchild",
  title: "Grandchild timeline",
  clips: packTimelineClips([image("g-img", 1)]),
};

const ROOT_DOC: TimelineDocument = {
  id: "focus-root",
  title: "Focused timeline",
  clips: packTimelineClips([
    image("img-1", 4),
    video("vid-1", 10, 2, 3),
    collectionClip("col-clip-1", "child", "Child timeline"),
  ]),
};

const DOCUMENTS = {
  "focus-root": ROOT_DOC,
  child: CHILD_DOC,
  grandchild: GRANDCHILD_DOC,
};

describe("buildFocusedGraph", () => {
  it("builds a valid graph rooted at the focused timeline, hydrating one child level", () => {
    const result = buildFocusedGraph(DOCUMENTS, "focus-root");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { graph, details } = result.value;

    expect(findGraphInvariantViolation(graph)).toBeNull();
    expect(graph.rootIds).toEqual(["focus-root"]);
    // A collection clip IS its child timeline: the node id is childTimelineId.
    expect(getChildren(graph, parseNodeId("focus-root"))).toEqual(["img-1", "vid-1", "child"]);

    // Hydrated one level: the child's clips are present…
    expect(getChildren(graph, parseNodeId("child"))).toEqual(["c-img", "grandchild"]);
    expect(details["child"]).toMatchObject({ hydrated: true, sourceClipId: "col-clip-1" });
    // …the grandchild is a placeholder awaiting focus/expansion.
    expect(getChildren(graph, parseNodeId("grandchild"))).toEqual([]);
    expect(details["grandchild"]).toMatchObject({ hydrated: false });
  });

  it("maps media fields onto nodes and app fields into the side-table", () => {
    const result = buildFocusedGraph(DOCUMENTS, "focus-root");
    if (!result.ok) throw new Error(result.error);
    const { graph, details } = result.value;

    expect(graph.nodesById.get(parseNodeId("vid-1"))).toMatchObject({
      kind: "media",
      mediaKind: "video",
      fullDurationSeconds: 10,
      trimInSeconds: 2,
      trimOutSeconds: 3,
      posterSrcs: ["https://example.com/vid-1-poster.jpg"],
    });
    expect(details["vid-1"]).toMatchObject({ alt: "vid-1 alt", aspect: 16 / 9 });
    expect(details["img-1"]).toMatchObject({ sourceDuration: 4, trimIn: 0, trimOut: 0 });
  });

  it("demotes a duplicate reference to a non-navigable card instead of failing", () => {
    const docs = {
      ...DOCUMENTS,
      "focus-root": {
        ...ROOT_DOC,
        clips: packTimelineClips([
          collectionClip("ref-a", "child", "Child timeline"),
          collectionClip("ref-b", "child", "Child timeline"),
        ]),
      },
    };
    const result = buildFocusedGraph(docs, "focus-root");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getChildren(result.value.graph, parseNodeId("focus-root"))).toEqual(["child", "ref-b"]);
    expect(result.value.details["ref-b"]).toMatchObject({ duplicateOfTimelineId: "child" });
  });

  it("reports missing child documents and leaves placeholders", () => {
    const docs = { "focus-root": ROOT_DOC }; // child/grandchild absent
    const result = buildFocusedGraph(docs, "focus-root");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.missingDocuments).toEqual(["child"]);
    expect(getChildren(result.value.graph, parseNodeId("child"))).toEqual([]);
  });

  it("rejects an unknown focus target", () => {
    expect(buildFocusedGraph(DOCUMENTS, "nope")).toMatchObject({ ok: false });
  });
});

describe("buildHydrationSpecs", () => {
  it("hydrates a placeholder mid-session to the same shape a fresh focused build gives", () => {
    // Focused build leaves the grandchild as a placeholder…
    const focused = buildFocusedGraph(DOCUMENTS, "focus-root");
    if (!focused.ok) throw new Error(focused.error);
    expect(getChildren(focused.value.graph, parseNodeId("grandchild"))).toEqual([]);

    // …then the incremental payload fills it through the engine's hydrate.
    const payload = buildHydrationSpecs(
      DOCUMENTS,
      "grandchild",
      1,
      focused.value.graph.nodesById.keys(),
    );
    expect(payload.ok).toBe(true);
    if (!payload.ok) return;
    const hydrated = hydrateCollection(
      focused.value.graph,
      parseNodeId("grandchild"),
      payload.value.specs,
    );
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;

    expect(findGraphInvariantViolation(hydrated.value)).toBeNull();
    expect(getChildren(hydrated.value, parseNodeId("grandchild"))).toEqual(["g-img"]);
    expect(payload.value.details["g-img"]).toMatchObject({ alt: "g-img alt" });
  });

  it("demotes children already present in the live graph via usedIds", () => {
    // A doc whose collection clip references a timeline the live graph
    // already contains elsewhere ("child" is in the focused build).
    const docs = {
      ...DOCUMENTS,
      grandchild: {
        ...GRANDCHILD_DOC,
        clips: packTimelineClips([
          image("g-img", 1),
          collectionClip("g-ref-clip", "child", "Child again"),
        ]),
      },
    };
    const focused = buildFocusedGraph(docs, "focus-root");
    if (!focused.ok) throw new Error(focused.error);

    const payload = buildHydrationSpecs(docs, "grandchild", 1, focused.value.graph.nodesById.keys());
    if (!payload.ok) throw new Error(payload.error);
    // The duplicate reference became a card keyed by the CLIP id, so the
    // engine accepts the specs without an id collision.
    const hydrated = hydrateCollection(
      focused.value.graph,
      parseNodeId("grandchild"),
      payload.value.specs,
    );
    expect(hydrated.ok).toBe(true);
    if (!hydrated.ok) return;
    expect(getChildren(hydrated.value, parseNodeId("grandchild"))).toEqual(["g-img", "g-ref-clip"]);
    expect(payload.value.details["g-ref-clip"]).toMatchObject({ duplicateOfTimelineId: "child" });
  });

  it("rejects an unknown timeline", () => {
    expect(buildHydrationSpecs(DOCUMENTS, "nope")).toMatchObject({ ok: false });
  });
});

describe("graphChildrenToClips (round-trip)", () => {
  it("projects back with packing parity against packTimelineClips", () => {
    const result = buildFocusedGraph(DOCUMENTS, "focus-root");
    if (!result.ok) throw new Error(result.error);
    const projected = graphChildrenToClips(result.value.graph, result.value.details, "focus-root");
    const packed = packTimelineClips(ROOT_DOC.clips.map((clip) => ({ ...clip })));

    expect(projected.map((c) => c.id)).toEqual(packed.map((c) => c.id));
    for (let i = 0; i < projected.length; i++) {
      expect(projected[i].startTime).toBeCloseTo(packed[i].startTime, 8);
      expect(projected[i].duration).toBeCloseTo(packed[i].duration, 8);
      expect(projected[i].kind).toBe(packed[i].kind);
      expect(projected[i].trimIn).toBe(packed[i].trimIn);
      expect(projected[i].trimOut).toBe(packed[i].trimOut);
    }
    // The collection clip keeps its legacy id and child reference.
    const col = projected[2];
    expect(col.kind).toBe("collection");
    if (col.kind === "collection") {
      expect(col.id).toBe("col-clip-1");
      expect(col.childTimelineId).toBe("child");
      expect(col.itemCount).toBe(2);
    }
  });
});

describe("against the app's real initial documents", () => {
  it("builds a valid graph for the root timeline and preserves clip order", () => {
    const documents = createInitialTimelineDocuments();
    const result = buildFocusedGraph(documents, "root");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { graph } = result.value;

    expect(findGraphInvariantViolation(graph)).toBeNull();
    const expectedIds = documents["root"].clips.map((clip) =>
      clip.kind === "collection" ? clip.childTimelineId : clip.id,
    );
    expect(getChildren(graph, parseNodeId("root"))).toEqual(expectedIds);
  });

  it("round-trips the real scene-a document's clip identities", () => {
    const documents = createInitialTimelineDocuments();
    const result = buildFocusedGraph(documents, "scene-a");
    if (!result.ok) throw new Error(result.error);
    const projected = graphChildrenToClips(result.value.graph, result.value.details, "scene-a");
    expect(projected.map((c) => c.id)).toEqual(documents["scene-a"].clips.map((c) => c.id));
  });
});

describe("collectAffectedCollectionIds", () => {
  it("names the write set for moves, adds, and updates", () => {
    const result = buildFocusedGraph(DOCUMENTS, "focus-root");
    if (!result.ok) throw new Error(result.error);
    const { graph } = result.value;

    expect(
      collectAffectedCollectionIds(graph, {
        type: "nodes-moved",
        moves: [
          {
            nodeId: parseNodeId("c-img"),
            fromParentId: parseNodeId("child"),
            fromIndex: 0,
            toParentId: parseNodeId("focus-root"),
            toIndex: 0,
          },
        ],
      }),
    ).toEqual(expect.arrayContaining(["child", "focus-root"]));

    expect(
      collectAffectedCollectionIds(graph, {
        type: "nodes-updated",
        updates: [
          {
            nodeId: parseNodeId("vid-1"),
            before: graph.nodesById.get(parseNodeId("vid-1"))!,
            after: graph.nodesById.get(parseNodeId("vid-1"))!,
          },
        ],
      }),
    ).toEqual(["focus-root"]);
  });
});

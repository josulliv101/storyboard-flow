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
  collectUnhydratedDropTargets,
  graphChildrenToClips,
  hydratedCollectionDuration,
  hydratedCollectionPlayableDuration,
  hydratedCollectionPreviews,
} from "./adapter";
import {
  buildGraph,
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
    // duration matches the child's actual content (c-img 2 + gap 0.12 +
    // grandchild summary 3): hydrated collections DERIVE their duration from
    // live children, so byte-for-byte round-trip parity holds only for a
    // FRESH summary. The stale-summary cases have their own suite below.
    { ...collectionClip("col-clip-1", "child", "Child timeline"), duration: 5.12 },
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

  it("round-trips a media clip's sourceAsset provenance through the side-table", () => {
    // The asset panel records which provider file a clip came from; the
    // engine never models it, so hydration must park it in the details
    // side-table and the write path must put it back — like poster, and
    // like poster it must NOT appear on clips that never had it.
    const sourceAsset = { providerId: "cloudinary", assetId: "gstudio/u/pic-1" };
    const doc = {
      id: "prov-root",
      title: "Provenance",
      clips: [
        { ...image("with-ref", 4), sourceAsset },
        image("without-ref", 4),
      ],
    };
    const result = buildFocusedGraph({ "prov-root": doc }, "prov-root");
    if (!result.ok) throw new Error(result.error);
    expect(result.value.details["with-ref"]?.sourceAsset).toEqual(sourceAsset);

    const projected = graphChildrenToClips(result.value.graph, result.value.details, "prov-root");
    expect(projected[0]).toMatchObject({ id: "with-ref", sourceAsset });
    expect("sourceAsset" in projected[1]).toBe(false);
  });

  it("round-trips `disabled` on media and collection clips, and omits it otherwise", () => {
    // Unlike sourceAsset this rides the GRAPH, not the details side-table —
    // disabling is a command, so the flag has to survive
    // clip -> spec -> node -> clip. A disabled clip keeps its slot: same
    // order, same startTime, same duration as if it were enabled.
    const doc: TimelineDocument = {
      id: "dis-root",
      title: "Disabled",
      clips: packTimelineClips([
        { ...image("off-img", 4), disabled: true },
        image("on-img", 4),
        { ...collectionClip("off-col", "child", "Child"), disabled: true },
      ]),
    };
    const result = buildFocusedGraph({ "dis-root": doc, child: CHILD_DOC }, "dis-root");
    if (!result.ok) throw new Error(result.error);

    const projected = graphChildrenToClips(result.value.graph, result.value.details, "dis-root");
    expect(projected[0]).toMatchObject({ id: "off-img", disabled: true });
    expect("disabled" in projected[1]).toBe(false);
    expect(projected[2]).toMatchObject({ disabled: true });

    // Slot preserved: projecting the SAME document with nothing disabled must
    // produce identical geometry. Compared against an enabled twin rather
    // than against packTimelineClips, because a hydrated collection derives
    // its duration from live children — the stored 3 is not what it projects.
    const enabledDoc: TimelineDocument = {
      ...doc,
      clips: doc.clips.map(({ disabled: _skip, ...clip }) => clip as TimelineClip),
    };
    const control = buildFocusedGraph({ "dis-root": enabledDoc, child: CHILD_DOC }, "dis-root");
    if (!control.ok) throw new Error(control.error);
    const controlClips = graphChildrenToClips(
      control.value.graph,
      control.value.details,
      "dis-root",
    );
    expect(projected.map((c) => [c.id, c.index, c.startTime, c.duration])).toEqual(
      controlClips.map((c) => [c.id, c.index, c.startTime, c.duration]),
    );
  });

  it("round-trips trash provenance through the details side-table", () => {
    // Same seam as sourceAsset: the engine never models "when was this
    // deleted", so hydration must park it and the write path must put it back
    // — and must NOT invent it on clips that never had it.
    const trashedAt = "2026-07-25T12:00:00.000Z";
    const trashedFrom = { timelineId: "bank-heist", title: "Bank Heist" };
    const doc: TimelineDocument = {
      id: "trash-root",
      title: "Trash",
      clips: packTimelineClips([
        { ...image("deleted", 4), trashedAt, trashedFrom },
        image("never-trashed", 4),
      ]),
    };
    const result = buildFocusedGraph({ "trash-root": doc }, "trash-root");
    if (!result.ok) throw new Error(result.error);
    expect(result.value.details["deleted"]?.trashedAt).toBe(trashedAt);
    expect(result.value.details["deleted"]?.trashedFrom).toEqual(trashedFrom);

    const projected = graphChildrenToClips(result.value.graph, result.value.details, "trash-root");
    expect(projected[0]).toMatchObject({ id: "deleted", trashedAt, trashedFrom });
    expect("trashedAt" in projected[1]).toBe(false);
    expect("trashedFrom" in projected[1]).toBe(false);
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

describe("collectUnhydratedDropTargets", () => {
  it("flags moves and adds whose destination is an un-hydrated placeholder", () => {
    const result = buildFocusedGraph(DOCUMENTS, "focus-root");
    if (!result.ok) throw new Error(result.error);
    const { details } = result.value; // "grandchild" is a placeholder (hydrated: false)

    expect(
      collectUnhydratedDropTargets(
        {
          type: "move-nodes",
          nodeIds: [parseNodeId("img-1")],
          toParentId: parseNodeId("grandchild"),
          toIndex: 0,
        },
        details,
      ),
    ).toEqual(["grandchild"]);

    expect(
      collectUnhydratedDropTargets(
        {
          type: "add-nodes",
          nodes: [{ id: parseNodeId("new-1"), kind: "media", name: "New", durationSeconds: 2 }],
          toParentId: parseNodeId("grandchild"),
          toIndex: 0,
        },
        details,
      ),
    ).toEqual(["grandchild"]);
  });

  it("passes hydrated destinations, roots without details, and non-placing commands", () => {
    const result = buildFocusedGraph(DOCUMENTS, "focus-root");
    if (!result.ok) throw new Error(result.error);
    const { details } = result.value;

    // "child" is hydrated: true; "focus-root" has no detail entry at all —
    // both are legitimate destinations.
    expect(
      collectUnhydratedDropTargets(
        {
          type: "move-nodes",
          nodeIds: [parseNodeId("img-1")],
          toParentId: parseNodeId("child"),
          toIndex: 0,
        },
        details,
      ),
    ).toEqual([]);

    expect(
      collectUnhydratedDropTargets(
        {
          type: "move-nodes",
          nodeIds: [parseNodeId("c-img")],
          toParentId: parseNodeId("focus-root"),
          toIndex: 0,
        },
        details,
      ),
    ).toEqual([]);

    expect(
      collectUnhydratedDropTargets(
        {
          type: "update-media",
          nodeId: parseNodeId("vid-1"),
          update: { mediaKind: "video", trimInSeconds: 1 },
        },
        details,
      ),
    ).toEqual([]);
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

  // The write path derives a hydrated collection's summary from its live
  // children, so an edit INSIDE a nested collection changes the projected
  // clips of every ancestor document too. Without the ancestor closure, a
  // child-only trim never rewrote the parent — the stored summary stayed
  // stale, and the server manifest (compiled from stored parent spans) kept
  // playing the pre-edit total no matter how fresh its compile was.
  it("closes the write set over ancestors of every touched collection", () => {
    const result = buildFocusedGraph(DOCUMENTS, "focus-root");
    if (!result.ok) throw new Error(result.error);
    const { graph } = result.value;

    // A trim on "c-img" (inside "child", inside the root) rewrites BOTH.
    expect(
      collectAffectedCollectionIds(graph, {
        type: "nodes-updated",
        updates: [
          {
            nodeId: parseNodeId("c-img"),
            before: graph.nodesById.get(parseNodeId("c-img"))!,
            after: graph.nodesById.get(parseNodeId("c-img"))!,
          },
        ],
      }),
    ).toEqual(["child", "focus-root"]);

    // A reorder WITHIN "child" also propagates: itemCount is unchanged but
    // the parent's projected clip content is the child's summary, and the
    // closure is deliberately unconditional — writes are debounced into one
    // batch, so the extra document costs nothing.
    expect(
      collectAffectedCollectionIds(graph, {
        type: "nodes-moved",
        moves: [
          {
            nodeId: parseNodeId("c-img"),
            fromParentId: parseNodeId("child"),
            fromIndex: 0,
            toParentId: parseNodeId("child"),
            toIndex: 1,
          },
        ],
      }),
    ).toEqual(["child", "focus-root"]);
  });
});

describe("duplicate collection-reference demotion", () => {
  // The shape that matters is the REAL one: a collection clip's stored id
  // equals its childTimelineId (both `create_collection` and the graph
  // write-back mint them that way). Demoting to `clip.id` therefore reproduced
  // the very id that collided, buildGraph returned `duplicate-id`, and because
  // every write builds the graph first, the whole project became unwritable.
  const SAME = "timeline-run";
  const DOUBLED: TimelineDocument = {
    id: "scene",
    title: "Scene",
    clips: packTimelineClips([
      collectionClip(SAME, SAME, "Result"),
      collectionClip(SAME, SAME, "Result"),
    ]),
  };

  it("builds a graph when one document references the same child twice", () => {
    const built = buildFocusedGraph({ scene: DOUBLED }, "scene", 2);

    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(getChildren(built.value.graph, parseNodeId("scene"))).toHaveLength(2);
  });

  it("gives the demoted reference an id that is not already taken", () => {
    const payload = buildHydrationSpecs({ scene: DOUBLED }, "scene", 0);
    if (!payload.ok) throw new Error(payload.error);

    expect(payload.value.specs.map((spec) => spec.id)).toEqual([
      SAME,
      `dup:scene:${SAME}`,
    ]);
    expect(payload.value.details[`dup:scene:${SAME}`]).toMatchObject({
      duplicateOfTimelineId: SAME,
      sourceClipId: SAME,
    });
  });

  it("round-trips both references back to their stored id and child pointer", () => {
    const built = buildFocusedGraph({ scene: DOUBLED }, "scene", 2);
    if (!built.ok) throw new Error(built.error);

    const clips = graphChildrenToClips(
      built.value.graph,
      built.value.details,
      parseNodeId("scene"),
    );

    // A demoted node must not leak its synthetic id into storage.
    expect(clips.map((clip) => clip.id)).toEqual([SAME, SAME]);
    expect(
      clips.map((clip) => (clip.kind === "collection" ? clip.childTimelineId : null)),
    ).toEqual([SAME, SAME]);
  });
});

describe("duplicate media-id demotion", () => {
  it("demotes a media id already used in the live graph, preserving the stored id", () => {
    // "c-img" already exists elsewhere in the graph (legacy stable per-asset
    // ids make this real data): the spec must NOT carry the colliding id —
    // store.hydrate would reject the whole payload and blank the collection.
    const payload = buildHydrationSpecs(DOCUMENTS, "child", 0, ["c-img"]);
    if (!payload.ok) throw new Error(payload.error);

    const specIds = payload.value.specs.map((spec) => spec.id);
    expect(specIds).toEqual(["dup:child:c-img", "grandchild"]);
    expect(payload.value.details["dup:child:c-img"]?.sourceClipId).toBe("c-img");
    // Non-colliding details stay keyed by their own ids.
    expect(payload.value.details["dup:child:c-img"]?.alt).toBe("c-img alt");
  });

  it("demotes the second occurrence when one document repeats a media id", () => {
    const doubled: TimelineDocument = {
      id: "doubled",
      title: "Doubled",
      clips: packTimelineClips([image("same", 2), image("same", 3)]),
    };
    const payload = buildHydrationSpecs({ doubled }, "doubled", 0);
    if (!payload.ok) throw new Error(payload.error);

    expect(payload.value.specs.map((spec) => spec.id)).toEqual(["same", "dup:doubled:same"]);
    expect(payload.value.details["dup:doubled:same"]?.sourceClipId).toBe("same");
  });

  it("round-trips the ORIGINAL stored id through the write path", () => {
    const payload = buildHydrationSpecs(DOCUMENTS, "child", 0, ["c-img"]);
    if (!payload.ok) throw new Error(payload.error);
    const built = buildGraph([
      { kind: "collection", id: "host", name: "Host", children: [...payload.value.specs] },
    ]);
    if (!built.ok) throw new Error(JSON.stringify(built.error));

    const clips = graphChildrenToClips(built.value, payload.value.details, "host");
    // The demoted node writes back the stored clip id, and the collection
    // reference keeps its own sourceClipId round-trip.
    expect(clips.map((clip) => clip.id)).toEqual(["c-img", "c-nested-clip"]);
    expect(clips[0].src).toBe("https://example.com/c-img.jpg");
  });
});

describe("hydrated collection durations", () => {
  // A stored summary goes stale the moment the CHILD document is edited —
  // writes are patch-scoped, so the parent's collection clip keeps the old
  // duration until the parent itself is rewritten. The projection must
  // therefore DERIVE a hydrated collection's duration from live children
  // (like itemCount already does) instead of parroting the summary, or the
  // preview clock drifts off the manifest AND the parent's next write
  // re-persists the stale number.
  function docsWithStaleSummary(): Record<string, TimelineDocument> {
    return {
      "stale-root": {
        id: "stale-root",
        title: "Stale root",
        clips: [{ ...collectionClip("clip-kid", "kid", "Kid"), duration: 999 }],
      },
      kid: {
        id: "kid",
        title: "Kid",
        clips: packTimelineClips([image("k-a", 4), image("k-b", 5)]),
      },
    };
  }

  it("derives a hydrated collection's duration from live children, not the stale summary", () => {
    const focused = buildFocusedGraph(docsWithStaleSummary(), "stale-root");
    if (!focused.ok) throw new Error(focused.error);

    const clips = graphChildrenToClips(focused.value.graph, focused.value.details, "stale-root");
    // 4 + gap(0.12) + 5 — the child's actual content, not the stored 999.
    expect(clips[0].kind).toBe("collection");
    expect(clips[0].duration).toBeCloseTo(9.12, 5);
  });

  it("keeps the stored summary for an UNHYDRATED placeholder", () => {
    const documents = docsWithStaleSummary();
    delete documents.kid; // the child document never loads
    const focused = buildFocusedGraph(documents, "stale-root");
    if (!focused.ok) throw new Error(focused.error);

    const clips = graphChildrenToClips(focused.value.graph, focused.value.details, "stale-root");
    // All anyone knows about a placeholder is its summary.
    expect(clips[0].duration).toBe(999);
  });

  it("recurses through hydrated nesting and stops at placeholders", () => {
    const documents: Record<string, TimelineDocument> = {
      "nest-root": {
        id: "nest-root",
        title: "Nest root",
        clips: [{ ...collectionClip("clip-mid", "mid", "Mid"), duration: 999 }],
      },
      mid: {
        id: "mid",
        title: "Mid",
        clips: packTimelineClips([
          image("m-a", 2),
          { ...collectionClip("clip-deep", "deep", "Deep"), duration: 50 },
        ]),
      },
      // "deep" has no document: it stays a placeholder inside mid.
    };
    const focused = buildFocusedGraph(documents, "nest-root");
    if (!focused.ok) throw new Error(focused.error);

    const clips = graphChildrenToClips(focused.value.graph, focused.value.details, "nest-root");
    // mid is hydrated: derived = 2 + gap + deep's SUMMARY 50 (deep is a
    // placeholder — its stored word is all anyone has).
    expect(clips[0].duration).toBeCloseTo(2 + 0.12 + 50, 5);
  });
});

describe("hydratedCollectionPlayableDuration", () => {
  // The READOUT twin of hydratedCollectionDuration. The two must diverge
  // exactly where something is disabled: geometry keeps the slot (the playhead
  // jumps it), the readout says what a viewer would sit through.
  function docsWithDisabledChild(): Record<string, TimelineDocument> {
    return {
      root: {
        id: "root",
        title: "Root",
        clips: [collectionClip("clip-kid", "kid", "Kid")],
      },
      kid: {
        id: "kid",
        title: "Kid",
        clips: packTimelineClips([image("k-a", 4), { ...image("k-b", 5), disabled: true }]),
      },
    };
  }

  it("excludes a disabled child's seconds AND its gap, where the layout walk keeps them", () => {
    const focused = buildFocusedGraph(docsWithDisabledChild(), "root");
    if (!focused.ok) throw new Error(focused.error);
    const { graph, details } = focused.value;
    const kid = parseNodeId("kid");

    expect(hydratedCollectionDuration(graph, details, kid)).toBeCloseTo(9.12, 5);
    expect(hydratedCollectionPlayableDuration(graph, details, kid)).toBeCloseTo(4, 5);
  });

  it("returns ZERO when every child is disabled — a real answer, not 'unknown'", () => {
    // This is what made the header's old `duration > 0 ? live : stored` test
    // wrong: zero is a legitimate live value, so falling back on it re-quoted
    // a stale nonzero summary for a collection that now plays nothing.
    const documents = docsWithDisabledChild();
    documents.kid.clips = packTimelineClips([
      { ...image("k-a", 4), disabled: true },
      { ...image("k-b", 5), disabled: true },
    ]);
    const focused = buildFocusedGraph(documents, "root");
    if (!focused.ok) throw new Error(focused.error);

    expect(
      hydratedCollectionPlayableDuration(focused.value.graph, focused.value.details, parseNodeId("kid")),
    ).toBe(0);
  });

  it("agrees with the layout walk when nothing is disabled", () => {
    const focused = buildFocusedGraph(
      {
        root: { id: "root", title: "Root", clips: [collectionClip("clip-kid", "kid", "Kid")] },
        kid: { id: "kid", title: "Kid", clips: packTimelineClips([image("k-a", 4), image("k-b", 5)]) },
      },
      "root",
    );
    if (!focused.ok) throw new Error(focused.error);
    const { graph, details } = focused.value;
    const kid = parseNodeId("kid");

    expect(hydratedCollectionPlayableDuration(graph, details, kid)).toBeCloseTo(
      hydratedCollectionDuration(graph, details, kid),
      5,
    );
  });
});

describe("hydrated collection previewItems", () => {
  // Third leg of the stale-stored-summary family (after duration + itemCount):
  // a collection clip's stored `previewItems` parrots the child's first/last
  // frames at seed time, but the child document changes underneath. The
  // projection must DERIVE previewItems from live children when hydrated (same
  // rule as duration/itemCount), or the parent's collection card shows old
  // frames AND the write path re-persists them.
  function docsWithStalePreview(): Record<string, TimelineDocument> {
    return {
      "stale-root": {
        id: "stale-root",
        title: "Stale root",
        clips: [collectionClip("clip-kid", "kid", "Kid")],
      },
      kid: {
        id: "kid",
        title: "Kid",
        clips: packTimelineClips([image("k-a", 4), image("k-b", 5)]),
      },
    };
  }

  it("derives a hydrated collection's previewItems from live children, not the stale summary", () => {
    const focused = buildFocusedGraph(docsWithStalePreview(), "stale-root");
    if (!focused.ok) throw new Error(focused.error);

    const clip = graphChildrenToClips(focused.value.graph, focused.value.details, "stale-root")[0];
    expect(clip.kind).toBe("collection");
    if (clip.kind !== "collection") throw new Error("expected a collection clip");
    // The stored summary was a single "p1" frame; live children are k-a, k-b.
    expect(clip.previewItems?.map((p) => p.id)).toEqual(["k-a", "k-b"]);
    expect(clip.previewItems?.[0]).toEqual({
      id: "k-a",
      kind: "image",
      src: "https://example.com/k-a.jpg",
      poster: "https://example.com/k-a-poster.jpg",
      alt: "k-a alt",
    });
  });

  it("reflects a front-insertion into the live child", () => {
    const documents = docsWithStalePreview();
    // Add an image to the FRONT of the child, as the failure scenario describes.
    documents.kid = {
      ...documents.kid,
      clips: packTimelineClips([image("k-new", 1), image("k-a", 4), image("k-b", 5)]),
    };
    const focused = buildFocusedGraph(documents, "stale-root");
    if (!focused.ok) throw new Error(focused.error);

    const clip = graphChildrenToClips(focused.value.graph, focused.value.details, "stale-root")[0];
    if (clip.kind !== "collection") throw new Error("expected a collection clip");
    // First/middle/last of three children — the new front frame leads.
    expect(clip.previewItems?.map((p) => p.id)).toEqual(["k-new", "k-a", "k-b"]);
  });

  it("keeps the stored previewItems for an UNHYDRATED placeholder", () => {
    const documents = docsWithStalePreview();
    delete documents.kid; // the child document never loads
    const focused = buildFocusedGraph(documents, "stale-root");
    if (!focused.ok) throw new Error(focused.error);

    const clip = graphChildrenToClips(focused.value.graph, focused.value.details, "stale-root")[0];
    if (clip.kind !== "collection") throw new Error("expected a collection clip");
    // All anyone knows about a placeholder is its stored summary.
    expect(clip.previewItems).toEqual([
      { id: "p1", kind: "image", src: "https://example.com/p1.jpg", alt: "p1" },
    ]);
  });
});

describe("hydratedCollectionPreviews (card frames)", () => {
  // The graph CARD renders its preview frames from the side-table, which the
  // adapter seeds from the STORED collection clip — so a hydrated parent card
  // showed the stored frames until a reload even after its loaded child was
  // edited. This helper derives the card's frames from the live children so
  // the visible card refreshes in step with the write path.
  function docs(kidClips: TimelineClip[]): Record<string, TimelineDocument> {
    return {
      "stale-root": {
        id: "stale-root",
        title: "Stale root",
        clips: [collectionClip("clip-kid", "kid", "Kid")],
      },
      kid: { id: "kid", title: "Kid", clips: packTimelineClips(kidClips) },
    };
  }

  it("derives a hydrated collection's frames from live children, not the stale summary", () => {
    const focused = buildFocusedGraph(docs([image("k-a", 4), image("k-b", 5)]), "stale-root");
    if (!focused.ok) throw new Error(focused.error);

    const previews = hydratedCollectionPreviews(focused.value.graph, "kid");
    // The stored summary was a single "p1" frame; live children are k-a, k-b.
    expect(previews.map((p) => p.id)).toEqual(["k-a", "k-b"]);
    expect(previews[0]).toEqual({
      id: "k-a",
      kind: "image",
      src: "https://example.com/k-a.jpg",
      alt: "k-a alt",
    });
  });

  it("reflects a front-insertion into the live child", () => {
    const focused = buildFocusedGraph(
      docs([image("k-new", 1), image("k-a", 4), image("k-b", 5)]),
      "stale-root",
    );
    if (!focused.ok) throw new Error(focused.error);

    // first/middle/last of three children — the new front frame leads.
    expect(hydratedCollectionPreviews(focused.value.graph, "kid").map((p) => p.id)).toEqual([
      "k-new",
      "k-a",
      "k-b",
    ]);
  });

  it("samples first/middle/last for a long child and carries a video poster", () => {
    const focused = buildFocusedGraph(
      docs([
        image("k-a", 1),
        image("k-b", 1),
        video("k-vid", 8, 2, 0),
        image("k-d", 1),
        image("k-e", 1),
      ]),
      "stale-root",
    );
    if (!focused.ok) throw new Error(focused.error);

    const previews = hydratedCollectionPreviews(focused.value.graph, "kid");
    // Five children → first, middle (the video), last.
    expect(previews.map((p) => p.id)).toEqual(["k-a", "k-vid", "k-e"]);
    // The video frame paints its poster, not the source url.
    expect(previews[1]).toEqual({
      id: "k-vid",
      kind: "video",
      src: "https://example.com/k-vid.mp4",
      poster: "https://example.com/k-vid-poster.jpg",
      trimIn: 2,
      alt: "k-vid alt",
    });
  });

  it("returns no frames for an UNHYDRATED placeholder (no live children)", () => {
    const documents = docs([image("k-a", 4)]);
    delete documents.kid; // never loads → placeholder with empty children
    const focused = buildFocusedGraph(documents, "stale-root");
    if (!focused.ok) throw new Error(focused.error);

    // Empty: the card keeps its stored summary for a placeholder.
    expect(hydratedCollectionPreviews(focused.value.graph, "kid")).toEqual([]);
  });

  it("recurses into a hydrated sub-collection to surface its nested images", () => {
    const documents: Record<string, TimelineDocument> = {
      kid: {
        id: "kid",
        title: "Kid",
        clips: packTimelineClips([collectionClip("clip-sub", "sub", "Sub")]),
      },
      sub: {
        id: "sub",
        title: "Sub",
        clips: packTimelineClips([image("s-a", 3), image("s-b", 3)]),
      },
    };
    const focused = buildFocusedGraph(documents, "kid");
    if (!focused.ok) throw new Error(focused.error);

    // "kid" has NO direct media — only the "sub" collection. The walk descends
    // into sub and surfaces its images as kid's preview frames (the first
    // nested image, and beyond).
    expect(hydratedCollectionPreviews(focused.value.graph, "kid").map((p) => p.id)).toEqual([
      "s-a",
      "s-b",
    ]);
  });

  it("stops at a placeholder sub-collection (its nested media aren't loaded)", () => {
    const documents: Record<string, TimelineDocument> = {
      kid: {
        id: "kid",
        title: "Kid",
        clips: packTimelineClips([collectionClip("clip-sub", "sub", "Sub")]),
      },
      // "sub" has no document: it stays a placeholder with no children in the
      // graph, so the descent finds nothing to show.
    };
    const focused = buildFocusedGraph(documents, "kid");
    if (!focused.ok) throw new Error(focused.error);

    expect(hydratedCollectionPreviews(focused.value.graph, "kid")).toEqual([]);
  });

  it("skips unusable media and continues to the next nested preview", () => {
    const graphResult = buildGraph([
      {
        kind: "collection",
        id: "kid",
        name: "Kid",
        children: [
          {
            kind: "media",
            mediaKind: "video",
            id: "posterless",
            name: "Posterless",
            src: "https://example.com/posterless.mp4",
            fullDurationSeconds: 10,
          },
          {
            kind: "media",
            mediaKind: "image",
            id: "missing-image",
            name: "Missing image",
          },
          {
            kind: "media",
            mediaKind: "image",
            id: "usable",
            name: "Usable",
            src: "https://example.com/usable.jpg",
          },
        ],
      },
    ]);
    if (!graphResult.ok) throw new Error(JSON.stringify(graphResult.error));

    expect(hydratedCollectionPreviews(graphResult.value, "kid")).toEqual([
      {
        id: "usable",
        kind: "image",
        src: "https://example.com/usable.jpg",
        alt: "Usable",
      },
    ]);
  });
});

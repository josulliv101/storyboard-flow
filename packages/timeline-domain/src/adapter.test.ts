import { describe, expect, it } from "vitest";

import {
  createInitialTimelineDocuments,
  packTimelineClips,
} from "@storyboard/ui/timeline/timeline-documents";
import type { TimelineClip, TimelineDocument } from "@storyboard/ui/timeline/types";
// The REAL write gate, so "the server would accept this projection" is
// asserted rather than approximated by an expected array.
import { isStoredTimelineDocument } from "@storyboard/timeline-model/validate";

import {
  buildFocusedGraph,
  buildHydrationSpecs,
  collectAffectedCollectionIds,
  collectionSubtreeHydrated,
  collectUnhydratedDropTargets,
  hydratedCollectionPlayableSpan,
  graphChildrenToClips,
  hydratedCollectionDuration,
  hydratedCollectionPlayableDuration,
  hydratedCollectionPreviews,
  resolveCollectionPreviews,
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

  it("writes the duplicate back as a REFERENCE, not a second owning placement", () => {
    // This expectation used to be the opposite — both clips round-tripped to
    // the stored id, on the rule that a synthetic id must never leak into
    // storage. That was right until the batch endpoint grew its duplicate-owner
    // guard, because ownership is SPELT `id === childTimelineId`: writing the
    // stored id back spells a second owning placement, and the server now
    // refuses the whole batch with
    //
    //   409 Refusing to give <id> a second owning placement.
    //
    // A document that already contains one (a real one sat in the trash bin,
    // from an item trashed, restored and trashed again) could then never be
    // written again — which stopped every delete, everywhere, since the bin is
    // per-user and every delete rewrites it. Keeping the stored id was
    // faithful; it was faithful to something the model no longer permits.
    const built = buildFocusedGraph({ scene: DOUBLED }, "scene", 2);
    if (!built.ok) throw new Error(built.error);

    const clips = graphChildrenToClips(
      built.value.graph,
      built.value.details,
      parseNodeId("scene"),
    );

    // The first placement OWNS the child and keeps the stored id untouched.
    // The second points at the same child under its own id, which is exactly
    // what "must be a reference, not an owning placement" asks for.
    expect(clips.map((clip) => clip.id)).toEqual([SAME, `dup:scene:${SAME}`]);
    expect(
      clips.map((clip) => (clip.kind === "collection" ? clip.childTimelineId : null)),
    ).toEqual([SAME, SAME]);

    // The server's rule, applied to the projection: one owner per child.
    const owners = clips.filter(
      (clip) => clip.kind === "collection" && clip.id === clip.childTimelineId,
    );
    expect(owners).toHaveLength(1);
  });

  it("re-reads to the same id, so the repair does not churn on every save", () => {
    // The written id is derived from the document id and the stored clip id,
    // and re-reading demotes to that same synthetic id — so a second save
    // produces identical bytes rather than minting `dup:...~` forever.
    const built = buildFocusedGraph({ scene: DOUBLED }, "scene", 2);
    if (!built.ok) throw new Error(built.error);
    const once = graphChildrenToClips(built.value.graph, built.value.details, parseNodeId("scene"));

    const reread = buildFocusedGraph(
      { scene: { id: "scene", title: "Scene", clips: once } },
      "scene",
      2,
    );
    if (!reread.ok) throw new Error(reread.error);
    const twice = graphChildrenToClips(
      reread.value.graph,
      reread.value.details,
      parseNodeId("scene"),
    );

    expect(twice.map((clip) => clip.id)).toEqual(once.map((clip) => clip.id));
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

  it("gives an EMPTY hydrated collection the same floor the model does", () => {
    // Where the zeroes come from in the first place, and the root of the
    // reload-changes-the-number bug.
    //
    // `hydratedCollectionDuration` starts at TIMELINE_LEADING_PADDING_SECONDS
    // (zero) and adds a term per child, so a collection with no children
    // returns 0 — while `collectionSpanSeconds`, the model's own answer to the
    // same question, returns 3 for an empty list because "a zero-width
    // collection card cannot be seen or clicked".
    //
    // It is not only a display bug: the write path persists documents THROUGH
    // this projection, so every empty collection wrote a stored duration of 0,
    // which is then the value every later reader has to defend against.
    const documents: Record<string, TimelineDocument> = {
      "empty-root": {
        id: "empty-root",
        title: "Empty root",
        clips: [{ ...collectionClip("clip-empty", "empty", "Empty"), duration: 999 }],
      },
      empty: { id: "empty", title: "Empty", clips: [] },
    };
    const focused = buildFocusedGraph(documents, "empty-root");
    if (!focused.ok) throw new Error(focused.error);

    const clips = graphChildrenToClips(focused.value.graph, focused.value.details, "empty-root");
    expect(clips[0].duration).toBeCloseTo(3, 5);
  });

  it("floors a placeholder's ZERO summary rather than counting it as no time", () => {
    // The disagreement this fixes, reproduced from a real board: the same
    // collection read 12.4s on a cold load and 3.4s after navigating to it and
    // back, so the number changed on reload.
    //
    // The server ignores stored summaries and re-derives bottom-up, where
    // `collectionSpanSeconds` floors an empty collection at 3 — "a zero-width
    // collection card cannot be seen or clicked". The client trusted the stored
    // value for placeholders, and the stored value was `0`: the write path
    // persists a duration it does not know, and `?? 3` never fires because zero
    // is not nullish. Three children contributing nothing collapsed the parent's
    // badge to one child's worth.
    //
    // Storing 0 is worse than storing nothing, and until the write path stops
    // doing it, every reader has to defend against it.
    const documents: Record<string, TimelineDocument> = {
      "zero-root": {
        id: "zero-root",
        title: "Zero root",
        clips: [{ ...collectionClip("clip-parent", "parent", "Parent"), duration: 999 }],
      },
      parent: {
        id: "parent",
        title: "Parent",
        clips: packTimelineClips([
          { ...collectionClip("clip-a", "a", "A"), duration: 3 },
          { ...collectionClip("clip-b", "b", "B"), duration: 0 },
          { ...collectionClip("clip-c", "c", "C"), duration: 0 },
        ]),
      },
      // a, b and c never load: placeholders, so their stored summaries are all
      // anyone knows about them.
    };
    const focused = buildFocusedGraph(documents, "zero-root");
    if (!focused.ok) throw new Error(focused.error);

    const clips = graphChildrenToClips(focused.value.graph, focused.value.details, "zero-root");
    // 3 + gap + 3 + gap + 3 — the two zeroes floored to the same 3 seconds the
    // server's derivation gives them. Counting them as 0 yields 3.24.
    expect(clips[0].duration).toBeCloseTo(9.24, 5);
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

  // A placeholder's stored frames are carried through UNTOUCHED — which is
  // right for a stale frame and wrong for an impossible one. A legacy AUDIO
  // frame (written before either deriver learned to skip audio) is refused by
  // the write gate, so carrying it back out made the document unwritable: the
  // batch 400ed, and because the collection in question lived in the TRASH
  // BIN, which every delete rewrites, deleting anything failed.
  //
  // The projection is checked against the REAL gate rather than an expected
  // array, because "the server would accept this" is the actual claim.
  it("drops an unpaintable stored frame instead of re-emitting it", () => {
    const documents = docsWithStalePreview();
    delete documents.kid; // still a placeholder — nothing live to re-derive from
    const poisoned = documents["stale-root"].clips[0];
    if (poisoned?.kind !== "collection") throw new Error("expected a collection clip");
    // Assigned through an untyped view on purpose: this frame is not
    // expressible in the current model, which is exactly its history — it was
    // written when the model was looser, and no writer can produce one today.
    (poisoned as { previewItems: unknown }).previewItems = [
      // Audio has a `src`, so every check except the kind passes.
      { id: "audio-80b79709", kind: "audio", src: "https://example.com/vo.flac", alt: "VO" },
      { id: "p1", kind: "image", src: "https://example.com/p1.jpg", alt: "p1" },
    ];

    const focused = buildFocusedGraph(documents, "stale-root");
    if (!focused.ok) throw new Error(focused.error);
    const clips = graphChildrenToClips(focused.value.graph, focused.value.details, "stale-root");

    expect(clips[0]?.kind === "collection" && clips[0].previewItems).toEqual([
      { id: "p1", kind: "image", src: "https://example.com/p1.jpg", alt: "p1" },
    ]);
    expect(
      isStoredTimelineDocument({ id: "stale-root", title: "Stale root", clips }),
    ).toBe(true);
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

    const previews = hydratedCollectionPreviews(focused.value.graph, "kid").frames;
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
    expect(hydratedCollectionPreviews(focused.value.graph, "kid").frames.map((p) => p.id)).toEqual([
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

    const previews = hydratedCollectionPreviews(focused.value.graph, "kid").frames;
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
    expect(hydratedCollectionPreviews(focused.value.graph, "kid").frames).toEqual([]);
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
    expect(hydratedCollectionPreviews(focused.value.graph, "kid").frames.map((p) => p.id)).toEqual([
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

    expect(hydratedCollectionPreviews(focused.value.graph, "kid").frames).toEqual([]);
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

    expect(hydratedCollectionPreviews(graphResult.value, "kid").frames).toEqual([
      {
        id: "usable",
        kind: "image",
        src: "https://example.com/usable.jpg",
        alt: "Usable",
      },
    ]);
  });
});

describe("previews when the walk sees only PART of the subtree (#293)", () => {
  // #290 covered the walk returning NOTHING. This is the other half: it returns
  // something real, computed over an incomplete set, so the frames are WRONG
  // rather than merely fewer.
  //
  // A card paints exactly one frame and it is always `frames[0]`, so the whole
  // question is whether the walk could see the START of the collection.

  const storedFirst = [
    { id: "true-first", kind: "image" as const, src: "https://example.com/first.jpg", alt: "first" },
  ];

  it("defers to the summary when an unloaded branch sits BEFORE the first media", () => {
    // run1 is a placeholder; run2 is loaded. The live walk cannot reach run1's
    // media, so the first frame it finds belongs to run2 — a later branch. The
    // server's summary was derived across the whole closure and knows the
    // real first frame.
    const focused = buildFocusedGraph(
      {
        scene: {
          id: "scene",
          title: "Scene one",
          clips: packTimelineClips([
            collectionClip("clip-run1", "run1", "Run 1"),
            collectionClip("clip-run2", "run2", "Run 2"),
          ]),
        },
        // run1 deliberately ABSENT.
        run2: { id: "run2", title: "Run 2", clips: packTimelineClips([image("r2-a", 4)]) },
      },
      "scene",
    );
    if (!focused.ok) throw new Error(focused.error);

    const live = hydratedCollectionPreviews(focused.value.graph, "scene");
    // The walk DID find a frame — this is not the #290 blank case.
    expect(live.frames.map((p) => p.id)).toEqual(["r2-a"]);
    expect(live.firstFrameUncertain).toBe(true);
    expect(resolveCollectionPreviews(live, storedFirst)).toEqual(storedFirst);
  });

  it("keeps the live frames when the unloaded branch is AFTER the first media", () => {
    // The distinction that stops this from becoming "prefer stored whenever
    // the walk is incomplete". run1 is loaded, so `frames[0]` is already the
    // collection's real first frame and no summary can improve on it —
    // deferring here would throw away an edit the user just made in run1.
    const focused = buildFocusedGraph(
      {
        scene: {
          id: "scene",
          title: "Scene one",
          clips: packTimelineClips([
            collectionClip("clip-run1", "run1", "Run 1"),
            collectionClip("clip-run2", "run2", "Run 2"),
          ]),
        },
        run1: { id: "run1", title: "Run 1", clips: packTimelineClips([image("r1-a", 4)]) },
        // run2 deliberately ABSENT.
      },
      "scene",
    );
    if (!focused.ok) throw new Error(focused.error);

    const live = hydratedCollectionPreviews(focused.value.graph, "scene");
    expect(live.frames.map((p) => p.id)).toEqual(["r1-a"]);
    expect(live.firstFrameUncertain).toBe(false);
    expect(resolveCollectionPreviews(live, storedFirst).map((p) => p.id)).toEqual(["r1-a"]);
  });

  it("shows what it found when there is no summary to fall back to", () => {
    // A partial answer beats an empty card.
    const focused = buildFocusedGraph(
      {
        scene: {
          id: "scene",
          title: "Scene one",
          clips: packTimelineClips([
            collectionClip("clip-run1", "run1", "Run 1"),
            collectionClip("clip-run2", "run2", "Run 2"),
          ]),
        },
        run2: { id: "run2", title: "Run 2", clips: packTimelineClips([image("r2-a", 4)]) },
      },
      "scene",
    );
    if (!focused.ok) throw new Error(focused.error);

    const live = hydratedCollectionPreviews(focused.value.graph, "scene");
    expect(live.firstFrameUncertain).toBe(true);
    expect(resolveCollectionPreviews(live, undefined).map((p) => p.id)).toEqual(["r2-a"]);
  });

  it("does not defer for a collection whose OWN media lead it", () => {
    // Media directly under the collection are found before any descent, so an
    // unloaded sub-collection later in the list changes nothing visible.
    const focused = buildFocusedGraph(
      {
        scene: {
          id: "scene",
          title: "Scene one",
          clips: packTimelineClips([
            image("own-a", 4),
            collectionClip("clip-run2", "run2", "Run 2"),
          ]),
        },
        // run2 deliberately ABSENT.
      },
      "scene",
    );
    if (!focused.ok) throw new Error(focused.error);

    const live = hydratedCollectionPreviews(focused.value.graph, "scene");
    expect(live.frames.map((p) => p.id)).toEqual(["own-a"]);
    expect(live.firstFrameUncertain).toBe(false);
    expect(resolveCollectionPreviews(live, storedFirst).map((p) => p.id)).toEqual(["own-a"]);
  });
});

describe("previews when the walk cannot see the whole subtree (#290)", () => {
  // The reported bug, in its exact shape. On the project board a top-level
  // collection is HYDRATED — its own children are loaded — but those children
  // are collections whose documents are NOT loaded. The live walk descends into
  // them, finds no media, and returns nothing; preferring it over the stored
  // summary blanked the card to a film-leader placeholder while the server had
  // already derived the correct frames across the closure.
  //
  // `hydrated` means "MY children are loaded" — one level. Preview frames come
  // from leaf media, which for a collection of collections is two or more.

  /** A parent holding collection clips whose child documents are absent — the
   *  board's boot state: focus + ONE level, grandchildren still placeholders. */
  function unloadedGrandchildren(): Record<string, TimelineDocument> {
    return {
      scene: {
        id: "scene",
        title: "Scene one",
        clips: packTimelineClips([
          collectionClip("clip-run1", "run1", "Run 1"),
          collectionClip("clip-run2", "run2", "Run 2"),
        ]),
      },
      // run1 / run2 documents are deliberately ABSENT.
    };
  }

  it("keeps the stored summary when a sub-collection is not loaded", () => {
    const focused = buildFocusedGraph(unloadedGrandchildren(), "scene");
    if (!focused.ok) throw new Error(focused.error);

    const live = hydratedCollectionPreviews(focused.value.graph, "scene");
    expect(live.frames).toEqual([]);
    expect(live.firstFrameUncertain).toBe(true);

    const stored = [
      { id: "s1", kind: "image" as const, src: "https://example.com/s1.jpg", alt: "s1" },
    ];
    expect(resolveCollectionPreviews(live, stored)).toEqual(stored);
  });

  it("still goes blank when a collection's own media were all removed", () => {
    // The case a bare `frames.length === 0` fallback would have broken:
    // emptying a collection must clear its card, not resurrect stale frames.
    const focused = buildFocusedGraph(
      {
        "stale-root": {
          id: "stale-root",
          title: "Stale root",
          clips: [collectionClip("clip-kid", "kid", "Kid")],
        },
        kid: { id: "kid", title: "Kid", clips: [] },
      },
      "stale-root",
    );
    if (!focused.ok) throw new Error(focused.error);

    const live = hydratedCollectionPreviews(focused.value.graph, "kid");
    expect(live.frames).toEqual([]);
    // No child COLLECTION was involved, so the empty result is authoritative.
    expect(live.firstFrameUncertain).toBe(false);

    const stored = [
      { id: "old", kind: "image" as const, src: "https://example.com/old.jpg", alt: "old" },
    ];
    expect(resolveCollectionPreviews(live, stored)).toEqual([]);
  });

  it("prefers live frames once the sub-collections load", () => {
    const focused = buildFocusedGraph(
      {
        scene: {
          id: "scene",
          title: "Scene one",
          clips: packTimelineClips([collectionClip("clip-run1", "run1", "Run 1")]),
        },
        run1: { id: "run1", title: "Run 1", clips: packTimelineClips([image("r-a", 4)]) },
      },
      "scene",
    );
    if (!focused.ok) throw new Error(focused.error);

    const live = hydratedCollectionPreviews(focused.value.graph, "scene");
    expect(live.frames.map((p) => p.id)).toEqual(["r-a"]);
    expect(live.firstFrameUncertain).toBe(false);

    const stored = [
      { id: "s1", kind: "image" as const, src: "https://example.com/s1.jpg", alt: "s1" },
    ];
    // Live wins — the whole point of deriving is that edits show up.
    expect(resolveCollectionPreviews(live, stored)).toEqual(live.frames);
  });

  it("carries the stored frames through graphChildrenToClips, not a blank summary", () => {
    // The write path matters as much as the card: projecting a blank summary
    // would PERSIST the blank, turning a display bug into stored data loss.
    //
    // THREE levels, deliberately. The clip under test has to be a HYDRATED
    // collection whose own children are unhydrated — that is the only shape
    // that reaches the guard. A two-level fixture puts a PLACEHOLDER under the
    // root, which takes the unhydrated branch and passes either way: it looked
    // like a regression test and proved nothing.
    const focused = buildFocusedGraph(
      {
        project: {
          id: "project",
          title: "Project",
          clips: [collectionClip("clip-scene", "scene", "Scene one")],
        },
        scene: {
          id: "scene",
          title: "Scene one",
          clips: packTimelineClips([
            collectionClip("clip-run1", "run1", "Run 1"),
            collectionClip("clip-run2", "run2", "Run 2"),
          ]),
        },
        // run1 / run2 documents deliberately ABSENT.
      },
      "project",
    );
    if (!focused.ok) throw new Error(focused.error);
    // Guard the fixture itself: if `scene` ever stops hydrating, this test
    // silently stops testing anything.
    expect(focused.value.details["scene"]?.hydrated).toBe(true);

    const clips = graphChildrenToClips(
      focused.value.graph,
      focused.value.details,
      parseNodeId("project"),
    );
    const scene = clips.find((clip) => clip.kind === "collection");
    if (scene?.kind !== "collection") throw new Error("expected a collection clip");
    expect(scene.previewItems).toEqual([
      { id: "p1", kind: "image", src: "https://example.com/p1.jpg", alt: "p1" },
    ]);
  });
});

describe("collectionSubtreeHydrated", () => {
  /**
   * Whether a collection's aggregate readouts can be shown at all.
   *
   * `hydratedCollectionDuration` always returns a number: for any child it does
   * not have, it substitutes that child's STORED summary. Those summaries drift
   * (58.4% of collection clips in a real project carry at least one stale
   * field), so the number is plausible and unverifiable. This predicate is how
   * a card knows to say nothing instead — and TRANSITIVITY is the whole point,
   * because a collection can be fully loaded while its grandchild is not.
   */
  const media = (rootId: string) => ({
    [rootId]: {
      id: rootId,
      title: rootId,
      clips: [collectionClip("clip-leaf", "leaf", "Leaf")],
    },
    leaf: { id: "leaf", title: "Leaf", clips: packTimelineClips([image("m-a", 4)]) },
  });

  const graphOf = (documents: Record<string, TimelineDocument>, rootId: string) => {
    const focused = buildFocusedGraph(documents, rootId);
    if (!focused.ok) throw new Error(focused.error);
    return focused.value;
  };

  it("vouches for a collection whose children are all media", () => {
    // The cheap case, and the reason the board is not simply blank: a
    // media-only collection is exactly known from its own document, so it earns
    // its readout at one level of reading.
    const { graph, details } = graphOf(media("root"), "root");
    expect(collectionSubtreeHydrated(graph, details, "leaf")).toBe(true);
  });

  it("refuses a collection whose child collection never loaded", () => {
    const documents = media("root");
    delete (documents as Record<string, unknown>).leaf;
    const { graph, details } = graphOf(documents, "root");
    expect(collectionSubtreeHydrated(graph, details, "root")).toBe(false);
  });

  it("refuses a LOADED collection with an unloaded grandchild", () => {
    // The case the predicate exists for. `root` and `mid` are both present, so
    // asking only about immediate children would vouch for root — while its
    // duration is quietly standing in `deep`'s stored summary.
    const { graph, details } = graphOf(
      {
        root: { id: "root", title: "root", clips: [collectionClip("c-mid", "mid", "Mid")] },
        mid: { id: "mid", title: "Mid", clips: [collectionClip("c-deep", "deep", "Deep")] },
      },
      "root",
    );
    // Not a vacuous pass: the root has NO detail entry (details come from a
    // parent's clip, and the focused root is nobody's clip), so the refusal
    // has to come from `deep`, two levels down.
    expect(details.root).toBeUndefined();
    expect(details.mid?.hydrated).toBe(true);
    expect(details.deep?.hydrated).toBe(false);
    expect(collectionSubtreeHydrated(graph, details, "root")).toBe(false);
  });

  it("still refuses when a document is LOADED but not hydrated into the graph", () => {
    // A fact about the client worth pinning: `buildFocusedGraph` hydrates the
    // focused collection and ONE level below it. `deep` below is present in the
    // documents and still comes back unhydrated, because nothing has called
    // `hydrateTimeline` for it — drill-in and sub-timeline expansion do that.
    //
    // Which is why the server's full-closure derivation existed at all: the
    // client's graph never held the deep documents, so every number below the
    // first level came from the clip summaries the server had just recomputed.
    // Reading one level and vouching is the same bargain made honestly.
    const { graph, details } = graphOf(
      {
        root: { id: "root", title: "root", clips: [collectionClip("c-mid", "mid", "Mid")] },
        mid: { id: "mid", title: "Mid", clips: [collectionClip("c-deep", "deep", "Deep")] },
        deep: { id: "deep", title: "Deep", clips: packTimelineClips([image("d-a", 4)]) },
      },
      "root",
    );
    expect(details.deep?.hydrated).toBe(false);
    expect(collectionSubtreeHydrated(graph, details, "root")).toBe(false);
  });

  it("treats a DANGLING child as resolved, not as pending forever", () => {
    // The card this fixed: five dangling references under one collection held
    // an otherwise complete 133-document branch at "no duration" permanently,
    // because a document that does not exist can never arrive. Gone is known —
    // it contributes nothing, and the total is exactly computable without it.
    const { graph, details } = graphOf(
      {
        root: {
          id: "root",
          title: "root",
          clips: [collectionClip("c-gone", "gone", "Gone")],
        },
      },
      "root",
    );
    expect(collectionSubtreeHydrated(graph, details, "root")).toBe(false);
    expect(collectionSubtreeHydrated(graph, details, "root", (id) => id === "gone")).toBe(true);
  });

  it("vouches for a DUPLICATE placement once the original is loaded", () => {
    // A second reference to the same collection is demoted to a card with no
    // children of its own, permanently unhydrated. Waiting on it blocked every
    // ancestor forever — a real project had one such duplicate, and it alone
    // kept a 133-document branch timeless after the dangling ids were handled.
    // Its content is not unknown: the original placement is right there.
    const { graph, details } = graphOf(
      {
        root: {
          id: "root",
          title: "root",
          clips: packTimelineClips([
            collectionClip("ref-a", "leaf", "Leaf"),
            collectionClip("ref-b", "leaf", "Leaf"),
          ]),
        },
        leaf: { id: "leaf", title: "Leaf", clips: packTimelineClips([image("m-a", 4)]) },
      },
      "root",
    );

    expect(details["ref-b"]).toMatchObject({ duplicateOfTimelineId: "leaf" });
    expect(details["ref-b"]?.hydrated).toBe(false);
    expect(collectionSubtreeHydrated(graph, details, "root")).toBe(true);
  });

  it("counts a duplicate's REAL content rather than its stored summary", () => {
    // The reason vouching for it is honest. The walk used to read the dup
    // card's stored duration, a copy nothing maintains — in the real project
    // the two parents of one duplicated collection stored 6.12s and 7.12s for
    // the same 4.0s of content, so at least one was always wrong and its
    // ancestors inherited the error.
    const { graph, details } = graphOf(
      {
        root: {
          id: "root",
          title: "root",
          clips: packTimelineClips([
            collectionClip("ref-a", "leaf", "Leaf"),
            { ...collectionClip("ref-b", "leaf", "Leaf"), duration: 999 },
          ]),
        },
        leaf: { id: "leaf", title: "Leaf", clips: packTimelineClips([image("m-a", 4)]) },
      },
      "root",
    );

    // Two placements of a 4s leaf, one gap between them — NOT 4 + gap + 999.
    expect(hydratedCollectionDuration(graph, details, parseNodeId("root"))).toBeCloseTo(8.12, 5);
  });

  it("counts a DANGLING child as zero playable seconds, not its stored duration", () => {
    // What the board was doing: quoting the remembered length of a document
    // that no longer exists. Five of these added 33.9s to one collection, so a
    // card claimed 19:24 of material when 18:51 of it was real.
    const { graph, details } = graphOf(
      {
        root: {
          id: "root",
          title: "root",
          clips: packTimelineClips([
            { ...collectionClip("c-gone", "gone", "Gone"), duration: 12.36 },
            collectionClip("c-leaf", "leaf", "Leaf"),
          ]),
        },
        leaf: { id: "leaf", title: "Leaf", clips: packTimelineClips([image("m-a", 4)]) },
      },
      "root",
    );

    // Unaware of the absence, it quotes the stored 12.36.
    expect(hydratedCollectionPlayableDuration(graph, details, parseNodeId("root"))).toBeCloseTo(
      12.36 + 0.12 + 4,
      5,
    );
    // Told the document is gone, it contributes nothing — but the GAP stays,
    // because the broken reference still draws a card between its neighbours.
    expect(
      hydratedCollectionPlayableDuration(
        graph,
        details,
        parseNodeId("root"),
        (id) => id === "gone",
      ),
    ).toBeCloseTo(0.12 + 4, 5);
  });

  it("vouches for a one-level tree, which is what a board actually shows", () => {
    // The case that makes the board useful rather than blank: the focused
    // collection plus media-only children is fully in the graph, so its cards
    // and the header both earn their times. Measured on the real project, this
    // is 103 of 149 collections.
    const { graph, details } = graphOf(media("root"), "root");
    expect(collectionSubtreeHydrated(graph, details, "root")).toBe(true);
  });
});

describe("hydratedCollectionPlayableSpan", () => {
  /**
   * The board header's number, and why it needed its own function.
   *
   * It was measured from card GEOMETRY (`playableSpanSeconds` over the spans
   * the strip draws), which keeps a card's full slot even when its descendants
   * are disabled. On a real project the header read 23:01 while its own three
   * cards summed to about 20:45 — more than half of one branch is disabled deep
   * inside. The spans carry no node id, so the playable length could not be
   * recovered from them.
   *
   * Its lane-blind twin cannot simply be reused: `graphChildrenToClips`
   * projects through that one to persist each clip's `playableDuration`.
   */
  it("excludes what a disabled descendant contributes", () => {
    const documents = {
      root: { id: "root", title: "root", clips: [collectionClip("c-kid", "kid", "Kid")] },
      kid: {
        id: "kid",
        title: "Kid",
        clips: packTimelineClips([image("k-a", 4), { ...image("k-b", 6), disabled: true }]),
      },
    };
    const focused = buildFocusedGraph(documents, "root");
    if (!focused.ok) throw new Error(focused.error);
    const { graph, details } = focused.value;

    // 4s plays, 6s does not.
    expect(hydratedCollectionPlayableSpan(graph, details, parseNodeId("root"))).toBeCloseTo(4, 5);
  });

  it("takes the LONGEST lane, not the sum — lanes play together", () => {
    // A 4s bed under a 4s shot is a 4s timeline, not an 8s one.
    const documents = {
      root: {
        id: "root",
        title: "root",
        clips: packTimelineClips([image("picture", 4), { ...image("bed", 4), trackIndex: 1 }]),
      },
    };
    const focused = buildFocusedGraph(documents, "root");
    if (!focused.ok) throw new Error(focused.error);
    const { graph, details } = focused.value;

    expect(hydratedCollectionPlayableSpan(graph, details, parseNodeId("root"))).toBeCloseTo(4, 5);
  });

  it("counts a dangling child as nothing, like every other readout", () => {
    const documents = {
      root: {
        id: "root",
        title: "root",
        clips: packTimelineClips([
          { ...collectionClip("c-gone", "gone", "Gone"), duration: 12.36 },
          collectionClip("c-leaf", "leaf", "Leaf"),
        ]),
      },
      leaf: { id: "leaf", title: "Leaf", clips: packTimelineClips([image("m-a", 4)]) },
    };
    const focused = buildFocusedGraph(documents, "root");
    if (!focused.ok) throw new Error(focused.error);
    const { graph, details } = focused.value;

    expect(
      hydratedCollectionPlayableSpan(graph, details, parseNodeId("root"), (id) => id === "gone"),
    ).toBeCloseTo(0.12 + 4, 5);
  });
});

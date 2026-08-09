import { describe, expect, test } from "vitest";
import {
  buildGraph,
  findGraphInvariantViolation,
  getChildren,
  getDocumentOrder,
  isSameOrAncestor,
  hasSourceWindow,
  isVideoMedia,
  mediaDurationSeconds,
  parseCollectionItemNode,
  parseGraphSpec,
  validateGraph,
  videoFrameCount,
  MAX_VIDEO_FRAMES,
  parseNodeId,
  EMPTY_GRAPH,
  type GraphNodeSpec,
  type MediaNode,
} from "./graph";

const media = (id: string, name = id): GraphNodeSpec => ({ kind: "media", id, name });
const collection = (
  id: string,
  children: readonly GraphNodeSpec[] = [],
  name = id
): GraphNodeSpec => ({ kind: "collection", id, name, children });

function build(roots: readonly GraphNodeSpec[]) {
  const result = buildGraph(roots);
  if (!result.ok) throw new Error(`buildGraph failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("media image/video model", () => {
  const nodeOf = (g: ReturnType<typeof build>, id: string): MediaNode => {
    const n = g.nodesById.get(parseNodeId(id));
    if (!n || n.kind !== "media") throw new Error(`not a media node: ${id}`);
    return n;
  };

  test("a plain media spec builds an image with the default duration", () => {
    const g = build([collection("root", [media("img")])]);
    const node = nodeOf(g, "img");
    expect(node.mediaKind).toBe("image");
    expect(mediaDurationSeconds(node)).toBe(4);
    expect(isVideoMedia(node)).toBe(false);
  });

  test("a video spec builds a video; effective duration = full - in - out", () => {
    const g = build([
      collection("root", [
        {
          kind: "media",
          mediaKind: "video",
          id: "vid",
          name: "Vid",
          fullDurationSeconds: 10,
          trimInSeconds: 2,
          trimOutSeconds: 3,
        },
      ]),
    ]);
    const node = nodeOf(g, "vid");
    expect(isVideoMedia(node)).toBe(true);
    expect(mediaDurationSeconds(node)).toBe(5);
  });

  test("video trim defaults to 0 (untrimmed) and effective duration clamps at 0", () => {
    const g = build([
      collection("root", [
        { kind: "media", mediaKind: "video", id: "v", name: "V", fullDurationSeconds: 8 },
      ]),
    ]);
    expect(mediaDurationSeconds(nodeOf(g, "v"))).toBe(8);
    // Over-trimmed hand-built node: never negative.
    const overTrimmed: MediaNode = {
      id: parseNodeId("x"),
      kind: "media",
      mediaKind: "video",
      name: "X",
      fullDurationSeconds: 5,
      trimInSeconds: 4,
      trimOutSeconds: 4,
    };
    expect(mediaDurationSeconds(overTrimmed)).toBe(0);
  });
});

describe("videoFrameCount", () => {
  test("scales with length: ~1 frame per 2s, at least 1, capped", () => {
    expect(videoFrameCount(0)).toBe(1); // zero/degenerate -> a single frame
    expect(videoFrameCount(1)).toBe(1); // round(0.5) = 1 (min applies)
    expect(videoFrameCount(4)).toBe(2);
    expect(videoFrameCount(6)).toBe(3);
    expect(videoFrameCount(100)).toBe(MAX_VIDEO_FRAMES); // capped
  });

  test("a tighter per-view max caps it further", () => {
    expect(videoFrameCount(100, 3)).toBe(3);
    expect(videoFrameCount(4, 1)).toBe(1);
  });

  test("malformed per-view caps fall back to a safe finite cap", () => {
    expect(videoFrameCount(100, Number.NaN)).toBe(MAX_VIDEO_FRAMES);
    expect(videoFrameCount(100, Number.POSITIVE_INFINITY)).toBe(MAX_VIDEO_FRAMES);
    expect(videoFrameCount(100, -4)).toBe(1);
  });

  test("non-finite durations degrade to a single frame", () => {
    expect(videoFrameCount(Number.NaN)).toBe(1);
    expect(videoFrameCount(Number.POSITIVE_INFINITY)).toBe(1);
    expect(videoFrameCount(-5)).toBe(1);
  });
});

describe("parseNodeId", () => {
  test("returns the id for non-empty strings", () => {
    expect(parseNodeId("a")).toBe("a");
    expect(parseNodeId(" a ")).toBe(" a "); // trimmed only for the emptiness check
  });

  test("throws on empty or whitespace-only ids", () => {
    expect(() => parseNodeId("")).toThrow(/Invalid NodeId/);
    expect(() => parseNodeId("   ")).toThrow(/Invalid NodeId/);
  });
});

describe("runtime graph validation", () => {
  test("parses normalized nodes into fresh, safe values", () => {
    const source = {
      id: "video",
      kind: "media",
      mediaKind: "video",
      name: "Video",
      posterSrcs: ["one.jpg", "two.jpg"],
      fullDurationSeconds: 10,
      trimInSeconds: 2,
      trimOutSeconds: 1,
    };
    const parsed = parseCollectionItemNode(source);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.value.kind !== "media" || !isVideoMedia(parsed.value)) return;
    expect(parsed.value).not.toBe(source);
    expect(parsed.value.posterSrcs).not.toBe(source.posterSrcs);
    expect(mediaDurationSeconds(parsed.value)).toBe(7);
  });

  test("rejects malformed node kinds, numeric media, posters, and over-trimming", () => {
    expect(parseCollectionItemNode({ id: "x", kind: "wat", name: "X" })).toMatchObject({
      ok: false,
      error: { path: "$.kind" },
    });
    expect(
      parseCollectionItemNode({
        id: "x",
        kind: "media",
        name: "X",
        durationSeconds: Number.NaN,
      })
    ).toMatchObject({ ok: false, error: { path: "$.durationSeconds" } });
    expect(
      parseCollectionItemNode({
        id: "x",
        kind: "media",
        mediaKind: "video",
        name: "X",
        posterSrcs: ["valid.jpg", 42],
        fullDurationSeconds: 10,
        trimInSeconds: 1,
        trimOutSeconds: 1,
      })
    ).toMatchObject({ ok: false, error: { path: "$.posterSrcs[1]" } });
    expect(
      parseCollectionItemNode({
        id: "x",
        kind: "media",
        mediaKind: "video",
        name: "X",
        fullDurationSeconds: 5,
        trimInSeconds: 3,
        trimOutSeconds: 3,
      })
    ).toMatchObject({ ok: false, error: { path: "$" } });
  });

  test("validates deeply nested graph specs iteratively and reports a precise path", () => {
    const valid = parseGraphSpec([
      collection("root", [
        {
          kind: "media",
          mediaKind: "video",
          id: "video",
          name: "Video",
          fullDurationSeconds: 10,
        },
      ]),
    ]);
    expect(valid.ok).toBe(true);

    const invalid = parseGraphSpec([
      {
        kind: "collection",
        id: "root",
        name: "Root",
        children: [
          {
            kind: "media",
            id: "bad",
            name: "Bad",
            durationSeconds: Number.POSITIVE_INFINITY,
          },
        ],
      },
    ]);
    expect(invalid).toMatchObject({
      ok: false,
      error: { path: "$[0].children[0].durationSeconds" },
    });
  });

  test("validates normalized node fields before structural graph invariants", () => {
    const graph = build([collection("root", [media("image")])]);
    expect(validateGraph(graph)).toEqual({ ok: true, value: undefined });

    const image = graph.nodesById.get(parseNodeId("image"));
    // `hasSourceWindow`, not `isVideoMedia`: audio is also not an image, and
    // narrowing by "not video" alone leaves a node with no `durationSeconds`.
    if (!image || image.kind !== "media" || hasSourceWindow(image)) {
      throw new Error("expected image fixture");
    }
    const nodesById = new Map(graph.nodesById);
    nodesById.set(image.id, { ...image, durationSeconds: Number.NaN });
    const invalid = validateGraph({ ...graph, nodesById });
    expect(invalid).toMatchObject({
      ok: false,
      error: { path: '$.nodesById["image"].durationSeconds' },
    });
  });

  test("rejects malformed node identity and media fields at their exact paths", () => {
    const cases: ReadonlyArray<readonly [value: unknown, path: string]> = [
      [null, "$"],
      [{ id: 1, kind: "collection", name: "Collection" }, "$.id"],
      [{ id: " ", kind: "collection", name: "Collection" }, "$.id"],
      [{ id: "collection", kind: "collection", name: 1 }, "$.name"],
      // "audio" is a REAL kind now (#309) — the rejection case it used to hold
      // moved to an unknown kind, so this path stays covered.
      [{ id: "media", kind: "media", mediaKind: "caption", name: "Media" }, "$.mediaKind"],
      // Audio is windowed like video, so it is its SOURCE fields that are
      // required — a lone durationSeconds is not enough.
      [
        { id: "media", kind: "media", mediaKind: "audio", name: "Media", durationSeconds: 4 },
        "$.fullDurationSeconds",
      ],
      [
        {
          id: "media",
          kind: "media",
          mediaKind: "audio",
          name: "Media",
          fullDurationSeconds: 4,
          trimInSeconds: 0,
          trimOutSeconds: 0,
          posterSrcs: ["a.jpg"],
        },
        "$.posterSrcs",
      ],
      [
        { id: "media", kind: "media", name: "Media", src: 42, durationSeconds: 4 },
        "$.src",
      ],
      [{ id: "media", kind: "media", name: "Media" }, "$.durationSeconds"],
      [
        { id: "media", kind: "media", name: "Media", durationSeconds: "4" },
        "$.durationSeconds",
      ],
      [
        { id: "media", kind: "media", name: "Media", durationSeconds: -1 },
        "$.durationSeconds",
      ],
      [
        { id: "video", kind: "media", mediaKind: "video", name: "Video" },
        "$.fullDurationSeconds",
      ],
      [
        {
          id: "video",
          kind: "media",
          mediaKind: "video",
          name: "Video",
          fullDurationSeconds: 10,
        },
        "$.trimInSeconds",
      ],
      [
        {
          id: "video",
          kind: "media",
          mediaKind: "video",
          name: "Video",
          fullDurationSeconds: 10,
          trimInSeconds: 0,
        },
        "$.trimOutSeconds",
      ],
      [
        {
          id: "video",
          kind: "media",
          mediaKind: "video",
          name: "Video",
          fullDurationSeconds: 10,
          trimInSeconds: 0,
          trimOutSeconds: 0,
          posterSrcs: "poster.jpg",
        },
        "$.posterSrcs",
      ],
    ];

    for (const [value, path] of cases) {
      expect(parseCollectionItemNode(value)).toMatchObject({
        ok: false,
        error: { path },
      });
    }

    expect(
      parseCollectionItemNode({
        id: "image",
        kind: "media",
        mediaKind: "image",
        name: "Image",
        src: "image.jpg",
        durationSeconds: 4,
      })
    ).toMatchObject({
      ok: true,
      value: { id: "image", mediaKind: "image", src: "image.jpg" },
    });
  });

  test("validates graph container and index shapes before invariants", () => {
    const cases: ReadonlyArray<readonly [value: unknown, path: string]> = [
      [null, "$"],
      [{}, "$.nodesById"],
      [
        { nodesById: new Map(), childrenById: {}, parentById: new Map(), rootIds: [] },
        "$.childrenById",
      ],
      [
        { nodesById: new Map(), childrenById: new Map(), parentById: {}, rootIds: [] },
        "$.parentById",
      ],
      [
        {
          nodesById: new Map(),
          childrenById: new Map(),
          parentById: new Map(),
          rootIds: {},
        },
        "$.rootIds",
      ],
      [
        {
          nodesById: new Map([["", { id: "", kind: "collection", name: "Root" }]]),
          childrenById: new Map(),
          parentById: new Map(),
          rootIds: [],
        },
        "$.nodesById",
      ],
      [
        {
          nodesById: new Map([
            [
              "expected",
              {
                id: "actual",
                kind: "media",
                mediaKind: "image",
                name: "Image",
                durationSeconds: 4,
              },
            ],
          ]),
          childrenById: new Map(),
          parentById: new Map(),
          rootIds: [],
        },
        '$.nodesById["expected"].id',
      ],
      [
        {
          nodesById: new Map(),
          childrenById: new Map([["", []]]),
          parentById: new Map(),
          rootIds: [],
        },
        "$.childrenById",
      ],
      [
        {
          nodesById: new Map(),
          childrenById: new Map([["root", "child"]]),
          parentById: new Map(),
          rootIds: [],
        },
        '$.childrenById["root"]',
      ],
      [
        {
          nodesById: new Map(),
          childrenById: new Map([["root", [""]]]),
          parentById: new Map(),
          rootIds: [],
        },
        '$.childrenById["root"][0]',
      ],
      [
        {
          nodesById: new Map(),
          childrenById: new Map(),
          parentById: new Map([["", null]]),
          rootIds: [],
        },
        "$.parentById",
      ],
      [
        {
          nodesById: new Map(),
          childrenById: new Map(),
          parentById: new Map([["child", 1]]),
          rootIds: [],
        },
        '$.parentById["child"]',
      ],
      [
        {
          nodesById: new Map(),
          childrenById: new Map(),
          parentById: new Map(),
          rootIds: [""],
        },
        "$.rootIds[0]",
      ],
    ];

    for (const [value, path] of cases) {
      expect(validateGraph(value)).toMatchObject({
        ok: false,
        error: { path },
      });
    }
  });

  test("accepts omitted spec defaults and reports normalized graph invariant failures", () => {
    const withoutChildren: GraphNodeSpec = {
      kind: "collection",
      id: "root",
      name: "Root",
    };
    const graph = build([withoutChildren]);
    expect(getChildren(graph, parseNodeId("root"))).toEqual([]);

    expect(
      parseGraphSpec([
        withoutChildren,
        { kind: "media", id: "draft", name: "Draft", src: "draft.jpg" },
      ])
    ).toMatchObject({ ok: true });

    const corrupted = {
      ...graph,
      parentById: new Map([[parseNodeId("root"), parseNodeId("root")]]),
    };
    expect(validateGraph(corrupted)).toMatchObject({
      ok: false,
      error: {
        reason: "graph-invariant",
        violation: { reason: "child-parent-mismatch", childId: "root" },
      },
    });
  });
});

describe("getChildren", () => {
  const graph = build([collection("root", [media("m1"), collection("f", [media("m2")])])]);

  test("returns [] for unknown and media ids", () => {
    expect(getChildren(graph, parseNodeId("nope"))).toEqual([]);
    expect(getChildren(graph, parseNodeId("m1"))).toEqual([]); // media has no children entry
  });

  test("the unknown-id fallback is reference-stable across calls", () => {
    // Selectors pass getChildren results straight to useCollectionsSelector;
    // a fresh [] per call would defeat the Object.is bail and re-render a
    // dead-id view on every store notify.
    expect(getChildren(graph, parseNodeId("nope"))).toBe(getChildren(graph, parseNodeId("nope")));
    expect(getChildren(graph, parseNodeId("m1"))).toBe(getChildren(graph, parseNodeId("nope")));
  });

  test("returns the ordered children of a collection", () => {
    expect(getChildren(graph, parseNodeId("root"))).toEqual(["m1", "f"]);
  });
});

describe("EMPTY_GRAPH", () => {
  test("passes the invariant checker and has no roots", () => {
    expect(findGraphInvariantViolation(EMPTY_GRAPH)).toBeNull();
    expect(EMPTY_GRAPH.rootIds).toEqual([]);
  });
});

describe("buildGraph", () => {
  test("denormalizes a nested spec into consistent indexes", () => {
    const graph = build([
      collection("root-a", [media("m1"), collection("folder", [media("m2")])]),
      collection("root-b", [media("m3")]),
    ]);

    expect(graph.rootIds).toEqual(["root-a", "root-b"]);
    expect(getChildren(graph, parseNodeId("root-a"))).toEqual(["m1", "folder"]);
    expect(getChildren(graph, parseNodeId("folder"))).toEqual(["m2"]);
    expect(graph.parentById.get(parseNodeId("m2"))).toBe("folder");
    expect(graph.parentById.get(parseNodeId("root-a"))).toBeNull();
    expect(findGraphInvariantViolation(graph)).toBeNull();
  });

  test("rejects duplicate ids anywhere in the tree", () => {
    const result = buildGraph([
      collection("root", [media("dup"), collection("folder", [media("dup")])]),
    ]);
    expect(result).toEqual({ ok: false, error: { reason: "duplicate-id", id: "dup" } });
  });

  test("rejects a media node as a root", () => {
    const result = buildGraph([media("m1")]);
    expect(result).toEqual({ ok: false, error: { reason: "root-not-collection", id: "m1" } });
  });

  test("rejects empty ids", () => {
    const result = buildGraph([collection("root", [media("")])]);
    expect(result).toEqual({ ok: false, error: { reason: "empty-id" } });
  });

  test("rejects a media spec that carries children instead of silently dropping the subtree", () => {
    // A mis-tagged collection (kind "media" + children) used to pass
    // validation with the whole subtree silently discarded — and duplicate
    // ids hidden inside it evaded the duplicate-id check entirely.
    const misTagged = {
      kind: "media",
      id: "oops",
      name: "Oops",
      durationSeconds: 4,
      children: [{ kind: "media", id: "lost", name: "Lost", durationSeconds: 2 }],
    } as unknown as GraphNodeSpec;
    const result = buildGraph([collection("root", [misTagged])]);
    expect(result).toMatchObject({
      ok: false,
      error: {
        reason: "invalid-spec",
        error: { reason: "invalid-value", path: "$[0].children[0].children" },
      },
    });
  });

  test("rejects malformed runtime node fields before normalizing them", () => {
    const result = buildGraph([
      {
        kind: "collection",
        id: "root",
        name: "Root",
        children: [
          {
            kind: "media",
            id: "bad",
            name: "Bad",
            durationSeconds: Number.NaN,
          },
        ],
      },
    ]);
    expect(result).toMatchObject({
      ok: false,
      error: {
        reason: "invalid-spec",
        error: { path: "$[0].children[0].durationSeconds" },
      },
    });
  });

  test("survives pathological depth without recursion", () => {
    let spec: GraphNodeSpec = media("leaf");
    for (let i = 0; i < 20_000; i++) {
      spec = collection(`c${i}`, [spec]);
    }
    const graph = build([collection("root", [spec])]);
    expect(graph.nodesById.size).toBe(20_002);
  });

  test("copies posterSrcs — mutating the caller's array never reaches the graph", () => {
    const posterSrcs = ["a.jpg", "b.jpg"];
    const graph = build([
      collection("root", [
        {
          kind: "media",
          mediaKind: "video",
          id: "v1",
          name: "V1",
          posterSrcs,
          fullDurationSeconds: 10,
        },
      ]),
    ]);

    posterSrcs.push("evil.jpg");
    const node = graph.nodesById.get(parseNodeId("v1"));
    expect(node?.kind === "media" && node.mediaKind === "video" ? node.posterSrcs : null).toEqual([
      "a.jpg",
      "b.jpg",
    ]);
  });
});

describe("isSameOrAncestor", () => {
  const graph = build([
    collection("root", [collection("outer", [collection("inner", [media("m1")])])]),
  ]);

  test("a node is its own ancestor for guard purposes", () => {
    expect(isSameOrAncestor(graph, parseNodeId("inner"), parseNodeId("inner"))).toBe(true);
  });

  test("walks up through parents", () => {
    expect(isSameOrAncestor(graph, parseNodeId("root"), parseNodeId("m1"))).toBe(true);
    expect(isSameOrAncestor(graph, parseNodeId("outer"), parseNodeId("m1"))).toBe(true);
  });

  test("false for siblings/descendants", () => {
    expect(isSameOrAncestor(graph, parseNodeId("m1"), parseNodeId("inner"))).toBe(false);
  });
});

describe("getDocumentOrder", () => {
  test("depth-first reading order across roots", () => {
    const graph = build([
      collection("a", [media("a1"), collection("af", [media("af1")]), media("a2")]),
      collection("b", [media("b1")]),
    ]);
    const order = getDocumentOrder(graph);
    const rank = (id: string) => order.get(parseNodeId(id))!;
    expect(rank("a")).toBeLessThan(rank("a1"));
    expect(rank("a1")).toBeLessThan(rank("af"));
    expect(rank("af")).toBeLessThan(rank("af1"));
    expect(rank("af1")).toBeLessThan(rank("a2"));
    expect(rank("a2")).toBeLessThan(rank("b"));
  });
});

describe("findGraphInvariantViolation", () => {
  test("catches a child whose parent index disagrees", () => {
    const graph = build([collection("root", [media("m1")])]);
    const corrupted = {
      ...graph,
      parentById: new Map([...graph.parentById, [parseNodeId("m1"), null]]),
    };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "child-parent-mismatch",
      childId: "m1",
      expectedParentId: "root",
    });
  });

  test("catches unreachable nodes", () => {
    const graph = build([collection("root", [media("m1")])]);
    const orphan = { id: parseNodeId("ghost"), kind: "media", name: "Ghost", durationSeconds: 1 } as const;
    const corrupted = {
      ...graph,
      nodesById: new Map([...graph.nodesById, [orphan.id, orphan]]),
      parentById: new Map([...graph.parentById, [orphan.id, null]]),
    };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "unreachable-node",
      id: "ghost",
    });
  });

  test("catches duplicate root ids", () => {
    const graph = build([collection("root", [media("m1")])]);
    const corrupted = { ...graph, rootIds: [parseNodeId("root"), parseNodeId("root")] };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "duplicate-root",
      id: "root",
    });
  });

  test("catches a media node listed as a root", () => {
    const graph = build([collection("root", [media("m1")])]);
    const corrupted = {
      ...graph,
      rootIds: [...graph.rootIds, parseNodeId("m1")],
    };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "root-not-collection",
      id: "m1",
    });
  });

  test("catches a root that also appears in a children list (the root-move corruption shape)", () => {
    // This is exactly the graph shape the cannot-move-root rejection in
    // commands.ts exists to prevent: a node in rootIds AND in some
    // collection's children.
    const graph = build([
      collection("root-a", [media("m1")]),
      collection("root-b", []),
    ]);
    const corrupted = {
      ...graph,
      childrenById: new Map([
        ...graph.childrenById,
        [parseNodeId("root-a"), [parseNodeId("m1"), parseNodeId("root-b")]],
      ]),
      parentById: new Map([...graph.parentById]),
    };
    const violation = findGraphInvariantViolation(corrupted);
    expect(violation && "id" in violation ? violation.id : violation?.reason).toBe("root-b");
  });

  test("catches a collection node with no childrenById entry", () => {
    // buildGraph always creates the entry; this shape only appears in
    // hand-constructed or corrupted graphs — which is what the checker is
    // for. A childless collection with a missing entry used to pass because
    // only parents referenced via parentById were checked.
    const graph = build([collection("root", [collection("leaf", [])])]);
    const prunedChildren = new Map(graph.childrenById);
    prunedChildren.delete(parseNodeId("leaf"));
    const corrupted = { ...graph, childrenById: prunedChildren };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "collection-missing-children-entry",
      id: "leaf",
    });
  });

  test("catches a root collection with no childrenById entry", () => {
    const graph = build([collection("root", [])]);
    const corrupted = { ...graph, childrenById: new Map() };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "collection-missing-children-entry",
      id: "root",
    });
  });

  test("catches a dangling parentById key for a node that does not exist", () => {
    const graph = build([collection("root", [media("m1")])]);
    const corrupted = {
      ...graph,
      parentById: new Map([...graph.parentById, [parseNodeId("ghost"), parseNodeId("root")]]),
    };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "missing-node",
      id: "ghost",
    });
  });

  test("catches a parent pointer at a media node", () => {
    const graph = build([collection("root", [media("m1"), media("m2")])]);
    const corrupted = {
      ...graph,
      parentById: new Map([...graph.parentById, [parseNodeId("m2"), parseNodeId("m1")]]),
    };
    const violation = findGraphInvariantViolation(corrupted);
    // Order-insensitive: either the child/parent index disagreement or the
    // media-parent check may fire first, both flag the corruption.
    expect(violation).not.toBeNull();
    expect(["parent-not-collection", "child-parent-mismatch"]).toContain(violation!.reason);
  });
});

import { describe, expect, it } from "vitest";

import {
  applyPatch,
  invertPatch,
  isEmptyPatch,
  patchDetachedSubtrees,
  patchTouchedNodeIds,
  scrubPatchForWrite,
  verifyPatchApplies,
} from "./index";
import {
  findInvariantViolation,
  getSubtreeRev,
  rebuildDerivedIndexes,
} from "../graph";
import {
  defineNodeType,
  makeCollectionNode,
  makeDataChange,
  makeLeafNode,
  makeSealedNode,
  parseNodeId,
  type GraphNode,
  type ChildrenState,
  type DataChange,
  type EngineContext,
  type Graph,
  type Move,
  type NodeId,
  type Patch,
  type Placement,
  type WidenedNodeType,
  type Issue,
  type Result,
  type ConsumerDefinedSummaryType,
} from "../types";
import { DEFAULT_MAX_NODES } from "../serialize";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ClipData = Readonly<{ title: string; assetId: string }>;
type ClipEdit = Readonly<{ title: string }>;

const clipType = defineNodeType<ClipData, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw) {
    if (!isRecord(raw)) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const title = raw["title"];
    const assetId = raw["assetId"];
    if (typeof title !== "string" || typeof assetId !== "string") {
      return { ok: false, error: [{ path: "$", message: "bad clip" }] };
    }
    return { ok: true, value: { title, assetId } };
  },
  serialize(data) {
    return { title: data.title, assetId: data.assetId };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { title: edit.title, assetId: data.assetId } };
  },
  contentKey(data) {
    return data.assetId;
  },
});

type FolderData = Readonly<{ name: string; source: string | null }>;
type FolderEdit = Readonly<{ name: string }>;

const folderType = defineNodeType<FolderData, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw) {
    if (!isRecord(raw)) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const name = raw["name"];
    const source = raw["source"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "bad folder" }] };
    }
    return {
      ok: true,
      value: { name, source: typeof source === "string" ? source : null },
    };
  },
  serialize(data) {
    return { name: data.name, source: data.source };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { name: edit.name, source: data.source } };
  },
  sourceKey(data) {
    return data.source;
  },
});

type TestTypes = readonly [typeof clipType, typeof folderType];
type Summary = Readonly<{ label: string }>;

const registry: ReadonlyMap<string, WidenedNodeType> = new Map<string, WidenedNodeType>(
  [
    ["clip", clipType],
    ["folder", folderType],
  ],
);

const summaryType: ConsumerDefinedSummaryType<Summary> = {
  parse(raw) {
    if (isRecord(raw)) {
      const label = raw["label"];
      if (typeof label === "string") return { ok: true, value: { label } };
    }
    return { ok: false, error: [{ path: "$", message: "bad summary" }] };
  },
  serialize(summary) {
    return { label: summary.label };
  },
};

const ENGINE_ID = Symbol("graph-test-engine");

function makeCtx(engineId: symbol = ENGINE_ID): EngineContext<Summary> {
  return {
    engineId,
    registry,
    summary: summaryType,
    onUnknownKind: "seal",
    onParseFailure: "seal",
    maxNodes: DEFAULT_MAX_NODES,
    maxDepth: null,
    // Unbounded, so this fixture behaves exactly as it did before the
    // id-length ceiling existed.
    maxNodeIdLength: null,
    mintId: () => "minted",
    now: () => 0,
    devChecks: false,
  };
}

const LOADED: ChildrenState = { status: "loaded" };
const UNLOADED: ChildrenState = { status: "unloaded" };
const REFERENCE: ChildrenState = { status: "reference" };

type Spec =
  | Readonly<{ tag: "clip"; id: string; title?: string; asset?: string }>
  | Readonly<{
      tag: "folder";
      id: string;
      name?: string;
      source?: string | null;
      state?: ChildrenState;
      summary?: Summary | null;
      children?: readonly Spec[];
    }>
  | Readonly<{
      tag: "sealed";
      id: string;
      kind?: string;
      container?: boolean;
      state?: ChildrenState | null;
      children?: readonly Spec[];
    }>;

function clip(id: string, asset?: string): Spec {
  return { tag: "clip", id, asset };
}

function folder(id: string, children: readonly Spec[] = []): Spec {
  return { tag: "folder", id, children };
}

const nid = (id: string): NodeId => parseNodeId(id);

/**
 * Builds a graph by hand rather than through `deserialize`, so these tests
 * exercise patches.ts and nothing else. Derived indexes go through the real
 * `rebuildDerivedIndexes`, because a hand-rolled stand-in would let a patch
 * that corrupts them still pass.
 */
function buildGraph(
  roots: readonly Spec[],
  engineId: symbol = ENGINE_ID,
): Graph<TestTypes, Summary> {
  const nodesById = new Map<NodeId, GraphNode<TestTypes, Summary>>();
  const childrenById = new Map<NodeId, readonly NodeId[]>();
  const parentById = new Map<NodeId, NodeId | null>();
  const subtreeRevById = new Map<NodeId, number>();

  const visit = (spec: Spec, parentId: NodeId | null): NodeId => {
    const id = nid(spec.id);
    parentById.set(id, parentId);
    subtreeRevById.set(id, 0);

    if (spec.tag === "clip") {
      nodesById.set(
        id,
        makeLeafNode<TestTypes>(id, "clip", {
          title: spec.id,
          assetId: spec.asset ?? `asset-${spec.id}`,
        }),
      );
      return id;
    }

    if (spec.tag === "folder") {
      const state = spec.state ?? LOADED;
      nodesById.set(
        id,
        makeCollectionNode<TestTypes, Summary>(
          id,
          "folder",
          { name: spec.name ?? spec.id, source: spec.source ?? null },
          state,
          spec.summary ?? null,
        ),
      );
      if (state.status === "loaded") {
        childrenById.set(
          id,
          (spec.children ?? []).map((child) => visit(child, id)),
        );
      }
      return id;
    }

    const state = spec.state === undefined ? LOADED : spec.state;
    nodesById.set(
      id,
      makeSealedNode({
        id,
        kind: spec.kind ?? "mystery",
        container: spec.container ?? true,
        schemaVersion: 3,
        raw: { opaque: spec.id },
        reason: "unknown-kind",
        issues: [],
        children: state,
        summary: null,
      }),
    );
    if (state !== null && state.status === "loaded") {
      childrenById.set(id, (spec.children ?? []).map((child) => visit(child, id)));
    }
    return id;
  };

  const rootIds = roots.map((spec) => visit(spec, null));
  const base: Graph<TestTypes, Summary> = {
    engineId,
    nodesById,
    childrenById,
    parentById,
    rootIds,
    subtreeRevById,
    deadRevById: new Map(),
    placementsByContentKey: new Map(),
    ownerBySourceKey: new Map(),
  };
  return { ...base, ...rebuildDerivedIndexes(base, registry) };
}

/**
 * root
 *  0 a (asset-1)
 *  1 b (asset-2)
 *  2 f1
 *      0 c (asset-1)     <- second placement of asset-1
 *      1 f2 (unloaded)
 */
function sampleGraph(): Graph<TestTypes, Summary> {
  return buildGraph([
    {
      tag: "folder",
      id: "root",
      children: [
        clip("a", "asset-1"),
        clip("b", "asset-2"),
        {
          tag: "folder",
          id: "f1",
          children: [
            clip("c", "asset-1"),
            { tag: "folder", id: "f2", state: UNLOADED, summary: { label: "f2" } },
          ],
        },
      ],
    },
  ]);
}

const kids = (graph: Graph<TestTypes, Summary>, id: string): readonly string[] =>
  (graph.childrenById.get(nid(id)) ?? []).map((child) => String(child));

const rev = (graph: Graph<TestTypes, Summary>, id: string): number | undefined =>
  graph.subtreeRevById.get(nid(id));

const parentOf = (
  graph: Graph<TestTypes, Summary>,
  id: string,
): string | null | undefined => {
  const parent = graph.parentById.get(nid(id));
  return parent === null ? null : parent === undefined ? undefined : String(parent);
};

const nodeOf = (
  graph: Graph<TestTypes, Summary>,
  id: string,
): GraphNode<TestTypes, Summary> | undefined => graph.nodesById.get(nid(id));

/** Structure only, order-normalized, so a remove/restore round trip can be
 *  compared without Map insertion order counting as a difference. */
function snapshot(graph: Graph<TestTypes, Summary>): unknown {
  const sortPairs = (
    pairs: readonly (readonly [string, unknown])[],
  ): readonly (readonly [string, unknown])[] =>
    [...pairs].sort((left, right) =>
      left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0,
    );
  return {
    roots: graph.rootIds.map((id) => String(id)),
    nodes: [...graph.nodesById.keys()].map((id) => String(id)).sort(),
    children: sortPairs(
      [...graph.childrenById.entries()].map(
        ([id, list]) => [String(id), list.map((child) => String(child))] as const,
      ),
    ),
    parents: sortPairs(
      [...graph.parentById.entries()].map(
        ([id, parent]) => [String(id), parent === null ? null : String(parent)] as const,
      ),
    ),
  };
}

function nodeOfOrThrow(
  graph: Graph<TestTypes, Summary>,
  id: string,
): GraphNode<TestTypes, Summary> {
  const node = nodeOf(graph, id);
  if (node === undefined) throw new Error(`fixture is missing node ${id}`);
  return node;
}

function placementOf(
  graph: Graph<TestTypes, Summary>,
  id: string,
  parentId: string,
  index: number,
): Placement<TestTypes, Summary> {
  return { node: nodeOfOrThrow(graph, id), parentId: nid(parentId), index };
}

// ---------------------------------------------------------------------------
// invertPatch
// ---------------------------------------------------------------------------

describe("invertPatch", () => {
  it("swaps move endpoints and preserves array order", () => {
    const patch: Patch<TestTypes, Summary> = {
      type: "moved",
      moves: [
        {
          nodeId: nid("a"),
          fromParentId: nid("root"),
          fromIndex: 0,
          toParentId: nid("f1"),
          toIndex: 2,
        },
        {
          nodeId: nid("b"),
          fromParentId: nid("root"),
          fromIndex: 1,
          toParentId: nid("f1"),
          toIndex: 3,
        },
      ],
    };

    const inverse = invertPatch(patch);
    expect(inverse.type).toBe("moved");
    if (inverse.type !== "moved") return;

    // Order preserved — `applyPatch` owns the walk direction, so the inverter
    // must not reverse anything or the two would reverse it twice.
    expect(inverse.moves.map((move) => String(move.nodeId))).toEqual(["a", "b"]);
    expect(inverse.moves[0]).toEqual({
      nodeId: nid("a"),
      fromParentId: nid("f1"),
      fromIndex: 2,
      toParentId: nid("root"),
      toIndex: 0,
    });
  });

  it("flips inserted to removed with the placements array untouched", () => {
    const graph = sampleGraph();
    const placements = [
      placementOf(graph, "f1", "root", 2),
      placementOf(graph, "c", "f1", 0),
    ];
    const patch: Patch<TestTypes, Summary> = { type: "inserted", placements };

    const inverse = invertPatch(patch);
    expect(inverse.type).toBe("removed");
    if (inverse.type !== "removed") return;
    expect(inverse.placements).toBe(placements);
  });

  it("flips removed to inserted", () => {
    const graph = sampleGraph();
    const patch: Patch<TestTypes, Summary> = {
      type: "removed",
      placements: [placementOf(graph, "b", "root", 1)],
    };
    expect(invertPatch(patch).type).toBe("inserted");
  });

  it("swaps before and after on every data change, in order", () => {
    const changes: readonly DataChange<TestTypes>[] = [
      {
        nodeId: nid("a"),
        kind: "clip",
        before: { title: "old-a", assetId: "asset-1" },
        after: { title: "new-a", assetId: "asset-1" },
      },
      {
        nodeId: nid("b"),
        kind: "clip",
        before: { title: "old-b", assetId: "asset-2" },
        after: { title: "new-b", assetId: "asset-2" },
      },
    ];
    const inverse = invertPatch<TestTypes, Summary>({
      type: "data-changed",
      changes,
    });
    expect(inverse.type).toBe("data-changed");
    if (inverse.type !== "data-changed") return;
    expect(inverse.changes.map((change) => String(change.nodeId))).toEqual([
      "a",
      "b",
    ]);
    expect(inverse.changes[0]?.before).toEqual({
      title: "new-a",
      assetId: "asset-1",
    });
    expect(inverse.changes[0]?.after).toEqual({
      title: "old-a",
      assetId: "asset-1",
    });
  });

  it("is an involution for every patch type", () => {
    const graph = sampleGraph();
    const patches: readonly Patch<TestTypes, Summary>[] = [
      {
        type: "moved",
        moves: [
          {
            nodeId: nid("a"),
            fromParentId: nid("root"),
            fromIndex: 0,
            toParentId: nid("f1"),
            toIndex: 2,
          },
        ],
      },
      { type: "inserted", placements: [placementOf(graph, "b", "root", 1)] },
      { type: "removed", placements: [placementOf(graph, "b", "root", 1)] },
      {
        type: "data-changed",
        changes: [
          {
            nodeId: nid("a"),
            kind: "clip",
            before: { title: "x", assetId: "asset-1" },
            after: { title: "y", assetId: "asset-1" },
          },
        ],
      },
    ];
    for (const patch of patches) {
      expect(invertPatch(invertPatch(patch))).toEqual(patch);
    }
  });

  it("does not mutate the patch it was given", () => {
    const patch: Patch<TestTypes, Summary> = {
      type: "moved",
      moves: [
        {
          nodeId: nid("a"),
          fromParentId: nid("root"),
          fromIndex: 0,
          toParentId: nid("f1"),
          toIndex: 2,
        },
      ],
    };
    const before = JSON.stringify(patch);
    invertPatch(patch);
    expect(JSON.stringify(patch)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// applyPatch — moved
// ---------------------------------------------------------------------------

describe("applyPatch: moved", () => {
  const ctx = makeCtx();

  it("honours the post-removal index on a same-parent reorder", () => {
    const graph = sampleGraph();
    // [a, b, f1] -> move `a` to the end. Post-removal the array is [b, f1], so
    // the end is index 2, NOT 3.
    const moves: readonly Move[] = [
      {
        nodeId: nid("a"),
        fromParentId: nid("root"),
        fromIndex: 0,
        toParentId: nid("root"),
        toIndex: 2,
      },
    ];
    const next = applyPatch(graph, { type: "moved", moves }, ctx);
    expect(kids(next, "root")).toEqual(["b", "f1", "a"]);
    expect(kids(graph, "root")).toEqual(["a", "b", "f1"]);
  });

  it("bumps BOTH ancestor chains, not just the destination's", () => {
    // The named trap: the SOURCE chain exists only in the pre-state parentById.
    // Bumping once against the post-state graph leaves `deep` and `left` stale,
    // so their rollups never re-render.
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          folder("left", [folder("deep", [clip("x")])]),
          folder("right", [clip("y")]),
        ],
      },
    ]);
    const next = applyPatch(
      graph,
      {
        type: "moved",
        moves: [
          {
            nodeId: nid("x"),
            fromParentId: nid("deep"),
            fromIndex: 0,
            toParentId: nid("right"),
            toIndex: 1,
          },
        ],
      },
      ctx,
    );

    expect(kids(next, "deep")).toEqual([]);
    expect(kids(next, "right")).toEqual(["y", "x"]);
    expect(parentOf(next, "x")).toBe("right");

    // Source chain.
    expect(rev(next, "deep")).toBeGreaterThan(rev(graph, "deep") ?? 0);
    expect(rev(next, "left")).toBeGreaterThan(rev(graph, "left") ?? 0);
    // Destination chain.
    expect(rev(next, "right")).toBeGreaterThan(rev(graph, "right") ?? 0);
    // Common ancestor.
    expect(rev(next, "root")).toBeGreaterThan(rev(graph, "root") ?? 0);
  });

  it("keeps relative order when several nodes move together", () => {
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [clip("a"), clip("b"), clip("c"), clip("d")],
      },
    ]);
    // Move b and c to the end: post-removal [a, d], so 2 and 3.
    const next = applyPatch(
      graph,
      {
        type: "moved",
        moves: [
          {
            nodeId: nid("b"),
            fromParentId: nid("root"),
            fromIndex: 1,
            toParentId: nid("root"),
            toIndex: 2,
          },
          {
            nodeId: nid("c"),
            fromParentId: nid("root"),
            fromIndex: 2,
            toParentId: nid("root"),
            toIndex: 3,
          },
        ],
      },
      ctx,
    );
    expect(kids(next, "root")).toEqual(["a", "d", "b", "c"]);
  });

  it("carries no content: nodesById is untouched", () => {
    const graph = sampleGraph();
    const next = applyPatch(
      graph,
      {
        type: "moved",
        moves: [
          {
            nodeId: nid("a"),
            fromParentId: nid("root"),
            fromIndex: 0,
            toParentId: nid("f1"),
            toIndex: 2,
          },
        ],
      },
      ctx,
    );
    expect(next.nodesById).toBe(graph.nodesById);
  });

  it("round-trips through invertPatch", () => {
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [clip("a"), clip("b"), clip("c"), clip("d")],
      },
    ]);
    const patch: Patch<TestTypes, Summary> = {
      type: "moved",
      moves: [
        {
          nodeId: nid("b"),
          fromParentId: nid("root"),
          fromIndex: 1,
          toParentId: nid("root"),
          toIndex: 2,
        },
        {
          nodeId: nid("c"),
          fromParentId: nid("root"),
          fromIndex: 2,
          toParentId: nid("root"),
          toIndex: 3,
        },
      ],
    };
    const moved = applyPatch(graph, patch, ctx);
    // Explicit type arguments: a "moved" patch mentions neither `Ts` nor `S`
    // (moves are pure ids and indices), so there is nothing for inference to
    // read them off. Real callers get them from the Engine method's own scope.
    const inverse = invertPatch<TestTypes, Summary>(patch);
    expect(verifyPatchApplies(moved, inverse, ctx).ok).toBe(true);
    const restored = applyPatch(moved, inverse, ctx);
    expect(kids(restored, "root")).toEqual(["a", "b", "c", "d"]);
    expect(snapshot(restored)).toEqual(snapshot(graph));
  });
});

// ---------------------------------------------------------------------------
// applyPatch — inserted / removed
// ---------------------------------------------------------------------------

describe("applyPatch: inserted", () => {
  const ctx = makeCtx();

  it("walks forward, so a placement can land inside an earlier one", () => {
    const graph = buildGraph([folder("root", [clip("a")])]);
    const newFolder = makeCollectionNode<TestTypes, Summary>(
      nid("n1"),
      "folder",
      { name: "n1", source: null },
      LOADED,
      null,
    );
    const newClip = makeLeafNode<TestTypes>(nid("n2"), "clip", {
      title: "n2",
      assetId: "asset-n2",
    });
    const patch: Patch<TestTypes, Summary> = {
      type: "inserted",
      placements: [
        { node: newFolder, parentId: nid("root"), index: 1 },
        { node: newClip, parentId: nid("n1"), index: 0 },
      ],
    };

    expect(verifyPatchApplies(graph, patch, ctx).ok).toBe(true);
    const next = applyPatch(graph, patch, ctx);

    expect(kids(next, "root")).toEqual(["a", "n1"]);
    expect(kids(next, "n1")).toEqual(["n2"]);
    expect(parentOf(next, "n2")).toBe("n1");
    // subtreeRevById is TOTAL over nodesById — a new node without an entry is a
    // node whose subscribers never fire.
    expect(next.subtreeRevById.has(nid("n1"))).toBe(true);
    expect(next.subtreeRevById.has(nid("n2"))).toBe(true);
    expect(rev(next, "root")).toBeGreaterThan(rev(graph, "root") ?? 0);
  });

  it("gives an inserted empty loaded collection a [] children entry", () => {
    const graph = buildGraph([folder("root", [])]);
    const empty = makeCollectionNode<TestTypes, Summary>(
      nid("n1"),
      "folder",
      { name: "n1", source: null },
      LOADED,
      null,
    );
    const next = applyPatch(
      graph,
      { type: "inserted", placements: [{ node: empty, parentId: nid("root"), index: 0 }] },
      ctx,
    );
    // "loaded with []" and "unloaded" must be distinguishable — collapsing them
    // is the ambiguity the four-state discriminant exists to remove.
    expect(next.childrenById.has(nid("n1"))).toBe(true);
    expect(kids(next, "n1")).toEqual([]);
  });

  it("gives an inserted unloaded collection NO children entry", () => {
    const graph = buildGraph([folder("root", [])]);
    const lazy = makeCollectionNode<TestTypes, Summary>(
      nid("n1"),
      "folder",
      { name: "n1", source: null },
      UNLOADED,
      { label: "n1" },
    );
    const next = applyPatch(
      graph,
      { type: "inserted", placements: [{ node: lazy, parentId: nid("root"), index: 0 }] },
      ctx,
    );
    expect(next.childrenById.has(nid("n1"))).toBe(false);
  });

  it("never touches rootIds", () => {
    const graph = sampleGraph();
    const next = applyPatch(
      graph,
      {
        type: "inserted",
        placements: [
          {
            node: makeLeafNode<TestTypes>(nid("n1"), "clip", {
              title: "n1",
              assetId: "asset-n1",
            }),
            parentId: nid("root"),
            index: 0,
          },
        ],
      },
      ctx,
    );
    expect(next.rootIds).toEqual(graph.rootIds);
  });
});

describe("applyPatch: removed", () => {
  const ctx = makeCtx();

  it("drops the node, its children entry, its parent entry and its rev", () => {
    const graph = sampleGraph();
    const patch: Patch<TestTypes, Summary> = {
      type: "removed",
      placements: [
        placementOf(graph, "f1", "root", 2),
        placementOf(graph, "c", "f1", 0),
        placementOf(graph, "f2", "f1", 1),
      ],
    };
    expect(verifyPatchApplies(graph, patch, ctx).ok).toBe(true);
    const next = applyPatch(graph, patch, ctx);

    expect(kids(next, "root")).toEqual(["a", "b"]);
    for (const gone of ["f1", "c", "f2"]) {
      expect(next.nodesById.has(nid(gone))).toBe(false);
      expect(next.parentById.has(nid(gone))).toBe(false);
      expect(next.childrenById.has(nid(gone))).toBe(false);
      // The rev entry SURVIVES on purpose. It is the fold cache's only
      // invalidation mechanism, and dropping it let a re-inserted id restart
      // low enough to reach the dead lineage's cached values. See the
      // tombstone comment in `applyRemoved`.
      //
      // It now survives in `deadRevById` rather than in `subtreeRevById`, which
      // is a change of ADDRESS and not of contract: the number is the same, the
      // high-water rule is the same, and `getSubtreeRev` still answers with it.
      // What changed is that it is no longer inside the map every commit
      // copies. Both halves are asserted, because "the tombstone moved" and
      // "the tombstone was dropped" must not look alike to this test.
      expect(next.subtreeRevById.has(nid(gone))).toBe(false);
      expect(next.deadRevById.has(nid(gone))).toBe(true);
      expect(getSubtreeRev(next, nid(gone))).toBeGreaterThan(
        getSubtreeRev(graph, nid(gone)),
      );
    }
    // The surviving placement of asset-1 is `a`; `c` left with the subtree.
    expect(
      (next.placementsByContentKey.get("asset-1") ?? []).map((id) => String(id)),
    ).toEqual(["a"]);
  });

  it("walks backward, so two siblings' recorded indices stay valid", () => {
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [clip("a"), clip("b"), clip("c"), clip("d")],
      },
    ]);
    const patch: Patch<TestTypes, Summary> = {
      type: "removed",
      placements: [placementOf(graph, "b", "root", 1), placementOf(graph, "c", "root", 2)],
    };
    expect(verifyPatchApplies(graph, patch, ctx).ok).toBe(true);
    const next = applyPatch(graph, patch, ctx);
    expect(kids(next, "root")).toEqual(["a", "d"]);
  });

  it("restores the exact structure when the removal is inverted", () => {
    const graph = sampleGraph();
    const patch: Patch<TestTypes, Summary> = {
      type: "removed",
      placements: [
        placementOf(graph, "f1", "root", 2),
        placementOf(graph, "c", "f1", 0),
        placementOf(graph, "f2", "f1", 1),
      ],
    };
    const removed = applyPatch(graph, patch, ctx);
    const inverse = invertPatch(patch);
    expect(verifyPatchApplies(removed, inverse, ctx).ok).toBe(true);
    const restored = applyPatch(removed, inverse, ctx);

    expect(snapshot(restored)).toEqual(snapshot(graph));
    // The unloaded placeholder came back as a placeholder, not as an empty
    // loaded collection.
    expect(restored.childrenById.has(nid("f2"))).toBe(false);
    expect(
      (restored.placementsByContentKey.get("asset-1") ?? []).map((id) => String(id)),
    ).toEqual(["a", "c"]);
  });

  it("bumps the surviving parent's chain", () => {
    const graph = sampleGraph();
    const next = applyPatch(
      graph,
      { type: "removed", placements: [placementOf(graph, "b", "root", 1)] },
      ctx,
    );
    expect(rev(next, "root")).toBeGreaterThan(rev(graph, "root") ?? 0);
  });
});

// ---------------------------------------------------------------------------
// applyPatch — data-changed
// ---------------------------------------------------------------------------

describe("applyPatch: data-changed", () => {
  const ctx = makeCtx();

  it("replaces data while preserving children state and summary", () => {
    const graph = sampleGraph();
    const next = applyPatch(
      graph,
      {
        type: "data-changed",
        changes: [
          {
            nodeId: nid("f2"),
            kind: "folder",
            before: { name: "f2", source: null },
            after: { name: "renamed", source: null },
          },
        ],
      },
      ctx,
    );
    const node = nodeOf(next, "f2");
    expect(node).toBeDefined();
    if (node === undefined || node.sealed || !node.container) {
      throw new Error("f2 should still be a collection");
    }
    expect(node.data).toEqual({ name: "renamed", source: null });
    expect(node.children).toEqual(UNLOADED);
    expect(node.summary).toEqual({ label: "f2" });
  });

  it("bumps the changed node and every ancestor", () => {
    const graph = sampleGraph();
    const next = applyPatch(
      graph,
      {
        type: "data-changed",
        changes: [
          {
            nodeId: nid("c"),
            kind: "clip",
            before: { title: "c", assetId: "asset-1" },
            after: { title: "renamed", assetId: "asset-1" },
          },
        ],
      },
      ctx,
    );
    expect(rev(next, "c")).toBeGreaterThan(rev(graph, "c") ?? 0);
    expect(rev(next, "f1")).toBeGreaterThan(rev(graph, "f1") ?? 0);
    expect(rev(next, "root")).toBeGreaterThan(rev(graph, "root") ?? 0);
    // Untouched branch stays put, or every card in the tree re-renders.
    expect(rev(next, "b")).toBe(rev(graph, "b"));
  });

  it("rebuilds placementsByContentKey when a contentKey moves", () => {
    const graph = sampleGraph();
    expect(
      (graph.placementsByContentKey.get("asset-1") ?? []).map((id) => String(id)),
    ).toEqual(["a", "c"]);

    const next = applyPatch(
      graph,
      {
        type: "data-changed",
        changes: [
          {
            nodeId: nid("a"),
            kind: "clip",
            before: { title: "a", assetId: "asset-1" },
            after: { title: "a", assetId: "asset-9" },
          },
        ],
      },
      ctx,
    );
    expect(
      (next.placementsByContentKey.get("asset-1") ?? []).map((id) => String(id)),
    ).toEqual(["c"]);
    expect(
      (next.placementsByContentKey.get("asset-9") ?? []).map((id) => String(id)),
    ).toEqual(["a"]);
  });

  it("leaves structure entirely alone", () => {
    const graph = sampleGraph();
    const next = applyPatch(
      graph,
      {
        type: "data-changed",
        changes: [
          {
            nodeId: nid("a"),
            kind: "clip",
            before: { title: "a", assetId: "asset-1" },
            after: { title: "renamed", assetId: "asset-1" },
          },
        ],
      },
      ctx,
    );
    expect(next.childrenById).toBe(graph.childrenById);
    expect(next.parentById).toBe(graph.parentById);
    expect(next.rootIds).toBe(graph.rootIds);
  });
});

// ---------------------------------------------------------------------------
// applyPatch — the invariants, checked against the engine's own auditor
// ---------------------------------------------------------------------------

describe("applyPatch keeps every graph invariant", () => {
  const ctx = makeCtx();

  /**
   * The strongest assertion available here, and the reason it is worth its own
   * block: `applyPatch` is the ONLY code that rewrites `childrenById`,
   * `parentById` and `subtreeRevById`, and `findInvariantViolation` checks both
   * directions of every children rule, `parentById` totality, `subtreeRevById`
   * totality, and that BOTH derived indexes match a fresh rebuild. A patch that
   * updates one index and forgets another shows up here and nowhere else.
   */
  const audit = (graph: Graph<TestTypes, Summary>): unknown =>
    findInvariantViolation(graph, registry);

  it("holds for the fixture itself", () => {
    expect(audit(sampleGraph())).toBeNull();
  });

  it("holds after a cross-parent move", () => {
    const graph = sampleGraph();
    expect(
      audit(
        applyPatch(
          graph,
          {
            type: "moved",
            moves: [
              {
                nodeId: nid("a"),
                fromParentId: nid("root"),
                fromIndex: 0,
                toParentId: nid("f1"),
                toIndex: 2,
              },
            ],
          },
          ctx,
        ),
      ),
    ).toBeNull();
  });

  it("holds after inserting a subtree", () => {
    const graph = sampleGraph();
    const parent = makeCollectionNode<TestTypes, Summary>(
      nid("n1"),
      "folder",
      { name: "n1", source: null },
      LOADED,
      null,
    );
    const child = makeLeafNode<TestTypes>(nid("n2"), "clip", {
      title: "n2",
      assetId: "asset-1",
    });
    expect(
      audit(
        applyPatch(
          graph,
          {
            type: "inserted",
            placements: [
              { node: parent, parentId: nid("root"), index: 3 },
              { node: child, parentId: nid("n1"), index: 0 },
            ],
          },
          ctx,
        ),
      ),
    ).toBeNull();
  });

  it("holds after removing a subtree, and again after restoring it", () => {
    const graph = sampleGraph();
    const patch: Patch<TestTypes, Summary> = {
      type: "removed",
      placements: [
        placementOf(graph, "f1", "root", 2),
        placementOf(graph, "c", "f1", 0),
        placementOf(graph, "f2", "f1", 1),
      ],
    };
    const removed = applyPatch(graph, patch, ctx);
    expect(audit(removed)).toBeNull();
    expect(audit(applyPatch(removed, invertPatch(patch), ctx))).toBeNull();
  });

  it("holds after a data change that moves a sourceKey", () => {
    // `sourceKey` backs the single-owner invariant, so a content edit can make
    // a graph illegal without touching a single index.
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          { tag: "folder", id: "owner", source: "stored-1" },
          { tag: "folder", id: "other", source: null },
        ],
      },
    ]);
    expect(audit(graph)).toBeNull();
    const next = applyPatch(
      graph,
      {
        type: "data-changed",
        changes: [
          {
            nodeId: nid("owner"),
            kind: "folder",
            before: { name: "owner", source: "stored-1" },
            after: { name: "owner", source: "stored-2" },
          },
        ],
      },
      ctx,
    );
    expect(audit(next)).toBeNull();
    expect([...next.ownerBySourceKey.keys()]).toEqual(["stored-2"]);
  });
});

// ---------------------------------------------------------------------------
// verifyPatchApplies
// ---------------------------------------------------------------------------

describe("verifyPatchApplies", () => {
  const ctx = makeCtx();

  it("rejects a graph from another engine instance", () => {
    const foreign = buildGraph([folder("root", [clip("a")])], Symbol("other"));
    const result = verifyPatchApplies(
      foreign,
      { type: "moved", moves: [] },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("foreign-graph");
  });

  describe("moved", () => {
    it("rejects a node that is gone", () => {
      const graph = sampleGraph();
      const result = verifyPatchApplies(
        graph,
        {
          type: "moved",
          moves: [
            {
              nodeId: nid("ghost"),
              fromParentId: nid("root"),
              fromIndex: 0,
              toParentId: nid("f1"),
              toIndex: 0,
            },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("node-missing");
      expect(result.error.nodeId).toBe(nid("ghost"));
    });

    it("rejects a destination whose children are not loaded", () => {
      const graph = sampleGraph();
      // f2 is `unloaded`: a post-removal index into children you have never
      // seen has no honest value.
      const result = verifyPatchApplies(
        graph,
        {
          type: "moved",
          moves: [
            {
              nodeId: nid("a"),
              fromParentId: nid("root"),
              fromIndex: 0,
              toParentId: nid("f2"),
              toIndex: 0,
            },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("parent-not-loaded");
      expect(result.error.parentId).toBe(nid("f2"));
    });

    it("rejects a stale fromIndex, even one that is still in bounds", () => {
      const graph = sampleGraph();
      // `b` is at index 1, not 0. An in-bounds but wrong index silently
      // relocates the node when the inverse re-inserts it.
      const result = verifyPatchApplies(
        graph,
        {
          type: "moved",
          moves: [
            {
              nodeId: nid("b"),
              fromParentId: nid("root"),
              fromIndex: 0,
              toParentId: nid("f1"),
              toIndex: 0,
            },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("index-out-of-range");
    });

    it("measures toIndex against the POST-removal array", () => {
      const graph = sampleGraph();
      // root is [a, b, f1]; removing `a` leaves length 2, so index 3 is out of
      // range even though the pre-removal array could hold it.
      const tooFar = verifyPatchApplies(
        graph,
        {
          type: "moved",
          moves: [
            {
              nodeId: nid("a"),
              fromParentId: nid("root"),
              fromIndex: 0,
              toParentId: nid("root"),
              toIndex: 3,
            },
          ],
        },
        ctx,
      );
      expect(tooFar.ok).toBe(false);
      if (!tooFar.ok) expect(tooFar.error.code).toBe("index-out-of-range");

      const atEnd = verifyPatchApplies(
        graph,
        {
          type: "moved",
          moves: [
            {
              nodeId: nid("a"),
              fromParentId: nid("root"),
              fromIndex: 0,
              toParentId: nid("root"),
              toIndex: 2,
            },
          ],
        },
        ctx,
      );
      expect(atEnd.ok).toBe(true);
    });

    it("rejects the same node moved twice by one patch", () => {
      const graph = sampleGraph();
      // One removal, two insertions: the node lands in two children arrays with
      // parentById naming one. A blind retry did exactly this in production.
      const result = verifyPatchApplies(
        graph,
        {
          type: "moved",
          moves: [
            {
              nodeId: nid("a"),
              fromParentId: nid("root"),
              fromIndex: 0,
              toParentId: nid("f1"),
              toIndex: 2,
            },
            {
              nodeId: nid("a"),
              fromParentId: nid("root"),
              fromIndex: 0,
              toParentId: nid("root"),
              toIndex: 1,
            },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("node-exists");
    });
  });

  describe("inserted", () => {
    it("accepts a subtree whose later placements land inside earlier ones", () => {
      // Without simulating the patch's own effects, this would be rejected for
      // a "missing" parent the same patch creates one entry earlier.
      const graph = buildGraph([folder("root", [])]);
      const parent = makeCollectionNode<TestTypes, Summary>(
        nid("n1"),
        "folder",
        { name: "n1", source: null },
        LOADED,
        null,
      );
      const child = makeLeafNode<TestTypes>(nid("n2"), "clip", {
        title: "n2",
        assetId: "asset-n2",
      });
      const result = verifyPatchApplies(
        graph,
        {
          type: "inserted",
          placements: [
            { node: parent, parentId: nid("root"), index: 0 },
            { node: child, parentId: nid("n1"), index: 0 },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(true);
    });

    it("rejects inserting into a parent the patch declares unloaded", () => {
      const graph = buildGraph([folder("root", [])]);
      const parent = makeCollectionNode<TestTypes, Summary>(
        nid("n1"),
        "folder",
        { name: "n1", source: null },
        UNLOADED,
        null,
      );
      const child = makeLeafNode<TestTypes>(nid("n2"), "clip", {
        title: "n2",
        assetId: "asset-n2",
      });
      const result = verifyPatchApplies(
        graph,
        {
          type: "inserted",
          placements: [
            { node: parent, parentId: nid("root"), index: 0 },
            { node: child, parentId: nid("n1"), index: 0 },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("parent-not-loaded");
    });

    it("rejects an id that already exists", () => {
      const graph = sampleGraph();
      const duplicate = makeLeafNode<TestTypes>(nid("b"), "clip", {
        title: "b",
        assetId: "asset-2",
      });
      const result = verifyPatchApplies(
        graph,
        {
          type: "inserted",
          placements: [{ node: duplicate, parentId: nid("root"), index: 0 }],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("node-exists");
    });

    it("rejects an out-of-range index but accepts the append position", () => {
      const graph = sampleGraph();
      const node = makeLeafNode<TestTypes>(nid("n1"), "clip", {
        title: "n1",
        assetId: "asset-n1",
      });
      const tooFar = verifyPatchApplies(
        graph,
        { type: "inserted", placements: [{ node, parentId: nid("root"), index: 4 }] },
        ctx,
      );
      expect(tooFar.ok).toBe(false);
      if (!tooFar.ok) expect(tooFar.error.code).toBe("index-out-of-range");

      const append = verifyPatchApplies(
        graph,
        { type: "inserted", placements: [{ node, parentId: nid("root"), index: 3 }] },
        ctx,
      );
      expect(append.ok).toBe(true);
    });
  });

  describe("removed", () => {
    it("rejects a patch that records only the named node, not its subtree", () => {
      // The spec calls this out: recording only the named node loses every
      // descendant on undo. Refusing it is cheaper than discovering it later.
      const graph = sampleGraph();
      const result = verifyPatchApplies(
        graph,
        { type: "removed", placements: [placementOf(graph, "f1", "root", 2)] },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("node-not-empty");
      expect(result.error.nodeId).toBe(nid("f1"));
    });

    it("rejects un-inserting a node that has gained a child since", () => {
      const graph = buildGraph([
        { tag: "folder", id: "root", children: [clip("a"), folder("box", [])] },
      ]);
      // The insert of `box` would be undone by removing exactly `box`...
      const undoOfInsert: Patch<TestTypes, Summary> = {
        type: "removed",
        placements: [placementOf(graph, "box", "root", 1)],
      };
      expect(verifyPatchApplies(graph, undoOfInsert, ctx).ok).toBe(true);

      // ...until something is moved into it. Then the same dormant patch would
      // orphan `a`.
      const afterMove = applyPatch(
        graph,
        {
          type: "moved",
          moves: [
            {
              nodeId: nid("a"),
              fromParentId: nid("root"),
              fromIndex: 0,
              toParentId: nid("box"),
              toIndex: 0,
            },
          ],
        },
        ctx,
      );
      const stale = verifyPatchApplies(
        afterMove,
        {
          type: "removed",
          placements: [placementOf(afterMove, "box", "root", 0)],
        },
        ctx,
      );
      expect(stale.ok).toBe(false);
      if (stale.ok) return;
      expect(stale.error.code).toBe("node-not-empty");
    });

    it("rejects a kind that no longer matches", () => {
      const graph = sampleGraph();
      const impostor = makeLeafNode<TestTypes>(nid("b"), "folder", {
        name: "b",
        source: null,
      });
      const result = verifyPatchApplies(
        graph,
        {
          type: "removed",
          placements: [{ node: impostor, parentId: nid("root"), index: 1 }],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("kind-mismatch");
    });

    it("rejects placements that are not in document order", () => {
      // The container is EMPTY in the graph, so the subtree check passes and the
      // ordering guard is the only thing left to catch it. With a non-empty
      // container the "node-not-empty" check fires first — covered above.
      const graph = buildGraph([
        { tag: "folder", id: "root", children: [folder("box", []), clip("x")] },
      ]);
      const result = verifyPatchApplies(
        graph,
        {
          type: "removed",
          // Child listed BEFORE its parent: the backward walk removes `box`
          // first, then looks for `x` under a parent that is already gone.
          placements: [
            { node: nodeOfOrThrow(graph, "x"), parentId: nid("box"), index: 0 },
            placementOf(graph, "box", "root", 0),
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("parent-missing");
      expect(result.error.parentId).toBe(nid("box"));
    });

    it("accepts removing a non-loaded container with no subtree recorded", () => {
      // `f2` is unloaded: it has no children entry, so there is nothing to
      // record and nothing to orphan.
      const graph = sampleGraph();
      const result = verifyPatchApplies(
        graph,
        { type: "removed", placements: [placementOf(graph, "f2", "f1", 1)] },
        ctx,
      );
      expect(result.ok).toBe(true);
    });
  });

  describe("data-changed", () => {
    it("accepts a `before` that is structurally equal but not identical", () => {
      const graph = sampleGraph();
      const result = verifyPatchApplies(
        graph,
        {
          type: "data-changed",
          changes: [
            {
              nodeId: nid("a"),
              kind: "clip",
              before: { title: "a", assetId: "asset-1" },
              after: { title: "renamed", assetId: "asset-1" },
            },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(true);
    });

    it("rejects a `before` the node no longer holds", () => {
      const graph = sampleGraph();
      const result = verifyPatchApplies(
        graph,
        {
          type: "data-changed",
          changes: [
            {
              nodeId: nid("a"),
              kind: "clip",
              before: { title: "something-else", assetId: "asset-1" },
              after: { title: "renamed", assetId: "asset-1" },
            },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("data-mismatch");
    });

    it("compares nested fields, not just the top level", () => {
      const graph = sampleGraph();
      const result = verifyPatchApplies(
        graph,
        {
          type: "data-changed",
          changes: [
            {
              nodeId: nid("f1"),
              kind: "folder",
              // The live folder has `source: null`.
              before: { name: "f1", source: "elsewhere" },
              after: { name: "f1", source: null },
            },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("data-mismatch");
    });

    it("rejects a kind mismatch", () => {
      const graph = sampleGraph();
      const result = verifyPatchApplies(
        graph,
        {
          type: "data-changed",
          changes: [
            {
              nodeId: nid("a"),
              kind: "folder",
              before: { name: "a", source: null },
              after: { name: "renamed", source: null },
            },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("kind-mismatch");
    });

    it("rejects editing a sealed node", () => {
      // Sealed nodes move and delete, but do not edit — writing into one
      // would destroy the byte-exact re-emit sealing exists to guarantee.
      const graph = buildGraph([
        {
          tag: "folder",
          id: "root",
          children: [{ tag: "sealed", id: "q", kind: "clip", container: false, state: null }],
        },
      ]);
      const result = verifyPatchApplies(
        graph,
        {
          type: "data-changed",
          changes: [
            {
              nodeId: nid("q"),
              kind: "clip",
              before: { title: "q", assetId: "asset-q" },
              after: { title: "renamed", assetId: "asset-q" },
            },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("data-mismatch");
    });

    it("rejects a node that is gone", () => {
      const graph = sampleGraph();
      const result = verifyPatchApplies(
        graph,
        {
          type: "data-changed",
          changes: [
            {
              nodeId: nid("ghost"),
              kind: "clip",
              before: { title: "x", assetId: "asset-x" },
              after: { title: "y", assetId: "asset-x" },
            },
          ],
        },
        ctx,
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe("node-missing");
    });
  });

  it("refuses a dormant patch whose parent stopped being loaded", () => {
    // The concrete reason this gate exists: the world moves while an entry
    // sleeps.
    const graph = sampleGraph();
    const patch: Patch<TestTypes, Summary> = {
      type: "removed",
      placements: [placementOf(graph, "c", "f1", 0)],
    };
    expect(verifyPatchApplies(graph, patch, ctx).ok).toBe(true);

    const emptied: Graph<TestTypes, Summary> = {
      ...graph,
      childrenById: new Map(
        [...graph.childrenById.entries()].filter(([id]) => id !== nid("f1")),
      ),
    };
    const result = verifyPatchApplies(emptied, patch, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("parent-not-loaded");
  });
});

// ---------------------------------------------------------------------------
// Patch queries
// ---------------------------------------------------------------------------

describe("patchTouchedNodeIds", () => {
  it("includes both move endpoints and dedupes in first-seen order", () => {
    const ids = patchTouchedNodeIds<TestTypes, Summary>({
      type: "moved",
      moves: [
        {
          nodeId: nid("a"),
          fromParentId: nid("root"),
          fromIndex: 0,
          toParentId: nid("f1"),
          toIndex: 0,
        },
        {
          nodeId: nid("b"),
          fromParentId: nid("root"),
          fromIndex: 0,
          toParentId: nid("f1"),
          toIndex: 1,
        },
      ],
    });
    expect(ids.map((id) => String(id))).toEqual(["a", "root", "f1", "b"]);
  });

  it("includes placement parents", () => {
    const graph = sampleGraph();
    const ids = patchTouchedNodeIds<TestTypes, Summary>({
      type: "inserted",
      placements: [placementOf(graph, "c", "f1", 0)],
    });
    expect(ids.map((id) => String(id))).toEqual(["c", "f1"]);
  });

  it("lists every changed node", () => {
    const ids = patchTouchedNodeIds<TestTypes, Summary>({
      type: "data-changed",
      changes: [
        {
          nodeId: nid("a"),
          kind: "clip",
          before: { title: "x", assetId: "asset-1" },
          after: { title: "y", assetId: "asset-1" },
        },
      ],
    });
    expect(ids.map((id) => String(id))).toEqual(["a"]);
  });
});

describe("patchDetachedSubtrees", () => {
  it("reports removed containers whose children were not loaded", () => {
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          clip("a"),
          { tag: "folder", id: "lazy", state: UNLOADED },
          { tag: "folder", id: "ref", state: REFERENCE },
          folder("open", []),
        ],
      },
    ]);
    const detached = patchDetachedSubtrees<TestTypes, Summary>({
      type: "removed",
      placements: [
        placementOf(graph, "a", "root", 0),
        placementOf(graph, "lazy", "root", 1),
        placementOf(graph, "ref", "root", 2),
        placementOf(graph, "open", "root", 3),
      ],
    });
    // A leaf owns no subtree; a loaded container's subtree left with the patch.
    expect(detached.map((id) => String(id))).toEqual(["lazy", "ref"]);
  });

  it("reports a sealed container that was never loaded", () => {
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [{ tag: "sealed", id: "q", state: UNLOADED }],
      },
    ]);
    const detached = patchDetachedSubtrees<TestTypes, Summary>({
      type: "removed",
      placements: [placementOf(graph, "q", "root", 0)],
    });
    expect(detached.map((id) => String(id))).toEqual(["q"]);
  });

  it("is empty for every non-removal patch", () => {
    const graph = sampleGraph();
    expect(
      patchDetachedSubtrees<TestTypes, Summary>({
        type: "inserted",
        placements: [placementOf(graph, "f2", "f1", 1)],
      }),
    ).toEqual([]);
    expect(
      patchDetachedSubtrees<TestTypes, Summary>({ type: "moved", moves: [] }),
    ).toEqual([]);
  });
});

describe("isEmptyPatch", () => {
  it("answers for all four patch types", () => {
    const graph = sampleGraph();
    expect(isEmptyPatch<TestTypes, Summary>({ type: "moved", moves: [] })).toBe(true);
    expect(
      isEmptyPatch<TestTypes, Summary>({ type: "inserted", placements: [] }),
    ).toBe(true);
    expect(
      isEmptyPatch<TestTypes, Summary>({ type: "removed", placements: [] }),
    ).toBe(true);
    expect(
      isEmptyPatch<TestTypes, Summary>({ type: "data-changed", changes: [] }),
    ).toBe(true);
    expect(
      isEmptyPatch<TestTypes, Summary>({
        type: "removed",
        placements: [placementOf(graph, "b", "root", 1)],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scrubPatchForWrite
// ---------------------------------------------------------------------------

describe("scrubPatchForWrite", () => {
  const written: ReadonlyMap<NodeId, unknown> = new Map<NodeId, unknown>([
    [nid("a"), { title: "from-server", assetId: "asset-1" }],
  ]);

  it("drops only the written node's data change", () => {
    const patch: Patch<TestTypes, Summary> = {
      type: "data-changed",
      changes: [
        {
          nodeId: nid("a"),
          kind: "clip",
          before: { title: "a", assetId: "asset-1" },
          after: { title: "mine", assetId: "asset-1" },
        },
        {
          nodeId: nid("b"),
          kind: "clip",
          before: { title: "b", assetId: "asset-2" },
          after: { title: "also-mine", assetId: "asset-2" },
        },
      ],
    };
    const scrubbed = scrubPatchForWrite<TestTypes, Summary>(patch, written);
    expect(scrubbed).not.toBeNull();
    if (scrubbed === null || scrubbed.type !== "data-changed") return;
    // Content changes are per-node independent, so `b` stays perfectly
    // invertible.
    expect(scrubbed.changes.map((change) => String(change.nodeId))).toEqual(["b"]);
  });

  it("returns null when every change was written, so the caller drops the entry", () => {
    const patch: Patch<TestTypes, Summary> = {
      type: "data-changed",
      changes: [
        {
          nodeId: nid("a"),
          kind: "clip",
          before: { title: "a", assetId: "asset-1" },
          after: { title: "mine", assetId: "asset-1" },
        },
      ],
    };
    expect(scrubPatchForWrite<TestTypes, Summary>(patch, written)).toBeNull();
  });

  it("rewrites captured data inside a dormant removal so undo cannot resurrect stale content", () => {
    const graph = sampleGraph();
    const patch: Patch<TestTypes, Summary> = {
      type: "removed",
      placements: [placementOf(graph, "a", "root", 0), placementOf(graph, "b", "root", 1)],
    };
    const scrubbed = scrubPatchForWrite<TestTypes, Summary>(patch, written);
    expect(scrubbed).not.toBeNull();
    if (scrubbed === null || scrubbed.type !== "removed") return;

    const first = scrubbed.placements[0];
    const second = scrubbed.placements[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (first === undefined || second === undefined) return;

    expect(first.node.sealed).toBe(false);
    if (first.node.sealed) return;
    expect(first.node.data).toEqual({ title: "from-server", assetId: "asset-1" });
    // Position is untouched — scrubbing is a content operation.
    expect(first.index).toBe(0);
    expect(String(first.parentId)).toBe("root");
    // The untouched placement keeps its identity.
    expect(second).toBe(patch.placements[1]);
  });

  it("preserves a collection's children state and summary while rewriting its data", () => {
    const graph = sampleGraph();
    const patch: Patch<TestTypes, Summary> = {
      type: "inserted",
      placements: [placementOf(graph, "f2", "f1", 1)],
    };
    const scrubbed = scrubPatchForWrite(
      patch,
      new Map<NodeId, unknown>([[nid("f2"), { name: "from-server", source: null }]]),
    );
    expect(scrubbed).not.toBeNull();
    if (scrubbed === null || scrubbed.type !== "inserted") return;
    const node = scrubbed.placements[0]?.node;
    expect(node).toBeDefined();
    if (node === undefined || node.sealed || !node.container) return;
    expect(node.data).toEqual({ name: "from-server", source: null });
    expect(node.children).toEqual(UNLOADED);
    expect(node.summary).toEqual({ label: "f2" });
  });

  it("leaves a sealed placement byte-exact", () => {
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [{ tag: "sealed", id: "q", state: null, container: false }],
      },
    ]);
    const patch: Patch<TestTypes, Summary> = {
      type: "removed",
      placements: [placementOf(graph, "q", "root", 0)],
    };
    const scrubbed = scrubPatchForWrite(
      patch,
      new Map<NodeId, unknown>([[nid("q"), { anything: true }]]),
    );
    expect(scrubbed).toBe(patch);
  });

  it("returns a structural patch untouched — moves carry no content", () => {
    const patch: Patch<TestTypes, Summary> = {
      type: "moved",
      moves: [
        {
          nodeId: nid("a"),
          fromParentId: nid("root"),
          fromIndex: 0,
          toParentId: nid("f1"),
          toIndex: 0,
        },
      ],
    };
    expect(scrubPatchForWrite<TestTypes, Summary>(patch, written)).toBe(patch);
  });

  it("returns the same patch when nothing was written", () => {
    const patch: Patch<TestTypes, Summary> = {
      type: "data-changed",
      changes: [
        {
          nodeId: nid("b"),
          kind: "clip",
          before: { title: "b", assetId: "asset-2" },
          after: { title: "mine", assetId: "asset-2" },
        },
      ],
    };
    expect(scrubPatchForWrite<TestTypes, Summary>(patch, new Map())).toBe(patch);
    expect(scrubPatchForWrite<TestTypes, Summary>(patch, written)).toBe(patch);
  });
});

// ---------------------------------------------------------------------------
// spliceInMany — the batched insertion path, and the fallback it declines to
// ---------------------------------------------------------------------------
//
// `applyInserted` and `applyMoved` used to call `spliceIn` once per node, and
// each call copied the whole destination array. Removing K of N siblings had
// already been made linear by `spliceOutMany`; INSERTING them had not, so undo
// of a bulk delete paid O(K x N) to restore what the delete removed in
// O(K + N). Measured, undo of a select-all Delete at 32,000 siblings: 6,759 ms
// against a 76 ms delete.
//
// The batched path builds each parent's array in ONE pass. That is only sound
// where it reproduces sequential splicing exactly, so it DECLINES — equal
// indices, descending indices, an index out of range — and the caller replays
// that parent through `spliceIn`, whose behaviour is the definition.
//
// These tests are the equivalence proof. They assert STRUCTURE, never wall
// clock, so they cannot flake: for every shape below, the array `applyPatch`
// produces must equal the array a naive one-at-a-time splice produces.
describe("batched insertion equals sequential splicing", () => {
  /** The reference: what `spliceIn` would have produced, one call at a time. */
  function sequentially(
    start: readonly string[],
    arrivals: readonly Readonly<{ index: number; id: string }>[],
  ): readonly string[] {
    const out = [...start];
    for (const { index, id } of arrivals) {
      const at = index < 0 ? 0 : index > out.length ? out.length : index;
      out.splice(at, 0, id);
    }
    return out;
  }

  /** A parent holding `width` clips, plus loose clips ready to be inserted. */
  function boardWith(width: number, incoming: readonly string[]) {
    const existing = Array.from({ length: width }, (_, i) => clip(`e${i}`));
    return buildGraph([
      folder("root", [
        folder("dest", existing),
        folder("pool", incoming.map((id) => clip(id))),
      ]),
    ]);
  }

  const shapes: readonly Readonly<{
    label: string;
    width: number;
    arrivals: readonly Readonly<{ index: number; id: string }>[];
  }>[] = [
    // Every shape the reducer itself produces — `buildSeedPlacements` and
    // `buildMoves` both emit `toIndex + offset`, so these take the fast path.
    { label: "contiguous at the front", width: 4, arrivals: [
      { index: 0, id: "n0" }, { index: 1, id: "n1" }, { index: 2, id: "n2" } ] },
    { label: "contiguous in the middle", width: 4, arrivals: [
      { index: 2, id: "n0" }, { index: 3, id: "n1" } ] },
    { label: "contiguous append", width: 3, arrivals: [
      { index: 3, id: "n0" }, { index: 4, id: "n1" }, { index: 5, id: "n2" } ] },
    { label: "into an empty parent", width: 0, arrivals: [
      { index: 0, id: "n0" }, { index: 1, id: "n1" } ] },
    { label: "single arrival", width: 3, arrivals: [{ index: 1, id: "n0" }] },
    // Ascending but with gaps — what undoing a SCATTERED delete inverts to.
    { label: "ascending with gaps", width: 6, arrivals: [
      { index: 1, id: "n0" }, { index: 4, id: "n1" }, { index: 7, id: "n2" } ] },
    // Shapes only a hand-built patch can produce. Each one DECLINES, and the
    // per-id fallback is what makes the answer right.
    { label: "declines: equal indices", width: 4, arrivals: [
      { index: 1, id: "n0" }, { index: 1, id: "n1" }, { index: 1, id: "n2" } ] },
    { label: "declines: descending indices", width: 4, arrivals: [
      { index: 3, id: "n0" }, { index: 1, id: "n1" }, { index: 0, id: "n2" } ] },
    { label: "declines: index past the end", width: 2, arrivals: [
      { index: 99, id: "n0" } ] },
    { label: "declines: negative index", width: 2, arrivals: [
      { index: -5, id: "n0" } ] },
    { label: "declines: ascending then a step back", width: 5, arrivals: [
      { index: 0, id: "n0" }, { index: 1, id: "n1" }, { index: 0, id: "n2" } ] },
  ];

  it.each(shapes)("$label", ({ width, arrivals }) => {
    const incoming = arrivals.map((a) => a.id);
    const graph = boardWith(width, incoming);
    const before = kids(graph, "dest");

    // The arriving nodes are lifted out of `pool` and inserted into `dest` in
    // patch order, which is the order their indices are expressed in.
    const patch: Patch<TestTypes, Summary> = {
      type: "inserted",
      placements: arrivals.map((a) => placementOf(graph, a.id, "dest", a.index)),
    };
    // A hand-built patch reuses ids already in the graph, so start from a graph
    // where `dest` holds only its own children and the arrivals are elsewhere;
    // `applyInserted` sets `parentById` and splices, which is what is under test.
    const next = applyPatch<TestTypes, Summary>(graph, patch, makeCtx());

    expect(kids(next, "dest")).toEqual(sequentially(before, arrivals));
  });

  it("keeps each parent independent when one batch spans several", () => {
    const graph = buildGraph([
      folder("root", [
        folder("a", [clip("a0"), clip("a1")]),
        folder("b", [clip("b0")]),
        folder("pool", [clip("x"), clip("y"), clip("z")]),
      ]),
    ]);
    const patch: Patch<TestTypes, Summary> = {
      type: "inserted",
      placements: [
        placementOf(graph, "x", "a", 0),
        placementOf(graph, "y", "b", 1),
        placementOf(graph, "z", "a", 3),
      ],
    };
    const next = applyPatch<TestTypes, Summary>(graph, patch, makeCtx());
    // `a` takes x at 0 then z at 3 — against ITS OWN growing array, not a
    // global one — and `b` takes y at 1. Grouping must not reorder either.
    expect(kids(next, "a")).toEqual(sequentially(["a0", "a1"], [
      { index: 0, id: "x" }, { index: 3, id: "z" },
    ]));
    expect(kids(next, "b")).toEqual(sequentially(["b0"], [{ index: 1, id: "y" }]));
  });
});

// ---------------------------------------------------------------------------
// deepEqual — a cyclic `serialize` output must not take the process with it
// ---------------------------------------------------------------------------
//
// `verifyDataChanged` compares `nodeType.serialize(change.before)` against
// `nodeType.serialize(node.data)`. Those are two FRESH objects, so `Object.is`
// cannot short-circuit them, and if the node type's `serialize` returns a value
// holding a back-reference the walk used to push two frames for every one it
// popped. Measured before the fix: heap exhaustion at 4 GB and a killed process
// in 23 seconds — not a hang, a crash, out of a function contracted to return a
// `Result`.
//
// Reaching it takes a node type whose `serialize` returns a cycle, which is a
// consumer bug on the same footing as the throwing `serialize` this module
// already wraps. Wire data cannot carry one; an in-memory value handed to
// `deserialize` can.
//
// The fix is a co-inductive pair memo, NOT a step budget: a budget would refuse
// a legitimately large value as `data-mismatch`, which is the failure ./types
// argues production must not have. So these assert a DEFINITE verdict in both
// directions, not merely that it terminated.
describe("a cyclic serialize output is compared, not fatal", () => {
  type Cyclic = Readonly<{ n: number }>;

  /** `serialize` returns a fresh object that points at itself. Conforming
   *  enough to run; not something that could ever reach the wire. */
  function cyclicType(shape: (n: number) => Record<string, unknown>) {
    return defineNodeType<Cyclic, Readonly<{ n: number }>>()({
      kind: "cyc",
      container: false,
      schemaVersion: 1,
      parse(raw): Result<Cyclic, readonly Issue[]> {
        if (!isRecord(raw) || typeof raw["n"] !== "number") {
          return { ok: false, error: [{ path: "$.n", message: "n" }] };
        }
        return { ok: true, value: { n: raw["n"] } };
      },
      serialize(data): unknown {
        const out = shape(data.n);
        out["self"] = out;
        return out;
      },
      applyEdit(_data, edit) {
        return { ok: true, value: { n: edit.n } };
      },
    });
  }

  function ctxWithCyclic(shape: (n: number) => Record<string, unknown>) {
    const nodeType = cyclicType(shape);
    const reg = new Map<string, WidenedNodeType>([["cyc", nodeType as WidenedNodeType]]);
    return { ...makeCtx(), registry: reg };
  }

  /** A `data-changed` patch whose `before` is a DIFFERENT object holding the
   *  same value — so the `Object.is` fast path cannot fire and the comparison
   *  really runs. That is the save/reload shape: a dormant patch replayed
   *  against a graph deserialized separately. */
  function patchAgainst(before: Cyclic): Patch<TestTypes, Summary> {
    return {
      type: "data-changed",
      changes: [
        makeDataChange<TestTypes>(nid("c"), "cyc", before, { n: 99 }),
      ],
    };
  }

  function graphHolding(n: number): Graph<TestTypes, Summary> {
    const g = buildGraph([folder("root", [clip("c")])]);
    const node = makeLeafNode<TestTypes>(nid("c"), "cyc", { n });
    return { ...g, nodesById: new Map(g.nodesById).set(nid("c"), node) };
  }

  it("terminates with a verdict when both sides cycle identically", () => {
    const ctx = ctxWithCyclic((n) => ({ n }));
    // before and live hold EQUAL values in DIFFERENT objects.
    const verdict = verifyPatchApplies<TestTypes, Summary>(
      graphHolding(7),
      patchAgainst({ n: 7 }),
      ctx,
    );
    // Structurally identical cycles compare EQUAL, so the patch still applies.
    expect(verdict.ok).toBe(true);
  }, 5000);

  it("still refuses when the cyclic values genuinely differ", () => {
    const ctx = ctxWithCyclic((n) => ({ n }));
    const verdict = verifyPatchApplies<TestTypes, Summary>(
      graphHolding(7),
      patchAgainst({ n: 8 }),
      ctx,
    );
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error.code).toBe("data-mismatch");
  }, 5000);

  it("refuses when one side cycles and the other does not", () => {
    // `n` decides the shape, so the two serialize outputs disagree in structure
    // as well as in their back-reference.
    const ctx = ctxWithCyclic((n) => (n === 7 ? { n } : { n, extra: [1, 2, 3] }));
    const verdict = verifyPatchApplies<TestTypes, Summary>(
      graphHolding(7),
      patchAgainst({ n: 8 }),
      ctx,
    );
    expect(verdict.ok).toBe(false);
  }, 5000);

  it("compares a deeply shared acyclic value without exploding", () => {
    // A DAG, not a cycle: the same subobject reachable by many paths. The memo
    // is what keeps this linear rather than exponential in the sharing depth.
    const ctx = ctxWithCyclic((n) => {
      let level: Record<string, unknown> = { n };
      for (let i = 0; i < 24; i += 1) level = { a: level, b: level };
      return level;
    });
    const started = Date.now();
    const verdict = verifyPatchApplies<TestTypes, Summary>(
      graphHolding(7),
      patchAgainst({ n: 7 }),
      ctx,
    );
    expect(verdict.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(2000);
  }, 5000);
});

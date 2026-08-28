import { beforeEach, describe, expect, it } from "vitest";

import {
  bumpSubtreeRevs,
  bumpSubtreeRevsInto,
  findInvariantViolation,
  rebuildDerivedIndexes,
} from "./graph";
import { applyPatch, verifyPatchApplies } from "./patches";
import {
  defineNodeType,
  makeCollectionNode,
  makeLeafNode,
  parseNodeId,
  type AnyNode,
  type ChildrenState,
  type EngineContext,
  type Graph,
  type NodeId,
  type Patch,
  type SomeNodeType,
  type SummaryCodec,
} from "./types";
import { DEFAULT_MAX_NODES } from "./serialize";

// A single commit used to do FIVE pieces of whole-graph work for a change that
// touched one children array: a clone of `parentById` (one entry per node), two
// clones of `subtreeRevById` (one entry per node), a document-order DFS, and a
// from-scratch rebuild of both derived indexes with a codec call per node — the
// last of these running even when no registered codec defined either key.
//
// These tests pin the scaling properties that removed that work. They assert
// STRUCTURE — reference identity, and how many times a codec was asked — never
// wall clock, so they cannot flake on a slow machine. A comment claiming a map
// is shared is not a guarantee; `toBe` is.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Bumped by the KEYED codecs below, so a test can ask how much of the graph a
 *  commit actually looked at. Reset by `beforeEach`. */
let contentKeyCalls = 0;
let sourceKeyCalls = 0;

type ClipData = Readonly<{ title: string; assetId: string }>;
type ClipEdit = Readonly<{ title: string }>;

function parseClip(raw: unknown): ClipData | null {
  if (!isRecord(raw)) return null;
  const title = raw["title"];
  const assetId = raw["assetId"];
  if (typeof title !== "string" || typeof assetId !== "string") return null;
  return { title, assetId };
}

const clipType = defineNodeType<ClipData, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw) {
    const parsed = parseClip(raw);
    if (parsed === null) {
      return { ok: false, error: [{ path: "$", message: "bad clip" }] };
    }
    return { ok: true, value: parsed };
  },
  serialize(data) {
    return { title: data.title, assetId: data.assetId };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { title: edit.title, assetId: data.assetId } };
  },
  contentKey(data) {
    contentKeyCalls += 1;
    return data.assetId;
  },
});

type FolderData = Readonly<{ name: string; source: string | null }>;
type FolderEdit = Readonly<{ name: string }>;

function parseFolder(raw: unknown): FolderData | null {
  if (!isRecord(raw)) return null;
  const name = raw["name"];
  const source = raw["source"];
  if (typeof name !== "string") return null;
  return { name, source: typeof source === "string" ? source : null };
}

const folderType = defineNodeType<FolderData, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw) {
    const parsed = parseFolder(raw);
    if (parsed === null) {
      return { ok: false, error: [{ path: "$", message: "bad folder" }] };
    }
    return { ok: true, value: parsed };
  },
  serialize(data) {
    return { name: data.name, source: data.source };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { name: edit.name, source: data.source } };
  },
  sourceKey(data) {
    sourceKeyCalls += 1;
    return data.source;
  },
});

// The SAME two kinds with neither identity function — a consumer that opts into
// no identity at all. Both derived indexes are then permanently empty, and a
// commit must not walk the graph to rediscover that.
const keylessClipType = defineNodeType<ClipData, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse: clipType.parse,
  serialize: clipType.serialize,
  applyEdit: clipType.applyEdit,
});

const keylessFolderType = defineNodeType<FolderData, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse: folderType.parse,
  serialize: folderType.serialize,
  applyEdit: folderType.applyEdit,
});

type TestTypes = readonly [typeof clipType, typeof folderType];
type Summary = Readonly<{ label: string }>;
type TestGraph = Graph<TestTypes, Summary>;

const keyedRegistry: ReadonlyMap<string, SomeNodeType> = new Map<string, SomeNodeType>([
  ["clip", clipType],
  ["folder", folderType],
]);

const keylessRegistry: ReadonlyMap<string, SomeNodeType> = new Map<string, SomeNodeType>([
  ["clip", keylessClipType],
  ["folder", keylessFolderType],
]);

const summaryCodec: SummaryCodec<Summary> = {
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

const ENGINE_ID = Symbol("keel-move-cost-engine");
const LOADED: ChildrenState = { status: "loaded" };

function makeCtx(registry: ReadonlyMap<string, SomeNodeType>): EngineContext<Summary> {
  return {
    engineId: ENGINE_ID,
    registry,
    summary: summaryCodec,
    onUnknownKind: "quarantine",
    onParseFailure: "quarantine",
    maxNodes: DEFAULT_MAX_NODES,
    maxDepth: null,
    mintId: () => "minted",
    now: () => 0,
    devChecks: false,
  };
}

const nid = (id: string): NodeId => parseNodeId(id);

type Spec =
  | Readonly<{ tag: "clip"; id: string; asset?: string }>
  | Readonly<{
      tag: "folder";
      id: string;
      source?: string | null;
      children?: readonly Spec[];
    }>;

/**
 * Builds a graph by hand, then derives the indexes through the REAL
 * `rebuildDerivedIndexes`. A hand-rolled stand-in would let an incremental
 * update that drifts from the rebuild still pass, which is the exact failure
 * these tests exist to catch.
 */
function buildGraph(
  roots: readonly Spec[],
  registry: ReadonlyMap<string, SomeNodeType> = keyedRegistry,
): TestGraph {
  const nodesById = new Map<NodeId, AnyNode<TestTypes, Summary>>();
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
    nodesById.set(
      id,
      makeCollectionNode<TestTypes, Summary>(
        id,
        "folder",
        { name: spec.id, source: spec.source ?? null },
        LOADED,
        null,
      ),
    );
    childrenById.set(id, (spec.children ?? []).map((child) => visit(child, id)));
    return id;
  };

  const rootIds = roots.map((spec) => visit(spec, null));
  const base: TestGraph = {
    engineId: ENGINE_ID,
    nodesById,
    childrenById,
    parentById,
    rootIds,
    subtreeRevById,
    placementsByContentKey: new Map(),
    ownerBySourceKey: new Map(),
  };
  return { ...base, ...rebuildDerivedIndexes(base, registry) };
}

/**
 * `collections` collections of `perCollection` clips each, under one root.
 * `assetOf` defaults to a unique asset per clip — the shape where a reorder
 * cannot change `placementsByContentKey` at all.
 */
function wideGraph(
  collections: number,
  perCollection: number,
  options?: Readonly<{
    assetOf?: (collection: number, index: number) => string;
    registry?: ReadonlyMap<string, SomeNodeType>;
  }>,
): TestGraph {
  const roots: Spec[] = [];
  for (let c = 0; c < collections; c += 1) {
    const clips: Spec[] = [];
    for (let i = 0; i < perCollection; i += 1) {
      clips.push({
        tag: "clip",
        id: `c${c}-m${i}`,
        asset: options?.assetOf?.(c, i) ?? `asset-c${c}-m${i}`,
      });
    }
    roots.push({ tag: "folder", id: `c${c}`, source: `src-c${c}`, children: clips });
  }
  return buildGraph(
    [{ tag: "folder", id: "root", source: "src-root", children: roots }],
    options?.registry ?? keyedRegistry,
  );
}

/**
 * Verify then apply, the way the engine does. Routing every test through
 * `verifyPatchApplies` means a change that made patches cheaper but no longer
 * replayable fails here rather than in production.
 */
function commit(
  graph: TestGraph,
  patch: Patch<TestTypes, Summary>,
  ctx: EngineContext<Summary> = makeCtx(keyedRegistry),
): TestGraph {
  const verified = verifyPatchApplies(graph, patch, ctx);
  if (!verified.ok) throw new Error(`${verified.error.code}: ${verified.error.message}`);
  const next = applyPatch(graph, patch, ctx);

  // The audit is the backstop for every cheap path below: a shared map or a
  // scoped reindex that is wrong shows up here as `parent-index-disagrees` or
  // `derived-index-stale`, not as a silently wrong render three commits later.
  //
  // It walks the whole graph and calls both codecs per node — twice, checks 8
  // and 9 — so the counters are snapshotted around it. Without this the
  // "how much did the commit look at" tests would be measuring the ASSERTION,
  // which is the one thing production never runs.
  const committed = { content: contentKeyCalls, source: sourceKeyCalls };
  expect(findInvariantViolation(next, ctx.registry)).toBeNull();
  contentKeyCalls = committed.content;
  sourceKeyCalls = committed.source;
  return next;
}

function reorderWithin(parentId: string, nodeId: string, from: number, to: number) {
  return {
    type: "moved",
    moves: [
      {
        nodeId: nid(nodeId),
        fromParentId: nid(parentId),
        fromIndex: from,
        toParentId: nid(parentId),
        toIndex: to,
      },
    ],
  } as const;
}

/** The cross-parent twin of `reorderWithin`. Separate rather than a parameter
 *  on that one, because "same parent" and "different parent" take different
 *  paths through `placementsAfterMove` and a test should name which it drives. */
function moveAcross(
  fromParentId: string,
  toParentId: string,
  nodeId: string,
  from: number,
  to: number,
) {
  return {
    type: "moved",
    moves: [
      {
        nodeId: nid(nodeId),
        fromParentId: nid(fromParentId),
        fromIndex: from,
        toParentId: nid(toParentId),
        toIndex: to,
      },
    ],
  } as const;
}

/** Which node ids' revisions actually moved — the touched-chain measurement. */
function bumpedIds(before: TestGraph, after: TestGraph): readonly string[] {
  const out: string[] = [];
  for (const [id, rev] of after.subtreeRevById) {
    if (rev !== (before.subtreeRevById.get(id) ?? 0)) out.push(String(id));
  }
  return out.sort();
}

/**
 * Zero the codec counters. Called by `beforeEach`, and AGAIN by hand after a
 * fixture is built — `buildGraph` derives its indexes through the real rebuild,
 * so a 400-clip fixture arrives having already asked `contentKey` 400 times.
 */
function resetCodecCounters(): void {
  contentKeyCalls = 0;
  sourceKeyCalls = 0;
}

beforeEach(resetCodecCounters);

// ---------------------------------------------------------------------------
// Structural sharing
// ---------------------------------------------------------------------------

describe("move commit cost — index sharing", () => {
  it("shares parentById for a same-parent reorder", () => {
    const graph = wideGraph(20, 20); // 400 clips + 20 collections + root
    const next = commit(graph, reorderWithin("c0", "c0-m0", 0, 5));

    // Nothing was reparented, so the per-NODE map is handed through by
    // reference instead of being cloned at the size of the whole graph.
    expect(next.parentById).toBe(graph.parentById);
    // The per-collection map genuinely changed and must not be shared.
    expect(next.childrenById).not.toBe(graph.childrenById);
  });

  it("clones parentById only when a node actually changes parent", () => {
    const graph = wideGraph(20, 20);
    const next = commit(graph, {
      type: "moved",
      moves: [
        {
          nodeId: nid("c0-m0"),
          fromParentId: nid("c0"),
          fromIndex: 0,
          toParentId: nid("c1"),
          toIndex: 0,
        },
      ],
    });
    expect(next.parentById).not.toBe(graph.parentById);
    expect(next.parentById.get(nid("c0-m0"))).toBe(nid("c1"));
  });

  it("shares parentById when a MIXED batch reparents nothing", () => {
    // Two moves inside one parent. The `some(...)` guard must look at every
    // move, not just the first, or a batch would clone on a hunch.
    const graph = wideGraph(4, 6);
    const next = commit(graph, {
      type: "moved",
      moves: [
        {
          nodeId: nid("c0-m0"),
          fromParentId: nid("c0"),
          fromIndex: 0,
          toParentId: nid("c0"),
          toIndex: 4,
        },
        {
          nodeId: nid("c0-m1"),
          fromParentId: nid("c0"),
          fromIndex: 1,
          toParentId: nid("c0"),
          toIndex: 5,
        },
      ],
    });
    expect(next.parentById).toBe(graph.parentById);
    expect([...(next.childrenById.get(nid("c0")) ?? [])].map(String)).toEqual([
      "c0-m2",
      "c0-m3",
      "c0-m4",
      "c0-m5",
      "c0-m0",
      "c0-m1",
    ]);
  });

  it("never re-allocates nodesById for a move, reorder or reparent", () => {
    const graph = wideGraph(20, 20);
    // A move carries no content, so every node OBJECT keeps its identity —
    // this is what lets a selector store skip uninvolved cards.
    expect(commit(graph, reorderWithin("c0", "c0-m0", 0, 5)).nodesById).toBe(
      graph.nodesById,
    );
    expect(
      commit(graph, {
        type: "moved",
        moves: [
          {
            nodeId: nid("c0-m0"),
            fromParentId: nid("c0"),
            fromIndex: 0,
            toParentId: nid("c1"),
            toIndex: 0,
          },
        ],
      }).nodesById,
    ).toBe(graph.nodesById);
  });

  it("leaves untouched collections' children arrays shared", () => {
    const graph = wideGraph(20, 20);
    const before = graph.childrenById.get(nid("c7"));
    const next = commit(graph, reorderWithin("c0", "c0-m0", 0, 3));
    expect(next.childrenById.get(nid("c7"))).toBe(before);
  });

  it("bumps only the touched chain, not the graph", () => {
    const graph = wideGraph(20, 20);
    const next = commit(graph, reorderWithin("c0", "c0-m0", 0, 5));
    // Source chain and destination chain are the same chain here, and each is
    // walked once per phase — but the SET of entries that moved is the chain,
    // not the 421-node graph.
    expect(bumpedIds(graph, next)).toEqual(["c0", "root"]);
    expect(next.subtreeRevById.size).toBe(graph.subtreeRevById.size);
  });
});

// ---------------------------------------------------------------------------
// Derived indexes
// ---------------------------------------------------------------------------

describe("derived index cost", () => {
  it("does no index work at all when no codec defines either key", () => {
    const ctx = makeCtx(keylessRegistry);
    const graph = wideGraph(10, 10, { registry: keylessRegistry });
    // The shared empties, so a consumer memoising on these fields sees no churn
    // across a commit that could never have moved them.
    const next = commit(graph, reorderWithin("c0", "c0-m0", 0, 4), ctx);
    expect(next.placementsByContentKey).toBe(graph.placementsByContentKey);
    expect(next.ownerBySourceKey).toBe(graph.ownerBySourceKey);
    expect(next.placementsByContentKey.size).toBe(0);
  });

  it("never asks for a sourceKey on a move", () => {
    const graph = wideGraph(20, 20);
    resetCodecCounters();
    commit(graph, {
      type: "moved",
      moves: [
        {
          nodeId: nid("c0-m0"),
          fromParentId: nid("c0"),
          fromIndex: 0,
          toParentId: nid("c1"),
          toIndex: 0,
        },
      ],
    });
    // A move changes no `data` and no `ChildrenState`, so ownership cannot have
    // moved. Even the fallback rebuild skips the whole sourceKey half.
    expect(sourceKeyCalls).toBe(0);
  });

  it("carries ownerBySourceKey through a move by reference", () => {
    const graph = wideGraph(6, 6);
    const next = commit(graph, reorderWithin("c0", "c0-m0", 0, 3));
    expect(next.ownerBySourceKey).toBe(graph.ownerBySourceKey);
    expect(next.ownerBySourceKey.get("src-c0")).toBe(nid("c0"));
  });

  it("asks once per node that TRAVELLED, not once per sibling", () => {
    // THE BILL IS THE MOVED SUBTREE. Held at three strip widths, because a
    // per-width bound cannot tell "the moved subtree" apart from "the strip
    // happened to be 20 wide" — which is exactly what the previous version of
    // this test asserted, and why it passed while the commonest drag in the
    // product paid for every sibling beside it.
    const widths = [5, 20, 50] as const;
    const counts = widths.map((width) => {
      const graph = wideGraph(20, width);
      resetCodecCounters();
      commit(graph, reorderWithin("c0", "c0-m0", 0, 3));
      return contentKeyCalls;
    });
    // One clip moved, one clip asked, whatever it was standing next to.
    expect(counts).toEqual([1, 1, 1]);
  });

  it("charges a reorder the same as a cross-parent move of the same node", () => {
    // The two gestures move one leaf; only the destination differs. They cost
    // the same because the SCOPE is the same, and a reorder used to cost the
    // whole sibling list while the cross-parent move already cost one.
    const graph = wideGraph(20, 20);

    resetCodecCounters();
    commit(graph, reorderWithin("c0", "c0-m0", 0, 5));
    const withinCalls = contentKeyCalls;

    resetCodecCounters();
    commit(graph, moveAcross("c0", "c1", "c0-m0", 0, 0));
    const acrossCalls = contentKeyCalls;

    expect(withinCalls).toBe(acrossCalls);
  });

  it("does not charge a COLLECTION reorder for the whole document", () => {
    // The worst case, and the one no previous test covered: reordering a
    // collection under the root made the scope root the DOCUMENT root, so the
    // cheap path was skipped and every node in the graph was asked for its key.
    const small = wideGraph(10, 20); // 200 clips + 10 folders
    resetCodecCounters();
    commit(small, reorderWithin("root", "c0", 0, 5));
    const smallCalls = contentKeyCalls;

    const large = wideGraph(20, 20); // 400 clips + 20 folders
    resetCodecCounters();
    commit(large, reorderWithin("root", "c0", 0, 5));
    const largeCalls = contentKeyCalls;

    // The moved subtree is one folder and its 20 clips in both graphs, so the
    // count must not move when the document doubles.
    expect(smallCalls).toBe(largeCalls);
    // 20, not 21: only the clip kind defines `contentKey`, so the folder that
    // actually moved contributes nothing to the index and is never asked. The
    // bill is the moved subtree's KEYED nodes.
    expect(largeCalls).toBe(20);
  });

  it("keeps placementsByContentKey identical when a reorder cannot move it", () => {
    const graph = wideGraph(20, 20); // one asset per clip
    const next = commit(graph, reorderWithin("c0", "c0-m0", 0, 5));
    // Every bucket holds one id, so no bucket's ORDER changed. Saying so must
    // not allocate a map the size of the key space.
    expect(next.placementsByContentKey).toBe(graph.placementsByContentKey);
  });

  it("reorders a shared-asset bucket exactly as a rebuild would", () => {
    // Three placements of one asset inside the reordered collection, and one
    // outside it that must keep its slot.
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          { tag: "clip", id: "outside", asset: "shared" },
          {
            tag: "folder",
            id: "c0",
            children: [
              { tag: "clip", id: "a", asset: "shared" },
              { tag: "clip", id: "b", asset: "other" },
              { tag: "clip", id: "c", asset: "shared" },
              { tag: "clip", id: "d", asset: "shared" },
            ],
          },
        ],
      },
    ]);
    expect(graph.placementsByContentKey.get("shared")?.map(String)).toEqual([
      "outside",
      "a",
      "c",
      "d",
    ]);

    // Move `d` to the front of c0: the bucket's three in-scope slots must be
    // rewritten in the new order, and `outside`'s slot must not move.
    const next = commit(graph, reorderWithin("c0", "d", 3, 0));
    expect(next.placementsByContentKey.get("shared")?.map(String)).toEqual([
      "outside",
      "d",
      "a",
      "c",
    ]);
    // The incremental answer and the from-scratch answer are the SAME answer —
    // this is the property `findInvariantViolation` check 9 exists to defend,
    // asserted directly so a drift is named here rather than in a dev build.
    expect(next.placementsByContentKey).toEqual(
      rebuildDerivedIndexes(next, keyedRegistry).placementsByContentKey,
    );
  });

  it("leaves an unaffected bucket's ARRAY shared through a reorder", () => {
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          { tag: "clip", id: "far", asset: "elsewhere" },
          {
            tag: "folder",
            id: "c0",
            children: [
              { tag: "clip", id: "a", asset: "shared" },
              { tag: "clip", id: "b", asset: "shared" },
            ],
          },
        ],
      },
    ]);
    const untouched = graph.placementsByContentKey.get("elsewhere");
    const next = commit(graph, reorderWithin("c0", "b", 1, 0));
    expect(next.placementsByContentKey.get("elsewhere")).toBe(untouched);
    expect(next.placementsByContentKey.get("shared")?.map(String)).toEqual(["b", "a"]);
  });

  it("moves a whole keyed SUBTREE within its parent, exactly as a rebuild would", () => {
    // The case the slot-rewriting argument really rests on: reordering a
    // container drags its descendants' document positions with it, so a bucket
    // gains a multi-id run that must land in the new pre-order.
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          { tag: "clip", id: "outside", asset: "shared" },
          {
            tag: "folder",
            id: "c0",
            children: [
              { tag: "clip", id: "first", asset: "shared" },
              {
                tag: "folder",
                id: "nested",
                children: [
                  { tag: "clip", id: "n1", asset: "shared" },
                  { tag: "clip", id: "n2", asset: "shared" },
                ],
              },
              { tag: "clip", id: "last", asset: "shared" },
            ],
          },
        ],
      },
    ]);
    expect(graph.placementsByContentKey.get("shared")?.map(String)).toEqual([
      "outside",
      "first",
      "n1",
      "n2",
      "last",
    ]);

    // `nested` (index 1) to the front of c0 — three ids change position, one of
    // them a container carrying two more.
    const next = commit(graph, reorderWithin("c0", "nested", 1, 0));
    expect(next.placementsByContentKey.get("shared")?.map(String)).toEqual([
      "outside",
      "n1",
      "n2",
      "first",
      "last",
    ]);
    expect(next.placementsByContentKey).toEqual(
      rebuildDerivedIndexes(next, keyedRegistry).placementsByContentKey,
    );
  });

  it("keeps a shared bucket right when a cross-parent move cannot reorder it", () => {
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          {
            tag: "folder",
            id: "c0",
            children: [
              { tag: "clip", id: "a", asset: "shared" },
              { tag: "clip", id: "b", asset: "shared" },
            ],
          },
          { tag: "folder", id: "c1", children: [{ tag: "clip", id: "z", asset: "shared" }] },
        ],
      },
    ]);
    const next = commit(graph, {
      type: "moved",
      moves: [
        {
          nodeId: nid("b"),
          fromParentId: nid("c0"),
          fromIndex: 1,
          toParentId: nid("c1"),
          toIndex: 0,
        },
      ],
    });
    expect(next.placementsByContentKey.get("shared")?.map(String)).toEqual([
      "a",
      "b",
      "z",
    ]);
    expect(next.placementsByContentKey).toEqual(
      rebuildDerivedIndexes(next, keyedRegistry).placementsByContentKey,
    );
  });

  // -------------------------------------------------------------------------
  // Cross-parent moves — the scope is what MOVED, not the LCA of the endpoints
  // -------------------------------------------------------------------------

  it("does not walk the document when a clip changes parents", () => {
    const graph = wideGraph(20, 20); // 400 clips, one asset each
    resetCodecCounters();
    const next = commit(graph, moveAcross("c0", "c1", "c0-m0", 0, 0));
    // ONE key: the clip that travelled. The old path rebuilt the index from a
    // full document walk and asked all 400. Nothing else in the graph moved
    // relative to anything else, so nothing else has an opinion.
    expect(contentKeyCalls).toBe(1);
    expect(sourceKeyCalls).toBe(0);
    // Every bucket holds one id, so no bucket's ORDER changed. Saying so must
    // not allocate a map the size of the key space.
    expect(next.placementsByContentKey).toBe(graph.placementsByContentKey);
  });

  it("asks once per node that travelled, not once per node that exists", () => {
    // The moved node is a FOLDER, so its whole subtree travels with it and the
    // cost is that subtree — the distinction the bare `1` above cannot make.
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          {
            tag: "folder",
            id: "c0",
            children: [
              {
                tag: "folder",
                id: "nested",
                children: [
                  { tag: "clip", id: "n0", asset: "a0" },
                  { tag: "clip", id: "n1", asset: "a1" },
                ],
              },
              { tag: "clip", id: "stay", asset: "a2" },
            ],
          },
          { tag: "folder", id: "c1", children: [{ tag: "clip", id: "far", asset: "a3" }] },
        ],
      },
    ]);
    resetCodecCounters();
    commit(graph, moveAcross("c0", "c1", "nested", 0, 0));
    // `nested` itself is a folder and has no content key, so the two clips
    // inside it are the whole bill. `stay` and `far` are never asked.
    expect(contentKeyCalls).toBe(2);
  });

  it("repositions a moved placement in a shared bucket exactly as a rebuild would", () => {
    // One asset placed four times across two collections. Moving the LAST
    // placement to the front of the FIRST collection is the case a slot-rewrite
    // cannot express: the id has to cross other members of its own bucket.
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          {
            tag: "folder",
            id: "c0",
            children: [
              { tag: "clip", id: "a", asset: "shared" },
              { tag: "clip", id: "b", asset: "shared" },
            ],
          },
          {
            tag: "folder",
            id: "c1",
            children: [
              { tag: "clip", id: "c", asset: "shared" },
              { tag: "clip", id: "d", asset: "shared" },
            ],
          },
        ],
      },
    ]);
    expect(graph.placementsByContentKey.get("shared")?.map(String)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);

    const next = commit(graph, moveAcross("c1", "c0", "d", 1, 0));
    expect(next.placementsByContentKey.get("shared")?.map(String)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
    expect(next.placementsByContentKey).toEqual(
      rebuildDerivedIndexes(next, keyedRegistry).placementsByContentKey,
    );
  });

  it("agrees with a rebuild for a move into the MIDDLE of a shared bucket", () => {
    // The merge's real work: the mover lands neither first nor last, so both
    // sides of the merge have to advance. Landing it at either end would pass
    // even if the merge only ever appended.
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          {
            tag: "folder",
            id: "c0",
            children: [
              { tag: "clip", id: "a", asset: "shared" },
              { tag: "clip", id: "b", asset: "shared" },
              { tag: "clip", id: "c", asset: "shared" },
            ],
          },
          { tag: "folder", id: "c1", children: [{ tag: "clip", id: "d", asset: "shared" }] },
        ],
      },
    ]);

    const next = commit(graph, moveAcross("c1", "c0", "d", 0, 2));
    expect(next.placementsByContentKey.get("shared")?.map(String)).toEqual([
      "a",
      "b",
      "d",
      "c",
    ]);
    expect(next.placementsByContentKey).toEqual(
      rebuildDerivedIndexes(next, keyedRegistry).placementsByContentKey,
    );
  });

  it("carries ownerBySourceKey through a cross-parent move by reference", () => {
    // Ownership is a property of the node, not of where it sits, so a move
    // cannot transfer it — and must not allocate a map to say so.
    const graph = wideGraph(20, 20);
    const next = commit(graph, moveAcross("c0", "c1", "c0-m0", 0, 0));
    expect(next.ownerBySourceKey).toBe(graph.ownerBySourceKey);
  });

  it("reorders correctly when a batch moves subtrees to two different parents", () => {
    // Movers from separate moves can land out of walk order relative to each
    // other, which is why they are sorted before the merge rather than appended
    // in the order the walk happened to find them.
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          {
            tag: "folder",
            id: "c0",
            children: [
              { tag: "clip", id: "a", asset: "shared" },
              { tag: "clip", id: "b", asset: "shared" },
            ],
          },
          { tag: "folder", id: "c1", children: [{ tag: "clip", id: "keep", asset: "shared" }] },
        ],
      },
    ]);

    const next = commit(graph, {
      type: "moved",
      moves: [
        {
          nodeId: nid("b"),
          fromParentId: nid("c0"),
          fromIndex: 1,
          toParentId: nid("c1"),
          toIndex: 0,
        },
        {
          nodeId: nid("a"),
          fromParentId: nid("c0"),
          fromIndex: 0,
          toParentId: nid("c1"),
          toIndex: 1,
        },
      ],
    } as const);

    expect(next.placementsByContentKey).toEqual(
      rebuildDerivedIndexes(next, keyedRegistry).placementsByContentKey,
    );
  });
});

// ---------------------------------------------------------------------------
// The other three arms
// ---------------------------------------------------------------------------

describe("insert / remove / edit commit cost", () => {
  it("shares both indexes when the inserted nodes carry no key", () => {
    const graph = wideGraph(10, 10, { registry: keylessRegistry });
    const ctx = makeCtx(keylessRegistry);
    const next = commit(
      graph,
      {
        type: "inserted",
        placements: [
          {
            node: makeCollectionNode<TestTypes, Summary>(
              nid("fresh"),
              "folder",
              { name: "fresh", source: null },
              LOADED,
              null,
            ),
            parentId: nid("root"),
            index: 0,
          },
        ],
      },
      ctx,
    );
    expect(next.placementsByContentKey).toBe(graph.placementsByContentKey);
    expect(next.ownerBySourceKey).toBe(graph.ownerBySourceKey);
  });

  it("shares both indexes when an inserted node's kind defines no key", () => {
    // The keyed registry, but `folder` has no `contentKey` and this one's
    // `sourceKey` is null — nothing to index, so nothing to rebuild.
    const graph = wideGraph(8, 8);
    const next = commit(graph, {
      type: "inserted",
      placements: [
        {
          node: makeCollectionNode<TestTypes, Summary>(
            nid("fresh"),
            "folder",
            { name: "fresh", source: null },
            LOADED,
            null,
          ),
          parentId: nid("root"),
          index: 0,
        },
      ],
    });
    expect(next.placementsByContentKey).toBe(graph.placementsByContentKey);
    expect(next.ownerBySourceKey).toBe(graph.ownerBySourceKey);
  });

  it("still indexes an inserted node that DOES carry a key", () => {
    const graph = wideGraph(4, 4);
    const next = commit(graph, {
      type: "inserted",
      placements: [
        {
          node: makeLeafNode<TestTypes>(nid("fresh"), "clip", {
            title: "fresh",
            assetId: "asset-c0-m0",
          }),
          parentId: nid("c0"),
          index: 0,
        },
      ],
    });
    expect(next.placementsByContentKey.get("asset-c0-m0")?.map(String)).toEqual([
      "fresh",
      "c0-m0",
    ]);
  });

  it("updates the placement index on removal without touching other buckets", () => {
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          { tag: "clip", id: "a", asset: "shared" },
          { tag: "clip", id: "b", asset: "shared" },
          { tag: "clip", id: "keep", asset: "elsewhere" },
        ],
      },
    ]);
    const untouched = graph.placementsByContentKey.get("elsewhere");
    const removedNode = graph.nodesById.get(nid("a"));
    if (removedNode === undefined) throw new Error("fixture is missing node a");

    const next = commit(graph, {
      type: "removed",
      placements: [{ node: removedNode, parentId: nid("root"), index: 0 }],
    });
    expect(next.placementsByContentKey.get("shared")?.map(String)).toEqual(["b"]);
    // A removal cannot reorder a survivor, so a bucket nothing left is the same
    // array object it was.
    expect(next.placementsByContentKey.get("elsewhere")).toBe(untouched);
  });

  it("drops an emptied bucket rather than leaving it as []", () => {
    // A rebuild never mints an empty bucket, and check 9 compares key COUNTS —
    // leaving one behind reads as `derived-index-stale` on a correct graph.
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        children: [
          { tag: "clip", id: "only", asset: "lonely" },
          { tag: "clip", id: "keep", asset: "elsewhere" },
        ],
      },
    ]);
    const removedNode = graph.nodesById.get(nid("only"));
    if (removedNode === undefined) throw new Error("fixture is missing node only");
    const next = commit(graph, {
      type: "removed",
      placements: [{ node: removedNode, parentId: nid("root"), index: 0 }],
    });
    expect(next.placementsByContentKey.has("lonely")).toBe(false);
  });

  it("vacates the sourceKey of a removed owner and shares the map otherwise", () => {
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        source: "src-root",
        children: [
          { tag: "folder", id: "owned", source: "src-owned", children: [] },
          { tag: "folder", id: "other", source: "src-other", children: [] },
        ],
      },
    ]);
    const removedNode = graph.nodesById.get(nid("owned"));
    if (removedNode === undefined) throw new Error("fixture is missing node owned");
    const next = commit(graph, {
      type: "removed",
      placements: [{ node: removedNode, parentId: nid("root"), index: 0 }],
    });
    expect(next.ownerBySourceKey.has("src-owned")).toBe(false);
    expect(next.ownerBySourceKey.get("src-other")).toBe(nid("other"));
  });

  it("shares both indexes when a removal touches no key", () => {
    const graph = buildGraph([
      {
        tag: "folder",
        id: "root",
        source: "src-root",
        children: [
          { tag: "clip", id: "a", asset: "shared" },
          { tag: "folder", id: "keyless", source: null, children: [] },
        ],
      },
    ]);
    const removedNode = graph.nodesById.get(nid("keyless"));
    if (removedNode === undefined) throw new Error("fixture is missing node keyless");
    const next = commit(graph, {
      type: "removed",
      placements: [{ node: removedNode, parentId: nid("root"), index: 1 }],
    });
    expect(next.placementsByContentKey).toBe(graph.placementsByContentKey);
    expect(next.ownerBySourceKey).toBe(graph.ownerBySourceKey);
  });

  it("shares both indexes for an edit that does not move a key", () => {
    const graph = wideGraph(10, 10);
    resetCodecCounters();
    const next = commit(graph, {
      type: "data-changed",
      changes: [
        {
          nodeId: nid("c0-m0"),
          kind: "clip",
          before: { title: "c0-m0", assetId: "asset-c0-m0" },
          after: { title: "renamed", assetId: "asset-c0-m0" },
        },
      ],
    });
    // A retitle leaves `contentKey` (the asset id) alone — the common edit, and
    // the one that used to cost a document-order DFS.
    expect(next.placementsByContentKey).toBe(graph.placementsByContentKey);
    expect(next.ownerBySourceKey).toBe(graph.ownerBySourceKey);
    expect(contentKeyCalls).toBe(2); // before and after of the one change
  });

  it("rebuilds for an edit that DOES move a key", () => {
    const graph = wideGraph(3, 3);
    const next = commit(graph, {
      type: "data-changed",
      changes: [
        {
          nodeId: nid("c0-m0"),
          kind: "clip",
          before: { title: "c0-m0", assetId: "asset-c0-m0" },
          after: { title: "c0-m0", assetId: "asset-c1-m1" },
        },
      ],
    });
    expect(next.placementsByContentKey.has("asset-c0-m0")).toBe(false);
    expect(next.placementsByContentKey.get("asset-c1-m1")?.map(String)).toEqual([
      "c0-m0",
      "c1-m1",
    ]);
    expect(next.placementsByContentKey).toEqual(
      rebuildDerivedIndexes(next, keyedRegistry).placementsByContentKey,
    );
  });
});

// ---------------------------------------------------------------------------
// The differential guard
// ---------------------------------------------------------------------------

describe("incremental indexes never diverge from a rebuild", () => {
  /** Deterministic LCG. A seeded generator, never `Math.random`: a fuzz that
   *  cannot be re-run on the failing input is a flake, not a test. */
  function makeRandom(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  it("survives 300 random commits against a heavily shared key space", () => {
    const collections = 5;
    const perCollection = 6;
    const assetPool = ["shared-0", "shared-1", "shared-2"];
    // Deliberately few distinct keys, so most buckets hold several placements
    // and the slot-rewriting path is exercised rather than the trivial
    // one-id-per-bucket shortcut.
    let graph = wideGraph(collections, perCollection, {
      assetOf: (c, i) => `shared-${(c + i) % assetPool.length}`,
    });

    const assetOfClip = new Map<string, string>();
    for (let c = 0; c < collections; c += 1) {
      for (let i = 0; i < perCollection; i += 1) {
        assetOfClip.set(`c${c}-m${i}`, `shared-${(c + i) % assetPool.length}`);
      }
    }

    const random = makeRandom(20260827);
    const pick = <T>(items: readonly T[]): T | undefined =>
      items[Math.floor(random() * items.length)];

    const collectionIds = Array.from({ length: collections }, (_, c) => `c${c}`);
    let reorders = 0;
    let reparents = 0;
    let removals = 0;
    let edits = 0;

    for (let step = 0; step < 300; step += 1) {
      const roll = random();
      const fromId = pick(collectionIds);
      if (fromId === undefined) throw new Error("empty collection list");
      const from = graph.childrenById.get(nid(fromId)) ?? [];
      if (from.length === 0) continue;
      const fromIndex = Math.floor(random() * from.length);
      const nodeId = from[fromIndex];
      if (nodeId === undefined) continue;

      if (roll < 0.5) {
        // Same-parent reorder — the scoped path.
        const toIndex = Math.floor(random() * from.length);
        if (toIndex === fromIndex) continue;
        graph = commit(graph, {
          type: "moved",
          moves: [
            {
              nodeId,
              fromParentId: nid(fromId),
              fromIndex,
              toParentId: nid(fromId),
              toIndex,
            },
          ],
        });
        reorders += 1;
      } else if (roll < 0.8) {
        // Cross-parent move — the rebuild fallback.
        const toId = pick(collectionIds);
        if (toId === undefined || toId === fromId) continue;
        const to = graph.childrenById.get(nid(toId)) ?? [];
        graph = commit(graph, {
          type: "moved",
          moves: [
            {
              nodeId,
              fromParentId: nid(fromId),
              fromIndex,
              toParentId: nid(toId),
              toIndex: Math.floor(random() * (to.length + 1)),
            },
          ],
        });
        reparents += 1;
      } else if (roll < 0.9) {
        // Removal — the filtered-bucket path. Clips are leaves, so one
        // placement is the whole subtree.
        const node = graph.nodesById.get(nodeId);
        if (node === undefined) continue;
        graph = commit(graph, {
          type: "removed",
          placements: [{ node, parentId: nid(fromId), index: fromIndex }],
        });
        assetOfClip.delete(String(nodeId));
        removals += 1;
      } else {
        // Content edit — half of these move the key, half do not.
        const before = assetOfClip.get(String(nodeId));
        if (before === undefined) continue;
        const after = pick(assetPool);
        if (after === undefined) continue;
        graph = commit(graph, {
          type: "data-changed",
          changes: [
            {
              nodeId,
              kind: "clip",
              before: { title: String(nodeId), assetId: before },
              after: { title: String(nodeId), assetId: after },
            },
          ],
        });
        assetOfClip.set(String(nodeId), after);
        edits += 1;
      }
    }

    // `commit` asserts `findInvariantViolation` after every step, and check 9 of
    // that audit compares BOTH derived indexes against a fresh rebuild — so the
    // loop above is a differential test of every incremental path, entry by
    // entry and in order, 300 times over.
    expect(reorders).toBeGreaterThan(50);
    expect(reparents).toBeGreaterThan(20);
    expect(removals).toBeGreaterThan(5);
    expect(edits).toBeGreaterThan(5);
    // A last explicit comparison, so a reader does not have to take check 9 on
    // trust to see what this test proves.
    const fresh = rebuildDerivedIndexes(graph, keyedRegistry);
    expect(graph.placementsByContentKey).toEqual(fresh.placementsByContentKey);
    expect(graph.ownerBySourceKey).toEqual(fresh.ownerBySourceKey);
  });
});

// ---------------------------------------------------------------------------
// bumpSubtreeRevsInto — the shared implementation under the copying form
// ---------------------------------------------------------------------------

describe("bumpSubtreeRevsInto", () => {
  const graph = wideGraph(3, 3);

  it("agrees with the copying form entry for entry", () => {
    const ids = [nid("c0-m0"), nid("c1-m2"), nid("c0")];
    const copied = bumpSubtreeRevs(graph.subtreeRevById, graph, ids);
    const written = new Map(graph.subtreeRevById);
    bumpSubtreeRevsInto(written, graph, ids);
    expect([...written.entries()]).toEqual([...copied.entries()]);
  });

  it("bumps a shared ancestor once per call, not once per id", () => {
    const written = new Map(graph.subtreeRevById);
    bumpSubtreeRevsInto(written, graph, [nid("c0-m0"), nid("c0-m1"), nid("c0-m2")]);
    // The prefix-closed short-circuit: `c0` and `root` are on all three chains
    // and must each move by exactly one.
    expect(written.get(nid("c0"))).toBe(1);
    expect(written.get(nid("root"))).toBe(1);
    expect(written.get(nid("c1"))).toBe(0);
  });

  it("writes nothing for an empty id list", () => {
    const written = new Map(graph.subtreeRevById);
    bumpSubtreeRevsInto(written, graph, []);
    expect([...written.entries()]).toEqual([...graph.subtreeRevById.entries()]);
  });

  it("bumps an id the graph does not hold rather than dropping it", () => {
    const written = new Map(graph.subtreeRevById);
    bumpSubtreeRevsInto(written, graph, [nid("vanished")]);
    expect(written.get(nid("vanished"))).toBe(1);
  });
});

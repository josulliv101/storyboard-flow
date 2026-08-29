// Unit tests for keel-core/graph.
//
// The bias here is toward FAILURE modes. A happy-path graph is a few asserts;
// the value of this module is `findInvariantViolation`, and an invariant check
// that has only ever been run against a valid graph has never been tested at
// all — it can return `null` for every input and pass. So every violation code
// this module can emit has a test that PRODUCES it, and the two codes it
// deliberately cannot emit (`cycle`) have a test showing which check catches
// that shape instead.

import { describe, expect, it } from "vitest";

import {
  ancestorChain,
  buildGraph,
  buildRegistry,
  bumpSubtreeRevs,
  childrenStateOf,
  contentKeyOf,
  documentOrder,
  emptyGraph,
  findInvariantViolation,
  getChildren,
  getNode,
  getParent,
  getSubtreeRev,
  isCollection,
  isLoaded,
  isSameOrAncestor,
  markMissing,
  ownsSubtree,
  rebuildDerivedIndexes,
  sourceKeyOf,
  subtreeIds,
} from "./graph";
import {
  defineNodeType,
  makeCollectionNode,
  makeLeafNode,
  makeQuarantinedNode,
  parseNodeId,
} from "./types";
import type {
  GraphNode,
  ChildrenState,
  Graph,
  Issue,
  NodeId,
  Result,
} from "./types";

// ---------------------------------------------------------------------------
// Fixtures: a two-kind registry with real node types
// ---------------------------------------------------------------------------
//
// The node types CONSTRUCT rather than cast, matching the rule the engine relies
// on. They are only exercised here through `contentKey` / `sourceKey`, but a
// permissive `parse` in a fixture is exactly the shape of test double that
// hides a real bug, so they are written honestly.

type ClipData = Readonly<{ assetId: string; label: string }>;
type ClipEdit = Readonly<{ label: string }>;
type FolderData = Readonly<{ name: string; docId: string | null }>;
type FolderEdit = Readonly<{ name: string }>;
type NoteData = Readonly<{ text: string }>;
type NoteEdit = Readonly<{ text: string }>;
type Summary = Readonly<{ count: number }>;

function asRecord(raw: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof raw !== "object" || raw === null) return null;
  return { ...raw };
}

const clipType = defineNodeType<ClipData, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<ClipData, readonly Issue[]> {
    const record = asRecord(raw);
    const assetId = record?.["assetId"];
    const label = record?.["label"];
    if (typeof assetId !== "string" || typeof label !== "string") {
      return { ok: false, error: [{ path: "$", message: "not a clip" }] };
    }
    return { ok: true, value: { assetId, label } };
  },
  serialize(data) {
    return { assetId: data.assetId, label: data.label };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { assetId: data.assetId, label: edit.label } };
  },
  contentKey(data) {
    return data.assetId;
  },
});

const folderType = defineNodeType<FolderData, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<FolderData, readonly Issue[]> {
    const record = asRecord(raw);
    const name = record?.["name"];
    const docId = record?.["docId"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "not a folder" }] };
    }
    return { ok: true, value: { name, docId: typeof docId === "string" ? docId : null } };
  },
  serialize(data) {
    return { name: data.name, docId: data.docId };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { name: edit.name, docId: data.docId } };
  },
  // "same stored subtree" — this is what the single-owner invariant keys on.
  sourceKey(data) {
    return data.docId;
  },
});

/** Declares NEITHER optional key hook, so it covers the "node type opted out" arm
 *  of `contentKeyOf` / `sourceKeyOf` — distinct from "kind not registered". */
const noteType = defineNodeType<NoteData, NoteEdit>()({
  kind: "note",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<NoteData, readonly Issue[]> {
    const text = asRecord(raw)?.["text"];
    if (typeof text !== "string") {
      return { ok: false, error: [{ path: "$.text", message: "not a note" }] };
    }
    return { ok: true, value: { text } };
  },
  serialize(data) {
    return { text: data.text };
  },
  applyEdit(_data, edit) {
    return { ok: true, value: { text: edit.text } };
  },
});

type Types = readonly [typeof clipType, typeof folderType, typeof noteType];
type TestGraph = Graph<Types, Summary>;
type TestNode = GraphNode<Types, Summary>;

const registry = buildRegistry([clipType, folderType, noteType]);
const ENGINE = Symbol("keel-graph-test");

const LOADED: ChildrenState = { status: "loaded" };
const UNLOADED: ChildrenState = { status: "unloaded" };
const REFERENCE: ChildrenState = { status: "reference" };

function nid(text: string): NodeId {
  return parseNodeId(text);
}

function clip(name: string, assetId: string = name): TestNode {
  return makeLeafNode<Types>(nid(name), "clip", { assetId, label: name });
}

function note(name: string): TestNode {
  return makeLeafNode<Types>(nid(name), "note", { text: name });
}

function folder(
  name: string,
  children: ChildrenState,
  docId: string | null = null,
): TestNode {
  return makeCollectionNode<Types, Summary>(
    nid(name),
    "folder",
    { name, docId },
    children,
    null,
  );
}

function quarantined(
  name: string,
  container: boolean,
  children: ChildrenState | null,
): TestNode {
  return makeQuarantinedNode({
    id: nid(name),
    kind: "from-the-future",
    container,
    schemaVersion: 9,
    raw: { anything: true },
    reason: "unknown-kind",
    issues: [],
    children,
    summary: null,
  });
}

function graphOf(
  args: Readonly<{
    nodes: readonly TestNode[];
    children?: Readonly<Record<string, readonly string[]>>;
    roots: readonly string[];
  }>,
): TestGraph {
  const nodesById = new Map<NodeId, TestNode>();
  for (const node of args.nodes) nodesById.set(node.id, node);

  const childrenById = new Map<NodeId, readonly NodeId[]>();
  for (const [parentId, childIds] of Object.entries(args.children ?? {})) {
    childrenById.set(
      nid(parentId),
      childIds.map((childId) => nid(childId)),
    );
  }

  return buildGraph<Types, Summary>({
    engineId: ENGINE,
    nodesById,
    childrenById,
    rootIds: args.roots.map((rootId) => nid(rootId)),
    registry,
  });
}

/**
 * root
 *  |- a            (folder, loaded, docId "doc-a")
 *  |   |- c1       (clip, asset-x)
 *  |   `- c2       (clip, asset-y)
 *  |- b            (folder, unloaded, docId "doc-b")
 *  `- c3           (clip, asset-x)   <- second placement of asset-x
 */
function sampleGraph(): TestGraph {
  return graphOf({
    nodes: [
      folder("root", LOADED),
      folder("a", LOADED, "doc-a"),
      clip("c1", "asset-x"),
      clip("c2", "asset-y"),
      folder("b", UNLOADED, "doc-b"),
      clip("c3", "asset-x"),
    ],
    children: { root: ["a", "b", "c3"], a: ["c1", "c2"] },
    roots: ["root"],
  });
}

// ---------------------------------------------------------------------------

describe("buildRegistry", () => {
  it("keys every node type by its kind", () => {
    expect([...registry.keys()].sort()).toEqual(["clip", "folder", "note"]);
    expect(registry.get("clip")).toBe(clipType);
  });

  it("THROWS on a duplicate kind, naming it", () => {
    // Not Result-shaped on purpose: a duplicate kind is a module-init
    // programmer error, and there is no partial-success answer — one node type
    // would silently win at the trust boundary.
    expect(() => buildRegistry([clipType, folderType, clipType])).toThrow(
      /duplicate node kind "clip"/,
    );
  });

  it("does not throw for distinct kinds", () => {
    expect(() => buildRegistry([clipType, folderType])).not.toThrow();
  });
});

describe("emptyGraph", () => {
  it("is empty, carries the engineId, and is valid", () => {
    const graph = emptyGraph<Types, Summary>(ENGINE);
    expect(graph.engineId).toBe(ENGINE);
    expect(graph.nodesById.size).toBe(0);
    expect(graph.rootIds).toEqual([]);
    expect(findInvariantViolation(graph, registry)).toBeNull();
  });
});

describe("buildGraph", () => {
  it("produces a valid graph with total parent and revision indexes", () => {
    const graph = sampleGraph();
    expect(findInvariantViolation(graph, registry)).toBeNull();

    // TOTAL means every node has an entry — a root's is an explicit null, so
    // `has` and `get` answer different questions.
    for (const id of graph.nodesById.keys()) {
      expect(graph.parentById.has(id)).toBe(true);
      expect(graph.subtreeRevById.has(id)).toBe(true);
      expect(getSubtreeRev(graph, id)).toBe(0);
    }
    expect(graph.parentById.get(nid("root"))).toBeNull();
    expect(graph.parentById.get(nid("c1"))).toBe(nid("a"));
  });

  it("carries forward supplied revisions and defaults the rest to 0", () => {
    const base = sampleGraph();
    const rebuilt = buildGraph<Types, Summary>({
      engineId: ENGINE,
      nodesById: base.nodesById,
      childrenById: base.childrenById,
      rootIds: base.rootIds,
      registry,
      subtreeRevs: new Map([[nid("a"), 7]]),
    });
    expect(getSubtreeRev(rebuilt, nid("a"))).toBe(7);
    expect(getSubtreeRev(rebuilt, nid("root"))).toBe(0);
  });
});

describe("queries are total", () => {
  const graph = sampleGraph();
  const ghost = nid("no-such-node");

  it("getNode returns undefined rather than throwing", () => {
    expect(getNode(graph, ghost)).toBeUndefined();
    expect(getNode(graph, nid("c1"))?.kind).toBe("clip");
  });

  it("getChildren answers [] for unknown, leaf and unloaded alike", () => {
    expect(getChildren(graph, nid("a"))).toEqual([nid("c1"), nid("c2")]);
    expect(getChildren(graph, ghost)).toEqual([]);
    expect(getChildren(graph, nid("c1"))).toEqual([]);
    expect(getChildren(graph, nid("b"))).toEqual([]);
  });

  it("getChildren returns ONE shared empty array", () => {
    // A fresh [] per call would give every consumer a new identity every frame
    // and defeat their memo comparisons.
    expect(getChildren(graph, ghost)).toBe(getChildren(graph, nid("b")));
  });

  it("getParent answers null for a root and for an unknown node", () => {
    expect(getParent(graph, nid("root"))).toBeNull();
    expect(getParent(graph, ghost)).toBeNull();
    expect(getParent(graph, nid("c2"))).toBe(nid("a"));
  });

  it("getSubtreeRev answers 0 for an unknown node", () => {
    expect(getSubtreeRev(graph, ghost)).toBe(0);
  });
});

describe("childrenStateOf / isCollection / isLoaded / ownsSubtree", () => {
  const graph = graphOf({
    nodes: [
      folder("root", LOADED),
      folder("loaded", LOADED),
      folder("unloaded", UNLOADED),
      folder("ref", REFERENCE),
      clip("leaf"),
      quarantined("q-container", true, UNLOADED),
      quarantined("q-leaf", false, null),
    ],
    children: {
      root: ["loaded", "unloaded", "ref", "leaf", "q-container", "q-leaf"],
      loaded: [],
    },
    roots: ["root"],
  });

  it("distinguishes all four children states", () => {
    expect(childrenStateOf(graph, nid("loaded"))).toEqual({ status: "loaded" });
    expect(childrenStateOf(graph, nid("unloaded"))).toEqual({ status: "unloaded" });
    expect(childrenStateOf(graph, nid("ref"))).toEqual({ status: "reference" });
    expect(childrenStateOf(graph, nid("q-container"))).toEqual({
      status: "unloaded",
    });
  });

  it("answers null where there is no subtree at all", () => {
    expect(childrenStateOf(graph, nid("leaf"))).toBeNull();
    expect(childrenStateOf(graph, nid("q-leaf"))).toBeNull();
    expect(childrenStateOf(graph, nid("nope"))).toBeNull();
  });

  it("isCollection is true for EVERY quarantined node, leaf included", () => {
    // Over-broad by design: the predicate narrows its false branch to LeafNode,
    // so admitting a quarantined leaf there would let it be read as a parsed
    // leaf with a `data` field it does not have.
    const qLeaf = getNode(graph, nid("q-leaf"));
    const qContainer = getNode(graph, nid("q-container"));
    const leaf = getNode(graph, nid("leaf"));
    expect(qLeaf !== undefined && isCollection(qLeaf)).toBe(true);
    expect(qContainer !== undefined && isCollection(qContainer)).toBe(true);
    expect(leaf !== undefined && isCollection(leaf)).toBe(false);
  });

  it("isLoaded is true only for `loaded`", () => {
    expect(isLoaded(graph, nid("loaded"))).toBe(true);
    expect(isLoaded(graph, nid("unloaded"))).toBe(false);
    expect(isLoaded(graph, nid("ref"))).toBe(false);
    expect(isLoaded(graph, nid("leaf"))).toBe(false);
    expect(isLoaded(graph, nid("nope"))).toBe(false);
  });

  it("only `reference` disclaims ownership", () => {
    expect(ownsSubtree({ status: "loaded" })).toBe(true);
    expect(ownsSubtree({ status: "unloaded" })).toBe(true);
    expect(ownsSubtree({ status: "missing", reason: "404" })).toBe(true);
    expect(ownsSubtree({ status: "reference" })).toBe(false);
  });
});

describe("ancestorChain / isSameOrAncestor", () => {
  const graph = sampleGraph();

  it("is parent-first and excludes the node itself", () => {
    expect(ancestorChain(graph, nid("c1"))).toEqual([nid("a"), nid("root")]);
    expect(ancestorChain(graph, nid("a"))).toEqual([nid("root")]);
    expect(ancestorChain(graph, nid("root"))).toEqual([]);
    expect(ancestorChain(graph, nid("nope"))).toEqual([]);
  });

  it("terminates on a corrupt parentById instead of hanging", () => {
    // Hand-built cycle in parentById only — the guard is about not hanging a
    // render loop; naming the corruption is findInvariantViolation's job.
    const corrupt: TestGraph = {
      ...graph,
      parentById: new Map([
        [nid("a"), nid("c1")],
        [nid("c1"), nid("a")],
      ]),
    };
    const chain = ancestorChain(corrupt, nid("c1"));
    expect(chain.length).toBeLessThanOrEqual(corrupt.nodesById.size);
    expect(isSameOrAncestor(corrupt, nid("root"), nid("c1"))).toBe(false);
  });

  it("isSameOrAncestor is reflexive, true upward, false downward and sideways", () => {
    expect(isSameOrAncestor(graph, nid("a"), nid("a"))).toBe(true);
    expect(isSameOrAncestor(graph, nid("root"), nid("c1"))).toBe(true);
    expect(isSameOrAncestor(graph, nid("a"), nid("c1"))).toBe(true);
    expect(isSameOrAncestor(graph, nid("c1"), nid("a"))).toBe(false);
    expect(isSameOrAncestor(graph, nid("b"), nid("c1"))).toBe(false);
  });
});

describe("subtreeIds / documentOrder", () => {
  const graph = sampleGraph();

  it("subtreeIds is pre-order and includes the node itself", () => {
    expect(subtreeIds(graph, nid("a"))).toEqual([nid("a"), nid("c1"), nid("c2")]);
    expect(subtreeIds(graph, nid("c1"))).toEqual([nid("c1")]);
  });

  it("subtreeIds stops at an unloaded collection", () => {
    // Not "b is empty" — b's children have never been seen. The walk cannot
    // invent them, and getChildren answering [] is why callers must read
    // childrenStateOf instead.
    expect(subtreeIds(graph, nid("b"))).toEqual([nid("b")]);
  });

  it("subtreeIds is [] for an unknown id, not [id]", () => {
    expect(subtreeIds(graph, nid("nope"))).toEqual([]);
  });

  it("documentOrder walks every root in rootIds order", () => {
    expect(documentOrder(graph)).toEqual([
      nid("root"),
      nid("a"),
      nid("c1"),
      nid("c2"),
      nid("b"),
      nid("c3"),
    ]);

    const twoRoots = graphOf({
      nodes: [folder("r2", LOADED), folder("r1", LOADED), clip("x")],
      children: { r1: ["x"], r2: [] },
      roots: ["r2", "r1"],
    });
    expect(documentOrder(twoRoots)).toEqual([nid("r2"), nid("r1"), nid("x")]);
  });
});

describe("contentKeyOf / sourceKeyOf", () => {
  const graph = graphOf({
    nodes: [
      folder("root", LOADED),
      folder("owned", UNLOADED, "doc-1"),
      clip("c1", "asset-x"),
      note("n1"),
      quarantined("q", false, null),
      makeLeafNode<Types>(nid("ghost-kind"), "not-registered", { assetId: "z" }),
    ],
    children: { root: ["owned", "c1", "n1", "q", "ghost-kind"] },
    roots: ["root"],
  });

  function keysOf(id: string): readonly [string | null, string | null] {
    const node = getNode(graph, nid(id));
    if (node === undefined) throw new Error(`missing fixture node ${id}`);
    return [contentKeyOf(registry, node), sourceKeyOf(registry, node)];
  }

  it("reads the node type's hooks when it declares them", () => {
    expect(keysOf("c1")).toEqual(["asset-x", null]);
    expect(keysOf("owned")).toEqual([null, "doc-1"]);
  });

  it("is null when the node type declined the hook", () => {
    expect(keysOf("n1")).toEqual([null, null]);
  });

  it("is null for a quarantined node — `raw` is not `Data`", () => {
    expect(keysOf("q")).toEqual([null, null]);
  });

  it("is null when no node type is registered for the kind", () => {
    expect(keysOf("ghost-kind")).toEqual([null, null]);
  });
});

describe("bumpSubtreeRevs", () => {
  const graph = sampleGraph();
  const zero = graph.subtreeRevById;

  function bumped(revs: ReadonlyMap<NodeId, number>): readonly string[] {
    const out: string[] = [];
    for (const [id, rev] of revs) if (rev > 0) out.push(id);
    return out.sort();
  }

  it("bumps the node and every ancestor, and nothing else", () => {
    const next = bumpSubtreeRevs(zero, graph, [nid("c1")]);
    expect(bumped(next)).toEqual(["a", "c1", "root"]);
    expect(next.get(nid("c2"))).toBe(0);
    expect(next.get(nid("b"))).toBe(0);
  });

  it("bumps each id once, even when the ids share a chain", () => {
    const next = bumpSubtreeRevs(zero, graph, [nid("c1"), nid("c2")]);
    expect(next.get(nid("root"))).toBe(1);
    expect(next.get(nid("a"))).toBe(1);
    expect(next.get(nid("c1"))).toBe(1);
    expect(next.get(nid("c2"))).toBe(1);
  });

  it("bumps a repeated id once", () => {
    const next = bumpSubtreeRevs(zero, graph, [nid("c1"), nid("c1")]);
    expect(next.get(nid("c1"))).toBe(1);
  });

  it("returns the SAME map for an empty id list", () => {
    // Identity is the signal a caller uses to skip notifying at all.
    expect(bumpSubtreeRevs(zero, graph, [])).toBe(zero);
  });

  it("bumps an id the graph does not hold rather than dropping it", () => {
    // Filtering would turn "caller passed the wrong-state graph" into a silent
    // missed notification. A stray entry for a vanished id is inert.
    const next = bumpSubtreeRevs(zero, graph, [nid("vanished")]);
    expect(next.get(nid("vanished"))).toBe(1);
  });

  it("accumulates across calls", () => {
    const once = bumpSubtreeRevs(zero, graph, [nid("c1")]);
    const twice = bumpSubtreeRevs(once, graph, [nid("c1")]);
    expect(twice.get(nid("c1"))).toBe(2);
    expect(twice.get(nid("root"))).toBe(2);
  });

  it("A MOVE HAS TWO CHAINS — one graph cannot supply both", () => {
    // Pre-state: c1 under a. Post-state: c1 under b.
    const pre = graphOf({
      nodes: [folder("root", LOADED), folder("a", LOADED), folder("b", LOADED), clip("c1")],
      children: { root: ["a", "b"], a: ["c1"], b: [] },
      roots: ["root"],
    });
    const post = graphOf({
      nodes: [folder("root", LOADED), folder("a", LOADED), folder("b", LOADED), clip("c1")],
      children: { root: ["a", "b"], a: [], b: ["c1"] },
      roots: ["root"],
    });

    const viaPre = bumpSubtreeRevs(pre.subtreeRevById, pre, [nid("c1")]);
    const viaPost = bumpSubtreeRevs(post.subtreeRevById, post, [nid("c1")]);

    // The old parent is only reachable through the PRE-state graph...
    expect(bumped(viaPre)).toEqual(["a", "c1", "root"]);
    // ...and the new parent only through the post-state one. An applyPatch that
    // bumps against a single graph leaves one side's rollups permanently stale,
    // and the moved node itself still updates — so the bug is invisible.
    expect(bumped(viaPost)).toEqual(["b", "c1", "root"]);
  });
});

describe("rebuildDerivedIndexes", () => {
  it("lists every placement of one contentKey in DOCUMENT order", () => {
    const graph = sampleGraph();
    expect(graph.placementsByContentKey.get("asset-x")).toEqual([
      nid("c1"),
      nid("c3"),
    ]);
    expect(graph.placementsByContentKey.get("asset-y")).toEqual([nid("c2")]);
  });

  it("records the owner and skips a `reference` placement", () => {
    const graph = graphOf({
      nodes: [
        folder("root", LOADED),
        folder("ref", REFERENCE, "doc-1"),
        folder("owner", UNLOADED, "doc-1"),
      ],
      // The reference comes FIRST in document order, so a naive "first wins"
      // over all placements would name the wrong node.
      children: { root: ["ref", "owner"] },
      roots: ["root"],
    });
    expect(graph.ownerBySourceKey.get("doc-1")).toBe(nid("owner"));
    expect(findInvariantViolation(graph, registry)).toBeNull();
  });

  it("keeps the FIRST owner when a graph illegally has two", () => {
    const graph = graphOf({
      nodes: [
        folder("root", LOADED),
        folder("own1", UNLOADED, "doc-1"),
        folder("own2", UNLOADED, "doc-1"),
      ],
      children: { root: ["own1", "own2"] },
      roots: ["root"],
    });
    // The index stays deterministic; refusing is findInvariantViolation's job,
    // because this function runs on every mutation.
    expect(graph.ownerBySourceKey.get("doc-1")).toBe(nid("own1"));
  });

  it("indexes only reachable nodes", () => {
    const graph = graphOf({
      nodes: [folder("root", LOADED), clip("orphan", "asset-x")],
      children: { root: [] },
      roots: ["root"],
    });
    const fresh = rebuildDerivedIndexes(graph, registry);
    expect(fresh.placementsByContentKey.size).toBe(0);
  });

  it("agrees with what buildGraph stored", () => {
    const graph = sampleGraph();
    const fresh = rebuildDerivedIndexes(graph, registry);
    expect([...fresh.placementsByContentKey]).toEqual([
      ...graph.placementsByContentKey,
    ]);
    expect([...fresh.ownerBySourceKey]).toEqual([...graph.ownerBySourceKey]);
  });
});

describe("markMissing", () => {
  it("turns an unloaded collection into missing and bumps the chain", () => {
    const graph = sampleGraph();
    const next = markMissing(graph, nid("b"), "404");

    expect(childrenStateOf(next, nid("b"))).toEqual({
      status: "missing",
      reason: "404",
    });
    expect(getSubtreeRev(next, nid("b"))).toBe(1);
    expect(getSubtreeRev(next, nid("root"))).toBe(1);
    // A sibling's rollup did not change meaning, so it must not be notified.
    expect(getSubtreeRev(next, nid("a"))).toBe(0);
    expect(findInvariantViolation(next, registry)).toBeNull();
  });

  it("leaves the input graph untouched", () => {
    const graph = sampleGraph();
    markMissing(graph, nid("b"), "404");
    expect(childrenStateOf(graph, nid("b"))).toEqual({ status: "unloaded" });
  });

  it("is a no-op for an unknown node and for a leaf", () => {
    const graph = sampleGraph();
    expect(markMissing(graph, nid("nope"), "404")).toBe(graph);
    expect(markMissing(graph, nid("c1"), "404")).toBe(graph);
  });

  it("is a no-op for a `reference` — it never owned the subtree", () => {
    const graph = graphOf({
      nodes: [folder("root", LOADED), folder("ref", REFERENCE, "doc-1")],
      children: { root: ["ref"] },
      roots: ["root"],
    });
    expect(markMissing(graph, nid("ref"), "404")).toBe(graph);
  });

  it("is a no-op for a `loaded` collection — loading is MONOTONE in v1", () => {
    // Demoting a loaded collection would silently discard resident nodes with
    // no patch, and break the property dormant history rests on.
    const graph = sampleGraph();
    expect(markMissing(graph, nid("a"), "404")).toBe(graph);
    expect(getChildren(graph, nid("a"))).toEqual([nid("c1"), nid("c2")]);
  });

  it("is idempotent for the same reason and updates a different one", () => {
    const graph = sampleGraph();
    const once = markMissing(graph, nid("b"), "404");
    expect(markMissing(once, nid("b"), "404")).toBe(once);

    const changed = markMissing(once, nid("b"), "deleted");
    expect(childrenStateOf(changed, nid("b"))).toEqual({
      status: "missing",
      reason: "deleted",
    });
    expect(getSubtreeRev(changed, nid("b"))).toBe(2);
  });

  it("works on a quarantined container", () => {
    const graph = graphOf({
      nodes: [folder("root", LOADED), quarantined("q", true, UNLOADED)],
      children: { root: ["q"] },
      roots: ["root"],
    });
    const next = markMissing(graph, nid("q"), "404");
    expect(childrenStateOf(next, nid("q"))).toEqual({
      status: "missing",
      reason: "404",
    });
    // The quarantined node's byte-exact `raw` must survive the state change, or
    // re-emit stops being byte-exact.
    const node = getNode(next, nid("q"));
    expect(node?.quarantined === true && node.raw).toEqual({ anything: true });
    expect(findInvariantViolation(next, registry)).toBeNull();
  });

  it("is a no-op for a quarantined LEAF (no subtree to be missing)", () => {
    const graph = graphOf({
      nodes: [folder("root", LOADED), quarantined("q", false, null)],
      children: { root: ["q"] },
      roots: ["root"],
    });
    expect(markMissing(graph, nid("q"), "404")).toBe(graph);
  });
});

// ---------------------------------------------------------------------------
// findInvariantViolation — one test per code it can emit
// ---------------------------------------------------------------------------

describe("findInvariantViolation: valid graphs", () => {
  it("passes a populated graph", () => {
    expect(findInvariantViolation(sampleGraph(), registry)).toBeNull();
  });

  it("passes a graph with quarantined nodes in it", () => {
    const graph = graphOf({
      nodes: [
        folder("root", LOADED),
        quarantined("qc", true, LOADED),
        quarantined("ql", false, null),
        clip("inside"),
      ],
      // A quarantined container keeps its children addressable and movable —
      // that is the whole point of quarantining the DATA and not the node.
      children: { root: ["qc", "ql"], qc: ["inside"] },
      roots: ["root"],
    });
    expect(findInvariantViolation(graph, registry)).toBeNull();
    expect(getChildren(graph, nid("qc"))).toEqual([nid("inside")]);
  });

  it("passes a graph with several roots", () => {
    const graph = graphOf({
      nodes: [folder("r1", LOADED), folder("r2", UNLOADED)],
      children: { r1: [] },
      roots: ["r1", "r2"],
    });
    expect(findInvariantViolation(graph, registry)).toBeNull();
  });
});

describe("findInvariantViolation: id checks", () => {
  it("empty-node-id", () => {
    const good = sampleGraph();
    const nodesById = new Map(good.nodesById);
    // `parseNodeId` refuses this at the door; only a hand-built map can hold it.
    const blank = "   " as NodeId;
    nodesById.set(blank, clip("c1"));
    expect(findInvariantViolation({ ...good, nodesById }, registry)?.code).toBe(
      "empty-node-id",
    );
  });

  it("duplicate-node-id when the map key disagrees with the node's own id", () => {
    const good = sampleGraph();
    const nodesById = new Map(good.nodesById);
    nodesById.set(nid("mis-keyed"), clip("c1"));
    const violation = findInvariantViolation({ ...good, nodesById }, registry);
    expect(violation?.code).toBe("duplicate-node-id");
    expect(violation?.nodeId).toBe(nid("c1"));
    expect(violation?.otherNodeId).toBe(nid("mis-keyed"));
  });

  it("duplicate-node-id when rootIds lists one id twice", () => {
    const good = sampleGraph();
    const violation = findInvariantViolation(
      { ...good, rootIds: [nid("root"), nid("root")] },
      registry,
    );
    expect(violation?.code).toBe("duplicate-node-id");
    expect(violation?.nodeId).toBe(nid("root"));
  });
});

describe("findInvariantViolation: children checks", () => {
  it("dangling-child when a children array names a non-node", () => {
    const good = sampleGraph();
    const childrenById = new Map(good.childrenById);
    childrenById.set(nid("a"), [nid("c1"), nid("gone")]);
    const violation = findInvariantViolation({ ...good, childrenById }, registry);
    expect(violation?.code).toBe("dangling-child");
    expect(violation?.nodeId).toBe(nid("gone"));
    expect(violation?.parentId).toBe(nid("a"));
  });

  it("dangling-child when childrenById is keyed by a non-node", () => {
    const good = sampleGraph();
    const childrenById = new Map(good.childrenById);
    childrenById.set(nid("phantom"), []);
    const violation = findInvariantViolation({ ...good, childrenById }, registry);
    expect(violation?.code).toBe("dangling-child");
    expect(violation?.parentId).toBe(nid("phantom"));
  });

  it("dangling-child when rootIds names a non-node", () => {
    const good = sampleGraph();
    const violation = findInvariantViolation(
      { ...good, rootIds: [nid("root"), nid("phantom")] },
      registry,
    );
    expect(violation?.code).toBe("dangling-child");
    expect(violation?.nodeId).toBe(nid("phantom"));
  });

  it("multi-parent across two children arrays", () => {
    const good = sampleGraph();
    const childrenById = new Map(good.childrenById);
    childrenById.set(nid("a"), [nid("c1"), nid("c2"), nid("c3")]);
    const violation = findInvariantViolation({ ...good, childrenById }, registry);
    expect(violation?.code).toBe("multi-parent");
    expect(violation?.nodeId).toBe(nid("c3"));
  });

  it("multi-parent when one array lists an id twice", () => {
    // This is the shape a blind move retry produced in production: one removal
    // and two insertions, leaving one node in two slots.
    const good = sampleGraph();
    const childrenById = new Map(good.childrenById);
    childrenById.set(nid("a"), [nid("c1"), nid("c1"), nid("c2")]);
    const violation = findInvariantViolation({ ...good, childrenById }, registry);
    expect(violation?.code).toBe("multi-parent");
    expect(violation?.nodeId).toBe(nid("c1"));
  });

  it("leaf-with-children when a non-container holds a childrenById entry", () => {
    const good = sampleGraph();
    const childrenById = new Map(good.childrenById);
    childrenById.set(nid("c1"), []);
    const violation = findInvariantViolation({ ...good, childrenById }, registry);
    expect(violation?.code).toBe("leaf-with-children");
    expect(violation?.nodeId).toBe(nid("c1"));
  });

  it("leaf-with-children for a QUARANTINED leaf with an entry", () => {
    const graph = graphOf({
      nodes: [folder("root", LOADED), quarantined("ql", false, null)],
      children: { root: ["ql"], ql: [] },
      roots: ["root"],
    });
    expect(findInvariantViolation(graph, registry)?.code).toBe("leaf-with-children");
  });

  it("unloaded-collection-with-children", () => {
    // The direction that keeps `unloaded` from quietly meaning `loaded and
    // empty` — the ambiguity the four-state discriminant exists to remove.
    const graph = graphOf({
      nodes: [folder("root", LOADED), folder("b", UNLOADED), clip("c1")],
      children: { root: ["b"], b: ["c1"] },
      roots: ["root"],
    });
    const violation = findInvariantViolation(graph, registry);
    expect(violation?.code).toBe("unloaded-collection-with-children");
    expect(violation?.nodeId).toBe(nid("b"));
  });

  it("unloaded-collection-with-children also covers `reference` and `missing`", () => {
    for (const state of [REFERENCE, { status: "missing", reason: "404" } as const]) {
      const graph = graphOf({
        nodes: [folder("root", LOADED), folder("x", state), clip("c1")],
        children: { root: ["x"], x: ["c1"] },
        roots: ["root"],
      });
      expect(findInvariantViolation(graph, registry)?.code).toBe(
        "unloaded-collection-with-children",
      );
    }
  });

  it("loaded-collection-missing-children-entry", () => {
    const graph = graphOf({
      nodes: [folder("root", LOADED), folder("a", LOADED)],
      // `a` says loaded but has no entry — the other direction of the same rule.
      children: { root: ["a"] },
      roots: ["root"],
    });
    const violation = findInvariantViolation(graph, registry);
    expect(violation?.code).toBe("loaded-collection-missing-children-entry");
    expect(violation?.nodeId).toBe(nid("a"));
  });
});

describe("findInvariantViolation: root checks", () => {
  it("root-not-container", () => {
    const graph = graphOf({
      nodes: [folder("root", LOADED), clip("stray")],
      children: { root: [] },
      roots: ["root", "stray"],
    });
    const violation = findInvariantViolation(graph, registry);
    expect(violation?.code).toBe("root-not-container");
    expect(violation?.nodeId).toBe(nid("stray"));
  });

  it("root-is-child", () => {
    const good = sampleGraph();
    const violation = findInvariantViolation(
      { ...good, rootIds: [nid("root"), nid("a")] },
      registry,
    );
    expect(violation?.code).toBe("root-is-child");
    expect(violation?.nodeId).toBe(nid("a"));
    expect(violation?.parentId).toBe(nid("root"));
  });

  it("a quarantined node may be a root when the wire said container", () => {
    const graph = graphOf({
      nodes: [quarantined("qr", true, UNLOADED)],
      roots: ["qr"],
    });
    expect(findInvariantViolation(graph, registry)).toBeNull();
  });

  it("...and may not when it said leaf", () => {
    const graph = graphOf({
      nodes: [quarantined("qr", false, null)],
      roots: ["qr"],
    });
    expect(findInvariantViolation(graph, registry)?.code).toBe("root-not-container");
  });
});

describe("findInvariantViolation: parent and revision indexes", () => {
  it("missing-parent-entry", () => {
    const good = sampleGraph();
    const parentById = new Map(good.parentById);
    parentById.delete(nid("c1"));
    const violation = findInvariantViolation({ ...good, parentById }, registry);
    expect(violation?.code).toBe("missing-parent-entry");
    expect(violation?.nodeId).toBe(nid("c1"));
  });

  it("missing-parent-entry is checked with `has`, so an explicit null passes", () => {
    const good = sampleGraph();
    expect(good.parentById.get(nid("root"))).toBeNull();
    expect(findInvariantViolation(good, registry)).toBeNull();
  });

  it("parent-index-disagrees when parentById names the wrong parent", () => {
    const good = sampleGraph();
    const parentById = new Map(good.parentById);
    parentById.set(nid("c1"), nid("b"));
    const violation = findInvariantViolation({ ...good, parentById }, registry);
    expect(violation?.code).toBe("parent-index-disagrees");
    expect(violation?.nodeId).toBe(nid("c1"));
    expect(violation?.parentId).toBe(nid("a"));
  });

  it("parent-index-disagrees when a child is recorded as a root", () => {
    const good = sampleGraph();
    const parentById = new Map(good.parentById);
    parentById.set(nid("c1"), null);
    expect(findInvariantViolation({ ...good, parentById }, registry)?.code).toBe(
      "parent-index-disagrees",
    );
  });

  it("missing-subtree-rev", () => {
    const good = sampleGraph();
    const subtreeRevById = new Map(good.subtreeRevById);
    subtreeRevById.delete(nid("c2"));
    const violation = findInvariantViolation({ ...good, subtreeRevById }, registry);
    expect(violation?.code).toBe("missing-subtree-rev");
    expect(violation?.nodeId).toBe(nid("c2"));
  });
});

describe("findInvariantViolation: reachability and cycles", () => {
  it("unreachable-node", () => {
    const graph = graphOf({
      nodes: [folder("root", LOADED), clip("orphan")],
      children: { root: [] },
      roots: ["root"],
    });
    const violation = findInvariantViolation(graph, registry);
    expect(violation?.code).toBe("unreachable-node");
    expect(violation?.nodeId).toBe(nid("orphan"));
  });

  it("a cycle reachable from a root is caught by the COUNTING check", () => {
    // root -> a -> b -> a. `a` appears as a child twice, which is the forest
    // condition failing — no walk is needed to see it, and none is done.
    const graph = graphOf({
      nodes: [folder("root", LOADED), folder("a", LOADED), folder("b", LOADED)],
      children: { root: ["a"], a: ["b"], b: ["a"] },
      roots: ["root"],
    });
    const violation = findInvariantViolation(graph, registry);
    expect(violation?.code).toBe("multi-parent");
    expect(violation?.nodeId).toBe(nid("a"));
  });

  it("a detached cycle is caught by reachability, and terminates", () => {
    // a <-> b, neither reachable from root. Each appears exactly once as a
    // child, so only reachability sees it — and the walk never enters the
    // cycle, because it only descends from roots.
    const graph = graphOf({
      nodes: [folder("root", LOADED), folder("a", LOADED), folder("b", LOADED)],
      children: { root: [], a: ["b"], b: ["a"] },
      roots: ["root"],
    });
    const violation = findInvariantViolation(graph, registry);
    expect(violation?.code).toBe("unreachable-node");
    // documentOrder must also terminate on this graph rather than spin.
    expect(documentOrder(graph)).toEqual([nid("root")]);
  });
});

describe("findInvariantViolation: ownership", () => {
  it("duplicate-owner when two non-reference placements share a sourceKey", () => {
    const graph = graphOf({
      nodes: [
        folder("root", LOADED),
        folder("own1", UNLOADED, "doc-1"),
        folder("own2", LOADED, "doc-1"),
      ],
      children: { root: ["own1", "own2"], own2: [] },
      roots: ["root"],
    });
    const violation = findInvariantViolation(graph, registry);
    expect(violation?.code).toBe("duplicate-owner");
    expect(violation?.nodeId).toBe(nid("own2"));
    expect(violation?.otherNodeId).toBe(nid("own1"));
    expect(violation?.sourceKey).toBe("doc-1");
  });

  it("a `reference` second placement is legal — that IS the typed answer", () => {
    const graph = graphOf({
      nodes: [
        folder("root", LOADED),
        folder("owner", UNLOADED, "doc-1"),
        folder("ref", REFERENCE, "doc-1"),
      ],
      children: { root: ["owner", "ref"] },
      roots: ["root"],
    });
    expect(findInvariantViolation(graph, registry)).toBeNull();
  });

  it("a `missing` placement still counts as an owner", () => {
    // Confirmed-gone is knowledge about a subtree you own, not a handoff.
    const graph = graphOf({
      nodes: [
        folder("root", LOADED),
        folder("gone", { status: "missing", reason: "404" }, "doc-1"),
        folder("other", UNLOADED, "doc-1"),
      ],
      children: { root: ["gone", "other"] },
      roots: ["root"],
    });
    expect(findInvariantViolation(graph, registry)?.code).toBe("duplicate-owner");
  });

  it("a null sourceKey never collides", () => {
    const graph = graphOf({
      nodes: [folder("root", LOADED), folder("a", UNLOADED), folder("b", UNLOADED)],
      children: { root: ["a", "b"] },
      roots: ["root"],
    });
    expect(findInvariantViolation(graph, registry)).toBeNull();
  });
});

describe("findInvariantViolation: derived indexes", () => {
  it("derived-index-stale when placementsByContentKey lost a key", () => {
    const good = sampleGraph();
    expect(
      findInvariantViolation({ ...good, placementsByContentKey: new Map() }, registry)
        ?.code,
    ).toBe("derived-index-stale");
  });

  it("derived-index-stale when a placement list has the wrong length", () => {
    const good = sampleGraph();
    const placementsByContentKey = new Map(good.placementsByContentKey);
    placementsByContentKey.set("asset-x", [nid("c1")]);
    expect(
      findInvariantViolation({ ...good, placementsByContentKey }, registry)?.code,
    ).toBe("derived-index-stale");
  });

  it("derived-index-stale when a placement list is out of DOCUMENT order", () => {
    // Order is part of the contract — a consumer rendering "2 of 3" reads
    // position out of this array.
    const good = sampleGraph();
    const placementsByContentKey = new Map(good.placementsByContentKey);
    placementsByContentKey.set("asset-x", [nid("c3"), nid("c1")]);
    const violation = findInvariantViolation(
      { ...good, placementsByContentKey },
      registry,
    );
    expect(violation?.code).toBe("derived-index-stale");
    expect(violation?.message).toMatch(/out of order/);
  });

  it("derived-index-stale when ownerBySourceKey names the wrong node", () => {
    const good = sampleGraph();
    const ownerBySourceKey = new Map(good.ownerBySourceKey);
    ownerBySourceKey.set("doc-b", nid("a"));
    const violation = findInvariantViolation({ ...good, ownerBySourceKey }, registry);
    expect(violation?.code).toBe("derived-index-stale");
    expect(violation?.sourceKey).toBe("doc-b");
  });

  it("derived-index-stale when ownerBySourceKey has an extra key", () => {
    const good = sampleGraph();
    const ownerBySourceKey = new Map(good.ownerBySourceKey);
    ownerBySourceKey.set("doc-ghost", nid("a"));
    expect(
      findInvariantViolation({ ...good, ownerBySourceKey }, registry)?.code,
    ).toBe("derived-index-stale");
  });

  it("markMissing keeps both indexes correct without rebuilding them", () => {
    const good = sampleGraph();
    const next = markMissing(good, nid("b"), "404");
    // `unloaded` and `missing` both own, and `data` is untouched, so the
    // indexes cannot have moved — the audit is what proves that claim.
    expect(next.ownerBySourceKey).toBe(good.ownerBySourceKey);
    expect(findInvariantViolation(next, registry)).toBeNull();
  });
});

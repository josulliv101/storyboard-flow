// Unit tests for the KEEL command reducer.
//
// The bias here is toward INVARIANTS and FAILURE MODES rather than happy paths:
// every rejection code this module can emit has a test, and the structural
// results are asserted through `findInvariantViolation` so a command that
// produces the right children array but a stale index still fails.
//
// Two things are deliberately exercised end-to-end rather than mocked, because
// they are the contract this module is written against and a stub would only
// prove the stub: `applyPatch` (the reducer's output has to actually apply) and
// `invertPatch` (a removal has to restore exactly).

import { describe, expect, it } from "vitest";

import {
  type AnyNode,
  type ChildrenState,
  type EditOf,
  type EngineContext,
  type Graph,
  type Issue,
  type NodeId,
  type QuarantineReason,
  type Rejection,
  type Result,
  type Seed,
  type SummaryCodec,
  defineNodeType,
  makeCollectionNode,
  makeLeafNode,
  makeQuarantinedNode,
  parseNodeId,
} from "./types";
import {
  buildRegistry,
  findInvariantViolation,
  getChildren,
  getNode,
  getParent,
  getSubtreeRev,
} from "./graph";
import { applyPatch, invertPatch } from "./patches";
import { createHistory } from "./history";
import { applyCommand, applyIngestEdits, resolveDrop } from "./commands";
import { DEFAULT_MAX_NODES } from "./serialize";

// ---------------------------------------------------------------------------
// Fixture node types
// ---------------------------------------------------------------------------

type Clip = Readonly<{ title: string; seconds: number }>;
type ClipEdit = Readonly<{ title?: string; seconds?: number }>;

/**
 * `parse` is deliberately STRICTER than `applyEdit` and also NORMALIZING:
 *
 *  - it trims `title`, which is how the tests prove the reducer stores parse's
 *    OUTPUT rather than the raw seed or the codec's edit result;
 *  - it caps `seconds` at 100 while `applyEdit` does not, which is how the
 *    tests reach the "the edit produced a value that no longer parses" branch
 *    without the codec having to refuse the edit itself.
 */
const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw, ctx): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const title = record["title"];
    const seconds = record["seconds"];
    if (typeof title !== "string" || title.trim() === "") {
      return { ok: false, error: [{ path: "$.title", message: "title required" }] };
    }
    if (typeof seconds !== "number" || Number.isNaN(seconds) || seconds < 0) {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds >= 0" }] };
    }
    if (seconds > 100) {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds <= 100" }] };
    }
    if (title !== title.trim()) ctx.warn({ path: "$.title", message: "trimmed" });
    return { ok: true, value: { title: title.trim(), seconds } };
  },
  serialize(data): unknown {
    return { title: data.title, seconds: data.seconds };
  },
  applyEdit(data, edit) {
    const title = edit.title ?? data.title;
    if (title === "") {
      return { ok: false, error: { code: "empty-title", message: "title cannot be empty" } };
    }
    return { ok: true, value: { title, seconds: edit.seconds ?? data.seconds } };
  },
  contentKey(data): string | null {
    return `asset:${data.title}`;
  },
});

type Folder = Readonly<{ name: string; source: string | null }>;
type FolderEdit = Readonly<{ name?: string; source?: string | null }>;

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const name = record["name"];
    const source = record["source"];
    if (typeof name !== "string" || name.trim() === "") {
      return { ok: false, error: [{ path: "$.name", message: "name required" }] };
    }
    if (source !== undefined && source !== null && typeof source !== "string") {
      return { ok: false, error: [{ path: "$.source", message: "source must be a string" }] };
    }
    return { ok: true, value: { name: name.trim(), source: source ?? null } };
  },
  serialize(data): unknown {
    return { name: data.name, source: data.source };
  },
  applyEdit(data, edit) {
    return {
      ok: true,
      value: {
        name: edit.name ?? data.name,
        source: edit.source === undefined ? data.source : edit.source,
      },
    };
  },
  sourceKey(data): string | null {
    return data.source;
  },
});

const types = [clipType, folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ label: string }>;

const summaryCodec: SummaryCodec<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const label = record["label"];
    if (typeof label !== "string") {
      return { ok: false, error: [{ path: "$.label", message: "label required" }] };
    }
    return { ok: true, value: { label } };
  },
  serialize(summary): unknown {
    return { label: summary.label };
  },
};

const registry = buildRegistry(types);

// ---------------------------------------------------------------------------
// Fixture graph
// ---------------------------------------------------------------------------

type Spec = Readonly<{
  id: string;
  kind: string;
  data: unknown;
  container?: boolean;
  children?: readonly Spec[];
  state?: ChildrenState;
  summary?: Summary | null;
  quarantine?: QuarantineReason;
}>;

function id(raw: string): NodeId {
  return parseNodeId(raw);
}

function clipSpec(nodeId: string, title: string, seconds = 10): Spec {
  return { id: nodeId, kind: "clip", data: { title, seconds } };
}

function folderSpec(
  nodeId: string,
  name: string,
  extra?: Readonly<{
    source?: string | null;
    children?: readonly Spec[];
    state?: ChildrenState;
    summary?: Summary | null;
  }>,
): Spec {
  return {
    id: nodeId,
    kind: "folder",
    data: { name, source: extra?.source ?? null },
    container: true,
    children: extra?.children,
    state: extra?.state,
    summary: extra?.summary ?? null,
  };
}

function buildGraph(engineId: symbol, roots: readonly Spec[]): Graph<Types, Summary> {
  const nodes = new Map<NodeId, AnyNode<Types, Summary>>();
  const children = new Map<NodeId, readonly NodeId[]>();
  const parents = new Map<NodeId, NodeId | null>();
  const revs = new Map<NodeId, number>();

  // Recursion is fine in a fixture builder — these trees are authored here, not
  // read off a wire. The engine's own walks use explicit stacks.
  const visit = (spec: Spec, parentId: NodeId | null): NodeId => {
    const nodeId = id(spec.id);
    const container = spec.container ?? false;
    const state: ChildrenState = spec.state ?? { status: "loaded" };
    if (spec.quarantine !== undefined) {
      nodes.set(
        nodeId,
        makeQuarantinedNode({
          id: nodeId,
          kind: spec.kind,
          container,
          schemaVersion: 1,
          raw: spec.data,
          reason: spec.quarantine,
          issues: [{ path: "$", message: "fixture quarantine" }],
          children: container ? state : null,
          summary: spec.summary ?? null,
        }),
      );
    } else if (container) {
      nodes.set(
        nodeId,
        makeCollectionNode<Types, Summary>(
          nodeId,
          spec.kind,
          spec.data,
          state,
          spec.summary ?? null,
        ),
      );
    } else {
      nodes.set(nodeId, makeLeafNode<Types>(nodeId, spec.kind, spec.data));
    }
    parents.set(nodeId, parentId);
    revs.set(nodeId, 0);
    if (container && state.status === "loaded") {
      children.set(
        nodeId,
        (spec.children ?? []).map((child) => visit(child, nodeId)),
      );
    }
    return nodeId;
  };

  const rootIds = roots.map((spec) => visit(spec, null));
  const base: Graph<Types, Summary> = {
    engineId,
    nodesById: nodes,
    childrenById: children,
    parentById: parents,
    rootIds,
    subtreeRevById: revs,
    placementsByContentKey: new Map(),
    ownerBySourceKey: new Map(),
  };
  // The reducer never rebuilds these itself on the fixture path; borrowing the
  // engine's own rebuild keeps the fixture honest rather than hand-written.
  return { ...base, ...rebuildFixtureIndexes(base) };
}

function rebuildFixtureIndexes(
  graph: Graph<Types, Summary>,
): Pick<Graph<Types, Summary>, "placementsByContentKey" | "ownerBySourceKey"> {
  const placements = new Map<string, NodeId[]>();
  const owners = new Map<string, NodeId>();
  const walk = (nodeId: NodeId): void => {
    const node = graph.nodesById.get(nodeId);
    if (node === undefined) return;
    if (!node.quarantined) {
      const type = registry.get(node.kind);
      const contentKey = type?.contentKey?.(node.data) ?? null;
      if (contentKey !== null) {
        const list = placements.get(contentKey);
        if (list === undefined) placements.set(contentKey, [nodeId]);
        else list.push(nodeId);
      }
      const sourceKey = type?.sourceKey?.(node.data) ?? null;
      const owns = !node.container || node.children.status !== "reference";
      if (sourceKey !== null && owns && !owners.has(sourceKey)) {
        owners.set(sourceKey, nodeId);
      }
    }
    for (const child of graph.childrenById.get(nodeId) ?? []) walk(child);
  };
  for (const rootId of graph.rootIds) walk(rootId);
  return { placementsByContentKey: placements, ownerBySourceKey: owners };
}

/**
 * root
 *  0 a     clip "A"
 *  1 b     clip "B"
 *  2 c     clip "C"
 *  3 box   folder src-box   → [b1, b2]
 *  4 dest  folder           → []
 *  5 lazy  folder src-lazy  (unloaded)
 *  6 ref   folder src-ref   (reference — owns nothing)
 *  7 ghost folder           (missing)
 *  8 qleaf QUARANTINED leaf
 */
function fixtureRoots(): readonly Spec[] {
  return [
    folderSpec("root", "Root", {
      source: "src-root",
      children: [
        clipSpec("a", "A"),
        clipSpec("b", "B"),
        clipSpec("c", "C"),
        folderSpec("box", "Box", {
          source: "src-box",
          children: [clipSpec("b1", "B1", 5), clipSpec("b2", "B2", 6)],
        }),
        folderSpec("dest", "Dest", { children: [] }),
        folderSpec("lazy", "Lazy", { source: "src-lazy", state: { status: "unloaded" } }),
        folderSpec("ref", "Ref", { source: "src-ref", state: { status: "reference" } }),
        folderSpec("ghost", "Ghost", {
          state: { status: "missing", reason: "deleted upstream" },
        }),
        {
          id: "qleaf",
          kind: "clip",
          data: { title: 42 },
          quarantine: "parse-failed",
        },
      ],
    }),
  ];
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

type Harness = Readonly<{
  graph: Graph<Types, Summary>;
  ctx: EngineContext<Summary>;
}>;

function makeHarness(
  overrides?: Readonly<{ mintId?: () => string; roots?: readonly Spec[] }>,
): Harness {
  const engineId = Symbol("keel-test");
  let counter = 0;
  const ctx: EngineContext<Summary> = {
    engineId,
    registry,
    summary: summaryCodec,
    onUnknownKind: "quarantine",
    onParseFailure: "quarantine",
    maxNodes: DEFAULT_MAX_NODES,
    maxDepth: null,
    mintId:
      overrides?.mintId ??
      ((): string => {
        counter += 1;
        return `mint-${counter}`;
      }),
    now: () => 1_700_000_000_000,
    devChecks: false,
  };
  return { graph: buildGraph(engineId, overrides?.roots ?? fixtureRoots()), ctx };
}

function unwrap<T>(result: Result<T, Rejection>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function rejectionOf<T>(result: Result<T, Rejection>): Rejection {
  if (result.ok) throw new Error("expected a rejection, got ok");
  return result.error;
}

/** Children as readable labels, so an assertion says what a user would see. */
function labels(graph: Graph<Types, Summary>, parentId: string): readonly string[] {
  return getChildren(graph, id(parentId)).map((childId) => {
    const node = getNode(graph, childId);
    if (node === undefined) return "?";
    if (node.quarantined) return `!${node.kind}`;
    if (node.kind === "clip") return node.data.title;
    return node.data.name;
  });
}

function expectValid(graph: Graph<Types, Summary>): void {
  expect(findInvariantViolation(graph, registry)).toBeNull();
}

// ---------------------------------------------------------------------------
// The fixture itself
// ---------------------------------------------------------------------------

describe("fixture", () => {
  it("is a valid graph before any command runs", () => {
    // If this ever fails, every other failure in this file is meaningless.
    const { graph } = makeHarness();
    expectValid(graph);
    expect(labels(graph, "root")).toEqual([
      "A",
      "B",
      "C",
      "Box",
      "Dest",
      "Lazy",
      "Ref",
      "Ghost",
      "!clip",
    ]);
  });

  it("exempts a reference placement from ownership", () => {
    // `ref` declares sourceKey "src-ref" but is structurally childless forever,
    // so it owns nothing and the index has no entry for it.
    const { graph } = makeHarness();
    expect(graph.ownerBySourceKey.get("src-box")).toBe(id("box"));
    expect(graph.ownerBySourceKey.has("src-ref")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// move-nodes
// ---------------------------------------------------------------------------

describe("applyCommand / move-nodes", () => {
  it("treats toIndex as POST-REMOVAL", () => {
    // [A,B,C,...] with A taken out is [B,C,...]; index 1 is between B and C.
    // Under a pre-removal reading the same number would mean "before B".
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(
        graph,
        { type: "move-nodes", nodeIds: [id("a")], toParentId: id("root"), toIndex: 1 },
        ctx,
      ),
    );
    expect(labels(next.graph, "root").slice(0, 3)).toEqual(["B", "A", "C"]);
    expectValid(next.graph);
  });

  it("records both endpoints in the patch so the move inverts", () => {
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(
        graph,
        { type: "move-nodes", nodeIds: [id("a")], toParentId: id("box"), toIndex: 1 },
        ctx,
      ),
    );
    expect(next.patch).toEqual({
      type: "moved",
      moves: [
        {
          nodeId: id("a"),
          fromParentId: id("root"),
          fromIndex: 0,
          toParentId: id("box"),
          toIndex: 1,
        },
      ],
    });
    expect(labels(next.graph, "box")).toEqual(["B1", "A", "B2"]);
    expect(getParent(next.graph, id("a"))).toBe(id("box"));
    expectValid(next.graph);
  });

  it("inserts a multi-node move as one contiguous block in document order", () => {
    const { graph, ctx } = makeHarness();
    // Listed out of order on purpose — the reducer sorts, so a selection built
    // by shift-clicking upward behaves like one built downward.
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "move-nodes",
          nodeIds: [id("c"), id("a")],
          toParentId: id("dest"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    expect(labels(next.graph, "dest")).toEqual(["A", "C"]);
    expect(labels(next.graph, "root").slice(0, 2)).toEqual(["B", "Box"]);
    expectValid(next.graph);
  });

  it("prunes descendants so a subtree moves with its root", () => {
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "move-nodes",
          nodeIds: [id("box"), id("b1")],
          toParentId: id("dest"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    // b1 travelled inside box; it did NOT also land in dest.
    expect(labels(next.graph, "dest")).toEqual(["Box"]);
    expect(labels(next.graph, "box")).toEqual(["B1", "B2"]);
    expect(getParent(next.graph, id("b1"))).toBe(id("box"));
    expectValid(next.graph);
  });

  it("bumps subtreeRev on BOTH ancestor chains", () => {
    // The source chain exists only in the PRE-state graph. Getting this wrong
    // is invisible: the node updates and the old ancestors' rollups silently
    // never re-render.
    const { graph, ctx } = makeHarness();
    const boxBefore = getSubtreeRev(graph, id("box"));
    const destBefore = getSubtreeRev(graph, id("dest"));
    const next = unwrap(
      applyCommand(
        graph,
        { type: "move-nodes", nodeIds: [id("b1")], toParentId: id("dest"), toIndex: 0 },
        ctx,
      ),
    );
    expect(getSubtreeRev(next.graph, id("box"))).toBeGreaterThan(boxBefore);
    expect(getSubtreeRev(next.graph, id("dest"))).toBeGreaterThan(destBefore);
  });

  it("refuses a move that lands where it started", () => {
    const { graph, ctx } = makeHarness();
    const error = rejectionOf(
      applyCommand(
        graph,
        { type: "move-nodes", nodeIds: [id("a")], toParentId: id("root"), toIndex: 0 },
        ctx,
      ),
    );
    expect(error.code).toBe("empty-command");
  });

  it("still commits a multi-node move where one node happens not to shift", () => {
    // [A,B,C] → move [A,C] to 0 gives [A,C,B]. A's index is unchanged, but
    // dropping it from the move set would re-index C, so the whole set commits.
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "move-nodes",
          nodeIds: [id("a"), id("c")],
          toParentId: id("root"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    expect(labels(next.graph, "root").slice(0, 3)).toEqual(["A", "C", "B"]);
    expectValid(next.graph);
  });

  it("rejects the same id listed twice", () => {
    const { graph, ctx } = makeHarness();
    const error = rejectionOf(
      applyCommand(
        graph,
        {
          type: "move-nodes",
          nodeIds: [id("a"), id("a")],
          toParentId: id("dest"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    expect(error.code).toBe("duplicate-node-ids");
  });

  it("rejects an empty node list", () => {
    const { graph, ctx } = makeHarness();
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "move-nodes", nodeIds: [], toParentId: id("dest"), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("empty-command");
  });

  it("rejects an unknown node and an unknown parent", () => {
    const { graph, ctx } = makeHarness();
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "move-nodes", nodeIds: [id("nope")], toParentId: id("dest"), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("unknown-node");
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "move-nodes", nodeIds: [id("a")], toParentId: id("nope"), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("unknown-parent");
  });

  it("rejects moving a root", () => {
    const { graph, ctx } = makeHarness();
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "move-nodes", nodeIds: [id("root")], toParentId: id("dest"), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("cannot-move-root");
  });

  it("rejects a leaf target", () => {
    const { graph, ctx } = makeHarness();
    const error = rejectionOf(
      applyCommand(
        graph,
        { type: "move-nodes", nodeIds: [id("a")], toParentId: id("b"), toIndex: 0 },
        ctx,
      ),
    );
    expect(error.code).toBe("not-a-container");
    expect(error.parentId).toBe(id("b"));
  });

  it.each([
    ["unloaded", "lazy"],
    ["reference", "ref"],
    ["missing", "ghost"],
  ])("rejects dropping into a %s container", (_state, target) => {
    // A post-removal index into children nobody has ever seen has no honest
    // value — and `missing` is a confirmed answer, not a gap to fill.
    const { graph, ctx } = makeHarness();
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "move-nodes", nodeIds: [id("a")], toParentId: id(target), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("target-not-loaded");
  });

  it("rejects a move into itself or into its own descendant", () => {
    const { graph, ctx } = makeHarness();
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "move-nodes", nodeIds: [id("box")], toParentId: id("box"), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("would-create-cycle");
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "move-nodes", nodeIds: [id("root")], toParentId: id("box"), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("cannot-move-root");
  });

  it("rejects a cycle even when the target is several levels down", () => {
    const { graph, ctx } = makeHarness({
      roots: [
        folderSpec("root", "Root", {
          children: [
            folderSpec("l1", "L1", {
              children: [folderSpec("l2", "L2", { children: [folderSpec("l3", "L3")] })],
            }),
          ],
        }),
      ],
    });
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "move-nodes", nodeIds: [id("l1")], toParentId: id("l3"), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("would-create-cycle");
  });

  it.each([-1, 9, 1.5, Number.NaN])("rejects toIndex %s", (toIndex) => {
    // Post-removal length for a single move out of root's nine children is 8,
    // so 9 is one past the append position.
    const { graph, ctx } = makeHarness();
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "move-nodes", nodeIds: [id("a")], toParentId: id("root"), toIndex },
          ctx,
        ),
      ).code,
    ).toBe("index-out-of-range");
  });

  it("rejects a graph from another engine", () => {
    const { graph } = makeHarness();
    const { ctx } = makeHarness();
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "move-nodes", nodeIds: [id("a")], toParentId: id("dest"), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("foreign-graph");
  });
});

// ---------------------------------------------------------------------------
// insert-nodes
// ---------------------------------------------------------------------------

describe("applyCommand / insert-nodes", () => {
  it("mints ids and stores parse's OUTPUT, not the seed's input", () => {
    const { graph, ctx } = makeHarness();
    const seed: Seed<Types, Summary> = {
      kind: "clip",
      data: { title: "  Padded  ", seconds: 3 },
    };
    const next = unwrap(
      applyCommand(
        graph,
        { type: "insert-nodes", seeds: [seed], toParentId: id("dest"), toIndex: 0 },
        ctx,
      ),
    );
    // The seed was typed as `Clip` and still went through the codec, so the
    // normalizing parse normalized the insert too.
    expect(labels(next.graph, "dest")).toEqual(["Padded"]);
    expect(getChildren(next.graph, id("dest"))).toEqual([id("mint-1")]);
    expectValid(next.graph);
  });

  it("emits placements in document order, parents first", () => {
    const { graph, ctx } = makeHarness();
    const seed: Seed<Types, Summary> = {
      kind: "folder",
      data: { name: "Outer", source: null },
      children: [
        { kind: "clip", data: { title: "Inner1", seconds: 1 } },
        {
          kind: "folder",
          data: { name: "Nested", source: null },
          children: [{ kind: "clip", data: { title: "Deep", seconds: 2 } }],
        },
      ],
    };
    const next = unwrap(
      applyCommand(
        graph,
        { type: "insert-nodes", seeds: [seed], toParentId: id("dest"), toIndex: 0 },
        ctx,
      ),
    );
    if (next.patch.type !== "inserted") throw new Error("expected an inserted patch");
    expect(next.patch.placements.map((p) => [p.node.id, p.parentId, p.index])).toEqual([
      [id("mint-1"), id("dest"), 0],
      [id("mint-2"), id("mint-1"), 0],
      [id("mint-3"), id("mint-1"), 1],
      [id("mint-4"), id("mint-3"), 0],
    ]);
    expect(labels(next.graph, "mint-1")).toEqual(["Inner1", "Nested"]);
    expect(labels(next.graph, "mint-3")).toEqual(["Deep"]);
    expectValid(next.graph);
  });

  it("makes a childless container seed a LOADED empty collection", () => {
    // Not `unloaded`: the consumer just supplied the whole thing, so "we have
    // not read this yet" is false by construction.
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "insert-nodes",
          seeds: [{ kind: "folder", data: { name: "Fresh", source: null } }],
          toParentId: id("dest"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    const inserted = getNode(next.graph, id("mint-1"));
    expect(inserted?.quarantined).toBe(false);
    expect(inserted !== undefined && !inserted.quarantined && inserted.container).toBe(true);
    expect(getChildren(next.graph, id("mint-1"))).toEqual([]);
    expectValid(next.graph);
  });

  it("inserts several seeds at consecutive indices", () => {
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "insert-nodes",
          seeds: [
            { kind: "clip", data: { title: "X", seconds: 1 } },
            { kind: "clip", data: { title: "Y", seconds: 1 } },
          ],
          toParentId: id("root"),
          toIndex: 1,
        },
        ctx,
      ),
    );
    expect(labels(next.graph, "root").slice(0, 4)).toEqual(["A", "X", "Y", "B"]);
    expectValid(next.graph);
  });

  it("retries a colliding minted id instead of clobbering a node", () => {
    const minted = ["a", "b", "fresh"];
    let call = 0;
    const { graph, ctx } = makeHarness({
      mintId: () => {
        const next = minted[call] ?? "fallback";
        call += 1;
        return next;
      },
    });
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "insert-nodes",
          seeds: [{ kind: "clip", data: { title: "New", seconds: 1 } }],
          toParentId: id("dest"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    expect(getChildren(next.graph, id("dest"))).toEqual([id("fresh")]);
    // The originals are untouched — a collision must never overwrite.
    expect(labels(next.graph, "root").slice(0, 2)).toEqual(["A", "B"]);
    expectValid(next.graph);
  });

  it("does not let two seeds in one batch collide with each other", () => {
    // A weak mintId collides with its own siblings long before it collides with
    // the document, so the batch's own claims have to count as taken.
    let call = 0;
    const minted = ["same", "same", "other"];
    const { graph, ctx } = makeHarness({
      mintId: () => {
        const next = minted[call] ?? "fallback";
        call += 1;
        return next;
      },
    });
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "insert-nodes",
          seeds: [
            { kind: "clip", data: { title: "One", seconds: 1 } },
            { kind: "clip", data: { title: "Two", seconds: 1 } },
          ],
          toParentId: id("dest"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    expect(getChildren(next.graph, id("dest"))).toEqual([id("same"), id("other")]);
    expectValid(next.graph);
  });

  it("rejects a leaf seed carrying children", () => {
    const { graph, ctx } = makeHarness();
    const seed: Seed<Types, Summary> = {
      kind: "clip",
      data: { title: "Leaf", seconds: 1 },
      children: [],
    };
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "insert-nodes", seeds: [seed], toParentId: id("dest"), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("leaf-seed-with-children");
  });

  it("rejects an unregistered kind rather than quarantining it", () => {
    // Quarantine keeps forward-incompatible STORED data usable. A brand-new
    // insert has a consumer standing right here to be told.
    const { graph, ctx } = makeHarness();
    const seeds: readonly Seed<Types, Summary>[] = [];
    const unknownSeed = { kind: "widget", data: {} };
    const error = rejectionOf(
      applyCommand(
        graph,
        {
          type: "insert-nodes",
          // The mapped-tuple `Seed` cannot name an unregistered kind, which is
          // the point — this is what a JS caller or a stale bundle produces.
          seeds: [...seeds, unknownSeed] as readonly Seed<Types, Summary>[],
          toParentId: id("dest"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    expect(error.code).toBe("unknown-kind");
    expect(error.kind).toBe("widget");
  });

  it("rejects a seed whose data fails its own parse", () => {
    const { graph, ctx } = makeHarness();
    const error = rejectionOf(
      applyCommand(
        graph,
        {
          type: "insert-nodes",
          seeds: [{ kind: "clip", data: { title: "Too long", seconds: 500 } }],
          toParentId: id("dest"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    expect(error.code).toBe("parse-failed");
    expect(error.issues).toEqual([{ path: "$.seconds", message: "seconds <= 100" }]);
  });

  it("rejects a second owning placement of one stored subtree", () => {
    const { graph, ctx } = makeHarness();
    const error = rejectionOf(
      applyCommand(
        graph,
        {
          type: "insert-nodes",
          seeds: [{ kind: "folder", data: { name: "Copy", source: "src-box" } }],
          toParentId: id("dest"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    expect(error.code).toBe("duplicate-owner");
    expect(error.sourceKey).toBe("src-box");
    expect(error.ownerId).toBe(id("box"));
  });

  it("rejects two seeds in one batch claiming the same source", () => {
    const { graph, ctx } = makeHarness();
    expect(
      rejectionOf(
        applyCommand(
          graph,
          {
            type: "insert-nodes",
            seeds: [
              { kind: "folder", data: { name: "One", source: "src-new" } },
              { kind: "folder", data: { name: "Two", source: "src-new" } },
            ],
            toParentId: id("dest"),
            toIndex: 0,
          },
          ctx,
        ),
      ).code,
    ).toBe("duplicate-owner");
  });

  it("rejects a cyclic seed instead of hanging", () => {
    const { graph, ctx } = makeHarness();
    const children: Seed<Types, Summary>[] = [];
    const cyclic: Seed<Types, Summary> = {
      kind: "folder",
      data: { name: "Loop", source: null },
      children,
    };
    children.push(cyclic);
    const error = rejectionOf(
      applyCommand(
        graph,
        { type: "insert-nodes", seeds: [cyclic], toParentId: id("dest"), toIndex: 0 },
        ctx,
      ),
    );
    expect(error.code).toBe("parse-failed");
    expect(error.issues).toEqual([{ path: "$.children", message: "cyclic seed" }]);
  });

  it("allows the same seed VALUE twice as two siblings", () => {
    // Reference-equal siblings are two copies of one thing, not a cycle.
    const { graph, ctx } = makeHarness();
    const shared: Seed<Types, Summary> = {
      kind: "clip",
      data: { title: "Twin", seconds: 2 },
    };
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "insert-nodes",
          seeds: [shared, shared],
          toParentId: id("dest"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    expect(labels(next.graph, "dest")).toEqual(["Twin", "Twin"]);
    // Two placements, two ids — node-as-placement, not shared identity.
    expect(next.graph.placementsByContentKey.get("asset:Twin")).toEqual([
      id("mint-1"),
      id("mint-2"),
    ]);
    expectValid(next.graph);
  });

  it("rejects an empty seed list, a bad index, and a non-loaded target", () => {
    const { graph, ctx } = makeHarness();
    const seed: Seed<Types, Summary> = { kind: "clip", data: { title: "S", seconds: 1 } };
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "insert-nodes", seeds: [], toParentId: id("dest"), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("empty-command");
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "insert-nodes", seeds: [seed], toParentId: id("dest"), toIndex: 1 },
          ctx,
        ),
      ).code,
    ).toBe("index-out-of-range");
    expect(
      rejectionOf(
        applyCommand(
          graph,
          { type: "insert-nodes", seeds: [seed], toParentId: id("lazy"), toIndex: 0 },
          ctx,
        ),
      ).code,
    ).toBe("target-not-loaded");
  });
});

// ---------------------------------------------------------------------------
// remove-nodes
// ---------------------------------------------------------------------------

describe("applyCommand / remove-nodes", () => {
  it("records the whole subtree, parents first, at pre-removal indices", () => {
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(graph, { type: "remove-nodes", nodeIds: [id("box")] }, ctx),
    );
    if (next.patch.type !== "removed") throw new Error("expected a removed patch");
    expect(next.patch.placements.map((p) => [p.node.id, p.parentId, p.index])).toEqual([
      [id("box"), id("root"), 3],
      [id("b1"), id("box"), 0],
      [id("b2"), id("box"), 1],
    ]);
    expect(getNode(next.graph, id("b1"))).toBeUndefined();
    expectValid(next.graph);
  });

  it("inverts exactly — the removal restores the graph it came from", () => {
    // The whole reason `removed` is the exact mirror of `inserted`.
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(graph, { type: "remove-nodes", nodeIds: [id("box"), id("a")] }, ctx),
    );
    const restored = applyPatch(next.graph, invertPatch(next.patch), ctx);
    expect(labels(restored, "root")).toEqual(labels(graph, "root"));
    expect(labels(restored, "box")).toEqual(["B1", "B2"]);
    expectValid(restored);
  });

  it("removes a listed descendant once, via its ancestor", () => {
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(graph, { type: "remove-nodes", nodeIds: [id("b1"), id("box")] }, ctx),
    );
    if (next.patch.type !== "removed") throw new Error("expected a removed patch");
    expect(next.patch.placements.map((p) => p.node.id)).toEqual([
      id("box"),
      id("b1"),
      id("b2"),
    ]);
    expectValid(next.graph);
  });

  it("dedupes a repeated id rather than refusing it", () => {
    // Removal is idempotent, so "delete this twice" has one obvious meaning —
    // unlike a move, where a repeat means one removal and two insertions.
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(graph, { type: "remove-nodes", nodeIds: [id("a"), id("a")] }, ctx),
    );
    if (next.patch.type !== "removed") throw new Error("expected a removed patch");
    expect(next.patch.placements).toHaveLength(1);
    expectValid(next.graph);
  });

  it("removes several siblings at once and stays consistent", () => {
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(graph, { type: "remove-nodes", nodeIds: [id("c"), id("a")] }, ctx),
    );
    expect(labels(next.graph, "root").slice(0, 2)).toEqual(["B", "Box"]);
    expectValid(next.graph);
  });

  it.each([
    ["unloaded", "lazy"],
    ["reference", "ref"],
    ["missing", "ghost"],
  ])("requires allowUnloaded for a %s container", (_state, target) => {
    const { graph, ctx } = makeHarness();
    const error = rejectionOf(
      applyCommand(graph, { type: "remove-nodes", nodeIds: [id(target)] }, ctx),
    );
    expect(error.code).toBe("unloaded-subtree");

    const forced = unwrap(
      applyCommand(
        graph,
        { type: "remove-nodes", nodeIds: [id(target)], allowUnloaded: true },
        ctx,
      ),
    );
    expect(getNode(forced.graph, id(target))).toBeUndefined();
    expectValid(forced.graph);
  });

  it("requires allowUnloaded for an unloaded container nested inside the removal", () => {
    const { graph, ctx } = makeHarness({
      roots: [
        folderSpec("root", "Root", {
          children: [
            folderSpec("outer", "Outer", {
              children: [
                folderSpec("inner", "Inner", { state: { status: "unloaded" } }),
              ],
            }),
          ],
        }),
      ],
    });
    expect(
      rejectionOf(
        applyCommand(graph, { type: "remove-nodes", nodeIds: [id("outer")] }, ctx),
      ).code,
    ).toBe("unloaded-subtree");
  });

  it("rejects removing a root, an unknown node, and an empty list", () => {
    const { graph, ctx } = makeHarness();
    expect(
      rejectionOf(
        applyCommand(graph, { type: "remove-nodes", nodeIds: [id("root")] }, ctx),
      ).code,
    ).toBe("cannot-remove-root");
    expect(
      rejectionOf(
        applyCommand(graph, { type: "remove-nodes", nodeIds: [id("nope")] }, ctx),
      ).code,
    ).toBe("unknown-node");
    expect(
      rejectionOf(applyCommand(graph, { type: "remove-nodes", nodeIds: [] }, ctx)).code,
    ).toBe("empty-command");
  });

  it("removes a quarantined node", () => {
    // Quarantined nodes move, delete and undo — that is what keeps a document
    // with one bad clip from becoming permanently unwritable.
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(graph, { type: "remove-nodes", nodeIds: [id("qleaf")] }, ctx),
    );
    expect(getNode(next.graph, id("qleaf"))).toBeUndefined();
    expectValid(next.graph);
  });
});

// ---------------------------------------------------------------------------
// edit-nodes
// ---------------------------------------------------------------------------

describe("applyCommand / edit-nodes", () => {
  it("emits WHOLE before/after values", () => {
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "edit-nodes",
          edits: [{ nodeId: id("a"), kind: "clip", edit: { seconds: 42 } }],
        },
        ctx,
      ),
    );
    expect(next.patch).toEqual({
      type: "data-changed",
      changes: [
        {
          nodeId: id("a"),
          kind: "clip",
          before: { title: "A", seconds: 10 },
          after: { title: "A", seconds: 42 },
        },
      ],
    });
    expect(labels(next.graph, "root")[0]).toBe("A");
    expectValid(next.graph);
  });

  it("RE-PARSES the codec's own output and stores parse's value", () => {
    // `applyEdit` hands back "  Spaced  "; the stored value is the trimmed one,
    // which is only possible if the result went back through `parse`.
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "edit-nodes",
          edits: [{ nodeId: id("a"), kind: "clip", edit: { title: "  Spaced  " } }],
        },
        ctx,
      ),
    );
    expect(labels(next.graph, "root")[0]).toBe("Spaced");
    if (next.patch.type !== "data-changed") throw new Error("expected data-changed");
    expect(next.patch.changes[0]?.after).toEqual({ title: "Spaced", seconds: 10 });
  });

  it("rejects an edit whose RESULT no longer parses", () => {
    // The codec happily accepts seconds: 500; its own `parse` caps at 100. The
    // result of applyEdit is an ingress like any other.
    const { graph, ctx } = makeHarness();
    const error = rejectionOf(
      applyCommand(
        graph,
        {
          type: "edit-nodes",
          edits: [{ nodeId: id("a"), kind: "clip", edit: { seconds: 500 } }],
        },
        ctx,
      ),
    );
    expect(error.code).toBe("parse-failed");
    expect(error.issues).toEqual([{ path: "$.seconds", message: "seconds <= 100" }]);
  });

  it("relays the codec's own refusal verbatim", () => {
    const { graph, ctx } = makeHarness();
    const error = rejectionOf(
      applyCommand(
        graph,
        {
          type: "edit-nodes",
          edits: [{ nodeId: id("a"), kind: "clip", edit: { title: "" } }],
        },
        ctx,
      ),
    );
    expect(error.code).toBe("edit-rejected");
    expect(error.editRejection).toEqual({
      code: "empty-title",
      message: "title cannot be empty",
    });
  });

  it("applies a batch as ONE patch", () => {
    // A rename across every placement is one gesture, so it is one history
    // entry — which is what keeps Ctrl-Z matching what the user thinks they did.
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "edit-nodes",
          edits: [
            { nodeId: id("a"), kind: "clip", edit: { title: "A2" } },
            { nodeId: id("b"), kind: "clip", edit: { title: "B2" } },
          ],
        },
        ctx,
      ),
    );
    if (next.patch.type !== "data-changed") throw new Error("expected data-changed");
    expect(next.patch.changes).toHaveLength(2);
    expect(labels(next.graph, "root").slice(0, 2)).toEqual(["A2", "B2"]);
    expectValid(next.graph);
  });

  it("refuses to edit a quarantined node", () => {
    const { graph, ctx } = makeHarness();
    const error = rejectionOf(
      applyCommand(
        graph,
        {
          type: "edit-nodes",
          edits: [{ nodeId: id("qleaf"), kind: "clip", edit: { title: "Nope" } }],
        },
        ctx,
      ),
    );
    expect(error.code).toBe("node-quarantined");
  });

  it("rejects a kind mismatch, an unknown node, a duplicate, and an empty list", () => {
    const { graph, ctx } = makeHarness();
    expect(
      rejectionOf(
        applyCommand(
          graph,
          {
            type: "edit-nodes",
            edits: [{ nodeId: id("a"), kind: "folder", edit: { name: "X" } }],
          },
          ctx,
        ),
      ).code,
    ).toBe("kind-mismatch");
    expect(
      rejectionOf(
        applyCommand(
          graph,
          {
            type: "edit-nodes",
            edits: [{ nodeId: id("nope"), kind: "clip", edit: { title: "X" } }],
          },
          ctx,
        ),
      ).code,
    ).toBe("unknown-node");
    expect(
      rejectionOf(
        applyCommand(
          graph,
          {
            type: "edit-nodes",
            edits: [
              { nodeId: id("a"), kind: "clip", edit: { title: "X" } },
              { nodeId: id("a"), kind: "clip", edit: { title: "Y" } },
            ],
          },
          ctx,
        ),
      ).code,
    ).toBe("duplicate-node-ids");
    expect(
      rejectionOf(applyCommand(graph, { type: "edit-nodes", edits: [] }, ctx)).code,
    ).toBe("empty-command");
  });

  it("refuses an edit that would create a second owner", () => {
    const { graph, ctx } = makeHarness();
    const error = rejectionOf(
      applyCommand(
        graph,
        {
          type: "edit-nodes",
          edits: [{ nodeId: id("dest"), kind: "folder", edit: { source: "src-box" } }],
        },
        ctx,
      ),
    );
    expect(error.code).toBe("duplicate-owner");
    expect(error.ownerId).toBe(id("box"));
  });

  it("lets a node keep its own source key", () => {
    const { graph, ctx } = makeHarness();
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "edit-nodes",
          edits: [{ nodeId: id("box"), kind: "folder", edit: { name: "Renamed" } }],
        },
        ctx,
      ),
    );
    expect(next.graph.ownerBySourceKey.get("src-box")).toBe(id("box"));
    expectValid(next.graph);
  });

  it("keeps the derived content index in step with an edit", () => {
    const { graph, ctx } = makeHarness();
    expect(graph.placementsByContentKey.get("asset:A")).toEqual([id("a")]);
    const next = unwrap(
      applyCommand(
        graph,
        {
          type: "edit-nodes",
          edits: [{ nodeId: id("a"), kind: "clip", edit: { title: "Renamed" } }],
        },
        ctx,
      ),
    );
    expect(next.graph.placementsByContentKey.has("asset:A")).toBe(false);
    expect(next.graph.placementsByContentKey.get("asset:Renamed")).toEqual([id("a")]);
    expectValid(next.graph);
  });
});

// ---------------------------------------------------------------------------
// resolveDrop
// ---------------------------------------------------------------------------

describe("resolveDrop", () => {
  it("subtracts the moved nodes that sit before the drop, in the same parent", () => {
    const { graph, ctx } = makeHarness();
    const command = unwrap(
      resolveDrop(
        graph,
        { type: "move", nodeIds: [id("a")], toParentId: id("root"), toIndexBefore: 2 },
        ctx,
      ),
    );
    expect(command).toEqual({
      type: "move-nodes",
      nodeIds: [id("a")],
      toParentId: id("root"),
      toIndex: 1,
    });
  });

  it("round-trips a same-parent drag to the visual order the view intended", () => {
    // The real proof: resolveDrop's number, fed to applyCommand, has to put the
    // node where the pointer was. Off-by-one here is the classic DnD bug.
    const { graph, ctx } = makeHarness();
    const command = unwrap(
      resolveDrop(
        graph,
        { type: "move", nodeIds: [id("a")], toParentId: id("root"), toIndexBefore: 3 },
        ctx,
      ),
    );
    const next = unwrap(applyCommand(graph, command, ctx));
    // Dropped "before Box" ⇒ A lands after C and before Box.
    expect(labels(next.graph, "root").slice(0, 4)).toEqual(["B", "C", "A", "Box"]);
    expectValid(next.graph);
  });

  it("appends when the drop is past the last child", () => {
    const { graph, ctx } = makeHarness();
    const command = unwrap(
      resolveDrop(
        graph,
        { type: "move", nodeIds: [id("a")], toParentId: id("root"), toIndexBefore: 9 },
        ctx,
      ),
    );
    const next = unwrap(applyCommand(graph, command, ctx));
    expect(labels(next.graph, "root").at(-1)).toBe("A");
    expectValid(next.graph);
  });

  it("passes the index through unchanged for a different parent", () => {
    const { graph, ctx } = makeHarness();
    const command = unwrap(
      resolveDrop(
        graph,
        { type: "move", nodeIds: [id("a")], toParentId: id("box"), toIndexBefore: 1 },
        ctx,
      ),
    );
    expect(command).toEqual({
      type: "move-nodes",
      nodeIds: [id("a")],
      toParentId: id("box"),
      toIndex: 1,
    });
  });

  it("counts only the nodes that are currently in the target", () => {
    // Mixed drag: `a` comes out of root (and shifts its indices), `b1` comes
    // out of box (and does not).
    const { graph, ctx } = makeHarness();
    const command = unwrap(
      resolveDrop(
        graph,
        {
          type: "move",
          nodeIds: [id("a"), id("b1")],
          toParentId: id("root"),
          toIndexBefore: 2,
        },
        ctx,
      ),
    );
    expect(command).toEqual({
      type: "move-nodes",
      nodeIds: [id("a"), id("b1")],
      toParentId: id("root"),
      toIndex: 1,
    });
    const next = unwrap(applyCommand(graph, command, ctx));
    expect(labels(next.graph, "root").slice(0, 4)).toEqual(["B", "A", "B1", "C"]);
    expectValid(next.graph);
  });

  it("returns the pruned, document-ordered id list", () => {
    const { graph, ctx } = makeHarness();
    const command = unwrap(
      resolveDrop(
        graph,
        {
          type: "move",
          nodeIds: [id("b1"), id("box")],
          toParentId: id("dest"),
          toIndexBefore: 0,
        },
        ctx,
      ),
    );
    if (command.type !== "move-nodes") throw new Error("expected move-nodes");
    expect(command.nodeIds).toEqual([id("box")]);
  });

  it.each([0, 1])("refuses a drop at position %s that changes nothing", (toIndexBefore) => {
    // Both gestures mean "leave A where it is" — before A, and after A.
    const { graph, ctx } = makeHarness();
    expect(
      rejectionOf(
        resolveDrop(
          graph,
          { type: "move", nodeIds: [id("a")], toParentId: id("root"), toIndexBefore },
          ctx,
        ),
      ).code,
    ).toBe("empty-command");
  });

  it("applies the move command's own validity checks", () => {
    const { graph, ctx } = makeHarness();
    expect(
      rejectionOf(
        resolveDrop(
          graph,
          { type: "move", nodeIds: [id("box")], toParentId: id("b1"), toIndexBefore: 0 },
          ctx,
        ),
      ).code,
    ).toBe("not-a-container");
    expect(
      rejectionOf(
        resolveDrop(
          graph,
          { type: "move", nodeIds: [id("a")], toParentId: id("lazy"), toIndexBefore: 0 },
          ctx,
        ),
      ).code,
    ).toBe("target-not-loaded");
    expect(
      rejectionOf(
        resolveDrop(
          graph,
          { type: "move", nodeIds: [id("a")], toParentId: id("root"), toIndexBefore: 10 },
          ctx,
        ),
      ).code,
    ).toBe("index-out-of-range");
  });

  it("passes an insert intent's index straight through", () => {
    const { graph, ctx } = makeHarness();
    const seed: Seed<Types, Summary> = { kind: "clip", data: { title: "Drop", seconds: 1 } };
    const command = unwrap(
      resolveDrop(
        graph,
        { type: "insert", seeds: [seed], toParentId: id("root"), toIndexBefore: 2 },
        ctx,
      ),
    );
    expect(command).toEqual({
      type: "insert-nodes",
      seeds: [seed],
      toParentId: id("root"),
      toIndex: 2,
    });
    const next = unwrap(applyCommand(graph, command, ctx));
    expect(labels(next.graph, "root").slice(0, 4)).toEqual(["A", "B", "Drop", "C"]);
    expectValid(next.graph);
  });

  it("refuses an insert drop of a leaf seed with children before it becomes a command", () => {
    const { graph, ctx } = makeHarness();
    const seed: Seed<Types, Summary> = {
      kind: "clip",
      data: { title: "Bad", seconds: 1 },
      children: [],
    };
    expect(
      rejectionOf(
        resolveDrop(
          graph,
          { type: "insert", seeds: [seed], toParentId: id("root"), toIndexBefore: 0 },
          ctx,
        ),
      ).code,
    ).toBe("leaf-seed-with-children");
  });

  it("rejects a foreign graph", () => {
    const { graph } = makeHarness();
    const { ctx } = makeHarness();
    expect(
      rejectionOf(
        resolveDrop(
          graph,
          { type: "move", nodeIds: [id("a")], toParentId: id("dest"), toIndexBefore: 0 },
          ctx,
        ),
      ).code,
    ).toBe("foreign-graph");
  });
});

// ---------------------------------------------------------------------------
// applyIngestEdits
// ---------------------------------------------------------------------------

describe("applyIngestEdits", () => {
  const ingest = (nodeId: string, edit: ClipEdit): readonly EditOf<Types>[] => [
    { nodeId: id(nodeId), kind: "clip", edit },
  ];

  it("writes the value and bumps the ancestor chain, with no patch", () => {
    const { graph, ctx } = makeHarness();
    const rootBefore = getSubtreeRev(graph, id("root"));
    const boxBefore = getSubtreeRev(graph, id("box"));
    const result = unwrap(
      applyIngestEdits(graph, createHistory(), ingest("b1", { seconds: 9 }), ctx),
    );
    const node = getNode(result.graph, id("b1"));
    expect(node !== undefined && !node.quarantined && node.data).toEqual({
      title: "B1",
      seconds: 9,
    });
    // Structure is untouched, but every ancestor's rollup has to invalidate or
    // the arriving value never re-renders anywhere above it.
    expect(getSubtreeRev(result.graph, id("box"))).toBeGreaterThan(boxBefore);
    expect(getSubtreeRev(result.graph, id("root"))).toBeGreaterThan(rootBefore);
    expect(labels(result.graph, "box")).toEqual(["B1", "B2"]);
    expectValid(result.graph);
  });

  it("normalizes through the same codec path an edit command uses", () => {
    const { graph, ctx } = makeHarness();
    const result = unwrap(
      applyIngestEdits(graph, createHistory(), ingest("a", { title: "  Server  " }), ctx),
    );
    expect(labels(result.graph, "root")[0]).toBe("Server");
  });

  it("drops the ingested node from a dormant data-changed entry, keeping the rest", () => {
    // The user loses undo of THEIR edit to that one node — correct, the server
    // has since overwritten it — and keeps every other change in the entry.
    const { graph, ctx } = makeHarness();
    const edited = unwrap(
      applyCommand(
        graph,
        {
          type: "edit-nodes",
          edits: [
            { nodeId: id("a"), kind: "clip", edit: { seconds: 11 } },
            { nodeId: id("b"), kind: "clip", edit: { seconds: 22 } },
          ],
        },
        ctx,
      ),
    );
    const history = {
      past: [{ command: null, patch: edited.patch, at: 0 }],
      future: [],
      limit: Number.POSITIVE_INFINITY,
    };
    const result = unwrap(
      applyIngestEdits(edited.graph, history, ingest("a", { seconds: 99 }), ctx),
    );
    expect(result.scrubbed).toEqual([id("a")]);
    const survivor = result.history.past[0];
    if (survivor === undefined) throw new Error("the entry should survive");
    if (survivor.patch.type !== "data-changed") throw new Error("expected data-changed");
    expect(survivor.patch.changes.map((c) => c.nodeId)).toEqual([id("b")]);
  });

  it("rewrites the captured data inside a dormant insert placement", () => {
    // A dormant restore must not resurrect the value the server replaced.
    const { graph, ctx } = makeHarness();
    const inserted = unwrap(
      applyCommand(
        graph,
        {
          type: "insert-nodes",
          seeds: [{ kind: "clip", data: { title: "Fresh", seconds: 1 } }],
          toParentId: id("dest"),
          toIndex: 0,
        },
        ctx,
      ),
    );
    const history = {
      past: [{ command: null, patch: inserted.patch, at: 0 }],
      future: [],
      limit: Number.POSITIVE_INFINITY,
    };
    const result = unwrap(
      applyIngestEdits(
        inserted.graph,
        history,
        [{ nodeId: id("mint-1"), kind: "clip", edit: { seconds: 77 } }],
        ctx,
      ),
    );
    expect(result.scrubbed).toEqual([id("mint-1")]);
    const entry = result.history.past[0];
    if (entry === undefined) throw new Error("the entry should survive");
    if (entry.patch.type !== "inserted") throw new Error("expected inserted");
    const placed = entry.patch.placements[0];
    if (placed === undefined || placed.node.quarantined) throw new Error("bad placement");
    expect(placed.node.data).toEqual({ title: "Fresh", seconds: 77 });
  });

  it("leaves structural history alone and reports nothing scrubbed", () => {
    const { graph, ctx } = makeHarness();
    const moved = unwrap(
      applyCommand(
        graph,
        { type: "move-nodes", nodeIds: [id("a")], toParentId: id("dest"), toIndex: 0 },
        ctx,
      ),
    );
    const history = {
      past: [{ command: null, patch: moved.patch, at: 0 }],
      future: [],
      limit: Number.POSITIVE_INFINITY,
    };
    const result = unwrap(
      applyIngestEdits(moved.graph, history, ingest("a", { seconds: 5 }), ctx),
    );
    // A "moved" patch carries no content, so there is nothing to scrub — and
    // the entry must survive intact or the user loses an unrelated undo.
    expect(result.scrubbed).toEqual([]);
    expect(result.history.past[0]?.patch).toEqual(moved.patch);
  });

  it("rejects exactly what edit-nodes rejects", () => {
    const { graph, ctx } = makeHarness();
    const history = createHistory<Types, Summary>();
    expect(
      rejectionOf(applyIngestEdits(graph, history, ingest("qleaf", { seconds: 1 }), ctx)).code,
    ).toBe("node-quarantined");
    expect(
      rejectionOf(applyIngestEdits(graph, history, ingest("nope", { seconds: 1 }), ctx)).code,
    ).toBe("unknown-node");
    expect(
      rejectionOf(applyIngestEdits(graph, history, ingest("a", { seconds: 500 }), ctx)).code,
    ).toBe("parse-failed");
    expect(rejectionOf(applyIngestEdits(graph, history, [], ctx)).code).toBe(
      "empty-command",
    );
  });

  it("rejects a foreign graph before touching the history", () => {
    const { graph } = makeHarness();
    const { ctx } = makeHarness();
    expect(
      rejectionOf(
        applyIngestEdits(graph, createHistory(), ingest("a", { seconds: 1 }), ctx),
      ).code,
    ).toBe("foreign-graph");
  });
});

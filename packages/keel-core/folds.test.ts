import { describe, expect, it } from "vitest";

import {
  computeFold,
  createFoldCache,
  foldMonoid,
  folded,
  foldedExact,
  summaryFrom,
  weakestCertainty,
} from "./folds";
import {
  defineNodeType,
  makeCollectionNode,
  makeLeafNode,
  makeQuarantinedNode,
  parseNodeId,
} from "./types";
import type {
  GraphNode,
  Certainty,
  ChildrenState,
  Fold,
  Folded,
  Graph,
  Issue,
  NodeId,
  Result,
} from "./types";

// ---------------------------------------------------------------------------
// Fixture registry
//
// Two kinds, so `LeafNode<Types>` and `CollectionNode<Types, Summary>` are real
// discriminated unions and every fold below has to narrow on `node.kind` before
// touching `data`. That is not ceremony: the mapped tuple names a
// `container: false` variant for EVERY registered kind, so a fold that skipped
// the narrowing would not compile — which is the behaviour we want to hold on
// to.
// ---------------------------------------------------------------------------

type ClipData = Readonly<{ title: string; seconds: number }>;
type ClipEdit = Readonly<{ title: string }>;
type FolderData = Readonly<{ name: string; disabled: boolean }>;
type FolderEdit = Readonly<{ name: string }>;
type Summary = Readonly<{ seconds: number }>;

function issue(path: string, message: string): readonly Issue[] {
  return [{ path, message }];
}

// The node type VALUE is never registered. This file builds its graph with
// `makeLeafNode<Types>` rather than through an engine, so this exists only so
// `typeof` can derive the `Types` tuple below — deleting it would mean
// hand-writing that tuple and letting it drift from the node types it describes.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const clipType = defineNodeType<ClipData, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<ClipData, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: issue("$", "expected an object") };
    }
    if (!("title" in raw) || typeof raw.title !== "string") {
      return { ok: false, error: issue("$.title", "expected a string") };
    }
    if (!("seconds" in raw) || typeof raw.seconds !== "number") {
      return { ok: false, error: issue("$.seconds", "expected a number") };
    }
    return { ok: true, value: { title: raw.title, seconds: raw.seconds } };
  },
  serialize(data) {
    return { title: data.title, seconds: data.seconds };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { title: edit.title, seconds: data.seconds } };
  },
});

// Same as `clipType` above: a value that exists to be `typeof`-ed.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const folderType = defineNodeType<FolderData, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<FolderData, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: issue("$", "expected an object") };
    }
    if (!("name" in raw) || typeof raw.name !== "string") {
      return { ok: false, error: issue("$.name", "expected a string") };
    }
    const disabled = "disabled" in raw && raw.disabled === true;
    return { ok: true, value: { name: raw.name, disabled } };
  },
  serialize(data) {
    return { name: data.name, disabled: data.disabled };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { name: edit.name, disabled: data.disabled } };
  },
});

type Types = readonly [typeof clipType, typeof folderType];
type TestGraph = Graph<Types, Summary>;

const ENGINE_ID = Symbol("keel-folds-test");

// ---------------------------------------------------------------------------
// Graph fixtures
// ---------------------------------------------------------------------------

type Spec =
  | Readonly<{ t: "clip"; id: string; title?: string; seconds?: number }>
  | Readonly<{
      t: "folder";
      id: string;
      disabled?: boolean;
      state?: ChildrenState;
      summary?: Summary;
      children?: readonly Spec[];
    }>
  | Readonly<{
      t: "bad";
      id: string;
      container?: boolean;
      children?: readonly Spec[];
    }>;

const LOADED: ChildrenState = { status: "loaded" };

function buildGraph(roots: readonly Spec[]): TestGraph {
  const nodesById = new Map<NodeId, GraphNode<Types, Summary>>();
  const childrenById = new Map<NodeId, readonly NodeId[]>();
  const parentById = new Map<NodeId, NodeId | null>();
  const subtreeRevById = new Map<NodeId, number>();

  const add = (spec: Spec, parentId: NodeId | null): NodeId => {
    const id = parseNodeId(spec.id);
    parentById.set(id, parentId);
    subtreeRevById.set(id, 1);

    if (spec.t === "clip") {
      nodesById.set(
        id,
        makeLeafNode<Types>(id, "clip", {
          title: spec.title ?? spec.id,
          seconds: spec.seconds ?? 1,
        }),
      );
      return id;
    }

    if (spec.t === "bad") {
      const container = spec.container ?? false;
      nodesById.set(
        id,
        makeQuarantinedNode({
          id,
          kind: "kind-nobody-registered",
          container,
          schemaVersion: 0,
          raw: { opaque: spec.id },
          reason: "unknown-kind",
          issues: issue("$.kind", "no node type registered"),
          children: container ? LOADED : null,
          summary: null,
        }),
      );
      if (container) {
        childrenById.set(
          id,
          (spec.children ?? []).map((child) => add(child, id)),
        );
      }
      return id;
    }

    const state = spec.state ?? LOADED;
    nodesById.set(
      id,
      makeCollectionNode<Types, Summary>(
        id,
        "folder",
        { name: spec.id, disabled: spec.disabled ?? false },
        state,
        spec.summary ?? null,
      ),
    );
    if (state.status === "loaded") {
      childrenById.set(id, (spec.children ?? []).map((child) => add(child, id)));
    }
    return id;
  };

  const rootIds = roots.map((root) => add(root, null));

  return {
    engineId: ENGINE_ID,
    nodesById,
    childrenById,
    parentById,
    rootIds,
    subtreeRevById,
    deadRevById: new Map(),
    placementsByContentKey: new Map(),
    ownerBySourceKey: new Map(),
  };
}

/** A rev bump on one node only — what a mutation to that node looks like to the
 *  cache, with every other subtree's rev left alone. */
function withRev(graph: TestGraph, id: NodeId, rev: number): TestGraph {
  const subtreeRevById = new Map(graph.subtreeRevById);
  subtreeRevById.set(id, rev);
  return { ...graph, subtreeRevById };
}

const id = (raw: string): NodeId => parseNodeId(raw);

// ---------------------------------------------------------------------------
// Fixture folds
// ---------------------------------------------------------------------------

const durationMonoid = foldMonoid<Types, Summary, number>({
  key: "duration-monoid",
  empty: 0,
  leaf: (node) => (node.kind === "clip" ? node.data.seconds : 0),
  concat: (a, b) => a + b,
  placeholder: (node) => node.summary?.seconds,
});

/** The floor the predecessor persisted `0` through, and the veto a monoid
 *  cannot express because `concat` runs after the subtree is already summed. */
const EMPTY_COLLECTION_SECONDS = 3;

const durationByHand: Fold<Types, Summary, number> = {
  key: "duration-by-hand",
  leaf(node) {
    return node.kind === "clip" ? node.data.seconds : 0;
  },
  collection(node, children) {
    if (node.kind === "folder" && node.data.disabled) {
      return { value: 0, certainty: "exact" };
    }
    if (children.length === 0) {
      return { value: EMPTY_COLLECTION_SECONDS, certainty: "exact" };
    }
    let total = 0;
    const certainties: Certainty[] = [];
    for (const child of children) {
      total += child.value;
      certainties.push(child.certainty);
    }
    return { value: total, certainty: weakestCertainty(certainties) };
  },
  placeholder(node) {
    return { value: node.summary?.seconds ?? 0, certainty: "estimated" };
  },
  missing() {
    return { value: 0, certainty: "exact" };
  },
  quarantined() {
    return { value: 0, certainty: "partial" };
  },
};

/**
 * The measured position-sensitive rule: a hole BEFORE the first frame is found
 * makes the answer uncertain; a hole AFTER it changes nothing, so the live
 * result still wins. Weakest-wins certainty cannot express this, and demoting
 * here is what discarded a just-made edit in the predecessor.
 */
const firstFrame: Fold<Types, Summary, string | null> = {
  key: "first-frame",
  leaf(node) {
    return node.kind === "clip" ? node.data.title : null;
  },
  collection(_node, children) {
    let found: string | null = null;
    let uncertain = false;
    for (const child of children) {
      if (child.value !== null) {
        found = child.value;
        break;
      }
      if (child.placeholder) uncertain = true;
    }
    return { value: found, certainty: uncertain ? "estimated" : "exact" };
  },
  placeholder() {
    return { value: null, certainty: "estimated" };
  },
  missing() {
    return { value: null, certainty: "exact" };
  },
  quarantined() {
    return { value: null, certainty: "partial" };
  },
};

// ---------------------------------------------------------------------------

describe("folded / foldedExact", () => {
  it("wraps a value at the given certainty", () => {
    expect(folded(7, "estimated")).toEqual({ value: 7, certainty: "estimated" });
    expect(foldedExact("x")).toEqual({ value: "x", certainty: "exact" });
  });

  it("produces a union member that narrows on `certainty`", () => {
    // The whole reason `Folded<A>` is a union rather than a flat object: a flat
    // shape narrows the PROPERTY but not the object, so `summaryFrom` would be
    // uncallable and the persistence gate would be dead code.
    const maybe: Folded<number> = folded(12, "exact");
    let persisted: number | null = null;
    if (maybe.certainty === "exact") {
      persisted = summaryFrom(maybe);
    }
    expect(persisted).toBe(12);
  });
});

describe("weakestCertainty", () => {
  it("treats an empty list as exact", () => {
    // An aggregate over nothing is a known-empty answer, not an uncertain one —
    // the alternative makes every leaf-only collection unpersistable forever.
    expect(weakestCertainty([])).toBe("exact");
  });

  it("returns the weakest member regardless of position", () => {
    expect(weakestCertainty(["exact", "exact"])).toBe("exact");
    expect(weakestCertainty(["exact", "estimated"])).toBe("estimated");
    expect(weakestCertainty(["estimated", "exact"])).toBe("estimated");
    expect(weakestCertainty(["exact", "partial", "estimated"])).toBe("partial");
    expect(weakestCertainty(["partial", "exact"])).toBe("partial");
  });
});

describe("summaryFrom", () => {
  it("unwraps an exact fold", () => {
    expect(summaryFrom(foldedExact(42))).toBe(42);
  });

  it("refuses a non-exact fold at the type level", () => {
    const estimated: Folded<number> = folded(42, "estimated");
    // @ts-expect-error — THE persistence gate. `Folded<A>` is not assignable to
    // `ExactFolded<A>`; persisting an estimate compounds it on every save, which
    // is how an empty collection came to store a duration of 0 forever.
    const leaked: number = summaryFrom(estimated);
    expect(leaked).toBe(42);
  });
});

describe("foldMonoid", () => {
  it("sums leaves under a collection", () => {
    const graph = buildGraph([
      {
        t: "folder",
        id: "root",
        children: [
          { t: "clip", id: "a", seconds: 2 },
          { t: "clip", id: "b", seconds: 3 },
        ],
      },
    ]);
    expect(computeFold(graph, durationMonoid, id("root"))).toEqual({
      value: 5,
      certainty: "exact",
    });
  });

  it("uses `own` as the seed rather than as another child", () => {
    const withOwn = foldMonoid<Types, Summary, number>({
      key: "with-own",
      empty: 0,
      leaf: (node) => (node.kind === "clip" ? node.data.seconds : 0),
      concat: (a, b) => a + b,
      own: () => 100,
    });
    const graph = buildGraph([
      { t: "folder", id: "root", children: [{ t: "clip", id: "a", seconds: 2 }] },
    ]);
    expect(computeFold(graph, withOwn, id("root"))?.value).toBe(102);
  });

  it("cannot express an empty-collection floor or a subtree veto", () => {
    // This is the recorded reason `Fold` is the primitive and the monoid is the
    // convenience — not a style preference.
    const empty = buildGraph([{ t: "folder", id: "root", children: [] }]);
    expect(computeFold(empty, durationMonoid, id("root"))).toEqual({
      value: 0,
      certainty: "exact",
    });
    expect(computeFold(empty, durationByHand, id("root"))).toEqual({
      value: EMPTY_COLLECTION_SECONDS,
      certainty: "exact",
    });

    const vetoed = buildGraph([
      {
        t: "folder",
        id: "root",
        disabled: true,
        children: [{ t: "clip", id: "a", seconds: 9 }],
      },
    ]);
    expect(computeFold(vetoed, durationMonoid, id("root"))?.value).toBe(9);
    expect(computeFold(vetoed, durationByHand, id("root"))?.value).toBe(0);
  });

  it("maps the four non-loaded states onto their documented certainties", () => {
    const graph = buildGraph([
      {
        t: "folder",
        id: "root",
        children: [
          { t: "folder", id: "unloaded", state: { status: "unloaded" }, summary: { seconds: 4 } },
          { t: "folder", id: "reference", state: { status: "reference" } },
          { t: "folder", id: "missing", state: { status: "missing", reason: "deleted" } },
          { t: "bad", id: "quarantined" },
        ],
      },
    ]);

    // A stored summary is an estimate — never exact, so it can never be
    // persisted back through `summaryFrom`.
    expect(computeFold(graph, durationMonoid, id("unloaded"))).toEqual({
      value: 4,
      certainty: "estimated",
    });
    // No stored summary: nothing is known, so `empty` at "partial".
    expect(computeFold(graph, durationMonoid, id("reference"))).toEqual({
      value: 0,
      certainty: "partial",
    });
    // Confirmed gone is KNOWLEDGE — exactly empty, and exact.
    expect(computeFold(graph, durationMonoid, id("missing"))).toEqual({
      value: 0,
      certainty: "exact",
    });
    expect(computeFold(graph, durationMonoid, id("quarantined"))).toEqual({
      value: 0,
      certainty: "partial",
    });
  });

  it("treats a placeholder step returning undefined as unknown, not as empty-but-known", () => {
    const noStandIn = foldMonoid<Types, Summary, number>({
      key: "no-stand-in",
      empty: 0,
      leaf: () => 1,
      concat: (a, b) => a + b,
      placeholder: () => undefined,
    });
    const graph = buildGraph([
      { t: "folder", id: "root", state: { status: "unloaded" } },
    ]);
    expect(computeFold(graph, noStandIn, id("root"))).toEqual({
      value: 0,
      certainty: "partial",
    });
  });

  it("propagates the weakest child certainty up the chain", () => {
    const graph = buildGraph([
      {
        t: "folder",
        id: "root",
        children: [
          { t: "clip", id: "a", seconds: 1 },
          {
            t: "folder",
            id: "mid",
            children: [
              { t: "folder", id: "deep", state: { status: "reference" } },
            ],
          },
        ],
      },
    ]);
    // "partial" at depth 2 must reach the root: an ancestor rollup that stayed
    // "exact" over an unknown subtree is exactly the lie this type prevents.
    expect(computeFold(graph, durationMonoid, id("root"))).toEqual({
      value: 1,
      certainty: "partial",
    });
  });
});

describe("computeFold dispatch", () => {
  it("returns undefined for an unknown node", () => {
    const graph = buildGraph([{ t: "folder", id: "root" }]);
    expect(computeFold(graph, durationMonoid, id("nobody"))).toBeUndefined();
  });

  it("wraps a leaf as exact without asking the fold", () => {
    const graph = buildGraph([
      { t: "folder", id: "root", children: [{ t: "clip", id: "a", seconds: 6 }] },
    ]);
    expect(computeFold(graph, durationMonoid, id("a"))).toEqual({
      value: 6,
      certainty: "exact",
    });
  });

  it("hands `collection` its children in document order, with ids", () => {
    const graph = buildGraph([
      {
        t: "folder",
        id: "root",
        children: [
          { t: "clip", id: "first", title: "1" },
          { t: "clip", id: "second", title: "2" },
          { t: "clip", id: "third", title: "3" },
        ],
      },
    ]);
    const order: Fold<Types, Summary, string> = {
      key: "order",
      leaf(node) {
        return node.kind === "clip" ? node.data.title : "?";
      },
      collection(_node, children) {
        return {
          value: children.map((child) => `${child.id}=${child.value}`).join(","),
          certainty: "exact",
        };
      },
      placeholder() {
        return { value: "", certainty: "estimated" };
      },
      missing() {
        return { value: "", certainty: "exact" };
      },
      quarantined() {
        return { value: "", certainty: "partial" };
      },
    };
    expect(computeFold(graph, order, id("root"))?.value).toBe(
      "first=1,second=2,third=3",
    );
  });

  it("flags placeholder children for `unloaded` and `reference` only", () => {
    const graph = buildGraph([
      {
        t: "folder",
        id: "root",
        children: [
          { t: "clip", id: "leaf" },
          { t: "folder", id: "loaded", children: [] },
          { t: "folder", id: "unloaded", state: { status: "unloaded" } },
          { t: "folder", id: "reference", state: { status: "reference" } },
          { t: "folder", id: "missing", state: { status: "missing", reason: "gone" } },
          { t: "bad", id: "quarantined" },
        ],
      },
    ]);
    const flags: Fold<Types, Summary, string> = {
      key: "flags",
      leaf() {
        return "";
      },
      collection(_node, children) {
        return {
          value: children
            .map((child) => `${child.id}:${child.placeholder ? "yes" : "no"}`)
            .join(" "),
          certainty: "exact",
        };
      },
      placeholder() {
        return { value: "", certainty: "estimated" };
      },
      missing() {
        return { value: "", certainty: "exact" };
      },
      quarantined() {
        return { value: "", certainty: "partial" };
      },
    };
    // `missing` is NOT a placeholder — it is a confirmed answer. Neither is a
    // quarantined node: it was answered by `fold.quarantined`, and conflating
    // the two would make the flag mean two things at once.
    expect(computeFold(graph, flags, id("root"))?.value).toBe(
      "leaf:no loaded:no unloaded:yes reference:yes missing:no quarantined:no",
    );
  });

  it("never folds a quarantined container's children", () => {
    const graph = buildGraph([
      {
        t: "folder",
        id: "root",
        children: [
          {
            t: "bad",
            id: "broken",
            container: true,
            children: [{ t: "clip", id: "hidden", seconds: 99 }],
          },
        ],
      },
    ]);
    let leafCalls = 0;
    const counting: Fold<Types, Summary, number> = {
      ...durationByHand,
      key: "counting-quarantine",
      leaf(node) {
        leafCalls += 1;
        return node.kind === "clip" ? node.data.seconds : 0;
      },
    };
    const result = computeFold(graph, counting, id("root"));
    // The child is still in the graph and still movable; it is simply not part
    // of any aggregate, because nothing validated the container that holds it.
    expect(leafCalls).toBe(0);
    expect(result?.value).toBe(0);
    expect(result?.certainty).toBe("partial");
  });

  it("expresses position-sensitive certainty a monoid cannot", () => {
    const before = buildGraph([
      {
        t: "folder",
        id: "root",
        children: [
          { t: "folder", id: "hole", state: { status: "unloaded" } },
          { t: "clip", id: "a", title: "frame-a" },
        ],
      },
    ]);
    const after = buildGraph([
      {
        t: "folder",
        id: "root",
        children: [
          { t: "clip", id: "a", title: "frame-a" },
          { t: "folder", id: "hole", state: { status: "unloaded" } },
        ],
      },
    ]);

    expect(computeFold(before, firstFrame, id("root"))).toEqual({
      value: "frame-a",
      certainty: "estimated",
    });
    // The decisive case: an unloaded branch AFTER the first frame leaves the
    // answer correct, so the live result still wins. Weakest-wins would demote
    // this to "estimated" and send the reader back to a stored summary,
    // discarding a just-made edit.
    expect(computeFold(after, firstFrame, id("root"))).toEqual({
      value: "frame-a",
      certainty: "exact",
    });
  });

  it("survives depth that would overflow a recursive evaluator", () => {
    const depth = 5000;
    const nodesById = new Map<NodeId, GraphNode<Types, Summary>>();
    const childrenById = new Map<NodeId, readonly NodeId[]>();
    const parentById = new Map<NodeId, NodeId | null>();
    const subtreeRevById = new Map<NodeId, number>();

    const bottom = id("deep-leaf");
    nodesById.set(
      bottom,
      makeLeafNode<Types>(bottom, "clip", { title: "bottom", seconds: 2 }),
    );
    subtreeRevById.set(bottom, 1);

    let childId = bottom;
    for (let i = depth - 1; i >= 0; i -= 1) {
      const folderId = id(`deep-${i}`);
      nodesById.set(
        folderId,
        makeCollectionNode<Types, Summary>(
          folderId,
          "folder",
          { name: `deep-${i}`, disabled: false },
          LOADED,
          null,
        ),
      );
      childrenById.set(folderId, [childId]);
      parentById.set(childId, folderId);
      subtreeRevById.set(folderId, 1);
      childId = folderId;
    }
    parentById.set(childId, null);

    const graph: TestGraph = {
      engineId: ENGINE_ID,
      nodesById,
      childrenById,
      parentById,
      rootIds: [childId],
      subtreeRevById,
    deadRevById: new Map(),
      placementsByContentKey: new Map(),
      ownerBySourceKey: new Map(),
    };

    expect(computeFold(graph, durationMonoid, childId)).toEqual({
      value: 2,
      certainty: "exact",
    });
  });

  it("drops a dangling child instead of throwing", () => {
    const base = buildGraph([
      { t: "folder", id: "root", children: [{ t: "clip", id: "a", seconds: 5 }] },
    ]);
    const childrenById = new Map(base.childrenById);
    childrenById.set(id("root"), [id("a"), id("ghost")]);
    const graph: TestGraph = { ...base, childrenById };

    // A dangling child is a `dangling-child` invariant violation, reported by
    // `findInvariantViolation`. This is a READ path: it stays total, because a
    // throw here lands inside a React render.
    expect(computeFold(graph, durationMonoid, id("root"))).toEqual({
      value: 5,
      certainty: "exact",
    });
  });

  it("terminates on a graph that violates its own acyclicity invariant", () => {
    const a = id("cyc-a");
    const b = id("cyc-b");
    const nodesById = new Map<NodeId, GraphNode<Types, Summary>>([
      [a, makeCollectionNode<Types, Summary>(a, "folder", { name: "a", disabled: false }, LOADED, null)],
      [b, makeCollectionNode<Types, Summary>(b, "folder", { name: "b", disabled: false }, LOADED, null)],
    ]);
    const graph: TestGraph = {
      engineId: ENGINE_ID,
      nodesById,
      deadRevById: new Map(),
      childrenById: new Map<NodeId, readonly NodeId[]>([
        [a, [b]],
        [b, [a]],
      ]),
      parentById: new Map<NodeId, NodeId | null>([
        [a, null],
        [b, a],
      ]),
      rootIds: [a],
      subtreeRevById: new Map([
        [a, 1],
        [b, 1],
      ]),
      placementsByContentKey: new Map(),
      ownerBySourceKey: new Map(),
    };

    // The exact number is not a contract — the graph is corrupt. Returning at
    // all is: an unbounded loop inside a render is unrecoverable, a wrong
    // rollup is not.
    expect(computeFold(graph, durationMonoid, a)).toBeDefined();
  });

  it("does not mutate the graph it reads", () => {
    const graph = buildGraph([
      {
        t: "folder",
        id: "root",
        children: [
          { t: "clip", id: "a", seconds: 1 },
          { t: "folder", id: "mid", children: [{ t: "clip", id: "b", seconds: 2 }] },
        ],
      },
    ]);
    const before = {
      nodes: graph.nodesById.size,
      children: graph.childrenById.size,
      revs: [...graph.subtreeRevById.values()],
    };
    computeFold(graph, durationMonoid, id("root"), createFoldCache());
    expect(graph.nodesById.size).toBe(before.nodes);
    expect(graph.childrenById.size).toBe(before.children);
    expect([...graph.subtreeRevById.values()]).toEqual(before.revs);
  });
});

describe("createFoldCache", () => {
  it("misses, then hits after a set", () => {
    const cache = createFoldCache();
    expect(cache.get("k", id("n"), 1)).toEqual({ hit: false });
    cache.set("k", id("n"), 1, "value");
    expect(cache.get("k", id("n"), 1)).toEqual({ hit: true, value: "value" });
    expect(cache.size()).toBe(1);
  });

  it("reports a cached `undefined` as a hit", () => {
    // Why `get` returns a hit/miss union instead of `unknown | undefined`:
    // those collapse, and a fold legitimately producing `undefined` would then
    // recompute forever while looking perfectly healthy.
    const cache = createFoldCache();
    cache.set("k", id("n"), 1, undefined);
    expect(cache.get("k", id("n"), 1)).toEqual({ hit: true, value: undefined });
  });

  it("makes a stale rev unreachable rather than wrong", () => {
    const cache = createFoldCache();
    cache.set("k", id("n"), 1, "old");
    expect(cache.get("k", id("n"), 2)).toEqual({ hit: false });
    expect(cache.get("k", id("n"), 1)).toEqual({ hit: true, value: "old" });
  });

  it("keys on the fold key too", () => {
    const cache = createFoldCache();
    cache.set("duration", id("n"), 1, 10);
    expect(cache.get("previews", id("n"), 1)).toEqual({ hit: false });
  });

  it("cannot collide two keys that a naive separator would fuse", () => {
    // A NodeId may contain ANY non-whitespace character — `scene/a` and
    // `timeline-e2e,comma` are real ids that have shipped. `[key, id, rev]
    // .join(":")` makes ("a", "b:c") and ("a:b", "c") the same slot, and the
    // symptom is a fold quietly answering with another node's value.
    const cache = createFoldCache();
    cache.set("a", id("b:c"), 1, "first");
    expect(cache.get("a:b", id("c"), 1)).toEqual({ hit: false });
    expect(cache.get("a", id("b:c"), 1)).toEqual({ hit: true, value: "first" });
  });

  it("evicts the least recently used entry past its limit", () => {
    const cache = createFoldCache(2);
    cache.set("k", id("one"), 1, 1);
    cache.set("k", id("two"), 1, 2);
    cache.set("k", id("three"), 1, 3);
    expect(cache.size()).toBe(2);
    expect(cache.get("k", id("one"), 1)).toEqual({ hit: false });
    expect(cache.get("k", id("three"), 1)).toEqual({ hit: true, value: 3 });
  });

  it("promotes an entry on read", () => {
    const cache = createFoldCache(2);
    cache.set("k", id("one"), 1, 1);
    cache.set("k", id("two"), 1, 2);
    expect(cache.get("k", id("one"), 1).hit).toBe(true);
    cache.set("k", id("three"), 1, 3);
    // "one" was touched most recently of the two, so "two" is what leaves.
    expect(cache.get("k", id("one"), 1).hit).toBe(true);
    expect(cache.get("k", id("two"), 1).hit).toBe(false);
  });

  it("disables itself at a limit of zero and falls back on a non-finite one", () => {
    const off = createFoldCache(0);
    off.set("k", id("n"), 1, 1);
    expect(off.size()).toBe(0);
    expect(off.get("k", id("n"), 1)).toEqual({ hit: false });

    const nonFinite = createFoldCache(Number.NaN);
    nonFinite.set("k", id("n"), 1, 1);
    expect(nonFinite.get("k", id("n"), 1)).toEqual({ hit: true, value: 1 });
  });

  it("clears", () => {
    const cache = createFoldCache();
    cache.set("k", id("n"), 1, 1);
    cache.clear();
    expect(cache.size()).toBe(0);
    expect(cache.get("k", id("n"), 1)).toEqual({ hit: false });
  });
});

describe("computeFold caching", () => {
  const treeSpec: readonly Spec[] = [
    {
      t: "folder",
      id: "root",
      children: [
        {
          t: "folder",
          id: "a",
          children: [
            { t: "clip", id: "c1", seconds: 1 },
            { t: "clip", id: "c2", seconds: 2 },
          ],
        },
        { t: "folder", id: "b", children: [{ t: "clip", id: "c3", seconds: 4 }] },
      ],
    },
  ];

  function countingDuration(): {
    fold: Fold<Types, Summary, number>;
    leafCalls: () => number;
    collectionCalls: () => number;
  } {
    let leafCalls = 0;
    let collectionCalls = 0;
    const fold: Fold<Types, Summary, number> = {
      key: "counting-duration",
      leaf(node) {
        leafCalls += 1;
        return node.kind === "clip" ? node.data.seconds : 0;
      },
      collection(_node, children) {
        collectionCalls += 1;
        let total = 0;
        const certainties: Certainty[] = [];
        for (const child of children) {
          total += child.value;
          certainties.push(child.certainty);
        }
        return { value: total, certainty: weakestCertainty(certainties) };
      },
      placeholder() {
        return { value: 0, certainty: "partial" };
      },
      missing() {
        return { value: 0, certainty: "exact" };
      },
      quarantined() {
        return { value: 0, certainty: "partial" };
      },
    };
    return { fold, leafCalls: () => leafCalls, collectionCalls: () => collectionCalls };
  }

  it("recomputes nothing on a repeat call", () => {
    const graph = buildGraph(treeSpec);
    const cache = createFoldCache();
    const { fold, leafCalls, collectionCalls } = countingDuration();

    expect(computeFold(graph, fold, id("root"), cache)?.value).toBe(7);
    expect(leafCalls()).toBe(3);
    expect(collectionCalls()).toBe(3);

    expect(computeFold(graph, fold, id("root"), cache)?.value).toBe(7);
    expect(leafCalls()).toBe(3);
    expect(collectionCalls()).toBe(3);
  });

  it("recomputes only the chain whose subtreeRev moved", () => {
    const graph = buildGraph(treeSpec);
    const cache = createFoldCache();
    const { fold, leafCalls, collectionCalls } = countingDuration();

    computeFold(graph, fold, id("root"), cache);
    expect(leafCalls()).toBe(3);
    expect(collectionCalls()).toBe(3);

    // Exactly what a mutation somewhere under `root` looks like once
    // `bumpSubtreeRevs` has walked the ancestor chain and stopped.
    const bumped = withRev(graph, id("root"), 2);
    computeFold(bumped, fold, id("root"), cache);

    // `root` misses and recomputes; `a` and `b` still hit at their untouched
    // revs, so neither their `collection` step nor any leaf runs again. This is
    // the whole reason folds are graph-blind — a fold that could read the graph
    // would make this reuse unsound.
    expect(collectionCalls()).toBe(4);
    expect(leafCalls()).toBe(3);
  });

  it("gives the same answer with and without a cache", () => {
    const graph = buildGraph([
      {
        t: "folder",
        id: "root",
        children: [
          { t: "clip", id: "a", seconds: 1 },
          { t: "folder", id: "unloaded", state: { status: "unloaded" }, summary: { seconds: 8 } },
          { t: "bad", id: "broken" },
        ],
      },
    ]);
    const cold = computeFold(graph, durationMonoid, id("root"));
    const warm = computeFold(graph, durationMonoid, id("root"), createFoldCache());
    expect(warm).toEqual(cold);
  });

  it("keeps two folds sharing one cache apart", () => {
    const graph = buildGraph([
      {
        t: "folder",
        id: "root",
        children: [
          { t: "clip", id: "a", title: "alpha", seconds: 1 },
          { t: "clip", id: "b", title: "beta", seconds: 2 },
        ],
      },
    ]);
    const titles: Fold<Types, Summary, readonly string[]> = {
      key: "titles",
      leaf(node) {
        return node.kind === "clip" ? [node.data.title] : [];
      },
      collection(_node, children) {
        return {
          value: children.flatMap((child) => child.value),
          certainty: "exact",
        };
      },
      placeholder() {
        return { value: [], certainty: "estimated" };
      },
      missing() {
        return { value: [], certainty: "exact" };
      },
      quarantined() {
        return { value: [], certainty: "partial" };
      },
    };

    const cache = createFoldCache();
    expect(computeFold(graph, durationMonoid, id("root"), cache)?.value).toBe(3);
    expect(computeFold(graph, titles, id("root"), cache)?.value).toEqual([
      "alpha",
      "beta",
    ]);
    // Re-read both: neither key may have been clobbered by the other.
    expect(computeFold(graph, durationMonoid, id("root"), cache)?.value).toBe(3);
    expect(computeFold(graph, titles, id("root"), cache)?.value).toEqual([
      "alpha",
      "beta",
    ]);
  });

  it("caches every node it folds, not just the one asked for", () => {
    const graph = buildGraph(treeSpec);
    const cache = createFoldCache();
    computeFold(graph, durationMonoid, id("root"), cache);
    // root, a, b, c1, c2, c3 — a later query for a sibling subtree is free.
    expect(cache.size()).toBe(6);
    expect(cache.get("duration-monoid", id("a"), 1)).toEqual({
      hit: true,
      value: { value: 3, certainty: "exact" },
    });
  });
});

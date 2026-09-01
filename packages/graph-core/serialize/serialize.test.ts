import { describe, expect, it } from "vitest";

import { childrenStateOf, buildRegistry, findInvariantViolation, getChildren, getParent } from "../graph";
import {
  DEFAULT_MAX_NODES,
  deserializeDocument,
  loadChildrenInto,
  parseNodeData,
  parseSerializedDocument,
  serializeGraph,
} from "./index";
import {
  defineNodeType,
  parseNodeId,
  type GraphNode,
  type EngineContext,
  type Graph,
  type Issue,
  type NodeId,
  type ParseCtx,
  type Result,
  type SerializedDocument,
  type SerializedNode,
  type ConsumerDefinedSummaryType,
} from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issue(path: string, message: string): readonly Issue[] {
  return [{ path, message }];
}

type Clip = Readonly<{ name: string; asset: string | null }>;
type ClipEdit = Readonly<{ name: string }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw: unknown, ctx: ParseCtx): Result<Clip, readonly Issue[]> {
    if (!isRecord(raw) || typeof raw.name !== "string") {
      return { ok: false, error: issue("$.name", "clip.name must be a string") };
    }
    if (raw.name === "") ctx.warn({ path: "$.name", message: "empty clip name" });
    return {
      ok: true,
      value: {
        name: raw.name,
        asset: typeof raw.asset === "string" ? raw.asset : null,
      },
    };
  },
  serialize(data: Clip): unknown {
    return { name: data.name, asset: data.asset };
  },
  applyEdit(_data: Clip, edit: ClipEdit): Result<Clip, never> {
    return { ok: true, value: { name: edit.name, asset: null } };
  },
  contentKey(data: Clip): string | null {
    return data.asset;
  },
});

type Folder = Readonly<{ title: string; source: string | null }>;

const folderType = defineNodeType<Folder, never>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw: unknown): Result<Folder, readonly Issue[]> {
    if (!isRecord(raw) || typeof raw.title !== "string") {
      return {
        ok: false,
        error: issue("$.title", "folder.title must be a string"),
      };
    }
    return {
      ok: true,
      value: {
        title: raw.title,
        source: typeof raw.source === "string" ? raw.source : null,
      },
    };
  },
  serialize(data: Folder): unknown {
    return { title: data.title, source: data.source };
  },
  applyEdit(data: Folder): Result<Folder, never> {
    return { ok: true, value: data };
  },
  sourceKey(data: Folder): string | null {
    return data.source;
  },
});

/** Records which migration TARGETS ran, in the order they ran. */
const migrationLog: number[] = [];

type Note = Readonly<{ text: string; color: string }>;

const noteType = defineNodeType<Note, never>()({
  kind: "note",
  container: false,
  schemaVersion: 3,
  migrations: {
    // v1 -> v2 renamed `body` to `text`.
    2: (raw: unknown): unknown => {
      migrationLog.push(2);
      const rec = isRecord(raw) ? raw : {};
      return { text: typeof rec.body === "string" ? rec.body : "" };
    },
    // v2 -> v3 introduced `color`.
    3: (raw: unknown): unknown => {
      migrationLog.push(3);
      const rec = isRecord(raw) ? raw : {};
      return { ...rec, color: "yellow" };
    },
  },
  parse(raw: unknown): Result<Note, readonly Issue[]> {
    if (!isRecord(raw)) {
      return { ok: false, error: issue("$", "note must be an object") };
    }
    if (typeof raw.text !== "string" || typeof raw.color !== "string") {
      return {
        ok: false,
        error: issue("$", "note needs text and color as strings"),
      };
    }
    return { ok: true, value: { text: raw.text, color: raw.color } };
  },
  serialize(data: Note): unknown {
    return { text: data.text, color: data.color };
  },
  applyEdit(data: Note): Result<Note, never> {
    return { ok: true, value: data };
  },
});

/** Sparse, very large version numbers: a counting loop would be the naive
 *  implementation and this kind is what makes that visible. */
const sparseType = defineNodeType<Readonly<{ v: number }>, never>()({
  kind: "sparse",
  container: false,
  schemaVersion: 1_000_000,
  migrations: {
    5: (raw: unknown): unknown => {
      migrationLog.push(5);
      return raw;
    },
    1_000_000: (raw: unknown): unknown => {
      migrationLog.push(1_000_000);
      return isRecord(raw) ? { v: 1 } : { v: 0 };
    },
  },
  parse(raw: unknown): Result<Readonly<{ v: number }>, readonly Issue[]> {
    if (!isRecord(raw) || typeof raw.v !== "number") {
      return { ok: false, error: issue("$.v", "sparse.v must be a number") };
    }
    return { ok: true, value: { v: raw.v } };
  },
  serialize(data: Readonly<{ v: number }>): unknown {
    return { v: data.v };
  },
  applyEdit(data: Readonly<{ v: number }>): Result<Readonly<{ v: number }>, never> {
    return { ok: true, value: data };
  },
});

/** A node type whose migration throws, and whose parse throws. Both are consumer
 *  code, and an ingress door that propagates either takes the document down. */
const hostileType = defineNodeType<Readonly<{ ok: true }>, never>()({
  kind: "hostile",
  container: false,
  schemaVersion: 2,
  migrations: {
    2: (): unknown => {
      throw new Error("migration exploded");
    },
  },
  parse(): Result<Readonly<{ ok: true }>, readonly Issue[]> {
    throw new Error("parse exploded");
  },
  serialize(): unknown {
    return {};
  },
  applyEdit(data: Readonly<{ ok: true }>): Result<Readonly<{ ok: true }>, never> {
    return { ok: true, value: data };
  },
});

const TYPES = [clipType, folderType, noteType, sparseType, hostileType] as const;
type Types = typeof TYPES;

type Summary = Readonly<{ count: number }>;

const summaryType: ConsumerDefinedSummaryType<Summary> = {
  parse(raw: unknown): Result<Summary, readonly Issue[]> {
    if (!isRecord(raw) || typeof raw.count !== "number") {
      return { ok: false, error: issue("$.count", "summary.count must be a number") };
    }
    return { ok: true, value: { count: raw.count } };
  },
  serialize(summary: Summary): unknown {
    return { count: summary.count };
  },
};

const ENGINE_ID = Symbol("graph-test-engine");

function makeCtx(
  overrides: Partial<EngineContext<Summary>> = {},
): EngineContext<Summary> {
  return {
    engineId: ENGINE_ID,
    registry: buildRegistry(TYPES),
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
    ...overrides,
  };
}

function expectOk<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

function expectErr<T, E>(result: Result<T, E>): E {
  if (result.ok) {
    throw new Error(`expected an error, got ok: ${JSON.stringify(result.value)}`);
  }
  return result.error;
}

function id(raw: string): NodeId {
  return parseNodeId(raw);
}

function nodeIn(
  graph: Graph<Types, Summary>,
  raw: string,
): GraphNode<Types, Summary> {
  const node = graph.nodesById.get(id(raw));
  if (node === undefined) throw new Error(`no node ${raw} in graph`);
  return node;
}

function wireNode(doc: SerializedDocument, raw: string): SerializedNode {
  const found = doc.nodes.find((node) => node.id === raw);
  if (found === undefined) throw new Error(`no node ${raw} in document`);
  return found;
}

/** root(folder) -> [a(clip), sub(folder, unloaded)] */
function simpleDoc(): unknown {
  return {
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes: [
      {
        id: "root",
        kind: "folder",
        children: ["a", "sub"],
        data: { title: "Root", source: null },
      },
      { id: "a", kind: "clip", data: { name: "A", asset: "asset-1" } },
      {
        id: "sub",
        kind: "folder",
        childrenState: "unloaded",
        summary: { count: 4 },
        data: { title: "Sub", source: null },
      },
    ],
  };
}

function loadSimple(
  ctx: EngineContext<Summary> = makeCtx(),
): Graph<Types, Summary> {
  return expectOk(deserializeDocument<Types, Summary>(simpleDoc(), ctx)).graph;
}

// ---------------------------------------------------------------------------
// parseSerializedDocument — shape only
// ---------------------------------------------------------------------------

describe("parseSerializedDocument", () => {
  it("rejects non-objects, null and arrays as malformed", () => {
    for (const raw of [null, undefined, 7, "doc", [], true]) {
      expect(expectErr(parseSerializedDocument(raw)).code).toBe(
        "malformed-document",
      );
    }
  });

  it("checks formatVersion before anything else", () => {
    // Every other field is deliberately garbage: a future format may legally
    // rearrange them, so complaining about them would misdirect the reader.
    const error = expectErr(
      parseSerializedDocument({ formatVersion: 2, rootIds: 9, nodes: "no" }),
    );
    expect(error.code).toBe("unsupported-format-version");
  });

  it("tolerates an absent schemaVersions but rejects a non-numeric one", () => {
    const okDoc = expectOk(
      parseSerializedDocument({ formatVersion: 1, rootIds: [], nodes: [] }),
    );
    expect(okDoc.schemaVersions).toEqual({});

    expect(
      expectErr(
        parseSerializedDocument({
          formatVersion: 1,
          schemaVersions: { clip: "1" },
          rootIds: [],
          nodes: [],
        }),
      ).code,
    ).toBe("malformed-document");
  });

  it("rejects a childrenState that is not one of the three states", () => {
    const error = expectErr(
      parseSerializedDocument({
        formatVersion: 1,
        rootIds: [],
        nodes: [{ id: "n", kind: "folder", childrenState: "loaded", data: {} }],
      }),
    );
    expect(error.code).toBe("invalid-children-state");
  });

  it("reads an absent `data` key as undefined rather than rejecting", () => {
    // JSON.stringify drops keys whose value is `undefined`, so requiring the
    // key would make the engine unable to read a document it wrote itself for
    // a kind whose `serialize` returns undefined.
    const doc = expectOk(
      parseSerializedDocument({
        formatVersion: 1,
        rootIds: [],
        nodes: [{ id: "n", kind: "clip" }],
      }),
    );
    expect(wireNode(doc, "n").data).toBeUndefined();
  });

  it("preserves a present summary and omits an absent one", () => {
    const doc = expectOk(
      parseSerializedDocument({
        formatVersion: 1,
        rootIds: [],
        nodes: [
          { id: "with", kind: "folder", summary: { count: 1 }, data: {} },
          { id: "without", kind: "folder", data: {} },
        ],
      }),
    );
    expect("summary" in wireNode(doc, "with")).toBe(true);
    expect("summary" in wireNode(doc, "without")).toBe(false);
  });

  it("does not check referential integrity — that is the graph's job", () => {
    // Dangling children and duplicate ids parse fine here; they are rejected by
    // deserializeDocument, which is the pass that has the whole node set.
    const doc = expectOk(
      parseSerializedDocument({
        formatVersion: 1,
        rootIds: ["nope"],
        nodes: [{ id: "n", kind: "folder", children: ["ghost"], data: {} }],
      }),
    );
    expect(doc.nodes).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// parseNodeData — the content trust boundary
// ---------------------------------------------------------------------------

describe("parseNodeData", () => {
  it("reports an unregistered kind as unknown-kind", () => {
    const error = expectErr(
      parseNodeData(makeCtx(), {
        nodeId: id("n"),
        kind: "ghost",
        container: false,
        schemaVersion: 1,
        raw: {},
      }),
    );
    expect(error.reason).toBe("unknown-kind");
    expect(error.kind).toBe("ghost");
  });

  it("relays the node type's own issues on a parse failure", () => {
    const error = expectErr(
      parseNodeData(makeCtx(), {
        nodeId: id("n"),
        kind: "clip",
        container: false,
        schemaVersion: 1,
        raw: { name: 7 },
      }),
    );
    expect(error.reason).toBe("parse-failed");
    expect(error.issues).toEqual([
      { path: "$.name", message: "clip.name must be a string" },
    ]);
  });

  it("collects warnings without failing", () => {
    const parsed = expectOk(
      parseNodeData(makeCtx(), {
        nodeId: id("n"),
        kind: "clip",
        container: false,
        schemaVersion: 1,
        raw: { name: "" },
      }),
    );
    expect(parsed.warnings).toEqual([
      { path: "$.name", message: "empty clip name" },
    ]);
  });

  it("does not throw when a node type's parse throws", () => {
    // An ingress door that propagates a consumer exception takes the whole
    // document down, which is exactly what sealing exists to prevent.
    const error = expectErr(
      parseNodeData(makeCtx(), {
        nodeId: id("n"),
        kind: "hostile",
        container: false,
        schemaVersion: 2, // already current, so no migration runs
        raw: {},
      }),
    );
    expect(error.reason).toBe("parse-failed");
    expect(error.issues[0]?.message).toContain("parse exploded");
  });

  it("reports a throwing migration as parse-failed at $.schemaVersion", () => {
    const error = expectErr(
      parseNodeData(makeCtx(), {
        nodeId: id("n"),
        kind: "hostile",
        container: false,
        schemaVersion: 1,
        raw: {},
      }),
    );
    expect(error.reason).toBe("parse-failed");
    expect(error.issues[0]?.path).toBe("$.schemaVersion");
    expect(error.issues[0]?.message).toContain("migration exploded");
  });

  it("runs migrations ascending, keyed by target, BEFORE parse", () => {
    migrationLog.length = 0;
    const parsed = expectOk(
      parseNodeData(makeCtx(), {
        nodeId: id("n"),
        kind: "note",
        container: false,
        schemaVersion: 1,
        raw: { body: "hello" },
      }),
    );
    expect(migrationLog).toEqual([2, 3]);
    // `parse` demands both `text` and `color`; only the migrated value has
    // them, so a parse-then-migrate order could not have produced this.
    expect(parsed.data).toEqual({ text: "hello", color: "yellow" });
    expect(parsed.migratedFrom).toBe(1);
  });

  it("runs only the migrations in (from, to]", () => {
    migrationLog.length = 0;
    const parsed = expectOk(
      parseNodeData(makeCtx(), {
        nodeId: id("n"),
        kind: "note",
        container: false,
        schemaVersion: 2,
        raw: { text: "already renamed" },
      }),
    );
    expect(migrationLog).toEqual([3]);
    expect(parsed.migratedFrom).toBe(2);
  });

  it("runs nothing when the document is already current", () => {
    migrationLog.length = 0;
    const parsed = expectOk(
      parseNodeData(makeCtx(), {
        nodeId: id("n"),
        kind: "note",
        container: false,
        schemaVersion: 3,
        raw: { text: "t", color: "blue" },
      }),
    );
    expect(migrationLog).toEqual([]);
    expect(parsed.migratedFrom).toBeNull();
    expect(parsed.data).toEqual({ text: "t", color: "blue" });
  });

  it("runs nothing for a document written by a NEWER build", () => {
    // No migration walks backwards. Refusing here would make every rolling
    // deploy produce documents that will not open; letting `parse` decide means
    // an additive change reads fine and a breaking one seals loudly.
    migrationLog.length = 0;
    const parsed = expectOk(
      parseNodeData(makeCtx(), {
        nodeId: id("n"),
        kind: "note",
        container: false,
        schemaVersion: 99,
        raw: { text: "from the future", color: "blue" },
      }),
    );
    expect(migrationLog).toEqual([]);
    expect(parsed.migratedFrom).toBeNull();
  });

  it("handles sparse, very large version numbers", () => {
    migrationLog.length = 0;
    const parsed = expectOk(
      parseNodeData(makeCtx(), {
        nodeId: id("n"),
        kind: "sparse",
        container: false,
        schemaVersion: 1,
        raw: {},
      }),
    );
    expect(migrationLog).toEqual([5, 1_000_000]);
    expect(parsed.data).toEqual({ v: 1 });
  });
});

// ---------------------------------------------------------------------------
// deserializeDocument — happy path and graph invariants
// ---------------------------------------------------------------------------

describe("deserializeDocument", () => {
  it("builds a graph that satisfies every structural invariant", () => {
    const ctx = makeCtx();
    const graph = loadSimple(ctx);
    expect(findInvariantViolation(graph, ctx.registry)).toBeNull();
  });

  it("stamps the engine id from the context", () => {
    const graph = loadSimple();
    expect(graph.engineId).toBe(ENGINE_ID);
  });

  it("gives childrenById an entry for EXACTLY the loaded collections", () => {
    const graph = loadSimple();
    expect([...graph.childrenById.keys()]).toEqual([id("root")]);
    expect(graph.childrenById.get(id("root"))).toEqual([id("a"), id("sub")]);
  });

  it("keeps parentById and subtreeRevById total, with roots at null", () => {
    const graph = loadSimple();
    for (const nodeId of graph.nodesById.keys()) {
      expect(graph.parentById.has(nodeId)).toBe(true);
      expect(graph.subtreeRevById.get(nodeId)).toBe(0);
    }
    expect(graph.parentById.get(id("root"))).toBeNull();
    expect(graph.parentById.get(id("a"))).toBe(id("root"));
  });

  it("decodes all four children states, including the missing reason", () => {
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            {
              id: "root",
              kind: "folder",
              children: ["u", "r", "m"],
              data: { title: "R", source: null },
            },
            {
              id: "u",
              kind: "folder",
              childrenState: "unloaded",
              data: { title: "U", source: null },
            },
            {
              id: "r",
              kind: "folder",
              childrenState: "reference",
              data: { title: "Ref", source: null },
            },
            {
              id: "m",
              kind: "folder",
              childrenState: "missing",
              missingReason: "deleted upstream",
              data: { title: "M", source: null },
            },
          ],
        },
        makeCtx(),
      ),
    ).graph;

    const states = ["root", "u", "r", "m"].map((raw) => {
      const node = nodeIn(graph, raw);
      if (node.sealed || !node.container) throw new Error("expected a collection");
      return node.children;
    });
    expect(states).toEqual([
      { status: "loaded" },
      { status: "unloaded" },
      { status: "reference" },
      { status: "missing", reason: "deleted upstream" },
    ]);
  });

  it("defaults a registered container with no children signal to unloaded", () => {
    // "We have not looked" is true; "it is empty" would be a guess, and the
    // predecessor's inability to tell the two apart is what every downstream
    // uncertainty flag was compensating for.
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [{ id: "root", kind: "folder", data: { title: "R", source: null } }],
        },
        makeCtx(),
      ),
    ).graph;
    const root = nodeIn(graph, "root");
    if (root.sealed || !root.container) throw new Error("expected a collection");
    expect(root.children).toEqual({ status: "unloaded" });
    expect(graph.childrenById.has(id("root"))).toBe(false);
  });

  it("carries summary through the node type, and absent summary as null", () => {
    const graph = loadSimple();
    const sub = nodeIn(graph, "sub");
    const root = nodeIn(graph, "root");
    if (sub.sealed || !sub.container) throw new Error("expected a collection");
    if (root.sealed || !root.container) throw new Error("expected a collection");
    expect(sub.summary).toEqual({ count: 4 });
    expect(root.summary).toBeNull();
  });

  it("reads an explicit null summary as no summary, not as node type input", () => {
    // Our own writer omits the key, but a reformatted document spells it out,
    // and handing `null` to a node type expecting S would seal a node for the
    // crime of having no rollup yet.
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            {
              id: "root",
              kind: "folder",
              children: [],
              summary: null,
              data: { title: "R", source: null },
            },
          ],
        },
        makeCtx(),
      ),
    ).graph;
    const root = nodeIn(graph, "root");
    if (root.sealed) throw new Error("summary null must not seal");
    if (!root.container) throw new Error("expected a collection");
    expect(root.summary).toBeNull();
  });

  it("builds the derived content index in document order", () => {
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { clip: 1, folder: 1 },
          rootIds: ["root"],
          nodes: [
            {
              id: "root",
              kind: "folder",
              children: ["one", "two"],
              data: { title: "R", source: null },
            },
            { id: "one", kind: "clip", data: { name: "One", asset: "shared" } },
            { id: "two", kind: "clip", data: { name: "Two", asset: "shared" } },
          ],
        },
        makeCtx(),
      ),
    ).graph;
    expect(graph.placementsByContentKey.get("shared")).toEqual([
      id("one"),
      id("two"),
    ]);
  });

  it("reports migrations in the load report", () => {
    migrationLog.length = 0;
    const report = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1, note: 1 },
          rootIds: ["root"],
          nodes: [
            {
              id: "root",
              kind: "folder",
              children: ["n"],
              data: { title: "R", source: null },
            },
            { id: "n", kind: "note", data: { body: "hi" } },
          ],
        },
        makeCtx(),
      ),
    ).report;
    expect(report.migrated).toEqual([
      { nodeId: id("n"), kind: "note", from: 1, to: 3 },
    ]);
    expect(report.nodeCount).toBe(2);
  });

  it("reads an UNDECLARED schema version as current, never as 0", () => {
    // Guessing 0 replays every migration over data that may already be current,
    // which corrupts it silently and permanently. Guessing current means old
    // data fails `parse` and seals — loud and repairable.
    migrationLog.length = 0;
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: {},
          rootIds: ["root"],
          nodes: [
            {
              id: "root",
              kind: "folder",
              children: ["n"],
              data: { title: "R", source: null },
            },
            { id: "n", kind: "note", data: { text: "kept", color: "blue" } },
          ],
        },
        makeCtx(),
      ),
    ).graph;
    expect(migrationLog).toEqual([]);
    const note = nodeIn(graph, "n");
    if (note.sealed) throw new Error("note should not have sealed");
    expect(note.data).toEqual({ text: "kept", color: "blue" });
  });

  it("collects node type warnings against their node", () => {
    const report = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { clip: 1, folder: 1 },
          rootIds: ["root"],
          nodes: [
            {
              id: "root",
              kind: "folder",
              children: ["a"],
              data: { title: "R", source: null },
            },
            { id: "a", kind: "clip", data: { name: "", asset: null } },
          ],
        },
        makeCtx(),
      ),
    ).report;
    expect(report.warnings).toEqual([
      { nodeId: id("a"), issue: { path: "$.name", message: "empty clip name" } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// deserializeDocument — structural failures are fatal
// ---------------------------------------------------------------------------

describe("deserializeDocument structural failures", () => {
  function loadNodes(
    rootIds: readonly string[],
    nodes: readonly unknown[],
  ): ReturnType<typeof deserializeDocument<Types, Summary>> {
    return deserializeDocument<Types, Summary>(
      { formatVersion: 1, schemaVersions: { clip: 1, folder: 1 }, rootIds, nodes },
      makeCtx(),
    );
  }

  it("rejects an id that is empty or whitespace", () => {
    const error = expectErr(
      loadNodes(["  "], [{ id: "  ", kind: "folder", children: [], data: { title: "R", source: null } }]),
    );
    expect(error.code).toBe("invalid-node-id");
    expect(error.rawId).toBe("  ");
  });

  it("accepts ids containing any other character", () => {
    // Ids carry NO meaning in their text. The predecessor sniffed a "dup:"
    // prefix off ids documented to permit anything and silently never loaded
    // `scene/a` and `timeline-e2e,comma`.
    const graph = expectOk(
      loadNodes(
        ["scene/a"],
        [
          {
            id: "scene/a",
            kind: "folder",
            children: ["timeline-e2e,comma", "dup:x"],
            data: { title: "R", source: null },
          },
          { id: "timeline-e2e,comma", kind: "clip", data: { name: "A", asset: null } },
          { id: "dup:x", kind: "clip", data: { name: "B", asset: null } },
        ],
      ),
    ).graph;
    expect(graph.nodesById.size).toBe(3);
  });

  it("rejects a duplicate node id", () => {
    const error = expectErr(
      loadNodes(
        ["root"],
        [
          { id: "root", kind: "folder", children: [], data: { title: "R", source: null } },
          { id: "root", kind: "clip", data: { name: "A", asset: null } },
        ],
      ),
    );
    expect(error.code).toBe("duplicate-node-id");
  });

  it("rejects a dangling child reference", () => {
    const error = expectErr(
      loadNodes(
        ["root"],
        [{ id: "root", kind: "folder", children: ["ghost"], data: { title: "R", source: null } }],
      ),
    );
    expect(error.code).toBe("dangling-child");
    expect(error.nodeId).toBe(id("ghost"));
  });

  it("rejects one id appearing under two parents", () => {
    const error = expectErr(
      loadNodes(
        ["root"],
        [
          { id: "root", kind: "folder", children: ["f1", "f2"], data: { title: "R", source: null } },
          { id: "f1", kind: "folder", children: ["shared"], data: { title: "1", source: null } },
          { id: "f2", kind: "folder", children: ["shared"], data: { title: "2", source: null } },
          { id: "shared", kind: "clip", data: { name: "S", asset: null } },
        ],
      ),
    );
    expect(error.code).toBe("multi-parent");
    expect(error.nodeId).toBe(id("shared"));
  });

  it("rejects the same id twice inside one children array", () => {
    const error = expectErr(
      loadNodes(
        ["root"],
        [
          { id: "root", kind: "folder", children: ["a", "a"], data: { title: "R", source: null } },
          { id: "a", kind: "clip", data: { name: "A", asset: null } },
        ],
      ),
    );
    expect(error.code).toBe("multi-parent");
  });

  it("rejects a root that is also someone's child", () => {
    const error = expectErr(
      loadNodes(
        ["root", "a"],
        [
          { id: "root", kind: "folder", children: ["a"], data: { title: "R", source: null } },
          { id: "a", kind: "folder", children: [], data: { title: "A", source: null } },
        ],
      ),
    );
    expect(error.code).toBe("multi-parent");
  });

  it("rejects a root named twice", () => {
    const error = expectErr(
      loadNodes(
        ["root", "root"],
        [{ id: "root", kind: "folder", children: [], data: { title: "R", source: null } }],
      ),
    );
    expect(error.code).toBe("duplicate-node-id");
  });

  it("rejects a root that is not in nodes", () => {
    expect(expectErr(loadNodes(["ghost"], [])).code).toBe("unknown-root");
  });

  it("rejects a root that is not a container", () => {
    const error = expectErr(
      loadNodes(["a"], [{ id: "a", kind: "clip", data: { name: "A", asset: null } }]),
    );
    expect(error.code).toBe("root-not-container");
  });

  // THESE TWO USED TO ASSERT REJECTION, and the change is deliberate. A leaf
  // kind arriving with children was the last shape failure that took the WHOLE
  // DOCUMENT down, while a node whose DATA failed to parse sealed and
  // everything around it loaded. Nothing justified the asymmetry: both are one
  // node's wire form disagreeing with this build.
  it("SEALS a leaf kind carrying a children array, and keeps the children", () => {
    const loaded = expectOk(
      loadNodes(
        ["root"],
        [
          { id: "root", kind: "folder", children: ["a"], data: { title: "R", source: null } },
          { id: "a", kind: "clip", children: ["b"], data: { name: "A", asset: null } },
          { id: "b", kind: "clip", data: { name: "B", asset: null } },
        ],
      ),
    );
    expect(loaded.report.sealed).toHaveLength(1);
    expect(loaded.report.sealed[0]?.reason).toBe("shape-mismatch");

    const bad = loaded.graph.nodesById.get(parseNodeId("a"));
    expect(bad?.sealed).toBe(true);
    // HELD AS A CONTAINER, which is the whole point. The node declared a
    // child; something has to own it.
    expect(bad?.container).toBe(true);

    // THE ASSERTION THAT MATTERS. Recording the node as a leaf would have left
    // `b` parentless, and nothing in this engine may be orphaned. Reverting the
    // `containerById.set(id, true)` fall-through fails HERE, not above.
    expect(getChildren(loaded.graph, parseNodeId("a"))).toEqual([parseNodeId("b")]);
    expect(getParent(loaded.graph, parseNodeId("b"))).toBe(parseNodeId("a"));
    // And the rest of the document is untouched.
    expect(getChildren(loaded.graph, parseNodeId("root"))).toEqual([parseNodeId("a")]);
  });

  it("SEALS a leaf kind carrying a childrenState", () => {
    const loaded = expectOk(
      loadNodes(
        ["root"],
        [
          { id: "root", kind: "folder", children: ["a"], data: { title: "R", source: null } },
          { id: "a", kind: "clip", childrenState: "unloaded", data: { name: "A", asset: null } },
        ],
      ),
    );
    expect(loaded.report.sealed).toHaveLength(1);
    expect(loaded.report.sealed[0]?.reason).toBe("shape-mismatch");
    const bad = loaded.graph.nodesById.get(parseNodeId("a"));
    expect(bad?.sealed).toBe(true);
    // The declared load state survives, so a round trip through seal does
    // not forget that the subtree was never fetched.
    expect(bad?.sealed === true ? bad.children?.status : null).toBe("unloaded");
  });

  it("still REJECTS a shape mismatch when the consumer asked for strictness", () => {
    // A shape mismatch routes through `onParseFailure`, because a consumer who
    // said "reject on a content failure at ingress" means this too. Seal
    // is the DEFAULT, not the only behaviour.
    const error = expectErr(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { clip: 1, folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["a"], data: { title: "R", source: null } },
            { id: "a", kind: "clip", children: [], data: { name: "A", asset: null } },
          ],
        },
        { ...makeCtx(), onParseFailure: "reject" },
      ),
    );
    expect(error.code).toBe("ingress-rejected");
  });

  it("a document with NO shape mismatch seals nothing", () => {
    // The false-alarm floor: a healthy leaf with neither signal must still be
    // recorded as a leaf, not swept into the new container arm.
    const loaded = expectOk(
      loadNodes(
        ["root"],
        [
          { id: "root", kind: "folder", children: ["a"], data: { title: "R", source: null } },
          { id: "a", kind: "clip", data: { name: "A", asset: null } },
        ],
      ),
    );
    expect(loaded.report.sealed).toHaveLength(0);
    expect(loaded.graph.nodesById.get(parseNodeId("a"))?.container).toBe(false);
  });

  it("rejects a node unreachable from any root", () => {
    const error = expectErr(
      loadNodes(
        ["root"],
        [
          { id: "root", kind: "folder", children: [], data: { title: "R", source: null } },
          { id: "orphan", kind: "clip", data: { name: "O", asset: null } },
        ],
      ),
    );
    expect(error.code).toBe("unreachable-node");
    expect(error.nodeId).toBe(id("orphan"));
  });

  it("catches a cycle as unreachable-node, with no cycle walk", () => {
    // The forest condition is checked by COUNTING: each id appears at most once
    // as a child, roots appear as no one's child, every node is reachable. A
    // cycle among non-roots survives the first two and is caught by the third,
    // because nothing in a cycle is reachable from a root.
    const error = expectErr(
      loadNodes(
        ["root"],
        [
          { id: "root", kind: "folder", children: [], data: { title: "R", source: null } },
          { id: "x", kind: "folder", children: ["y"], data: { title: "X", source: null } },
          { id: "y", kind: "folder", children: ["x"], data: { title: "Y", source: null } },
        ],
      ),
    );
    expect(error.code).toBe("unreachable-node");
  });

  it("rejects a second owning placement of one sourceKey", () => {
    const error = expectErr(
      loadNodes(
        ["root"],
        [
          { id: "root", kind: "folder", children: ["o1", "o2"], data: { title: "R", source: null } },
          { id: "o1", kind: "folder", childrenState: "unloaded", data: { title: "1", source: "doc-7" } },
          { id: "o2", kind: "folder", childrenState: "unloaded", data: { title: "2", source: "doc-7" } },
        ],
      ),
    );
    expect(error.code).toBe("duplicate-owner");
  });

  it("permits a second placement of one sourceKey when it is a reference", () => {
    // This is the typed answer the consumer is meant to give: a reference never
    // owns, so it is structurally childless forever and the forest holds.
    const ctx = makeCtx();
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["o1", "o2"], data: { title: "R", source: null } },
            { id: "o1", kind: "folder", childrenState: "unloaded", data: { title: "1", source: "doc-7" } },
            { id: "o2", kind: "folder", childrenState: "reference", data: { title: "2", source: "doc-7" } },
          ],
        },
        ctx,
      ),
    ).graph;
    expect(graph.ownerBySourceKey.get("doc-7")).toBe(id("o1"));
    expect(findInvariantViolation(graph, ctx.registry)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Seal
// ---------------------------------------------------------------------------

describe("seal", () => {
  /** An unregistered container kind holding a registered clip. */
  function docWithUnknownKind(rawData: unknown): unknown {
    return {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1, mystery: 9 },
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", children: ["q"], data: { title: "R", source: null } },
        { id: "q", kind: "mystery", children: ["kid"], summary: { count: 2 }, data: rawData },
        { id: "kid", kind: "clip", data: { name: "Kid", asset: null } },
      ],
    };
  }

  it("seals an unregistered kind instead of failing the document", () => {
    // The alternative shipped: one refused stored clip made a document
    // unwritable forever, and since the trash bin is rewritten on every delete,
    // deleting anything at all became impossible.
    const ctx = makeCtx();
    const loaded = expectOk(
      deserializeDocument<Types, Summary>(docWithUnknownKind({ any: "shape" }), ctx),
    );
    const node = nodeIn(loaded.graph, "q");
    if (!node.sealed) throw new Error("expected seal");
    expect(node.reason).toBe("unknown-kind");
    expect(node.kind).toBe("mystery");
    expect(loaded.report.sealed).toHaveLength(1);
    expect(findInvariantViolation(loaded.graph, ctx.registry)).toBeNull();
  });

  it("keeps a sealed node's id, position, children and summary", () => {
    const graph = expectOk(
      deserializeDocument<Types, Summary>(docWithUnknownKind({ any: "shape" }), makeCtx()),
    ).graph;
    // Position: still the root's child, in place.
    expect(graph.childrenById.get(id("root"))).toEqual([id("q")]);
    // Children: still addressable and still parented, so a child can be moved
    // out of a node whose kind this build cannot read.
    expect(graph.childrenById.get(id("q"))).toEqual([id("kid")]);
    expect(graph.parentById.get(id("kid"))).toBe(id("q"));
    const node = nodeIn(graph, "q");
    if (!node.sealed) throw new Error("expected seal");
    expect(node.children).toEqual({ status: "loaded" });
    expect(node.summary).toEqual({ count: 2 });
    expect(node.schemaVersion).toBe(9);
  });

  it("keeps `raw` byte-exact — the same value, not a copy", () => {
    const payload = { deeply: { nested: [1, 2, 3] } };
    const graph = expectOk(
      deserializeDocument<Types, Summary>(docWithUnknownKind(payload), makeCtx()),
    ).graph;
    const node = nodeIn(graph, "q");
    if (!node.sealed) throw new Error("expected seal");
    expect(node.raw).toBe(payload);
  });

  it("seals a failed parse of a REGISTERED kind", () => {
    const loaded = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { clip: 1, folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["a"], data: { title: "R", source: null } },
            { id: "a", kind: "clip", data: { name: 42 } },
          ],
        },
        makeCtx(),
      ),
    );
    const node = nodeIn(loaded.graph, "a");
    if (!node.sealed) throw new Error("expected seal");
    expect(node.reason).toBe("parse-failed");
    // container comes from the REGISTRY for a registered kind, so a sealed
    // leaf carries no children state at all.
    expect(node.container).toBe(false);
    expect(node.children).toBeNull();
  });

  it("seals a node whose SUMMARY fails its node type, keeping it raw", () => {
    // A failed summary is per-node content, not a malformed document. The node
    // stays movable and deletable and its raw summary survives.
    const loaded = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["s"], data: { title: "R", source: null } },
            {
              id: "s",
              kind: "folder",
              childrenState: "unloaded",
              summary: { count: "four" },
              data: { title: "S", source: null },
            },
          ],
        },
        makeCtx(),
      ),
    );
    const node = nodeIn(loaded.graph, "s");
    if (!node.sealed) throw new Error("expected seal");
    expect(node.reason).toBe("parse-failed");
    expect(node.issues[0]?.path).toBe("$.summary.count");
    expect(node.summary).toEqual({ count: "four" });
    expect(node.children).toEqual({ status: "unloaded" });
  });

  it("honours onUnknownKind: reject", () => {
    const error = expectErr(
      deserializeDocument<Types, Summary>(
        docWithUnknownKind({}),
        makeCtx({ onUnknownKind: "reject" }),
      ),
    );
    expect(error.code).toBe("ingress-rejected");
    expect(error.ingress?.[0]?.reason).toBe("unknown-kind");
    expect(error.nodeId).toBe(id("q"));
  });

  it("honours onParseFailure: reject", () => {
    const error = expectErr(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { clip: 1, folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["a"], data: { title: "R", source: null } },
            { id: "a", kind: "clip", data: { name: 42 } },
          ],
        },
        makeCtx({ onParseFailure: "reject" }),
      ),
    );
    expect(error.code).toBe("ingress-rejected");
    expect(error.ingress?.[0]?.reason).toBe("parse-failed");
  });

  it("reports a rejected summary as summary-parse-failed, not ingress-rejected", () => {
    const error = expectErr(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            {
              id: "root",
              kind: "folder",
              children: [],
              summary: { count: "nope" },
              data: { title: "R", source: null },
            },
          ],
        },
        makeCtx({ onParseFailure: "reject" }),
      ),
    );
    expect(error.code).toBe("summary-parse-failed");
  });

  it("does not let a sealed node claim ownership of a sourceKey", () => {
    // `sourceKey` comes from a node type that by definition did not run, so a
    // sealed node cannot be an owner and cannot conflict with one.
    const ctx = makeCtx();
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["good", "bad"], data: { title: "R", source: null } },
            { id: "good", kind: "folder", childrenState: "unloaded", data: { title: "G", source: "doc-7" } },
            { id: "bad", kind: "folder", childrenState: "unloaded", data: { title: 42, source: "doc-7" } },
          ],
        },
        ctx,
      ),
    ).graph;
    expect(graph.ownerBySourceKey.get("doc-7")).toBe(id("good"));
    expect(findInvariantViolation(graph, ctx.registry)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// serializeGraph
// ---------------------------------------------------------------------------

describe("serializeGraph", () => {
  it("round-trips a graph unchanged", () => {
    const ctx = makeCtx();
    const first = loadSimple(ctx);
    const wire = serializeGraph(first, ctx);
    const second = expectOk(deserializeDocument<Types, Summary>(wire, ctx)).graph;

    expect(serializeGraph(second, ctx)).toEqual(wire);
    expect([...second.nodesById.keys()]).toEqual([...first.nodesById.keys()]);
    expect([...second.childrenById.entries()]).toEqual([
      ...first.childrenById.entries(),
    ]);
    expect(findInvariantViolation(second, ctx.registry)).toBeNull();
  });

  it("writes formatVersion 1 and the REGISTRY's version for every kind", () => {
    const ctx = makeCtx();
    const wire = serializeGraph(loadSimple(ctx), ctx);
    expect(wire.formatVersion).toBe(1);
    expect(wire.schemaVersions).toEqual({
      clip: 1,
      folder: 1,
      note: 3,
      sparse: 1_000_000,
      hostile: 2,
    });
  });

  it("emits children for a loaded collection and childrenState otherwise", () => {
    const ctx = makeCtx();
    const wire = serializeGraph(loadSimple(ctx), ctx);
    expect(wireNode(wire, "root").children).toEqual(["a", "sub"]);
    expect(wireNode(wire, "root").childrenState).toBeUndefined();
    expect(wireNode(wire, "sub").children).toBeUndefined();
    expect(wireNode(wire, "sub").childrenState).toBe("unloaded");
  });

  it("omits the summary key when the summary is null", () => {
    const ctx = makeCtx();
    const wire = serializeGraph(loadSimple(ctx), ctx);
    expect("summary" in wireNode(wire, "root")).toBe(false);
    expect(wireNode(wire, "sub").summary).toEqual({ count: 4 });
  });

  it("re-emits a sealed node's raw data byte-exact", () => {
    const ctx = makeCtx();
    const payload = { unreadable: { by: ["this", "build"] } };
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1, mystery: 9 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["q"], data: { title: "R", source: null } },
            { id: "q", kind: "mystery", children: [], summary: { odd: true }, data: payload },
          ],
        },
        ctx,
      ),
    ).graph;
    const wire = serializeGraph(graph, ctx);
    // The SAME value, not a structural copy — a re-encode could reorder keys or
    // drop an undefined, and this document may outlive the build that can read
    // it by years.
    expect(wireNode(wire, "q").data).toBe(payload);
    expect(wireNode(wire, "q").summary).toEqual({ odd: true });
    // The version the document declared survives for a kind the registry has
    // never heard of.
    expect(wire.schemaVersions.mystery).toBe(9);
  });

  it("round-trips a sealed UNLOADED container as a container", () => {
    // The trap: an unregistered kind has no node type to declare container-ness, so
    // the wire decides. Without an explicit `childrenState: "unloaded"` this
    // node would reload as a sealed LEAF and its subtree would become
    // unreachable forever.
    const ctx = makeCtx();
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["q"], data: { title: "R", source: null } },
            { id: "q", kind: "mystery", childrenState: "unloaded", data: {} },
          ],
        },
        ctx,
      ),
    ).graph;
    const wire = serializeGraph(graph, ctx);
    expect(wireNode(wire, "q").childrenState).toBe("unloaded");

    const reloaded = expectOk(deserializeDocument<Types, Summary>(wire, ctx)).graph;
    const node = nodeIn(reloaded, "q");
    if (!node.sealed) throw new Error("expected seal");
    expect(node.container).toBe(true);
    expect(node.children).toEqual({ status: "unloaded" });
  });

  it("round-trips a sealed LEAF as a leaf", () => {
    const ctx = makeCtx();
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["q"], data: { title: "R", source: null } },
            { id: "q", kind: "mystery", data: { leafish: true } },
          ],
        },
        ctx,
      ),
    ).graph;
    const wire = serializeGraph(graph, ctx);
    expect(wireNode(wire, "q").children).toBeUndefined();
    expect(wireNode(wire, "q").childrenState).toBeUndefined();

    const node = nodeIn(
      expectOk(deserializeDocument<Types, Summary>(wire, ctx)).graph,
      "q",
    );
    if (!node.sealed) throw new Error("expected seal");
    expect(node.container).toBe(false);
    expect(node.children).toBeNull();
  });

  it("preserves the missing reason", () => {
    const ctx = makeCtx();
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["m"], data: { title: "R", source: null } },
            {
              id: "m",
              kind: "folder",
              childrenState: "missing",
              missingReason: "storage 404",
              data: { title: "M", source: null },
            },
          ],
        },
        ctx,
      ),
    ).graph;
    const wire = serializeGraph(graph, ctx);
    expect(wireNode(wire, "m").childrenState).toBe("missing");
    expect(wireNode(wire, "m").missingReason).toBe("storage 404");
  });

  it("emits an unreachable node rather than silently dropping it", () => {
    // An unreachable node is a bug the graph should never have contained, but
    // dropping it on save turns a detectable bug into data loss. Emitted, the
    // next load fails loudly with "unreachable-node".
    const ctx = makeCtx();
    const graph = loadSimple(ctx);
    const orphanId = id("orphan");
    const broken: Graph<Types, Summary> = {
      ...graph,
      nodesById: new Map(graph.nodesById).set(
        orphanId,
        nodeIn(graph, "a"),
      ),
    };
    const wire = serializeGraph(broken, ctx);
    expect(wire.nodes).toHaveLength(4);
    expect(expectErr(deserializeDocument<Types, Summary>(wire, ctx)).code).toBe(
      "unreachable-node",
    );
  });

  it("does not compute a summary, only writes the one on the node", () => {
    // Persisting an estimate compounds it on every save; refreshing a summary
    // goes through a fold and `summaryFrom`, which refuses anything but exact.
    const ctx = makeCtx();
    const wire = serializeGraph(loadSimple(ctx), ctx);
    expect(wireNode(wire, "sub").summary).toEqual({ count: 4 });
  });
});

// ---------------------------------------------------------------------------
// loadChildrenInto
// ---------------------------------------------------------------------------

describe("loadChildrenInto", () => {
  function payload(nodes: readonly unknown[], rootIds: readonly string[]): unknown {
    return {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1, note: 1 },
      rootIds,
      nodes,
    };
  }

  function simplePayload(): unknown {
    return payload(
      [
        { id: "p1", kind: "clip", data: { name: "P1", asset: null } },
        { id: "p2", kind: "folder", childrenState: "unloaded", data: { title: "P2", source: null } },
      ],
      ["p1", "p2"],
    );
  }

  it("fills an unloaded owner and keeps every invariant", () => {
    const ctx = makeCtx();
    const graph = loadSimple(ctx);
    const next = expectOk(loadChildrenInto<Types, Summary>(graph, id("sub"), simplePayload(), ctx)).graph;

    const sub = nodeIn(next, "sub");
    if (sub.sealed || !sub.container) throw new Error("expected a collection");
    expect(sub.children).toEqual({ status: "loaded" });
    expect(next.childrenById.get(id("sub"))).toEqual([id("p1"), id("p2")]);
    expect(next.parentById.get(id("p1"))).toBe(id("sub"));
    expect(next.parentById.get(id("p2"))).toBe(id("sub"));
    expect(findInvariantViolation(next, ctx.registry)).toBeNull();
  });

  it("leaves the input graph untouched", () => {
    const ctx = makeCtx();
    const graph = loadSimple(ctx);
    loadChildrenInto<Types, Summary>(graph, id("sub"), simplePayload(), ctx);
    expect(graph.nodesById.has(id("p1"))).toBe(false);
    expect(graph.childrenById.has(id("sub"))).toBe(false);
  });

  it("bumps subtreeRev on the target AND its ancestors, and nowhere else", () => {
    // Bumping only the target is the hole that made a deep change never
    // re-render an ancestor's rollup.
    const ctx = makeCtx();
    const graph = loadSimple(ctx);
    const next = expectOk(loadChildrenInto<Types, Summary>(graph, id("sub"), simplePayload(), ctx)).graph;
    expect(next.subtreeRevById.get(id("sub"))).toBe(1);
    expect(next.subtreeRevById.get(id("root"))).toBe(1);
    expect(next.subtreeRevById.get(id("a"))).toBe(0);
    // Newly arrived nodes start at 0.
    expect(next.subtreeRevById.get(id("p1"))).toBe(0);
  });

  it("accepts payload roots that are NOT containers", () => {
    const ctx = makeCtx();
    const next = expectOk(
      loadChildrenInto<Types, Summary>(
        loadSimple(ctx),
        id("sub"),
        payload([{ id: "p1", kind: "clip", data: { name: "P1", asset: null } }], ["p1"]),
        ctx,
      ),
    ).graph;
    expect(next.childrenById.get(id("sub"))).toEqual([id("p1")]);
  });

  it("RUNS MIGRATIONS on the lazy payload", () => {
    // The predecessor's hydrate path took a bare children array and silently
    // skipped migration, so a subtree loaded on demand was parsed by rules its
    // own document had already outgrown.
    migrationLog.length = 0;
    const ctx = makeCtx();
    const next = expectOk(
      loadChildrenInto<Types, Summary>(
        loadSimple(ctx),
        id("sub"),
        payload([{ id: "n", kind: "note", data: { body: "lazy" } }], ["n"]),
        ctx,
      ),
    ).graph;
    expect(migrationLog).toEqual([2, 3]);
    const note = nodeIn(next, "n");
    if (note.sealed) throw new Error("note should not have sealed");
    expect(note.data).toEqual({ text: "lazy", color: "yellow" });
  });

  it("seals a bad payload node instead of failing the load", () => {
    const ctx = makeCtx();
    const next = expectOk(
      loadChildrenInto<Types, Summary>(
        loadSimple(ctx),
        id("sub"),
        payload([{ id: "bad", kind: "clip", data: { name: 1 } }], ["bad"]),
        ctx,
      ),
    ).graph;
    const node = nodeIn(next, "bad");
    if (!node.sealed) throw new Error("expected seal");
    expect(node.reason).toBe("parse-failed");
  });

  it("can fill a sealed container", () => {
    // Its kind failed a node type, but its subtree is real and refusing to load it
    // would strand every node underneath it.
    const ctx = makeCtx();
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["q"], data: { title: "R", source: null } },
            { id: "q", kind: "mystery", childrenState: "unloaded", data: { opaque: 1 } },
          ],
        },
        ctx,
      ),
    ).graph;
    const next = expectOk(
      loadChildrenInto<Types, Summary>(
        graph,
        id("q"),
        payload([{ id: "p1", kind: "clip", data: { name: "P1", asset: null } }], ["p1"]),
        ctx,
      ),
    ).graph;
    const q = nodeIn(next, "q");
    if (!q.sealed) throw new Error("expected the node to stay sealed");
    expect(q.children).toEqual({ status: "loaded" });
    expect(q.raw).toEqual({ opaque: 1 });
    expect(next.childrenById.get(id("q"))).toEqual([id("p1")]);
    expect(findInvariantViolation(next, ctx.registry)).toBeNull();
  });

  it("rejects a graph from another engine", () => {
    const ctx = makeCtx();
    const foreign: Graph<Types, Summary> = {
      ...loadSimple(ctx),
      engineId: Symbol("other"),
    };
    expect(
      expectErr(loadChildrenInto<Types, Summary>(foreign, id("sub"), simplePayload(), ctx)).code,
    ).toBe("foreign-graph");
  });

  it("rejects an unknown target", () => {
    const ctx = makeCtx();
    expect(
      expectErr(
        loadChildrenInto<Types, Summary>(loadSimple(ctx), id("ghost"), simplePayload(), ctx),
      ).code,
    ).toBe("unknown-node");
  });

  it("rejects a leaf target", () => {
    const ctx = makeCtx();
    expect(
      expectErr(
        loadChildrenInto<Types, Summary>(loadSimple(ctx), id("a"), simplePayload(), ctx),
      ).code,
    ).toBe("not-a-container");
  });

  it("rejects every children state except unloaded", () => {
    const ctx = makeCtx();
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["r", "m"], data: { title: "R", source: null } },
            { id: "r", kind: "folder", childrenState: "reference", data: { title: "Ref", source: null } },
            {
              id: "m",
              kind: "folder",
              childrenState: "missing",
              missingReason: "gone",
              data: { title: "M", source: null },
            },
          ],
        },
        ctx,
      ),
    ).graph;

    // `reference` never owns, `loaded` is done, `missing` is a confirmed answer
    // rather than a gap.
    for (const target of ["root", "r", "m"]) {
      expect(
        expectErr(
          loadChildrenInto<Types, Summary>(graph, id(target), simplePayload(), ctx),
        ).code,
      ).toBe("target-not-unloaded");
    }
  });

  it("rejects an id that collides with the host graph, naming the ids", () => {
    const ctx = makeCtx();
    const error = expectErr(
      loadChildrenInto<Types, Summary>(
        loadSimple(ctx),
        id("sub"),
        payload([{ id: "a", kind: "clip", data: { name: "collides", asset: null } }], ["a"]),
        ctx,
      ),
    );
    expect(error.code).toBe("id-collision");
    expect(error.collidingIds).toEqual([id("a")]);
  });

  it("wraps a malformed payload, carrying the structural cause", () => {
    const ctx = makeCtx();
    const error = expectErr(
      loadChildrenInto<Types, Summary>(loadSimple(ctx), id("sub"), { formatVersion: 4 }, ctx),
    );
    expect(error.code).toBe("malformed-document");
    expect(error.cause?.code).toBe("unsupported-format-version");
  });

  it("wraps a payload whose own structure is broken", () => {
    const ctx = makeCtx();
    const error = expectErr(
      loadChildrenInto<Types, Summary>(
        loadSimple(ctx),
        id("sub"),
        payload(
          [{ id: "p1", kind: "folder", children: ["ghost"], data: { title: "P", source: null } }],
          ["p1"],
        ),
        ctx,
      ),
    );
    expect(error.code).toBe("malformed-document");
    expect(error.cause?.code).toBe("dangling-child");
  });

  it("rejects a payload that would create a second owner", () => {
    // The conflict only exists once the two documents are in one graph, so it
    // has to be checked over the MERGED graph.
    const ctx = makeCtx();
    const graph = expectOk(
      deserializeDocument<Types, Summary>(
        {
          formatVersion: 1,
          schemaVersions: { folder: 1 },
          rootIds: ["root"],
          nodes: [
            { id: "root", kind: "folder", children: ["owner", "sub"], data: { title: "R", source: null } },
            { id: "owner", kind: "folder", childrenState: "unloaded", data: { title: "O", source: "doc-7" } },
            { id: "sub", kind: "folder", childrenState: "unloaded", data: { title: "S", source: null } },
          ],
        },
        ctx,
      ),
    ).graph;
    const error = expectErr(
      loadChildrenInto<Types, Summary>(
        graph,
        id("sub"),
        payload(
          [{ id: "p1", kind: "folder", childrenState: "unloaded", data: { title: "P", source: "doc-7" } }],
          ["p1"],
        ),
        ctx,
      ),
    );
    expect(error.code).toBe("malformed-document");
    expect(error.cause?.code).toBe("duplicate-owner");
  });

  it("serializes the loaded subtree back out as part of the document", () => {
    const ctx = makeCtx();
    const next = expectOk(
      loadChildrenInto<Types, Summary>(loadSimple(ctx), id("sub"), simplePayload(), ctx),
    ).graph;
    const wire = serializeGraph(next, ctx);
    expect(wireNode(wire, "sub").children).toEqual(["p1", "p2"]);
    expect(wire.nodes).toHaveLength(5);
    const reloaded = expectOk(deserializeDocument<Types, Summary>(wire, ctx)).graph;
    expect(findInvariantViolation(reloaded, ctx.registry)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Ingress bounds — the size and depth a document is allowed to be
// ---------------------------------------------------------------------------
//
// Ported from the predecessor, where the same two bounds are `MAX_CLOSURE_
// DOCUMENTS` (500) and `BOARD_OPEN_MAX_DEPTH` (1) and both exist because an
// unbounded read had already gone wrong in production: a preview compile that
// walked `depth x breadth` sequential round trips could run past the platform's
// execution limit, and a board open billed 150 reads to correct four numbers.
// The shapes do not transfer — this engine reads one in-memory payload, not a
// document tree over the network — but the rule does, and it is stated in that
// package as plainly as it can be: refusing loudly beats running until
// something else kills you.

/** A chain `n0 -> n1 -> ... ` of `depth` containers, one root. */
function chainDoc(depth: number): unknown {
  const nodes: SerializedNode[] = [];
  for (let i = 0; i < depth; i += 1) {
    nodes.push({
      id: `n${i}`,
      kind: "folder",
      data: { title: `n${i}` },
      ...(i + 1 < depth ? { children: [`n${i + 1}`] } : { children: [] }),
    });
  }
  return { formatVersion: 1, rootIds: ["n0"], nodes };
}

/** One root folder with `count - 1` clip children. */
function flatDoc(count: number): unknown {
  const kids = Array.from({ length: count - 1 }, (_, i) => `c${i}`);
  const nodes: SerializedNode[] = [
    { id: "root", kind: "folder", data: { title: "root" }, children: kids },
  ];
  for (const kid of kids) {
    nodes.push({ id: kid, kind: "clip", data: { name: kid, asset: null } });
  }
  return { formatVersion: 1, rootIds: ["root"], nodes };
}

describe("the size bound", () => {
  it("refuses a document above the ceiling, reporting both numbers", () => {
    const error = expectErr(
      deserializeDocument<Types, Summary>(flatDoc(50), makeCtx({ maxNodes: 10 })),
    );
    expect(error.code).toBe("document-too-large");
    // Both numbers, structured. A consumer telling a person why their document
    // was refused should not have to parse them back out of the message.
    expect(error.limit).toBe(10);
    expect(error.actual).toBe(50);
  });

  it("accepts a document exactly AT the ceiling", () => {
    // The boundary in the direction that matters: a ceiling that refused the
    // document it was sized for would be off by one in the expensive
    // direction, and nothing else in this file would notice.
    const loaded = expectOk(
      deserializeDocument<Types, Summary>(flatDoc(10), makeCtx({ maxNodes: 10 })),
    );
    expect(loaded.report.nodeCount).toBe(10);
  });

  it("checks size BEFORE anything else it could fail on", () => {
    // The document is too large AND names a duplicate id. Size must win: a
    // check that ran after Pass A would be reporting a document too large from
    // inside the map it was supposed to stop being built. The only externally
    // visible proof of ordering is which error comes back.
    const doc = flatDoc(50) as { nodes: SerializedNode[] };
    doc.nodes.push({ id: "c0", kind: "clip", data: { name: "dup", asset: null } });
    const error = expectErr(
      deserializeDocument<Types, Summary>(doc, makeCtx({ maxNodes: 10 })),
    );
    expect(error.code).toBe("document-too-large");
  });

  it("refuses whole, never returning a truncated graph", () => {
    // The property the predecessor's comment is really about. A loader that
    // trimmed to the ceiling would hand back collections tagged `loaded` that
    // are missing children — which is exactly the "empty or unread?" ambiguity
    // the four-state `ChildrenState` exists to abolish, reintroduced by the
    // safety mechanism.
    const result = deserializeDocument<Types, Summary>(
      flatDoc(50),
      makeCtx({ maxNodes: 10 }),
    );
    expect(result.ok).toBe(false);
  });

  it("defaults to a ceiling no realistic document meets", () => {
    // Guards the coherence claim in `DEFAULT_MAX_NODES`: it must sit above the
    // fold cache's own sizing, or a document could load and then be too big for
    // the memo table that is supposed to serve it — two ceilings quietly
    // disagreeing, which is worse than either being wrong alone.
    expect(DEFAULT_MAX_NODES).toBeGreaterThan(16_384);
  });
});

describe("the depth bound", () => {
  it("is unbounded by default, and a deep document loads", () => {
    // Depth is opt-in precisely because this is true: every walk here uses an
    // explicit stack, so depth is a cost and not a crash, and a default
    // ceiling would refuse documents that work.
    const loaded = expectOk(
      deserializeDocument<Types, Summary>(chainDoc(500), makeCtx()),
    );
    expect(loaded.report.nodeCount).toBe(500);
  });

  it("refuses past the ceiling, naming the node it stopped at", () => {
    const error = expectErr(
      deserializeDocument<Types, Summary>(chainDoc(20), makeCtx({ maxDepth: 5 })),
    );
    expect(error.code).toBe("document-too-deep");
    expect(error.limit).toBe(5);
    expect(String(error.nodeId)).toBe("n5");
  });

  it("stops AT the ceiling rather than measuring the whole document first", () => {
    // `actual` is the ceiling plus one, not the document's true depth. That
    // difference IS the early exit: a version that walked the document and
    // then compared would report 5000 here, and would have paid for the walk
    // that the bound exists to avoid.
    const error = expectErr(
      deserializeDocument<Types, Summary>(chainDoc(5_000), makeCtx({ maxDepth: 5 })),
    );
    expect(error.actual).toBe(6);
  });

  it("counts a root as depth 1, so maxDepth 1 admits only roots", () => {
    expect(
      deserializeDocument<Types, Summary>(chainDoc(1), makeCtx({ maxDepth: 1 })).ok,
    ).toBe(true);
    expect(
      deserializeDocument<Types, Summary>(chainDoc(2), makeCtx({ maxDepth: 1 })).ok,
    ).toBe(false);
  });

  it("measures nesting, not node count — a wide document is depth 2", () => {
    // The two bounds must not be each other in disguise. 200 nodes under one
    // root passes a depth ceiling of 2 and would fail any bound that had
    // quietly become a size check.
    expect(
      deserializeDocument<Types, Summary>(flatDoc(200), makeCtx({ maxDepth: 2 })).ok,
    ).toBe(true);
  });
});

describe("the size bound across lazy loads", () => {
  // `loadSimple` is 3 nodes: root -> [a (clip), sub (unloaded folder)].
  const BASE_NODES = 3;

  function clips(prefix: string, n: number): unknown {
    return {
      formatVersion: 1,
      schemaVersions: { clip: 1 },
      rootIds: Array.from({ length: n }, (_, i) => `${prefix}${i}`),
      nodes: Array.from({ length: n }, (_, i) => ({
        id: `${prefix}${i}`,
        kind: "clip",
        data: { name: `${prefix}${i}`, asset: null },
      })),
    };
  }

  it("bounds the GRAPH, not each payload on its own", () => {
    // The bound's first version counted only the incoming document, and this is
    // the shape that made it useless: no single load is ever the one that is too
    // big. Measured before the fix — two 8-node loads under a ceiling of 10
    // produced a graph of 19. It is the same failure `MAX_CLOSURE_DOCUMENTS`
    // exists for in the predecessor, where what runs away is a closure walk
    // accumulating documents one legitimate read at a time.
    const ctx = makeCtx({ maxNodes: BASE_NODES + 1 });
    const graph = loadSimple(ctx);
    expect(graph.nodesById.size).toBe(BASE_NODES);

    const error = expectErr(
      loadChildrenInto<Types, Summary>(graph, id("sub"), clips("p", 2), ctx),
    );
    expect(error.code).toBe("malformed-document");
    expect(error.cause?.code).toBe("document-too-large");
    // The number reported is what the graph WOULD have reached, not the
    // payload's own size — the payload is 2 and would never trip a ceiling of 4
    // by itself.
    expect(error.cause?.actual).toBe(BASE_NODES + 2);
    expect(error.cause?.limit).toBe(BASE_NODES + 1);
  });

  it("admits a load that exactly fills the remaining budget", () => {
    const ctx = makeCtx({ maxNodes: BASE_NODES + 2 });
    const graph = loadSimple(ctx);
    const next = expectOk(
      loadChildrenInto<Types, Summary>(graph, id("sub"), clips("p", 2), ctx),
    ).graph;
    expect(next.nodesById.size).toBe(BASE_NODES + 2);
    expect(findInvariantViolation(next, ctx.registry)).toBeNull();
  });

  it("refuses without touching the graph it refused to grow", () => {
    // The lazy door is pure: a refusal must leave the caller exactly where it
    // was, not half-loaded. A collection that gained some of its children and
    // still claims `loaded` is the ambiguity the four states exist to remove.
    const ctx = makeCtx({ maxNodes: BASE_NODES + 1 });
    const graph = loadSimple(ctx);
    expect(loadChildrenInto<Types, Summary>(graph, id("sub"), clips("p", 2), ctx).ok).toBe(
      false,
    );
    expect(graph.nodesById.size).toBe(BASE_NODES);
    expect(childrenStateOf(graph, id("sub"))?.status).toBe("unloaded");
  });
});

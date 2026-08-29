// Third review round — three holes with one shape: a bound this package
// DOCUMENTS and then does not enforce at every door that can reach the state.
//
//   1. `parseSerializedDocument` composed two refusals with
//      `JSON.stringify(<untrusted value>)`. `JSON.parse` is ITERATIVE in V8 and
//      `JSON.stringify` is RECURSIVE, so a payload that parses fine blows the
//      stack while the engine builds the message that rejects it — a throw out
//      of a function whose whole contract is
//      `Result<SerializedDocument, StructuralError>`. It does not need an
//      exotic payload: ~6,000 levels is a 12 KB request body.
//
//   2. `EngineConfig.maxDepth` was enforced PER PAYLOAD, counted from each
//      payload's own roots, ignoring how deep the target already sat. So
//      repeated `store.load` calls walked past the ceiling without limit —
//      the identical hole `maxNodes` already closes a few lines away via
//      `existingNodeCount`.
//
//   3. The REDUCER enforced neither ceiling. Both lived only on the ingress
//      doors, so ordinary gestures grew a graph past either one, after which
//      `engine.serialize` emitted a document `engine.deserialize` refuses —
//      the engine producing documents it cannot read back.
//
// The theme is worth naming because it is the same one that produced three
// comments describing checks that did not exist: a rule enforced at one door is
// not a rule, it is a habit.
import { describe, expect, it } from "vitest";

import {
  type Issue,
  type Result,
  type ConsumerDefinedSummaryType,
  defineNodeType,
  parseNodeId,
} from "./types";
import { parseSerializedDocument } from "./serialize";
import { createEngine } from "./engine";

type Clip = Readonly<{ title: string }>;
const clipType = defineNodeType<Clip, Readonly<{ title?: string }>>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const title = record["title"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    return { ok: true, value: { title } };
  },
  serialize(data): unknown {
    return { title: data.title };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { title: edit.title ?? data.title } };
  },
});

type Folder = Readonly<{ name: string }>;
const folderType = defineNodeType<Folder, Readonly<{ name?: string }>>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const name = record["name"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize(data): unknown {
    return { name: data.name };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { name: edit.name ?? data.name } };
  },
});

const types = [clipType, folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ n: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const n = record["n"];
    if (typeof n !== "number") {
      return { ok: false, error: [{ path: "$.n", message: "n" }] };
    }
    return { ok: true, value: { n } };
  },
  serialize(value): unknown {
    return { n: value.n };
  },
};

function makeEngine(config?: Readonly<{ maxNodes?: number; maxDepth?: number }>) {
  return createEngine<Types, Summary, {}>({
    types,
    summary,
    folds: {},
    ...(config?.maxNodes === undefined ? {} : { maxNodes: config.maxNodes }),
    ...(config?.maxDepth === undefined ? {} : { maxDepth: config.maxDepth }),
  });
}

/** A value that `JSON.parse` builds happily and `JSON.stringify` cannot walk. */
function deeplyNested(levels: number): unknown {
  return JSON.parse("[".repeat(levels) + "1" + "]".repeat(levels));
}

// ---------------------------------------------------------------------------
// 1. Composing the refusal must not throw
// ---------------------------------------------------------------------------

describe("a refusal is composed without walking the value it refuses", () => {
  it("parses the hostile payload in the first place, which is the premise", () => {
    // If this ever throws, the rest of this block is testing nothing — V8's
    // JSON parser being iterative is the whole reason the defect exists.
    expect(() => deeplyNested(100_000)).not.toThrow();
  });

  it("returns a Result for a deeply nested formatVersion", () => {
    const raw = { formatVersion: deeplyNested(100_000), rootIds: [], nodes: [] };
    let thrown: unknown = null;
    let out: ReturnType<typeof parseSerializedDocument> | null = null;
    try {
      out = parseSerializedDocument(raw);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeNull();
    expect(out?.ok).toBe(false);
    if (out && !out.ok) expect(out.error.code).toBe("unsupported-format-version");
  });

  it("returns a Result for a deeply nested childrenState", () => {
    const raw = {
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "R" },
          childrenState: deeplyNested(100_000),
        },
      ],
    };
    let thrown: unknown = null;
    try {
      const out = parseSerializedDocument(raw);
      expect(out.ok).toBe(false);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeNull();
  });

  it("holds at 6,000 levels, which is a 12 KB request body and not an exotic one", () => {
    const raw = { formatVersion: deeplyNested(6_000), rootIds: [], nodes: [] };
    expect(() => parseSerializedDocument(raw)).not.toThrow();
  });

  it("reaches the same guard through the sanctioned ingress door", () => {
    const engine = makeEngine();
    expect(() =>
      engine.deserialize({
        formatVersion: deeplyNested(100_000),
        rootIds: [],
        nodes: [],
      }),
    ).not.toThrow();
  });

  it("still names an ordinary bad value usefully, and does not echo a huge one", () => {
    const bad = parseSerializedDocument({ formatVersion: 2, rootIds: [], nodes: [] });
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.error.message).toContain("2");

    const huge = parseSerializedDocument({
      formatVersion: "x".repeat(5_000_000),
      rootIds: [],
      nodes: [],
    });
    expect(huge.ok).toBe(false);
    if (huge.ok) return;
    // A refusal a consumer will log must not carry a 5 MB payload into the log.
    expect(huge.error.message.length).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// 2. maxDepth bounds the GRAPH, not one payload
// ---------------------------------------------------------------------------

describe("maxDepth survives repeated lazy loads", () => {
  /** A one-node payload whose root is an unloaded folder. */
  function unloadedPayload(id: string) {
    return {
      formatVersion: 1 as const,
      schemaVersions: { folder: 1, clip: 1 },
      rootIds: [id],
      nodes: [
        {
          id,
          kind: "folder",
          data: { name: id },
          childrenState: "unloaded" as const,
          summary: { n: 0 },
        },
      ],
    };
  }

  it("refuses the eager door past the ceiling, which proves the ceiling is live", () => {
    const engine = makeEngine({ maxDepth: 3 });
    const tooDeep = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1, clip: 1 },
      rootIds: ["r"],
      nodes: [
        { id: "r", kind: "folder", data: { name: "r" }, children: ["l2"] },
        { id: "l2", kind: "folder", data: { name: "l2" }, children: ["l3"] },
        { id: "l3", kind: "folder", data: { name: "l3" }, children: ["l4"] },
        { id: "l4", kind: "clip", data: { title: "l4" } },
      ],
    });
    expect(tooDeep.ok).toBe(false);
    if (tooDeep.ok) return;
    expect(tooDeep.error.code).toBe("document-too-deep");
  });

  it("refuses the LAZY door at the same ceiling", () => {
    const engine = makeEngine({ maxDepth: 3 });
    const loaded = engine.deserialize(unloadedPayload("f0"));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    // f0 is depth 1. Loading into it puts f1 at depth 2, f2 at 3 — both legal.
    expect(store.load(parseNodeId("f0"), unloadedPayload("f1")).ok).toBe(true);
    expect(store.load(parseNodeId("f1"), unloadedPayload("f2")).ok).toBe(true);

    // f3 would be depth 4. The eager door refuses that shape; so must this one.
    const past = store.load(parseNodeId("f2"), unloadedPayload("f3"));
    expect(past.ok).toBe(false);
    if (past.ok) return;
    expect(past.error.code).toBe("malformed-document");
    expect(past.error.cause?.code).toBe("document-too-deep");
  });

  it("does not refuse a legal lazy load, which is the over-refusal guard", () => {
    const engine = makeEngine({ maxDepth: 10 });
    const loaded = engine.deserialize(unloadedPayload("f0"));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);
    for (let i = 1; i < 9; i += 1) {
      const result = store.load(parseNodeId(`f${i - 1}`), unloadedPayload(`f${i}`));
      expect(result.ok).toBe(true);
    }
  });

  it("is unbounded by default, so this changes nothing for a consumer who set no ceiling", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize(unloadedPayload("f0"));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);
    for (let i = 1; i < 40; i += 1) {
      expect(store.load(parseNodeId(`f${i - 1}`), unloadedPayload(`f${i}`)).ok).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The reducer obeys the same ceilings the ingress doors do
// ---------------------------------------------------------------------------

describe("the reducer cannot grow a graph the engine could not read back", () => {
  function twoNodeStore(config: Readonly<{ maxNodes?: number; maxDepth?: number }>) {
    const engine = makeEngine(config);
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1, clip: 1 },
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { name: "R" }, children: ["a"] },
        { id: "a", kind: "clip", data: { title: "A" } },
      ],
    });
    if (!loaded.ok) throw new Error("fixture failed to deserialize");
    return { engine, store: engine.createStore(loaded.value.graph) };
  }

  it("refuses an insert that would exceed maxNodes", () => {
    const { engine, store } = twoNodeStore({ maxNodes: 4 });
    const rootId = parseNodeId("root");

    // 2 nodes present; two more are legal, the third is not.
    for (let i = 0; i < 2; i += 1) {
      const ok = store.dispatch({
        type: "insert-nodes",
        toParentId: rootId,
        toIndex: 0,
        seeds: [{ kind: "clip", data: { title: `n${i}` } }],
      });
      expect(ok.ok).toBe(true);
    }

    const past = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [{ kind: "clip", data: { title: "over" } }],
    });
    expect(past.ok).toBe(false);
    if (past.ok) return;
    expect(past.error.code).toBe("would-exceed-max-nodes");

    // The point of the ceiling: what the engine emits, it can read back.
    const round = engine.deserialize(engine.serialize(store.getGraph()));
    expect(round.ok).toBe(true);
  });

  it("counts a whole seed subtree, not one node per command", () => {
    const { store } = twoNodeStore({ maxNodes: 4 });
    const past = store.dispatch({
      type: "insert-nodes",
      toParentId: parseNodeId("root"),
      toIndex: 0,
      seeds: [
        {
          kind: "folder",
          data: { name: "F" },
          children: [
            { kind: "clip", data: { title: "x" } },
            { kind: "clip", data: { title: "y" } },
          ],
        },
      ],
    });
    // 2 present + 3 arriving = 5, above 4. A per-node check would have let the
    // command through and then blown the ceiling.
    expect(past.ok).toBe(false);
    if (past.ok) return;
    expect(past.error.code).toBe("would-exceed-max-nodes");
  });

  it("refuses an insert that would exceed maxDepth", () => {
    const { engine, store } = twoNodeStore({ maxDepth: 3 });
    const rootId = parseNodeId("root");

    // root(1) -> folder(2) -> clip(3) is legal.
    const legal = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [
        { kind: "folder", data: { name: "F" }, children: [{ kind: "clip", data: { title: "x" } }] },
      ],
    });
    expect(legal.ok).toBe(true);

    // One level further is not.
    const past = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [
        {
          kind: "folder",
          data: { name: "G" },
          children: [
            {
              kind: "folder",
              data: { name: "H" },
              children: [{ kind: "clip", data: { title: "deep" } }],
            },
          ],
        },
      ],
    });
    expect(past.ok).toBe(false);
    if (past.ok) return;
    expect(past.error.code).toBe("would-exceed-max-depth");

    const round = engine.deserialize(engine.serialize(store.getGraph()));
    expect(round.ok).toBe(true);
  });

  it("refuses a MOVE that would push a subtree past maxDepth", () => {
    const engine = makeEngine({ maxDepth: 3 });
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1, clip: 1 },
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { name: "R" }, children: ["deep", "sub"] },
        // A two-level subtree sitting at depth 2.
        { id: "deep", kind: "folder", data: { name: "D" }, children: ["leaf"] },
        { id: "leaf", kind: "clip", data: { title: "L" } },
        // Another container at depth 2. Moving `deep` under it puts `leaf` at 4.
        { id: "sub", kind: "folder", data: { name: "S" }, children: [] },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    const past = store.dispatch({
      type: "move-nodes",
      nodeIds: [parseNodeId("deep")],
      toParentId: parseNodeId("sub"),
      toIndex: 0,
    });
    expect(past.ok).toBe(false);
    if (past.ok) return;
    expect(past.error.code).toBe("would-exceed-max-depth");
  });

  it("leaves an unbounded engine exactly as it was", () => {
    const { store } = twoNodeStore({});
    for (let i = 0; i < 40; i += 1) {
      const ok = store.dispatch({
        type: "insert-nodes",
        toParentId: parseNodeId("root"),
        toIndex: 0,
        seeds: [{ kind: "clip", data: { title: `n${i}` } }],
      });
      expect(ok.ok).toBe(true);
    }
    expect(store.getGraph().nodesById.size).toBe(42);
  });
});

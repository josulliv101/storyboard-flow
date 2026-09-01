// Fifth review round — the third ceiling.
//
// `maxNodes` bounds how MANY nodes a document holds; `maxDepth` bounds how
// deeply they nest. Neither says anything about how large ONE of them is, and
// `tryParseNodeId` refuses only the empty and whitespace-only string. So the
// length of a node id was the sender's to choose, without limit, under ceilings
// that read as complete.
//
// WHERE THAT AMPLIFIES is not where it looks. The graph's four maps key by the
// id, but a JavaScript string is immutable and shared by reference, so holding
// one id in four maps costs four pointers and one copy of the bytes. The memo
// table is different: `cacheKey` CONCATENATES the id into a fresh string per
// `(foldKey, nodeId, subtreeRev)` entry, and `foldCacheLimit` bounds that table
// by ENTRY COUNT — 131,072 at the default. So the document chose the per-entry
// size, and ./folds' measured "~232 bytes an entry, stable to the byte across
// three runs" was a measurement of ordinary data resting on an assumption
// nothing enforced.
//
// ENFORCED AT INGRESS AND AT MINTING BOTH. A ceiling applied only to documents
// would let `insert-nodes` put an id into the graph that `deserialize` then
// refuses — the "saves cleanly, will not load" shape this package has already
// paid for at the node ceiling and at the depth one. `mintFreshId` treats an
// over-long id from a consumer `mintId` exactly as it treats a whitespace one.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  DEFAULT_MAX_NODE_ID_LENGTH,
  defineNodeType,
  parseNodeId,
} from "../index";
import { createEngine } from "../engine";

type Folder = Readonly<{ name: string }>;
type FolderEdit = Readonly<{ name?: string }>;

const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw): Result<Folder, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const name = ({ ...raw } as Record<string, unknown>)["name"];
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize(data): unknown {
    return { name: data.name };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, name: edit.name ?? data.name } };
  },
});

const types = [folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ n: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const n = ({ ...raw } as Record<string, unknown>)["n"];
    if (typeof n !== "number") {
      return { ok: false, error: [{ path: "$.n", message: "n" }] };
    }
    return { ok: true, value: { n } };
  },
  serialize(value): unknown {
    return { n: value.n };
  },
};

type Config = Readonly<{
  maxNodeIdLength?: number | null;
  mintId?: () => string;
}>;

const makeEngine = (config: Config = {}) =>
  createEngine<Types, Summary, {}>({
    types,
    summary,
    folds: {},
    ...(config.maxNodeIdLength === undefined
      ? {}
      : { maxNodeIdLength: config.maxNodeIdLength }),
    ...(config.mintId === undefined ? {} : { mintId: config.mintId }),
  });

const node = (id: string, children: string[]) => ({
  id,
  kind: "folder",
  data: { name: "n" },
  children,
});

const rootId = parseNodeId("root");

describe("a node id has a length ceiling", () => {
  it("refuses an over-long id at each of the three places the wire names one", () => {
    // All three, because a ceiling enforced at two of them is a ceiling with a
    // door left open: `nodes[].id`, `rootIds[]` and `children[]` are each a
    // string the sender chooses.
    const long = "x".repeat(64);
    const engine = makeEngine({ maxNodeIdLength: 32 });

    const inNodes = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [node("root", [long]), node(long, [])],
    });
    expect(inNodes.ok).toBe(false);
    if (!inNodes.ok) expect(inNodes.error.code).toBe("node-id-too-long");

    const inRoots = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: [long],
      nodes: [node(long, [])],
    });
    expect(inRoots.ok).toBe(false);
    if (!inRoots.ok) expect(inRoots.error.code).toBe("node-id-too-long");

    // `children` names an id the `nodes` pass never sees, so it needs its own
    // check rather than inheriting one.
    const inChildren = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [node("root", [long])],
    });
    expect(inChildren.ok).toBe(false);
    if (!inChildren.ok) expect(inChildren.error.code).toBe("node-id-too-long");
  });

  it("carries limit and actual, like the two ceilings it joins", () => {
    const long = "x".repeat(99);
    const engine = makeEngine({ maxNodeIdLength: 32 });
    const refused = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [node("root", []), node(long, [])],
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.limit).toBe(32);
    expect(refused.error.actual).toBe(99);
    // The message reports the LENGTH rather than quoting the id, so a refusal
    // about an over-long string does not itself carry one.
    expect(refused.error.message).not.toContain("xxx");
    expect(refused.error.message).toContain("maxNodeIdLength");
  });

  it("the lazy door is bounded too, not only the eager one", () => {
    // `loadChildrenInto` runs the same `buildDocument` pass, which is what makes
    // this hold — but the two doors have diverged before (see
    // `review3-the-ceilings-bound-the-graph-not-one-payload`), so it is pinned.
    const engine = makeEngine({ maxNodeIdLength: 32 });
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "R" },
          childrenState: "unloaded" as const,
        },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    const filled = store.load(rootId, {
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["x".repeat(64)],
      nodes: [node("x".repeat(64), [])],
    });
    expect(filled.ok).toBe(false);
    if (filled.ok) return;
    expect(filled.error.code).toBe("malformed-document");
    // The structural cause is carried, so a consumer can tell an over-long id
    // apart from every other reason a payload is unusable.
    expect(filled.error.cause?.code).toBe("node-id-too-long");
  });

  it("minting cannot install an id the ingress door would refuse", () => {
    // THE ASYMMETRY THAT WOULD OTHERWISE BITE. A ceiling on documents only would
    // let a consumer `mintId` put an id into the graph that `deserialize` then
    // refuses — a document that saves cleanly and never loads again.
    const engine = makeEngine({
      maxNodeIdLength: 32,
      mintId: () => "m".repeat(200),
    });
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [node("root", [])],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const inserted = engine.applyCommand(loaded.value.graph, {
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [{ kind: "folder", data: { name: "N" } }],
    });
    // It SUCCEEDS — the fallback is what the retry falls through to, exactly as
    // it does for a `mintId` that returns whitespace. What must not happen is an
    // over-long id landing in the graph.
    expect(inserted.ok).toBe(true);
    if (!inserted.ok) return;

    for (const id of inserted.value.graph.nodesById.keys()) {
      expect(id.length).toBeLessThanOrEqual(32);
    }
    // And the round trip closes: what the engine wrote, it can read back.
    const written = engine.serialize(inserted.value.graph);
    expect(engine.deserialize(written).ok).toBe(true);
  });

  it("null opts out, and a bad ceiling is refused at construction", () => {
    const long = "x".repeat(5_000);
    const unbounded = makeEngine({ maxNodeIdLength: null });
    const loaded = unbounded.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [node("root", [long]), node(long, [])],
    });
    expect(loaded.ok).toBe(true);

    // NaN and Infinity make every `length > ceiling` comparison false, which
    // disables the limit while looking like one — the same argument `maxNodes`
    // and `maxDepth` are validated on.
    for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => makeEngine({ maxNodeIdLength: bad })).toThrow(
        "maxNodeIdLength",
      );
    }
  });

  it("the default admits every id this repo actually stores", () => {
    // The ceiling is a trust boundary, not a style rule: a read-side limit that
    // refuses a STORED document is worse than the hazard it prevents. The
    // longest id-shaped string in this repo's fixtures and app code is a
    // 64-character storage path, so the default clears real data by ~16x.
    const realistic = [
      "root",
      "timeline-mslx1z52zghx1d",
      "graph-a1b2c3d4-1f-9k2m4p",
      "timeline-gstudio001/user-project-list/project-a/Scenes/frame-1",
      "scene/a",
      "timeline-e2e,comma",
    ];
    expect(Math.max(...realistic.map((id) => id.length))).toBeLessThan(
      DEFAULT_MAX_NODE_ID_LENGTH / 8,
    );

    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [
        node("root", realistic.filter((id) => id !== "root")),
        ...realistic.filter((id) => id !== "root").map((id) => node(id, [])),
      ],
    });
    expect(loaded.ok).toBe(true);
  });
});

// Assembly tests for `createEngine` and the store.
//
// engine.ts holds almost no logic — every rule lives in the module that owns
// it, and those modules have their own suites. What can only go wrong HERE is
// wiring, so that is what these assert: which door emits a change-feed event
// and which one stays silent, whether the veto lands before or after the
// commit, whether a selection change wakes graph subscribers, and whether the
// store's stacks survive a rejected replay.
//
// Everything runs end to end against the real modules. A stubbed reducer here
// would only prove the stub, and the failure mode this file exists to catch is
// two correct modules wired together wrongly.
import { describe, expect, it } from "vitest";

import {
  type Issue,
  type Result,
  type ConsumerDefinedSummaryType,
  defineNodeType,
  parseNodeId,
} from "./types";
import { foldMonoid } from "./folds";
import { createEngine } from "./engine";
import { DEFAULT_MAX_NODES } from "./serialize";

type Clip = Readonly<{ title: string; seconds: number }>;
type ClipEdit = Readonly<{ title?: string; seconds?: number }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const title = record["title"];
    const seconds = record["seconds"];
    if (typeof title !== "string" || title.trim() === "") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    return { ok: true, value: { title: title.trim(), seconds } };
  },
  serialize(data): unknown {
    return { title: data.title, seconds: data.seconds };
  },
  applyEdit(data, edit) {
    return {
      ok: true,
      value: { title: edit.title ?? data.title, seconds: edit.seconds ?? data.seconds },
    };
  },
});

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
    const record: Record<string, unknown> = { ...raw };
    const name = record["name"];
    if (typeof name !== "string" || name.trim() === "") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    return { ok: true, value: { name: name.trim() } };
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

type Summary = Readonly<{ seconds: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(raw): Result<Summary, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const record: Record<string, unknown> = { ...raw };
    const seconds = record["seconds"];
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    return { ok: true, value: { seconds } };
  },
  serialize(value): unknown {
    return { seconds: value.seconds };
  },
};

const durationFold = foldMonoid<Types, Summary, number>({
  key: "duration",
  empty: 0,
  leaf(node) {
    return node.kind === "clip" ? node.data.seconds : 0;
  },
  concat(a, b) {
    return a + b;
  },
  placeholder(node) {
    return node.summary === null ? undefined : node.summary.seconds;
  },
});

const folds = { duration: durationFold };

function makeEngine(policyRejectsInserts = false) {
  return createEngine<Types, Summary, typeof folds>({
    types,
    summary,
    folds,
    devChecks: true,
    now: () => 1234,
    commandPolicy(command) {
      if (!policyRejectsInserts) return null;
      if (command.type !== "insert-nodes") return null;
      return { code: "policy-rejected", message: "no inserts today" };
    },
  });
}

const doc = {
  formatVersion: 1,
  schemaVersions: { clip: 1, folder: 1 },
  rootIds: ["root"],
  nodes: [
    { id: "root", kind: "folder", data: { name: "Root" }, children: ["a", "sub"] },
    { id: "a", kind: "clip", data: { title: "A", seconds: 4 } },
    {
      id: "sub",
      kind: "folder",
      data: { name: "Sub" },
      childrenState: "unloaded",
      summary: { seconds: 30 },
    },
  ],
};

const rootId = parseNodeId("root");
const clipAId = parseNodeId("a");
const subId = parseNodeId("sub");

describe("createEngine end to end", () => {
  it("throws on a duplicate kind", () => {
    expect(() =>
      createEngine({ types: [clipType, clipType] as const, summary, folds: {} }),
    ).toThrow(/duplicate node kind/);
  });

  it("runs a full dispatch / undo / redo / ingest / selection cycle", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize(doc);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.report.nodeCount).toBe(3);
    expect(engine.findInvariantViolation(loaded.value.graph)).toBeNull();

    const store = engine.createStore(loaded.value.graph);

    // 4 from the loaded clip, 30 estimated from the unloaded subtree's summary.
    const before = store.aggregate("duration", rootId);
    expect(before).toEqual({ value: 34, certainty: "estimated" });

    let graphNotifications = 0;
    let rootNotifications = 0;
    const changes: string[] = [];
    store.subscribeToGraph(() => {
      graphNotifications += 1;
    });
    store.subscribeToNode(rootId, () => {
      rootNotifications += 1;
    });
    store.subscribeToChanges((change) => {
      changes.push(`${change.source}:${change.patch.type}`);
    });

    const inserted = store.dispatch({
      type: "insert-nodes",
      seeds: [{ kind: "clip", data: { title: "B", seconds: 7 } }],
      toParentId: rootId,
      toIndex: 1,
    });
    expect(inserted.ok).toBe(true);
    expect(graphNotifications).toBe(1);
    expect(rootNotifications).toBe(1);
    expect(changes).toEqual(["command:inserted"]);
    expect(store.aggregate("duration", rootId)?.value).toBe(41);
    expect(store.canUndo()).toBe(true);

    const undone = store.undo();
    expect(undone.ok).toBe(true);
    expect(store.aggregate("duration", rootId)?.value).toBe(34);
    expect(store.canRedo()).toBe(true);
    expect(changes).toEqual(["command:inserted", "undo:removed"]);

    const redone = store.redo();
    expect(redone.ok).toBe(true);
    expect(store.aggregate("duration", rootId)?.value).toBe(41);

    // Undo with an empty stack is a rejection, never a throw.
    store.undo();
    store.undo();
    expect(store.canUndo()).toBe(false);
    const empty = store.undo();
    expect(empty.ok).toBe(false);

    // Ingest: no change-feed event, and the graph still changes.
    const feedLength = changes.length;
    const ingested = store.ingest([
      { nodeId: clipAId, kind: "clip", edit: { seconds: 40 } },
    ]);
    expect(ingested.ok).toBe(true);
    expect(changes.length).toBe(feedLength);
    expect(store.aggregate("duration", rootId)?.value).toBe(70);

    // Selection: range in document order, pruned by removal, and its own feed.
    let selectionNotifications = 0;
    store.selection.subscribe(() => {
      selectionNotifications += 1;
    });
    const graphNotificationsBeforeSelection = graphNotifications;
    store.selection.selectRange(clipAId, subId);
    expect(store.selection.get()).toEqual([clipAId, subId]);
    expect(store.selection.anchor()).toBe(clipAId);
    expect(selectionNotifications).toBe(1);
    // A selection change must not wake graph subscribers.
    expect(graphNotifications).toBe(graphNotificationsBeforeSelection);

    const removed = store.dispatch({ type: "remove-nodes", nodeIds: [clipAId] });
    expect(removed.ok).toBe(true);
    expect(store.selection.get()).toEqual([subId]);
    expect(store.selection.anchor()).toBeNull();

    // markMissing is IO landing: graph changes, change feed stays silent.
    const feedAfterRemove = changes.length;
    store.markMissing(subId, "404");
    expect(changes.length).toBe(feedAfterRemove);
    expect(store.aggregate("duration", rootId)).toEqual({
      value: 0,
      certainty: "exact",
    });

    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();

    store.destroy();
    const afterDestroy = graphNotifications;
    store.dispatch({
      type: "insert-nodes",
      seeds: [{ kind: "clip", data: { title: "C", seconds: 1 } }],
      toParentId: rootId,
      toIndex: 0,
    });
    expect(graphNotifications).toBe(afterDestroy);
  });

  it("vetoes pre-commit, leaving history untouched", () => {
    const engine = makeEngine(true);
    const loaded = engine.deserialize(doc);
    if (!loaded.ok) throw new Error("fixture failed to load");
    const store = engine.createStore(loaded.value.graph);

    const rejected = store.dispatch({
      type: "insert-nodes",
      seeds: [{ kind: "clip", data: { title: "B", seconds: 7 } }],
      toParentId: rootId,
      toIndex: 0,
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("policy-rejected");
    expect(store.canUndo()).toBe(false);
    expect(store.getGraph()).toBe(loaded.value.graph);
  });

  it("round-trips through serialize", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize(doc);
    if (!loaded.ok) throw new Error("fixture failed to load");
    const wire = engine.serialize(loaded.value.graph);
    const again = engine.deserialize(wire);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(engine.serialize(again.value.graph)).toEqual(wire);
  });

  // `Store.load` and `Engine.loadChildren` take `unknown`, not
  // `SerializedDocument`. They used to take the latter while delegating to an
  // implementation that took `unknown` and re-validated — so the public type
  // vouched for an envelope nothing had checked, on the one door a payload
  // reaches straight from IO.
  //
  // Every value below would have needed a cast to get past a `SerializedDocument`
  // parameter, and every one is REFUSED as a value. That is the property the
  // widening exists to make expressible: the signature no longer implies a check
  // that only the body performs.
  it.each([
    ["null", null],
    ["a string", "not a document"],
    ["an array", [1, 2, 3]],
    ["an object with no formatVersion", { nodes: [], rootIds: [] }],
    ["a future formatVersion", { formatVersion: 99, nodes: [], rootIds: [] }],
    ["nodes that are not an array", { formatVersion: 1, rootIds: [], nodes: "nope" }],
  ])("refuses %s at the public load door rather than trusting it", (_label, payload) => {
    const engine = makeEngine();
    const loaded = engine.deserialize(doc);
    if (!loaded.ok) throw new Error("fixture failed to load");
    const store = engine.createStore(loaded.value.graph);

    const result = store.load(subId, payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("malformed-document");
    // A refused load lands nothing: the graph is untouched and undoable state
    // is unchanged.
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.canUndo()).toBe(false);
  });

  it("loads a lazily-fetched subtree with no patch and no history entry", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize(doc);
    if (!loaded.ok) throw new Error("fixture failed to load");
    const store = engine.createStore(loaded.value.graph);

    const result = store.load(subId, {
      formatVersion: 1,
      schemaVersions: { clip: 1 },
      rootIds: ["sub-a"],
      nodes: [{ id: "sub-a", kind: "clip", data: { title: "S", seconds: 9 } }],
    });
    expect(result.ok).toBe(true);
    expect(store.canUndo()).toBe(false);
    expect(store.aggregate("duration", rootId)).toEqual({
      value: 13,
      certainty: "exact",
    });
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Config resolution for the ingress bounds
// ---------------------------------------------------------------------------
//
// These live HERE, against `createEngine`, and not beside the other bound tests
// in serialize.test.ts, because of a mistake worth recording: the first version
// of the "a consumer may raise the ceiling" test built an `EngineContext` by
// hand and asserted on the object it had just written. Replacing
// `config.maxNodes ?? DEFAULT_MAX_NODES` with a `Math.min` against the default
// — a silent cap, the precise bug the test was named after — did not fail it,
// or anything else in the package. Only a test that goes through the config
// resolution can see the config resolution.

/** `count` nodes: one root folder and `count - 1` clips. Minimal content,
 *  because what is under test is the SIZE, and every field would be paid for
 *  per node. */
function bulkDoc(count: number): unknown {
  const kids = Array.from({ length: count - 1 }, (_, i) => `c${i}`);
  const nodes: unknown[] = [
    { id: "root", kind: "folder", data: { name: "Root" }, children: kids },
  ];
  for (const kid of kids) {
    nodes.push({ id: kid, kind: "clip", data: { title: kid, seconds: 1 } });
  }
  return { formatVersion: 1, rootIds: ["root"], nodes };
}

describe("ingress bound configuration", () => {
  it("refuses a document past the DEFAULT ceiling when the consumer set none", () => {
    const engine = createEngine<Types, Summary, typeof folds>({
      types,
      summary,
      folds,
      now: () => 1234,
    });
    const result = engine.deserialize(bulkDoc(DEFAULT_MAX_NODES + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("document-too-large");
    expect(result.error.limit).toBe(DEFAULT_MAX_NODES);
  });

  it("honours a ceiling ABOVE the default rather than capping it", () => {
    // THE non-vacuous form. The document is past the default and inside the
    // consumer's own ceiling, so the two answers differ: `??` loads it, a
    // `Math.min` refuses it. Deliberately the heaviest test in this file —
    // there is no smaller document that can tell the two apart.
    const engine = createEngine<Types, Summary, typeof folds>({
      types,
      summary,
      folds,
      now: () => 1234,
      maxNodes: DEFAULT_MAX_NODES * 2,
    });
    const result = engine.deserialize(bulkDoc(DEFAULT_MAX_NODES + 1));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.report.nodeCount).toBe(DEFAULT_MAX_NODES + 1);
  }, 30_000);

  it("honours a ceiling below the default", () => {
    const engine = createEngine<Types, Summary, typeof folds>({
      types,
      summary,
      folds,
      now: () => 1234,
      maxNodes: 3,
    });
    const result = engine.deserialize(bulkDoc(10));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.limit).toBe(3);
    expect(result.error.actual).toBe(10);
  });

  it("leaves depth unbounded unless the consumer asks for a ceiling", () => {
    const engine = createEngine<Types, Summary, typeof folds>({
      types,
      summary,
      folds,
      now: () => 1234,
    });
    // The same 3-node fixture the rest of this file uses, which nests two
    // levels: it must load with no depth ceiling in force.
    expect(engine.deserialize(doc).ok).toBe(true);

    const bounded = createEngine<Types, Summary, typeof folds>({
      types,
      summary,
      folds,
      now: () => 1234,
      maxDepth: 1,
    });
    const refused = bounded.deserialize(doc);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error.code).toBe("document-too-deep");
  });
});

// ---------------------------------------------------------------------------
// The predecessor's two replay corruptions, driven end to end
// ---------------------------------------------------------------------------
//
// `collections-core/patches.ts` carries a guard whose comment names two
// corruptions that BOTH REPRODUCED before it existed. History had assumed every
// dormant patch stays applicable — true under pure linear history, and false
// the moment loading grows the graph while entries sleep on a stack:
//
//   - REDO an add whose id was meanwhile hydrated in: the apply overwrote
//     `nodesById` and inserted the id into a second children array, leaving one
//     node in two collections with `parentById` naming one.
//   - UNDO an add of a collection that was hydrated AFTER being added: the
//     apply deleted it children-and-all, orphaning the hydrated children.
//
// keel-core has the equivalent checks in `verifyInserted` / `verifyRemoved`,
// and there are unit tests over those functions. These tests are deliberately
// NOT those: they go through the store, with a real `load` landing between the
// command and its replay, because the failure mode being ported is not "the
// check is wrong" — it is "nothing called the check". A guard that exists and
// is not wired looks exactly like a guard that works, right up until it
// doesn't.

describe("dormant patches across a load", () => {
  it("refuses to redo an insert whose id arrived by loading", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize(doc);
    if (!loaded.ok) throw new Error("fixture failed to load");
    const store = engine.createStore(loaded.value.graph);

    // 1. Insert a node, then undo it. The insert is now dormant on the redo
    //    stack, holding the id it minted.
    const inserted = store.dispatch({
      type: "insert-nodes",
      seeds: [{ kind: "clip", data: { title: "B", seconds: 7 } }],
      toParentId: rootId,
      toIndex: 0,
    });
    if (!inserted.ok) throw new Error("insert failed");
    const mintedId =
      inserted.value.type === "inserted" ? inserted.value.placements[0]?.node.id : undefined;
    if (mintedId === undefined) throw new Error("no minted id");
    expect(store.undo().ok).toBe(true);

    // 2. A load brings that very id into the graph from somewhere else. This is
    //    the interleaving: nothing about the load is illegal — the id is free,
    //    because the undo removed it.
    const load = store.load(subId, {
      formatVersion: 1,
      schemaVersions: { clip: 1 },
      rootIds: [String(mintedId)],
      nodes: [{ id: String(mintedId), kind: "clip", data: { title: "S", seconds: 9 } }],
    });
    expect(load.ok).toBe(true);

    // 3. Redo must refuse. Applying it would put one id in two children arrays.
    const redone = store.redo();
    expect(redone.ok).toBe(false);
    if (redone.ok) return;
    expect(redone.error.code).toBe("node-exists");

    // The graph is untouched by the refusal, and still a forest.
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.getGraph().childrenById.get(subId)).toHaveLength(1);
  });

  it("refuses to redo a removal whose subtree grew while it slept", () => {
    // The predecessor's SECOND corruption, in the shape this engine can
    // actually reach. Insert-then-hydrate cannot produce it here: a `Seed` has
    // no way to say "unloaded", so every inserted container is `loaded`, and
    // `load` is a no-op on a loaded collection. The hole is closed by the type
    // rather than guarded. What IS reachable is the same shape one step over —
    // a removal patch that recorded an unloaded placeholder, undone, and then
    // hydrated before the redo.
    const engine = makeEngine();
    const loaded = engine.deserialize(doc);
    if (!loaded.ok) throw new Error("fixture failed to load");
    const store = engine.createStore(loaded.value.graph);

    // 1. Remove the unloaded collection. The patch records the placeholder and
    //    its summary — there is no subtree to record, which is the whole point.
    const removed = store.dispatch({
      type: "remove-nodes",
      nodeIds: [subId],
      allowUnloaded: true,
    });
    expect(removed.ok).toBe(true);

    // 2. Undo brings it back, still unloaded.
    expect(store.undo().ok).toBe(true);
    expect(store.getGraph().nodesById.has(subId)).toBe(true);

    // 3. Now it gets hydrated. Two children exist that the sleeping removal
    //    patch has never heard of.
    const load = store.load(subId, {
      formatVersion: 1,
      schemaVersions: { clip: 1 },
      rootIds: ["s1", "s2"],
      nodes: [
        { id: "s1", kind: "clip", data: { title: "S1", seconds: 1 } },
        { id: "s2", kind: "clip", data: { title: "S2", seconds: 2 } },
      ],
    });
    expect(load.ok).toBe(true);

    // 4. Redo must refuse. Applying it would delete `sub` and strand s1 and s2
    //    — parentless nodes in a graph whose one hard rule is that nothing is.
    const redone = store.redo();
    expect(redone.ok).toBe(false);
    if (redone.ok) return;
    expect(redone.error.code).toBe("node-not-empty");

    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.getGraph().nodesById.has(parseNodeId("s1"))).toBe(true);
    expect(store.getGraph().nodesById.has(parseNodeId("s2"))).toBe(true);
  });

  it("leaves the stacks usable after refusing, rather than wedging history", () => {
    // The half of "refuse" that is easy to get wrong: a refusal must not
    // consume the entry it refused, or one stale patch permanently ends undo
    // for the session. The predecessor's guard returns a Result for exactly
    // this reason — it is a decision, not an exception.
    const engine = makeEngine();
    const loaded = engine.deserialize(doc);
    if (!loaded.ok) throw new Error("fixture failed to load");
    const store = engine.createStore(loaded.value.graph);

    const removed = store.dispatch({
      type: "remove-nodes",
      nodeIds: [subId],
      allowUnloaded: true,
    });
    expect(removed.ok).toBe(true);
    expect(store.undo().ok).toBe(true);
    store.load(subId, {
      formatVersion: 1,
      schemaVersions: { clip: 1 },
      rootIds: ["s1"],
      nodes: [{ id: "s1", kind: "clip", data: { title: "S1", seconds: 1 } }],
    });

    expect(store.redo().ok).toBe(false);
    // Still offered, and still refused the same way — the refusal is a property
    // of the graph, not a one-shot that clears itself by firing.
    expect(store.canRedo()).toBe(true);
    expect(store.redo().ok).toBe(false);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
  });
});

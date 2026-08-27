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
  type SummaryCodec,
  defineNodeType,
  parseNodeId,
} from "./types";
import { foldMonoid } from "./folds";
import { createEngine } from "./engine";

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

const summary: SummaryCodec<Summary> = {
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

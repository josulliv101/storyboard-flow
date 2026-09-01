// Fourth review round — two doors that were open and one that was not there.
//
// 1. THE CEILINGS TOOK NaN. `historyLimit` refuses a value that would silently
//    mean unbounded, and argues for refusing at length. `maxNodes` and
//    `maxDepth` accepted one. `Number(process.env.MAX_NODES)` on an unset
//    variable is `NaN`, every `count > NaN` is false, and the ingress trust
//    boundary plus all three growth doors stop refusing anything — with no line
//    of code looking wrong.
//
// 2. A REFUSED UNDO WAS A DEAD END. `undo()` leaves the stack intact when
//    replay is refused, deliberately, so a transient failure does not destroy
//    the entry. But replay is ordered: one permanently inapplicable entry
//    buries every entry beneath it, and `canUndo()` goes on answering true.
//    review3-replay-cannot-install-a-duplicate-owner.test.ts already pins that
//    `canUndo()` stays true after such a refusal — correct in isolation, and
//    the reason this needed a door.
//
//    ./history exported `clearPast` from the start, documented as "the only
//    recovery for a dormant entry whose world moved". Nothing could reach it:
//    the engine holds `History` in a closure and no accessor returns one, so a
//    consumer could import the pure function and had nothing to pass it. The
//    only escape was `destroy()` plus a serialize/deserialize round trip into a
//    fresh store, losing selection and every subscription.
import { describe, expect, it, vi } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

type Clip = Readonly<{ title: string; source: string }>;
type ClipEdit = Readonly<{ title?: string }>;

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
    const source = record["source"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    if (typeof source !== "string") {
      return { ok: false, error: [{ path: "$.source", message: "source" }] };
    }
    return { ok: true, value: { title, source } };
  },
  serialize(data): unknown {
    return { title: data.title, source: data.source };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title ?? data.title } };
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
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "name" }] };
    }
    if (source !== null && source !== undefined && typeof source !== "string") {
      return { ok: false, error: [{ path: "$.source", message: "source" }] };
    }
    return { ok: true, value: { name, source: (source as string) ?? null } };
  },
  serialize(data): unknown {
    return { name: data.name, source: data.source };
  },
  applyEdit(data, edit) {
    return {
      ok: true,
      value: {
        ...data,
        name: edit.name ?? data.name,
        // `source` is editable so the deadlock fixture can hand a freed key to
        // a live node — the same shape review3 gives its `box` type.
        source: edit.source === undefined ? data.source : edit.source,
      },
    };
  },
  sourceKey(data) {
    return data.source;
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

const rootId = parseNodeId("root");

// ---------------------------------------------------------------------------
// 1. The ceilings refuse a value that would disable them
// ---------------------------------------------------------------------------

describe("a ceiling that cannot bound anything is refused at construction", () => {
  // Each of these makes every `count > ceiling` comparison false, which is the
  // ceiling being absent — and absent in the unsafe direction, since the
  // consumer asked for a bound and would get none.
  const disabling = [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["zero", 0],
    ["negative", -1],
    ["fractional", 2.5],
  ] as const;

  for (const [label, value] of disabling) {
    it(`refuses maxNodes: ${label}`, () => {
      expect(() =>
        createEngine<Types, Summary, {}>({
          types,
          summary,
          folds: {},
          maxNodes: value,
        }),
      ).toThrow(/maxNodes must be a positive integer/);
    });

    it(`refuses maxDepth: ${label}`, () => {
      expect(() =>
        createEngine<Types, Summary, {}>({
          types,
          summary,
          folds: {},
          maxDepth: value,
        }),
      ).toThrow(/maxDepth must be a positive integer/);
    });
  }

  it("still accepts an omitted ceiling, and a large named one", () => {
    // Omitting is how a consumer asks for the default (`maxNodes`) and for
    // unbounded (`maxDepth`), and that must stay silent.
    expect(() =>
      createEngine<Types, Summary, {}>({ types, summary, folds: {} }),
    ).not.toThrow();
    // A ceiling ABOVE the default is a legitimate choice — see the `??` comment
    // on `ctx.maxNodes`, which is deliberately not a `Math.min`.
    expect(() =>
      createEngine<Types, Summary, {}>({
        types,
        summary,
        folds: {},
        maxNodes: 5_000_000,
        maxDepth: 64,
      }),
    ).not.toThrow();
  });

  it("a named ceiling actually refuses, which is what the guard protects", () => {
    const engine = createEngine<Types, Summary, {}>({
      types,
      summary,
      folds: {},
      maxNodes: 2,
    });
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["c1"],
        },
        { id: "c1", kind: "clip", data: { title: "One", source: "s1" } },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    const insert = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [{ kind: "clip", data: { title: "Two", source: "s2" } }],
    });
    expect(insert.ok).toBe(false);
    if (insert.ok) return;
    expect(insert.error.code).toBe("would-exceed-max-nodes");
  });
});

// ---------------------------------------------------------------------------
// 2. A refused undo has a way out
// ---------------------------------------------------------------------------

describe("a permanently refused undo entry can be cleared", () => {
  /**
   * The reachable deadlock, built the way review3 builds it: remove the node
   * that owns a `sourceKey`, then use the NON-undoable write door to hand that
   * key to a live node. The sleeping removal patch would re-install the original
   * owner beside the new one, so replay refuses — and will refuse forever,
   * because nothing about the graph is going to take the key back.
   */
  function deadlockedStore() {
    const engine = createEngine<Types, Summary, {}>({ types, summary, folds: {} });
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["x", "z"],
        },
        {
          id: "x",
          kind: "folder",
          data: { name: "X", source: "asset-a" },
          children: [],
        },
        {
          id: "z",
          kind: "folder",
          data: { name: "Z", source: null },
          children: [],
        },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error("fixture failed to load");
    const store = engine.createStore(loaded.value.graph);

    // An earlier, perfectly good edit sits BENEATH the one that will jam, so
    // the test can show that it is buried too.
    expect(
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: parseNodeId("z"), kind: "folder", edit: { name: "Zed" } }],
      }).ok,
    ).toBe(true);

    expect(
      store.dispatch({ type: "remove-nodes", nodeIds: [parseNodeId("x")] }).ok,
    ).toBe(true);

    // The non-undoable door moves the freed key onto a live node. Legitimate —
    // nothing owns "asset-a" right now. The sleeping removal patch still does.
    const written = store.applyNonUndoableWrite([
      { nodeId: parseNodeId("z"), kind: "folder", edit: { source: "asset-a" } },
    ]);
    expect(written.ok).toBe(true);

    return { engine, store };
  }

  it("the entry is genuinely stuck, and buries the entry beneath it", () => {
    const { store } = deadlockedStore();

    // Refused, and refused again — this is not a transient condition.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const undone = store.undo();
      expect(undone.ok).toBe(false);
      // The stack is deliberately NOT popped, so the button stays enabled.
      expect(store.canUndo()).toBe(true);
    }
  });

  it("clearPast releases it, and the store keeps working", () => {
    const { engine, store } = deadlockedStore();
    expect(store.undo().ok).toBe(false);
    expect(store.canUndo()).toBe(true);

    store.clearPast();

    expect(store.canUndo()).toBe(false);
    // And the document is untouched — this forgets how it got here, nothing
    // more. `z` still holds the name the non-undoable write gave it.
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.getGraph().nodesById.has(parseNodeId("z"))).toBe(true);

    // The store is not poisoned: a new command records a new, undoable entry.
    expect(
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: parseNodeId("z"), kind: "folder", edit: { name: "Z2" } }],
      }).ok,
    ).toBe(true);
    expect(store.canUndo()).toBe(true);
    expect(store.undo().ok).toBe(true);
  });

  it("notifies graph subscribers, so a stale enabled button re-renders", () => {
    // The whole symptom is a Ctrl-Z control that is lit and inert. Clearing the
    // stack without telling anyone leaves it lit.
    const { store } = deadlockedStore();
    expect(store.undo().ok).toBe(false);

    const listener = vi.fn();
    const unsubscribe = store.subscribeToGraph(listener);
    store.clearPast();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("says nothing when there is nothing to clear", () => {
    const engine = createEngine<Types, Summary, {}>({ types, summary, folds: {} });
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: [],
        },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    const listener = vi.fn();
    store.subscribeToGraph(listener);
    store.clearPast();
    store.clearFuture();
    store.clearHistory();
    // ./history returns the same object when the stack is already empty, and
    // identity is what suppresses the notification.
    expect(listener).not.toHaveBeenCalled();
  });

  it("clearFuture drops the redo branch and keeps the undo stack", () => {
    const engine = createEngine<Types, Summary, {}>({ types, summary, folds: {} });
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["z"],
        },
        {
          id: "z",
          kind: "folder",
          data: { name: "Z", source: null },
          children: [],
        },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    expect(
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: parseNodeId("z"), kind: "folder", edit: { name: "Zed" } }],
      }).ok,
    ).toBe(true);
    expect(store.undo().ok).toBe(true);
    expect(store.canRedo()).toBe(true);

    store.clearFuture();
    expect(store.canRedo()).toBe(false);
    expect(store.canUndo()).toBe(false);

    store.clearHistory();
    expect(store.canUndo()).toBe(false);
    expect(store.canRedo()).toBe(false);
  });

  it("is a silent no-op on a destroyed store", () => {
    const { store } = deadlockedStore();
    store.destroy();
    expect(() => {
      store.clearPast();
      store.clearFuture();
      store.clearHistory();
    }).not.toThrow();
  });
});

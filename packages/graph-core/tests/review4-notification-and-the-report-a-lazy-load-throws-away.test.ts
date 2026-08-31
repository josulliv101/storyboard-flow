// Fourth review round — the live collection, and the report nobody got.
//
// 1. ONE NOTIFICATION LOOP READ A LIVE COLLECTION. `notifyAll` copies its set
//    before iterating, and says why: "a listener that unsubscribes itself (the
//    normal React teardown) mutates the set mid-iteration otherwise." The node
//    loop in `commitGraph` iterated `nodeListeners` — a MAP — directly. On a
//    set the consequence is a skipped listener; on this map it is a commit that
//    never finishes, because `subscribeToNode`'s cleanup DELETES an emptied
//    entry and re-subscribing re-inserts it at the END of the iteration order,
//    where the live iterator has not been yet.
//
//    The test below is bounded rather than a hang: it stops re-subscribing
//    after a fixed number of rounds and asserts the count, so a regression
//    fails the assertion instead of wedging the suite.
//
// 2. A LAZY LOAD COMPUTED A REPORT AND DROPPED IT. `buildDocument` produces the
//    same `LoadReport` `deserialize` returns — nodeCount, quarantined, migrated,
//    warnings — and `loadChildrenInto` used every other field of its result and
//    discarded that one, so `Store.load` answered `Result<void>`. Quarantine is
//    a SUCCESS path, so a page in which every node quarantined was
//    indistinguishable from a clean one, on the door that runs repeatedly
//    against a live document rather than once at startup.
import { describe, expect, it, vi } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

type Clip = Readonly<{ title: string }>;
type ClipEdit = Readonly<{ title?: string }>;

const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw): Result<Clip, readonly Issue[]> {
    if (typeof raw !== "object" || raw === null) {
      return { ok: false, error: [{ path: "$", message: "not an object" }] };
    }
    const title = ({ ...raw } as Record<string, unknown>)["title"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    return { ok: true, value: { title } };
  },
  serialize(data): unknown {
    return { title: data.title };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title ?? data.title } };
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

const types = [clipType, folderType] as const;
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

const makeEngine = () =>
  createEngine<Types, Summary, {}>({ types, summary, folds: {} });

const rootId = parseNodeId("root");
const clipId = parseNodeId("c1");

function loadedStore() {
  const engine = makeEngine();
  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes: [
      {
        id: "root",
        kind: "folder",
        data: { name: "Root" },
        children: ["c1", "lazy"],
      },
      { id: "c1", kind: "clip", data: { title: "One" } },
      {
        id: "lazy",
        kind: "folder",
        data: { name: "Lazy" },
        childrenState: "unloaded",
      },
    ],
  });
  if (!loaded.ok) throw new Error("fixture failed to load");
  return { engine, store: engine.createStore(loaded.value.graph) };
}

// ---------------------------------------------------------------------------
// 1. A listener that re-subscribes during notification
// ---------------------------------------------------------------------------

describe("notification reads a snapshot, not a live collection", () => {
  it("a listener that re-subscribes to its own id is notified once", () => {
    // The ordinary `useSyncExternalStore` teardown-and-resubscribe: React runs
    // it whenever the subscribe callback identity changes, which for a card
    // keyed on its own node id is every render it triggers.
    const { store } = loadedStore();

    let notifications = 0;
    let unsubscribe = (): void => {};
    // BOUNDED: without the bound this test does not fail, it hangs — and a
    // hanging test in CI reads as a timeout, not as this defect.
    const RESUBSCRIBE_LIMIT = 50;

    const listener = (): void => {
      notifications += 1;
      if (notifications > RESUBSCRIBE_LIMIT) return;
      // Tear down and re-establish, exactly as the React teardown does.
      unsubscribe();
      unsubscribe = store.subscribeToNode(clipId, listener);
    };
    unsubscribe = store.subscribeToNode(clipId, listener);

    const edited = store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipId, kind: "clip", edit: { title: "Two" } }],
    });
    expect(edited.ok).toBe(true);

    // ONE commit, one notification. Before the fix the re-inserted map entry
    // landed behind the live iterator, its rev still differed across the commit,
    // and the loop kept finding it: 51 here, and unbounded in real code.
    expect(notifications).toBe(1);
    unsubscribe();
  });

  it("a subscription created during a commit is not told about that commit", () => {
    // The other half of what snapshotting settles, and settled the same way the
    // flat sets already settle it: the new subscriber was not listening when
    // the change happened.
    const { store } = loadedStore();
    const late = vi.fn();

    const unsubscribeFirst = store.subscribeToNode(clipId, () => {
      store.subscribeToNode(rootId, late);
    });

    expect(
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipId, kind: "clip", edit: { title: "Two" } }],
      }).ok,
    ).toBe(true);

    expect(late).not.toHaveBeenCalled();
    unsubscribeFirst();
  });

  it("still notifies every ordinary subscriber, including one that unsubscribes", () => {
    // The guard must not cost the traffic it sits in front of.
    const { store } = loadedStore();
    const first = vi.fn();
    const second = vi.fn();

    const dropFirst = store.subscribeToNode(clipId, () => {
      first();
      dropFirst();
    });
    const dropSecond = store.subscribeToNode(clipId, second);

    expect(
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipId, kind: "clip", edit: { title: "Two" } }],
      }).ok,
    ).toBe(true);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    dropSecond();
  });
});

// ---------------------------------------------------------------------------
// 2. The lazy load hands back its report
// ---------------------------------------------------------------------------

describe("a lazy load reports what it quarantined", () => {
  const lazyId = parseNodeId("lazy");

  it("a clean page reports no quarantine", () => {
    const { store } = loadedStore();
    const loaded = store.load(lazyId, {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["p1", "p2"],
      nodes: [
        { id: "p1", kind: "clip", data: { title: "P1" } },
        { id: "p2", kind: "clip", data: { title: "P2" } },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.quarantined).toEqual([]);
    expect(loaded.value.nodeCount).toBe(2);
  });

  it("a page where EVERY node quarantined is not reported as clean", () => {
    // This is the whole defect. `ok: true` is right — quarantine is a success
    // path, the nodes are in the graph holding their raw bytes — but the
    // consumer had no way to learn that nothing it asked for is readable.
    const { store, engine } = loadedStore();
    const loaded = store.load(lazyId, {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["b1", "b2"],
      nodes: [
        // `title` must be a string; a number fails `parse` and quarantines.
        { id: "b1", kind: "clip", data: { title: 1 } },
        { id: "b2", kind: "clip", data: { title: 2 } },
      ],
    });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.nodeCount).toBe(2);
    expect(loaded.value.quarantined).toHaveLength(2);
    expect(loaded.value.quarantined.map((q) => q.nodeId).sort()).toEqual([
      parseNodeId("b1"),
      parseNodeId("b2"),
    ]);
    for (const failure of loaded.value.quarantined) {
      expect(failure.reason).toBe("parse-failed");
    }

    // The graph is still valid and the nodes are still there — quarantine
    // preserves bytes rather than dropping the subtree.
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(store.getGraph().nodesById.has(parseNodeId("b1"))).toBe(true);
  });

  it("the engine door returns the graph and the report together", () => {
    // Shaped like `deserialize`'s result on purpose: the two are the same
    // operation against a different destination.
    const { engine, store } = loadedStore();
    const loaded = engine.loadChildren(store.getGraph(), lazyId, {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["p1"],
      nodes: [{ id: "p1", kind: "clip", data: { title: "P1" } }],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.graph.nodesById.has(parseNodeId("p1"))).toBe(true);
    expect(loaded.value.report.nodeCount).toBe(1);
    expect(loaded.value.report.quarantined).toEqual([]);
    expect(engine.findInvariantViolation(loaded.value.graph)).toBeNull();
  });

  it("a rejected load still rejects, and reports nothing", () => {
    const { store } = loadedStore();
    const loaded = store.load(lazyId, {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["c1"],
      // `c1` is already resident, so this is an id collision, not a quarantine.
      nodes: [{ id: "c1", kind: "clip", data: { title: "dup" } }],
    });
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.code).toBe("id-collision");
  });
});

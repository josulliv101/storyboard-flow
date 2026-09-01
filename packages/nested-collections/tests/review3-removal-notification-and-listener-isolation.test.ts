// Third review round — the two tombstone defects and the throwing subscriber.
//
// All three reproduce through the PUBLIC store surface, and all three are
// regressions against a guarantee some other module states in prose:
//
//   1. `subscribeToNode` promises to fire when that node changes, and
//      disappearing is the largest change there is. The rev TOMBSTONE that
//      round two added to `applyRemoved` made the removed node's revision
//      compare EQUAL across the commit, so `commitGraph` skipped its listeners.
//      The comment in ./engine.ts still claimed "0 for an unknown node is what
//      makes a removal and an insertion both register as a change" — true
//      before the tombstone, false after it.
//
//   2. `applyInserted` honours that same tombstone (`if (!revs.has(id))`), so a
//      re-inserted id lands strictly above every rev its dead lineage cached.
//      `loadChildrenInto` wrote 0 unconditionally, which is the identical
//      fold-cache corruption round two fixed, through the other door.
//
//   3. `dispatch` is contracted to return a `Result` and never throw. One
//      consumer listener throwing escaped it — after the graph had committed
//      and history had been pushed, and BEFORE the change feed emitted, so the
//      mutation existed in memory and in undo but was never announced to the
//      persistence layer.
import { describe, expect, it } from "vitest";

import {
  type Issue,
  type Result,
  type ConsumerDefinedSummaryType,
  defineNodeType,
  parseNodeId,
} from "../types";
import { getSubtreeRev } from "../graph";
import { foldMonoid } from "../folds";
import { createEngine } from "../engine";

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
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    if (typeof seconds !== "number") {
      return { ok: false, error: [{ path: "$.seconds", message: "seconds" }] };
    }
    return { ok: true, value: { title, seconds } };
  },
  serialize(data): unknown {
    return { title: data.title, seconds: data.seconds };
  },
  applyEdit(data, edit) {
    return {
      ok: true,
      value: {
        title: edit.title ?? data.title,
        seconds: edit.seconds ?? data.seconds,
      },
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

function makeEngine() {
  return createEngine<Types, Summary, typeof folds>({
    types,
    summary,
    folds,
    devChecks: true,
    now: () => 1234,
  });
}

const rootId = parseNodeId("root");
const clipXId = parseNodeId("x");
const clipYId = parseNodeId("y");
const boxId = parseNodeId("box");

/** root(loaded) -> [x(clip 4), y(clip 2), box(folder, unloaded)] */
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
        children: ["x", "y", "box"],
      },
      { id: "x", kind: "clip", data: { title: "X", seconds: 4 } },
      { id: "y", kind: "clip", data: { title: "Y", seconds: 2 } },
      {
        id: "box",
        kind: "folder",
        data: { name: "Box" },
        childrenState: "unloaded",
        summary: { seconds: 0 },
      },
    ],
  });
  if (!loaded.ok) throw new Error("fixture failed to deserialize");
  return { engine, store: engine.createStore(loaded.value.graph) };
}

// ---------------------------------------------------------------------------
// 1. A removed node's OWN subscribers
// ---------------------------------------------------------------------------

describe("removal wakes the removed node's own subscribers", () => {
  it("bumps the removed node's revision so commitGraph sees a change", () => {
    const { store } = loadedStore();

    const before = getSubtreeRev(store.getGraph(), clipXId);
    const removed = store.dispatch({
      type: "remove-nodes",
      nodeIds: [clipXId],
    });
    expect(removed.ok).toBe(true);

    // The NUMBER must move. Equal revisions across the commit is precisely what
    // made `commitGraph` skip the listener.
    //
    // It now moves DOWN rather than up: the entry is deleted and
    // `getSubtreeRev` answers 0, the sentinel no live node ever holds. The
    // tombstone that used to be left behind had to be bumped for exactly this
    // reason — a frozen one read identical on both sides. Different is what the
    // comparison needs; higher was an artifact of keeping a row per id.
    expect(getSubtreeRev(store.getGraph(), clipXId)).not.toBe(before);
    expect(getSubtreeRev(store.getGraph(), clipXId)).toBe(0);
  });

  it("notifies the subscriber mounted on the node that was deleted", () => {
    const { store } = loadedStore();

    let xWoke = 0;
    let yWoke = 0;
    let rootWoke = 0;
    store.subscribeToNode(clipXId, () => {
      xWoke += 1;
    });
    store.subscribeToNode(clipYId, () => {
      yWoke += 1;
    });
    store.subscribeToNode(rootId, () => {
      rootWoke += 1;
    });

    const removed = store.dispatch({
      type: "remove-nodes",
      nodeIds: [clipXId],
    });
    expect(removed.ok).toBe(true);

    // The point of the fix.
    expect(xWoke).toBe(1);
    // The ancestor still wakes, as it always did.
    expect(rootWoke).toBe(1);
    // And an uninvolved sibling still does NOT — the fix must not turn a
    // targeted notification into a broadcast.
    expect(yWoke).toBe(0);
  });

  it("notifies subscribers on every node of a removed SUBTREE, not just its root", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { name: "Root" }, children: ["dir"] },
        { id: "dir", kind: "folder", data: { name: "Dir" }, children: ["deep"] },
        { id: "deep", kind: "clip", data: { title: "Deep", seconds: 1 } },
      ],
    });
    if (!loaded.ok) throw new Error("fixture failed to deserialize");
    const store = engine.createStore(loaded.value.graph);

    const woke = new Set<string>();
    for (const raw of ["root", "dir", "deep"]) {
      store.subscribeToNode(parseNodeId(raw), () => {
        woke.add(raw);
      });
    }

    const removed = store.dispatch({
      type: "remove-nodes",
      nodeIds: [parseNodeId("dir")],
    });
    expect(removed.ok).toBe(true);

    // A card mounted on `deep` is just as gone as one mounted on `dir`.
    expect([...woke].sort()).toEqual(["deep", "dir", "root"]);
  });

  it("still wakes the node when it comes back via undo", () => {
    const { store } = loadedStore();
    store.dispatch({ type: "remove-nodes", nodeIds: [clipXId] });

    let xWoke = 0;
    store.subscribeToNode(clipXId, () => {
      xWoke += 1;
    });

    const undone = store.undo();
    expect(undone.ok).toBe(true);
    expect(xWoke).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. The tombstone must survive a lazy load
// ---------------------------------------------------------------------------

describe("loadChildrenInto seeds strictly above a removal tombstone", () => {
  it("does not serve the dead lineage's cached fold after a reused id arrives", () => {
    const { engine, store } = loadedStore();

    // Two cached generations for x: rev 0 -> 4, rev 1 -> 10.
    expect(store.aggregate("duration", clipXId)?.value).toBe(4);
    store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipXId, kind: "clip", edit: { seconds: 10 } }],
    });
    expect(store.aggregate("duration", clipXId)?.value).toBe(10);

    store.dispatch({ type: "remove-nodes", nodeIds: [clipXId] });
    const tombstone = getSubtreeRev(store.getGraph(), clipXId);

    // The server moved x into the not-yet-loaded folder, with new content.
    const loaded = store.load(boxId, {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["x"],
      nodes: [{ id: "x", kind: "clip", data: { title: "X", seconds: 999 } }],
    });
    expect(loaded.ok).toBe(true);

    // The arriving id must not land on a revision the dead lineage cached.
    expect(getSubtreeRev(store.getGraph(), clipXId)).toBeGreaterThan(tombstone);

    // The cached read and the uncached read must agree. This is the assertion
    // the defect fails: the store answered 4 while the truth was 999.
    const graph = store.getGraph();
    expect(store.aggregate("duration", clipXId)?.value).toBe(999);
    expect(engine.aggregate(graph, "duration", clipXId)?.value).toBe(999);
    expect(store.aggregate("duration", boxId)?.value).toBe(
      engine.aggregate(graph, "duration", boxId)?.value,
    );
  });

  it("keeps agreeing after further edits to the reloaded node", () => {
    const { engine, store } = loadedStore();

    store.aggregate("duration", clipXId);
    store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipXId, kind: "clip", edit: { seconds: 10 } }],
    });
    store.aggregate("duration", clipXId);
    store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipXId, kind: "clip", edit: { seconds: 20 } }],
    });
    store.aggregate("duration", clipXId);

    store.dispatch({ type: "remove-nodes", nodeIds: [clipXId] });
    store.load(boxId, {
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["x"],
      nodes: [{ id: "x", kind: "clip", data: { title: "X", seconds: 999 } }],
    });

    // The defect does not self-heal: each later edit lands on the NEXT
    // already-poisoned rev, so the store replays 4 / 10 / 20 in order.
    for (const seconds of [111, 222]) {
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipXId, kind: "clip", edit: { seconds } }],
      });
      const graph = store.getGraph();
      expect(store.aggregate("duration", clipXId)?.value).toBe(seconds);
      expect(engine.aggregate(graph, "duration", clipXId)?.value).toBe(seconds);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. One consumer's throwing listener must not derail the engine
// ---------------------------------------------------------------------------

describe("a throwing subscriber cannot break the commit sequence", () => {
  function silenceConsoleError() {
    const original = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]): void => {
      calls.push(args);
    };
    return {
      calls,
      restore: () => {
        console.error = original;
      },
    };
  }

  it("does not let a graph listener throw out of dispatch, and still runs the rest", () => {
    const { store } = loadedStore();
    const spy = silenceConsoleError();
    try {
      const ran: string[] = [];
      store.subscribeToGraph(() => {
        ran.push("first");
      });
      store.subscribeToGraph(() => {
        ran.push("throws");
        throw new Error("consumer listener blew up");
      });
      store.subscribeToGraph(() => {
        ran.push("third");
      });
      let changeFeedFired = 0;
      store.subscribeToChanges(() => {
        changeFeedFired += 1;
      });

      const result = store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipXId, kind: "clip", edit: { seconds: 7 } }],
      });

      // The contract: a Result, not an exception.
      expect(result.ok).toBe(true);
      // A listener that throws must not starve the ones after it.
      expect(ran).toEqual(["first", "throws", "third"]);
      // And the persistence feed must still be told about a mutation that
      // actually committed. This is the half that loses data.
      expect(changeFeedFired).toBe(1);
      // Swallowed, but never silently.
      expect(spy.calls.length).toBeGreaterThan(0);
    } finally {
      spy.restore();
    }
  });

  it("isolates a throwing NODE listener", () => {
    const { store } = loadedStore();
    const spy = silenceConsoleError();
    try {
      const ran: string[] = [];
      store.subscribeToNode(clipXId, () => {
        ran.push("throws");
        throw new Error("card blew up");
      });
      store.subscribeToNode(clipXId, () => {
        ran.push("sibling");
      });
      let graphWoke = 0;
      store.subscribeToGraph(() => {
        graphWoke += 1;
      });

      const result = store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipXId, kind: "clip", edit: { seconds: 7 } }],
      });

      expect(result.ok).toBe(true);
      expect(ran).toEqual(["throws", "sibling"]);
      // The node loop runs BEFORE graph subscribers; a throw there must not
      // skip them.
      expect(graphWoke).toBe(1);
    } finally {
      spy.restore();
    }
  });

  it("isolates a throwing CHANGE-FEED listener", () => {
    const { store } = loadedStore();
    const spy = silenceConsoleError();
    try {
      const ran: string[] = [];
      store.subscribeToChanges(() => {
        ran.push("throws");
        throw new Error("persistence blew up");
      });
      store.subscribeToChanges(() => {
        ran.push("second");
      });

      const result = store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipXId, kind: "clip", edit: { seconds: 7 } }],
      });

      expect(result.ok).toBe(true);
      expect(ran).toEqual(["throws", "second"]);
    } finally {
      spy.restore();
    }
  });

  it("isolates a throwing SELECTION listener", () => {
    const { store } = loadedStore();
    const spy = silenceConsoleError();
    try {
      const ran: string[] = [];
      store.selection.subscribe(() => {
        ran.push("throws");
        throw new Error("selection view blew up");
      });
      store.selection.subscribe(() => {
        ran.push("second");
      });

      expect(() => {
        store.selection.set([clipXId]);
      }).not.toThrow();
      expect(ran).toEqual(["throws", "second"]);
    } finally {
      spy.restore();
    }
  });

  it("still surfaces a throwing listener during undo and redo", () => {
    const { store } = loadedStore();
    const spy = silenceConsoleError();
    try {
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipXId, kind: "clip", edit: { seconds: 7 } }],
      });
      store.subscribeToGraph(() => {
        throw new Error("blew up");
      });

      const undone = store.undo();
      expect(undone.ok).toBe(true);
      const redone = store.redo();
      expect(redone.ok).toBe(true);
    } finally {
      spy.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 4. The same guarantee, through the MOVE door
// ---------------------------------------------------------------------------
//
// Defect 1 above was `subscribeToNode` staying silent when a node was REMOVED,
// because the rev tombstone compared equal across the commit. A move had the
// identical hole from the other direction: `applyMoved` bumped the source chain
// and the destination chain and never the node in between, so the dragged
// node's own revision did not move and `commitGraph` skipped its listeners.
//
// It survived because folds are GRAPH-BLIND — a moved node's own value really
// does not change, so no aggregate was ever wrong. What was wrong is anything
// rendering POSITION: a breadcrumb, an inspector naming the parent, the "3 of 7"
// a consumer reads out of `placementsByContentKey`. A tree view hides it
// entirely, because the parent re-renders and React reorders the children for
// free — which is why this needs a test that watches the NODE, not the list.
//
// The rule ./engine states over that loop, and the one these pin:
// EVERY MUTATION MOVES THE REVISION OF EVERY NODE IT AFFECTS.

const folderAId = parseNodeId("a");
const folderBId = parseNodeId("b");
const clipPId = parseNodeId("p");
const clipQId = parseNodeId("q");

/** root -> [ a(loaded)[p, q], b(loaded)[] ] — two real destinations. */
function twoFolderStore() {
  const engine = makeEngine();
  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { clip: 1, folder: 1 },
    rootIds: ["root"],
    nodes: [
      { id: "root", kind: "folder", data: { name: "Root" }, children: ["a", "b"] },
      { id: "a", kind: "folder", data: { name: "A" }, children: ["p", "q"] },
      { id: "b", kind: "folder", data: { name: "B" }, children: [] },
      { id: "p", kind: "clip", data: { title: "P", seconds: 4 } },
      { id: "q", kind: "clip", data: { title: "Q", seconds: 2 } },
    ],
  });
  if (!loaded.ok) throw new Error("fixture failed to deserialize");
  return { engine, store: engine.createStore(loaded.value.graph) };
}

describe("a moved node's own subscribers fire", () => {
  it("bumps the moved node's revision, which is what commitGraph compares", () => {
    const { store } = twoFolderStore();
    const before = getSubtreeRev(store.getGraph(), clipPId);
    const moved = store.dispatch({
      type: "move-nodes",
      nodeIds: [clipPId],
      toParentId: folderAId,
      toIndex: 1,
    });
    expect(moved.ok).toBe(true);
    expect(getSubtreeRev(store.getGraph(), clipPId)).toBeGreaterThan(before);
  });

  it("wakes the dragged node on a reorder inside one parent", () => {
    const { store } = twoFolderStore();
    let dragged = 0;
    let parent = 0;
    store.subscribeToNode(clipPId, () => {
      dragged += 1;
    });
    store.subscribeToNode(folderAId, () => {
      parent += 1;
    });

    const moved = store.dispatch({
      type: "move-nodes",
      nodeIds: [clipPId],
      toParentId: folderAId,
      toIndex: 1,
    });
    expect(moved.ok).toBe(true);

    // BOTH. The parent alone is exactly what the defect looked like.
    expect(dragged).toBe(1);
    expect(parent).toBeGreaterThan(0);
  });

  it("wakes the node and BOTH chains on a cross-parent move", () => {
    const { store } = twoFolderStore();
    let dragged = 0;
    let source = 0;
    let destination = 0;
    store.subscribeToNode(clipPId, () => {
      dragged += 1;
    });
    store.subscribeToNode(folderAId, () => {
      source += 1;
    });
    store.subscribeToNode(folderBId, () => {
      destination += 1;
    });

    const moved = store.dispatch({
      type: "move-nodes",
      nodeIds: [clipPId],
      toParentId: folderBId,
      toIndex: 0,
    });
    expect(moved.ok).toBe(true);

    expect(dragged).toBe(1);
    expect(source).toBe(1);
    expect(destination).toBe(1);
  });

  it("wakes every node of a multi-select move exactly once", () => {
    const { store } = twoFolderStore();
    let p = 0;
    let q = 0;
    store.subscribeToNode(clipPId, () => {
      p += 1;
    });
    store.subscribeToNode(clipQId, () => {
      q += 1;
    });

    const moved = store.dispatch({
      type: "move-nodes",
      nodeIds: [clipPId, clipQId],
      toParentId: folderBId,
      toIndex: 0,
    });
    expect(moved.ok).toBe(true);

    // ONCE each. The destination walk short-circuits at the shared parent, so
    // neither node's chain is walked or incremented twice.
    expect(p).toBe(1);
    expect(q).toBe(1);
  });

  it("wakes it again when the move is UNDONE", () => {
    const { store } = twoFolderStore();
    const moved = store.dispatch({
      type: "move-nodes",
      nodeIds: [clipPId],
      toParentId: folderBId,
      toIndex: 0,
    });
    expect(moved.ok).toBe(true);

    // Subscribed AFTER the move, so this counts the undo alone.
    let dragged = 0;
    store.subscribeToNode(clipPId, () => {
      dragged += 1;
    });
    const undone = store.undo();
    expect(undone.ok).toBe(true);
    expect(dragged).toBe(1);
  });
});

// F1 regression — the fold cache must not serve a dead lineage's values after
// a node is removed and restored by undo.
//
// `subtreeRevById` is the fold cache's only invalidation mechanism: an entry
// keyed (foldKey, nodeId, rev) is meant to be UNREACHABLE once the node's rev
// moves past it. Removal used to DELETE the node's rev entry, so a restored id
// restarted at 0 -> 1 and walked back through revs the dead lineage had already
// cached under different data. This asserts the store's cached aggregate always
// agrees with `engine.aggregate`, which is uncached by construction.
import { describe, expect, it } from "vitest";

import {
  type Issue,
  type Result,
  type ConsumerDefinedSummaryType,
  defineNodeType,
  parseNodeId,
} from "../types";
import { foldMonoid } from "../folds";
import { createEngine } from "../engine";
import { getSubtreeRev } from "../graph";

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
});

const folds = { duration: durationFold };

const doc = {
  formatVersion: 1,
  schemaVersions: { clip: 1, folder: 1 },
  rootIds: ["root"],
  nodes: [
    { id: "root", kind: "folder", data: { name: "Root" }, children: ["a"] },
    { id: "a", kind: "clip", data: { title: "A", seconds: 4 } },
  ],
};

const rootId = parseNodeId("root");
const clipAId = parseNodeId("a");

describe("fold cache after remove -> undo", () => {
  it("does not serve a stale aggregate after edit, edit, remove, undo", () => {
    const engine = createEngine<Types, Summary, typeof folds>({
      types,
      summary,
      folds,
      devChecks: true,
    });
    const loaded = engine.deserialize(doc);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    const store = engine.createStore(loaded.value.graph);
    const trace: string[] = [];
    const snap = (label: string): void => {
      const g = store.getGraph();
      trace.push(
        `${label}: rev(a)=${getSubtreeRev(g, clipAId)} rev(root)=${getSubtreeRev(g, rootId)} ` +
          `cached=${String(store.aggregate("duration", rootId)?.value)} ` +
          `uncached=${String(engine.aggregate(g, "duration", rootId)?.value)}`,
      );
    };

    // rev(a) = 0. Caches (duration, a, 0) = 4.
    snap("initial");

    store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipAId, kind: "clip", edit: { seconds: 10 } }],
    });
    // rev(a) = 1. Caches (duration, a, 1) = 10.
    snap("after edit to 10");

    store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipAId, kind: "clip", edit: { seconds: 99 } }],
    });
    // rev(a) = 2. Caches (duration, a, 2) = 99.
    snap("after edit to 99");

    const removed = store.dispatch({ type: "remove-nodes", nodeIds: [clipAId] });
    expect(removed.ok).toBe(true);
    snap("after remove");

    const undone = store.undo();
    expect(undone.ok).toBe(true);
    // `a` is back with seconds 99. Before the fix its rev restarted at 0 and
    // bumped to 1, making the rev-1 entry (10) reachable against rev-2 data.
    snap("after undo");

    store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipAId, kind: "clip", edit: { seconds: 50 } }],
    });
    // Before the fix this compounds rather than self-healing: rev(a) climbs back
    // to 2, where the DEAD lineage cached 99, so the store answers 99 for 50.
    snap("after post-undo edit to 50");

    // eslint-disable-next-line no-console
    for (const line of ["F1 TRACE:", ...trace]) console.log(line);

    const g = store.getGraph();
    // The aggregate at the ROOT is wrong, not merely the leaf read: the root's
    // own rev is fresh so it recomputes, then hits the stale child entry.
    expect(store.aggregate("duration", rootId)?.value).toBe(
      engine.aggregate(g, "duration", rootId)?.value,
    );
    expect(store.aggregate("duration", clipAId)?.value).toBe(50);
  });
});

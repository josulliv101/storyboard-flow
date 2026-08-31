// Third review round — one ownership rule, decided in three places.
//
// `sourceKey` enables the single-owner invariant: two placements of one stored
// subtree are incoherent under lazy loading, so the engine refuses the second
// non-`reference` one. Three call sites decided who counts as an owner, and
// they did not agree about LEAVES:
//
//   graph.ts    isOwningPlacement   `state === null || stateOwnsSubtree(state)`
//                                   -> a leaf (state null) IS an owner
//   commands.ts owningSourceKey     `if (node.container && !stateOwnsSubtree(...))`
//                                   -> the check is skipped for a leaf, so it IS
//   serialize.ts findDuplicateOwner `if (state === null || !stateOwnsSubtree(state))`
//                                   -> a leaf is SKIPPED, so it is NOT
//
// Two against one, and the one was right. Measured before the fix, with two
// leaf clips sharing a source:
//
//   deserialize            -> ok
//   findInvariantViolation -> duplicate-owner       (on the graph ingress built)
//   edit either clip       -> refused duplicate-owner
//   insert a third         -> refused duplicate-owner
//
// A document that loads, fails its own audit, and cannot be repaired through
// the API. Leaves are now exempt everywhere, through ONE predicate:
//
//   - `sourceKey` is documented as "same stored SUBTREE", and its rejection
//     tells the consumer to "insert a `reference` instead". A leaf has no
//     children state, so it can never BE a reference placement — the rule was
//     unsatisfiable for leaves, with no escape hatch.
//   - `contentKey` already covers leaf-level "same asset", which is the
//     question a repeated clip is actually asking.
//   - Tightening the other way would have made a stored document stop loading,
//     which is the failure this package's quarantine design exists to prevent.
import { describe, expect, it } from "vitest";

import {
  type Issue,
  type Result,
  type ConsumerDefinedSummaryType,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

/** A LEAF kind that declares `sourceKey` — nothing else in the suite does. */
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
  sourceKey(data) {
    return data.source;
  },
});

/** A CONTAINER kind that declares `sourceKey` — the case the rule is FOR. */
type Folder = Readonly<{ name: string; source: string | null }>;
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
    return { ok: true, value: { ...data, name: edit.name ?? data.name } };
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

function makeEngine() {
  return createEngine<Types, Summary, {}>({ types, summary, folds: {} });
}

const rootId = parseNodeId("root");

// ---------------------------------------------------------------------------
// A leaf owns nothing
// ---------------------------------------------------------------------------

describe("a leaf never owns a sourceKey", () => {
  /** root -> [c1, c2], both clips naming source "asset-A". */
  function twoLeavesSharingASource() {
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["c1", "c2"],
        },
        { id: "c1", kind: "clip", data: { title: "One", source: "asset-A" } },
        { id: "c2", kind: "clip", data: { title: "Two", source: "asset-A" } },
      ],
    });
    return { engine, loaded };
  }

  it("loads, and the graph it produced passes its own audit", () => {
    const { engine, loaded } = twoLeavesSharingASource();
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // The defect: ingress accepted this and the audit then condemned it.
    expect(engine.findInvariantViolation(loaded.value.graph)).toBeNull();
  });

  it("leaves both nodes editable", () => {
    const { engine, loaded } = twoLeavesSharingASource();
    // ASSERTED, not just guarded. An early `return` on a refused load makes
    // this test pass vacuously under exactly the mutation it exists to catch —
    // which is how the first draft of it reported a false green.
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    for (const raw of ["c1", "c2"]) {
      const edited = store.dispatch({
        type: "edit-nodes",
        edits: [
          { nodeId: parseNodeId(raw), kind: "clip", edit: { title: `${raw}!` } },
        ],
      });
      expect(edited.ok).toBe(true);
    }
  });

  it("accepts a third placement of the same source", () => {
    const { engine, loaded } = twoLeavesSharingASource();
    // ASSERTED, not just guarded. An early `return` on a refused load makes
    // this test pass vacuously under exactly the mutation it exists to catch —
    // which is how the first draft of it reported a false green.
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [{ kind: "clip", data: { title: "Three", source: "asset-A" } }],
    });
    expect(inserted.ok).toBe(true);
  });

  it("records no owner for a leaf's key in the derived index", () => {
    const { loaded } = twoLeavesSharingASource();
    // ASSERTED, not just guarded. An early `return` on a refused load makes
    // this test pass vacuously under exactly the mutation it exists to catch —
    // which is how the first draft of it reported a false green.
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // A leaf owns nothing, so it must not appear as the owner of anything —
    // otherwise the index and the predicate disagree, which is the whole class
    // of bug this change is closing.
    expect(loaded.value.graph.ownerBySourceKey.has("asset-A")).toBe(false);
  });

  it("round-trips: what serialize emits, deserialize still accepts", () => {
    const { engine, loaded } = twoLeavesSharingASource();
    // ASSERTED, not just guarded. An early `return` on a refused load makes
    // this test pass vacuously under exactly the mutation it exists to catch —
    // which is how the first draft of it reported a false green.
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const doc = engine.serialize(loaded.value.graph);
    const again = engine.deserialize(doc);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(engine.findInvariantViolation(again.value.graph)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The rule still does its job where it was meant to
// ---------------------------------------------------------------------------

describe("a container still owns its subtree", () => {
  it("still refuses two loaded containers sharing a sourceKey", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["b1", "b2"],
        },
        { id: "b1", kind: "folder", data: { name: "B1", source: "box" }, children: [] },
        { id: "b2", kind: "folder", data: { name: "B2", source: "box" }, children: [] },
      ],
    });
    // Loosening leaves must NOT loosen containers — this is the case the
    // single-owner invariant exists for.
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect((loaded.error as { code?: string }).code).toBe("duplicate-owner");
  });

  it("still refuses a second owning container through the reducer", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["b1"],
        },
        { id: "b1", kind: "folder", data: { name: "B1", source: "box" }, children: [] },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [{ kind: "folder", data: { name: "Copy", source: "box" } }],
    });
    expect(inserted.ok).toBe(false);
    if (inserted.ok) return;
    expect(inserted.error.code).toBe("duplicate-owner");
  });

  it("still exempts a reference placement, and still records the real owner", () => {
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { clip: 1, folder: 1 },
      rootIds: ["root"],
      nodes: [
        {
          id: "root",
          kind: "folder",
          data: { name: "Root", source: null },
          children: ["owner", "ref"],
        },
        {
          id: "owner",
          kind: "folder",
          data: { name: "Owner", source: "box" },
          children: [],
        },
        {
          id: "ref",
          kind: "folder",
          data: { name: "Ref", source: "box" },
          childrenState: "reference",
        },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(engine.findInvariantViolation(loaded.value.graph)).toBeNull();
    expect(loaded.value.graph.ownerBySourceKey.get("box")).toBe(
      parseNodeId("owner"),
    );
  });
});

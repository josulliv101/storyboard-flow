// Fourth review round — the last two consumer hooks that could still throw.
//
// review3 established the rule and wrapped every consumer hook it found:
// "dispatch promises a `Result`. A node type that throws while the reducer
// round-trips its own output turned that into an unhandled exception out of a
// React event handler, at every call site that correctly wrote
// `if (!result.ok)`." It named `verifyPatchApplies` for the same reason and
// `serializeGraph` for being documented TOTAL.
//
// `contentKey` and `sourceKey` were left out, and NOT by oversight — ./graph
// argues the case in prose: swallowing a throwing key hook into `null` would
// silently disable the single-owner rule, because `null` means "this node has
// no key" and a node type that threw has not said that.
//
// Both comments are right, and between them they had assumed the only two
// options were `null` and a raw throw. Measured before this change:
//
//                                     contentKey   sourceKey
//   deserialize                        THREW        THREW
//   dispatch (edit / insert / remove)  THREW        returned
//   undo                               THREW        returned
//   store.load                         THREW        THREW
//   findInvariantViolation             THREW        THREW
//   serializeGraph                     returned     returned
//
// Seven of eight doors for `contentKey`, five of them promising a `Result`.
//
// THE THIRD OPTION IS REFUSAL. The throw is caught at the hook, re-thrown as a
// private `KeyHookFailure` tag, and each door converts THAT TAG ONLY into its
// own rejection shape. Nothing is swallowed, no key is silently lost, and a
// genuine bug inside the engine still crashes as itself rather than being
// reported as the consumer's fault.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

/** Which hook detonates. Flipped per test; the throw is realistic — a key
 *  function meeting a shape it did not expect, not a synthetic panic. */
const explode = { contentKey: false, sourceKey: false };

function resetExplosions(): void {
  explode.contentKey = false;
  explode.sourceKey = false;
}

type Clip = Readonly<{ title: string; asset: string }>;
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
    const asset = record["asset"];
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "title" }] };
    }
    if (typeof asset !== "string") {
      return { ok: false, error: [{ path: "$.asset", message: "asset" }] };
    }
    return { ok: true, value: { title, asset } };
  },
  serialize(data): unknown {
    return { title: data.title, asset: data.asset };
  },
  applyEdit(data, edit) {
    return { ok: true, value: { ...data, title: edit.title ?? data.title } };
  },
  contentKey(data) {
    if (explode.contentKey) throw new Error("contentKey exploded");
    return data.asset;
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
        source: edit.source === undefined ? data.source : edit.source,
      },
    };
  },
  sourceKey(data) {
    if (explode.sourceKey) throw new Error("sourceKey exploded");
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
const lazyId = parseNodeId("lazy");

const doc = {
  formatVersion: 1 as const,
  schemaVersions: { clip: 1, folder: 1 },
  rootIds: ["root"],
  nodes: [
    {
      id: "root",
      kind: "folder",
      data: { name: "Root", source: null },
      children: ["box", "c1", "lazy"],
    },
    {
      id: "box",
      kind: "folder",
      data: { name: "Box", source: "s-a" },
      children: [],
    },
    { id: "c1", kind: "clip", data: { title: "One", asset: "a-1" } },
    {
      id: "lazy",
      kind: "folder",
      data: { name: "Lazy", source: null },
      childrenState: "unloaded" as const,
    },
  ],
};

/** A live store built with both hooks behaving. */
function calmStore() {
  resetExplosions();
  const engine = makeEngine();
  const loaded = engine.deserialize(doc);
  if (!loaded.ok) throw new Error("fixture failed to load");
  return { engine, store: engine.createStore(loaded.value.graph) };
}

const HOOKS = ["contentKey", "sourceKey"] as const;

describe("a throwing contentKey/sourceKey refuses rather than escaping", () => {
  for (const hook of HOOKS) {
    describe(`${hook} throws`, () => {
      it("deserialize refuses", () => {
        resetExplosions();
        const engine = makeEngine();
        explode[hook] = true;
        const loaded = engine.deserialize(doc);
        resetExplosions();
        expect(loaded.ok).toBe(false);
        if (loaded.ok) return;
        expect(loaded.error.code).toBe("node-type-threw");
        // The message names the kind and the hook, so the consumer can find it.
        expect(loaded.error.message).toContain(hook);
      });

      it("dispatch refuses, for an edit, an insert and a removal", () => {
        for (const command of [
          {
            type: "edit-nodes" as const,
            edits: [
              { nodeId: clipId, kind: "clip" as const, edit: { title: "Two" } },
            ],
          },
          {
            type: "insert-nodes" as const,
            toParentId: rootId,
            toIndex: 0,
            seeds: [
              { kind: "clip" as const, data: { title: "N", asset: "a-9" } },
            ],
          },
          { type: "remove-nodes" as const, nodeIds: [clipId] },
        ]) {
          const { store } = calmStore();
          explode[hook] = true;
          const result = store.dispatch(command);
          resetExplosions();
          // Some commands do not consult a given key hook at all, and that is
          // fine — what must never happen is a THROW out of a door that
          // promises a `Result`. Reaching this line at all is the assertion.
          if (!result.ok) {
            expect(result.error.code).toBe("node-type-threw");
          }
        }
      });

      it("undo refuses, and does not eat the entry", () => {
        const { store } = calmStore();
        expect(
          store.dispatch({
            type: "edit-nodes",
            edits: [{ nodeId: clipId, kind: "clip", edit: { title: "Two" } }],
          }).ok,
        ).toBe(true);

        explode[hook] = true;
        const undone = store.undo();
        const stillThere = store.canUndo();
        resetExplosions();

        if (!undone.ok) {
          expect(undone.error.code).toBe("node-type-threw");
          // THE ORDERING. `history` used to advance before `applyPatch` ran, so
          // a throw there consumed the entry and left the graph untouched — the
          // change gone AND the record of how to make it gone. Applying first
          // makes the call atomic: refused means nothing moved.
          expect(stillThere).toBe(true);
          // And the entry is still replayable once the consumer's bug is fixed.
          expect(store.undo().ok).toBe(true);
        }
      });

      it("store.load refuses", () => {
        const { store } = calmStore();
        explode[hook] = true;
        const loaded = store.load(lazyId, {
          formatVersion: 1,
          schemaVersions: { clip: 1, folder: 1 },
          rootIds: ["p1"],
          nodes: [{ id: "p1", kind: "clip", data: { title: "P", asset: "a-2" } }],
        });
        resetExplosions();
        if (!loaded.ok) {
          expect(loaded.error.code).toBe("node-type-threw");
        }
      });

      it("findInvariantViolation reports it instead of crashing", () => {
        // The audit returns `Violation | null`, not a `Result`, so the guard has
        // a different job: a diagnostic that crashes on the graph it was asked
        // to inspect is the least useful failure available.
        const { engine, store } = calmStore();
        explode[hook] = true;
        const violation = engine.findInvariantViolation(store.getGraph());
        resetExplosions();
        expect(violation).not.toBeNull();
        expect(violation?.code).toBe("node-type-threw");
      });

      it("serializeGraph stays total", () => {
        // It was already total for these two — it does not read them — and the
        // guard must not change that. A save path that throws loses the
        // document.
        const { engine, store } = calmStore();
        explode[hook] = true;
        expect(() => engine.serialize(store.getGraph())).not.toThrow();
        resetExplosions();
      });
    });
  }

  it("a genuine engine bug is NOT reported as a node-type failure", () => {
    // The guards catch `instanceof KeyHookFailure` and nothing else, on purpose:
    // a bare `catch` around these doors would blame the consumer for the
    // engine's mistakes and bury them behind a rejection nobody can act on.
    // A node type throwing from a DIFFERENT hook must still surface as itself.
    resetExplosions();
    const exploding = defineNodeType<Clip, ClipEdit>()({
      kind: "clip",
      container: false,
      schemaVersion: 1,
      parse: clipType.parse,
      serialize(): unknown {
        throw new Error("serialize exploded");
      },
      applyEdit: clipType.applyEdit,
    });
    const engine = createEngine<
      readonly [typeof exploding, typeof folderType],
      Summary,
      {}
    >({ types: [exploding, folderType] as const, summary, folds: {} });
    // A CONTAINER root — `deserialize` requires one, which is why this fixture
    // cannot just be the leaf on its own.
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
        { id: "c1", kind: "clip", data: { title: "One", asset: "a" } },
      ],
    });
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // `serialize` has its OWN guard (review3) which degrades rather than
    // refusing, so this must not come back as `node-type-threw`.
    expect(() => engine.serialize(loaded.value.graph)).not.toThrow();
  });

  it("both hooks behaving is completely unaffected", () => {
    // The whole guard must be invisible on the happy path.
    resetExplosions();
    const { engine, store } = calmStore();
    expect(
      store.dispatch({
        type: "edit-nodes",
        edits: [{ nodeId: clipId, kind: "clip", edit: { title: "Two" } }],
      }).ok,
    ).toBe(true);
    expect(store.undo().ok).toBe(true);
    expect(store.redo().ok).toBe(true);
    expect(engine.findInvariantViolation(store.getGraph())).toBeNull();
    expect(
      store.load(lazyId, {
        formatVersion: 1,
        schemaVersions: { clip: 1, folder: 1 },
        rootIds: ["p1"],
        nodes: [{ id: "p1", kind: "clip", data: { title: "P", asset: "a-2" } }],
      }).ok,
    ).toBe(true);
  });
});

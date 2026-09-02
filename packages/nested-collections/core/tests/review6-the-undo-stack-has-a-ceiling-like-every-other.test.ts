// Sixth review round — the fourth ceiling had no default and no doc.
//
// `EngineConfig` documents `maxNodes` in twenty lines, `maxDepth` in fifteen and
// `maxNodeIdLength` in twenty-five. `historyLimit?: number;` had NO doc comment
// at all and no default — the two omissions were the same omission.
//
// Unbounded is a strange default for this stack in particular. Undo is
// deliberately built on WHOLE-VALUE before/after pairs, and that is the right
// call — `ConsumerDefinedNodeType.invertEdit` argues it: "Undo works from
// whole-value before/after pairs, which cannot be wrong; a wrong inverse
// corrupts silently N undos later". The price is that every entry retains two
// complete copies of the edited node's `Data`, so an unbounded stack retains two
// per gesture for the life of the session.
//
// It is also what made the push superlinear: `pushHistory` returns a new
// `History`, so it copies `past` every time. MEASURED, microseconds per push
// against a full stack, with an interleaved control rather than two runs an
// hour apart:
//
//      limit      us/push          limit          us/push
//        100         3.59            2,500           6.61
//        250         3.21            5,000          12.89
//        500         3.29           10,000          20.56
//      1,000         5.07           25,000         239.70
//
//   unbounded, at  5,000 edits    12.00
//   unbounded, at 20,000 edits   135.81
//   unbounded, at 50,000 edits   293.21
//
// The unbounded rows are the same curve with nothing stopping it: a session
// walks down the table. Bounded, the cost is flat.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine, DEFAULT_HISTORY_LIMIT } from "../index";

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
    return { ok: true, value: { title: edit.title ?? data.title } };
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
    return { ok: true, value: { name: edit.name ?? data.name } };
  },
});

const types = [clipType, folderType] as const;
type Types = typeof types;
type Summary = Readonly<{ n: number }>;

const summary: ConsumerDefinedSummaryType<Summary> = {
  parse(): Result<Summary, readonly Issue[]> {
    return { ok: true, value: { n: 0 } };
  },
  serialize(): unknown {
    return { n: 0 };
  },
};

const clipId = parseNodeId("c1");

function storeWith(historyLimit?: number | null) {
  const engine = createEngine<Types, Summary, {}>({
    types,
    summary,
    folds: {},
    ...(historyLimit === undefined ? {} : { historyLimit }),
  });
  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { folder: 1, clip: 1 },
    rootIds: ["root"],
    nodes: [
      { id: "root", kind: "folder", data: { name: "R" }, children: ["c1"] },
      { id: "c1", kind: "clip", data: { title: "t0" } },
    ],
  });
  if (!loaded.ok) throw new Error("fixture failed to load");
  return engine.createStore(loaded.value.graph);
}

/**
 * How many entries the stack actually retained.
 *
 * Counted by undoing rather than read off a field: `History` is not on the
 * public store surface, and the number that matters to a user is how many times
 * Ctrl-Z does something — which is the same question and the one a regression
 * here would actually change.
 */
function retainedEntries(store: ReturnType<typeof storeWith>): number {
  let undone = 0;
  while (store.canUndo()) {
    const result = store.undo();
    if (!result.ok) break;
    undone += 1;
    // A runaway guard, not the measurement: an unbounded stack under test is
    // seeded with a known number of edits, so this can only be reached if
    // `canUndo` and `undo` disagree.
    if (undone > 100_000) throw new Error("undo did not terminate");
  }
  return undone;
}

function edit(store: ReturnType<typeof storeWith>, times: number): void {
  for (let i = 0; i < times; i += 1) {
    const result = store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: clipId, kind: "clip", edit: { title: `t${i + 1}` } }],
    });
    if (!result.ok) throw new Error(`edit ${i} refused: ${result.error.code}`);
  }
}

describe("the undo stack has a ceiling like every other", () => {
  it("bounds an omitted historyLimit at the default", () => {
    const store = storeWith();
    edit(store, DEFAULT_HISTORY_LIMIT + 50);
    expect(retainedEntries(store)).toBe(DEFAULT_HISTORY_LIMIT);
  }, 30_000);

  it("drops the OLDEST entries, not the newest", () => {
    // `trimPast` takes from the front. The entry a user is most likely to want
    // back is the one they just made, so a ceiling that discarded the newest
    // would be worse than no ceiling.
    const store = storeWith(3);
    edit(store, 6);
    // Six edits, a ceiling of three: undoing to the bottom must land on the
    // value the third edit produced, not the original.
    while (store.canUndo()) store.undo();
    const node = store.getGraph().nodesById.get(clipId);
    expect(node?.sealed).toBe(false);
    if (node === undefined || node.sealed || node.container) return;
    // Narrowed on `kind` as well as on the two discriminants: `LeafNode<Ts>`
    // spans every leaf kind in the registry, so `data` is the UNION of their
    // Data types until the kind is pinned.
    if (node.kind !== "clip") return;
    expect(node.data.title).toBe("t3");
  });

  it("takes a consumer's number over the default, above it as well as below", () => {
    // The rule `maxNodes` states — "a consumer who names a ceiling has named
    // THE ceiling, including one above the default. The default is what applies
    // when nobody chose, not a cap on choosing."
    const small = storeWith(5);
    edit(small, 40);
    expect(retainedEntries(small)).toBe(5);

    const large = storeWith(DEFAULT_HISTORY_LIMIT + 200);
    edit(large, DEFAULT_HISTORY_LIMIT + 100);
    expect(retainedEntries(large)).toBe(DEFAULT_HISTORY_LIMIT + 100);
  }, 30_000);

  it("restores unbounded with an explicit null", () => {
    // Giving the field a default would have REMOVED the only way to ask for
    // unbounded, because omission was that way and `0` is refused. `null` is
    // the replacement, spelled the way `maxNodeIdLength` spells the same
    // choice.
    const store = storeWith(null);
    edit(store, DEFAULT_HISTORY_LIMIT + 100);
    expect(retainedEntries(store)).toBe(DEFAULT_HISTORY_LIMIT + 100);
  }, 30_000);

  it("refuses every value that would silently mean unbounded", () => {
    // Each of these maps to Infinity in `effectiveLimit`, so accepting one
    // would give a consumer who asked to bound memory no bound at all —
    // failure in the unsafe direction, which is the whole reason this door
    // throws instead of reinterpreting. `NaN` arrives for free from
    // `Number(fromEnv)`.
    for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createEngine<Types, Summary, {}>({
          types,
          summary,
          folds: {},
          historyLimit: bad,
        }),
      ).toThrow(/historyLimit must be a positive integer or null/);
    }
  });

  it("points at null in the refusal, since that is now the escape hatch", () => {
    // The message used to say "omit it entirely for unbounded history", which
    // stopped being true the moment omission started meaning the default. A
    // refusal that names the wrong escape hatch is worse than one that names
    // none.
    let message = "";
    try {
      createEngine<Types, Summary, {}>({
        types,
        summary,
        folds: {},
        historyLimit: 0,
      });
    } catch (thrown) {
      message = thrown instanceof Error ? thrown.message : String(thrown);
    }
    expect(message).toContain("null");
    expect(message).not.toContain("Omit it entirely");
  });

  it("keeps redo working across a trim", () => {
    // Trimming rewrites `past`, and `pushHistory` clears `future` on every
    // push. Undo/redo has to stay coherent across both.
    const store = storeWith(3);
    edit(store, 5);
    expect(store.undo().ok).toBe(true);
    expect(store.canRedo()).toBe(true);
    expect(store.redo().ok).toBe(true);
    const node = store.getGraph().nodesById.get(clipId);
    if (node === undefined || node.sealed || node.container) return;
    // Narrowed on `kind` as well as on the two discriminants: `LeafNode<Ts>`
    // spans every leaf kind in the registry, so `data` is the UNION of their
    // Data types until the kind is pinned.
    if (node.kind !== "clip") return;
    expect(node.data.title).toBe("t5");
  });
});

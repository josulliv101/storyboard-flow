// KEEL — history unit tests.
//
// These cover the invariants and the failure modes, not the happy path alone.
// The failure modes are named where they are tested, because most of them are
// silent: coalescing in the wrong direction, or pairing changes by position
// instead of by node, produces a history that looks perfectly healthy and
// misbehaves only when someone actually presses Ctrl-Z.

import { describe, expect, it } from "vitest";

import {
  canRedo,
  canUndo,
  clearFuture,
  clearHistory,
  clearPast,
  coalesceEntries,
  commitRedo,
  commitUndo,
  createHistory,
  peekRedo,
  peekUndo,
  pushHistory,
  scrubHistoryForIngest,
} from "./history";
import type {
  GraphNode,
  Command,
  DataChange,
  History,
  HistoryEntry,
  NodeId,
  Patch,
  Placement,
} from "./types";
import {
  defineNodeType,
  makeDataChange,
  makeLeafNode,
  parseNodeId,
} from "./types";

// ---------------------------------------------------------------------------
// Fixtures — two real registered kinds, so `kind` is a genuine discriminant
// ---------------------------------------------------------------------------

type Clip = Readonly<{ title: string }>;
type ClipEdit = Readonly<{ op: "set-title"; title: string }>;

// The node type VALUE is never registered. This file builds its graph with
// `makeLeafNode<Types>` rather than through an engine, so this exists only so
// `typeof` can derive the `Types` tuple below — deleting it would mean
// hand-writing that tuple and letting it drift from the node types it describes.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const clipType = defineNodeType<Clip, ClipEdit>()({
  kind: "clip",
  container: false,
  schemaVersion: 1,
  parse(raw) {
    if (typeof raw !== "object" || raw === null || !("title" in raw)) {
      return { ok: false, error: [{ path: "$.title", message: "missing title" }] };
    }
    const title = raw.title;
    if (typeof title !== "string") {
      return { ok: false, error: [{ path: "$.title", message: "not a string" }] };
    }
    // CONSTRUCT, never cast — the same rule the engine's ingress relies on.
    return { ok: true, value: { title } };
  },
  serialize(data) {
    return { title: data.title };
  },
  applyEdit(_data, edit) {
    return { ok: true, value: { title: edit.title } };
  },
});

type Folder = Readonly<{ name: string }>;
type FolderEdit = Readonly<{ op: "rename"; name: string }>;

// Same as `clipType` above: a value that exists to be `typeof`-ed.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const folderType = defineNodeType<Folder, FolderEdit>()({
  kind: "folder",
  container: true,
  schemaVersion: 1,
  parse(raw) {
    if (typeof raw !== "object" || raw === null || !("name" in raw)) {
      return { ok: false, error: [{ path: "$.name", message: "missing name" }] };
    }
    const name = raw.name;
    if (typeof name !== "string") {
      return { ok: false, error: [{ path: "$.name", message: "not a string" }] };
    }
    return { ok: true, value: { name } };
  },
  serialize(data) {
    return { name: data.name };
  },
  applyEdit(_data, edit) {
    return { ok: true, value: { name: edit.name } };
  },
});

type Types = readonly [typeof clipType, typeof folderType];
type Summary = Readonly<{ itemCount: number }>;

type Entry = HistoryEntry<Types, Summary>;
type TestPatch = Patch<Types, Summary>;
type TestHistory = History<Types, Summary>;

const n = (id: string): NodeId => parseNodeId(id);

/** Indexed access without `!` — `noUncheckedIndexedAccess` is on, and a real
 *  check here turns an off-by-one in a test into a readable failure. */
function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`no element at index ${index} (length ${items.length})`);
  }
  return item;
}

function only<T>(items: readonly T[]): T {
  if (items.length !== 1) {
    throw new Error(`expected exactly one element, got ${items.length}`);
  }
  return at(items, 0);
}

function titleChange(id: string, before: string, after: string): DataChange<Types> {
  return makeDataChange<Types>(n(id), "clip", { title: before }, { title: after });
}

function nameChange(id: string, before: string, after: string): DataChange<Types> {
  return makeDataChange<Types>(n(id), "folder", { name: before }, { name: after });
}

function dataPatch(...changes: readonly DataChange<Types>[]): TestPatch {
  return { type: "data-changed", changes };
}

function movedPatch(id: string): TestPatch {
  return {
    type: "moved",
    moves: [
      {
        nodeId: n(id),
        fromParentId: n("root"),
        fromIndex: 0,
        toParentId: n("root"),
        toIndex: 1,
      },
    ],
  };
}

function insertedPatch(id: string, title: string): TestPatch {
  const placement: Placement<Types, Summary> = {
    node: makeLeafNode<Types>(n(id), "clip", { title }),
    parentId: n("root"),
    index: 0,
  };
  return { type: "inserted", placements: [placement] };
}

function entryOf(patch: TestPatch, timestamp = 0, coalesceKey?: string): Entry {
  if (coalesceKey === undefined) return { command: null, patch, at: timestamp };
  return { command: null, patch, at: timestamp, coalesceKey };
}

function changesOf(patch: TestPatch): readonly DataChange<Types>[] {
  if (patch.type !== "data-changed") {
    throw new Error(`expected a data-changed patch, got "${patch.type}"`);
  }
  return patch.changes;
}

function placementsOf(patch: TestPatch): readonly Placement<Types, Summary>[] {
  if (patch.type !== "inserted" && patch.type !== "removed") {
    throw new Error(`expected an inserted/removed patch, got "${patch.type}"`);
  }
  return patch.placements;
}

/** Discriminate on `quarantined` FIRST — `container` alone cannot narrow. */
function dataOf(node: GraphNode<Types, Summary>): unknown {
  if (node.quarantined) throw new Error("expected a live node, got a quarantined one");
  return node.data;
}

// ---------------------------------------------------------------------------
// createHistory
// ---------------------------------------------------------------------------

describe("createHistory", () => {
  it("starts empty and unbounded", () => {
    const history = createHistory<Types, Summary>();
    expect(history.past).toEqual([]);
    expect(history.future).toEqual([]);
    expect(history.limit).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps a positive integer limit", () => {
    expect(createHistory<Types, Summary>(3).limit).toBe(3);
    expect(createHistory<Types, Summary>(1).limit).toBe(1);
  });

  it.each([
    ["zero", 0],
    ["negative", -5],
    // A fraction is a typo, not a rounding request: silently choosing 2 or 3
    // for the consumer hides it.
    ["fractional", 2.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("treats a %s limit as unbounded", (_label, limit) => {
    expect(createHistory<Types, Summary>(limit).limit).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

// ---------------------------------------------------------------------------
// pushHistory
// ---------------------------------------------------------------------------

describe("pushHistory", () => {
  it("appends with the newest entry LAST", () => {
    const first = entryOf(movedPatch("a"), 1);
    const second = entryOf(movedPatch("b"), 2);
    const history = pushHistory(pushHistory(createHistory<Types, Summary>(), first), second);

    expect(history.past).toHaveLength(2);
    expect(at(history.past, 0)).toBe(first);
    expect(at(history.past, 1)).toBe(second);
  });

  it("clears the redo branch — a new command makes the undone branch unreachable", () => {
    const start: TestHistory = {
      past: [],
      future: [entryOf(movedPatch("stale"))],
      limit: Number.POSITIVE_INFINITY,
    };
    const history = pushHistory(start, entryOf(movedPatch("fresh")));
    expect(history.future).toEqual([]);
  });

  it("drops the OLDEST entry past the limit and keeps the newest", () => {
    const limited = createHistory<Types, Summary>(2);
    const a = entryOf(movedPatch("a"), 1);
    const b = entryOf(movedPatch("b"), 2);
    const c = entryOf(movedPatch("c"), 3);

    const history = pushHistory(pushHistory(pushHistory(limited, a), b), c);

    expect(history.past).toHaveLength(2);
    expect(at(history.past, 0)).toBe(b);
    expect(at(history.past, 1)).toBe(c);
    expect(history.limit).toBe(2);
  });

  it("does not mutate the history it was handed", () => {
    const start = pushHistory(createHistory<Types, Summary>(), entryOf(movedPatch("a")));
    const before = start.past;

    pushHistory(start, entryOf(movedPatch("b")));

    expect(start.past).toBe(before);
    expect(start.past).toHaveLength(1);
  });

  describe("coalescing", () => {
    it("merges with the top entry when the keys match, keeping the OLDEST before and NEWEST after", () => {
      // The silent failure this guards: reversed, Ctrl-Z after a drag lands in
      // the MIDDLE of the drag instead of before it.
      const history = pushHistory(
        pushHistory(
          createHistory<Types, Summary>(),
          entryOf(dataPatch(titleChange("n1", "a", "b")), 1, "trim:n1"),
        ),
        entryOf(dataPatch(titleChange("n1", "b", "c")), 2, "trim:n1"),
      );

      expect(history.past).toHaveLength(1);
      const change = only(changesOf(at(history.past, 0).patch));
      expect(change.before).toEqual({ title: "a" });
      expect(change.after).toEqual({ title: "c" });
    });

    it("keeps merging for the whole gesture — the merged entry carries the key forward", () => {
      let history = createHistory<Types, Summary>();
      for (const [i, [before, after]] of [
        ["a", "b"],
        ["b", "c"],
        ["c", "d"],
      ].entries()) {
        history = pushHistory(
          history,
          entryOf(dataPatch(titleChange("n1", String(before), String(after))), i, "trim:n1"),
        );
      }

      expect(history.past).toHaveLength(1);
      const change = only(changesOf(at(history.past, 0).patch));
      expect(change.before).toEqual({ title: "a" });
      expect(change.after).toEqual({ title: "d" });
    });

    it("marks a merged entry command: null — no original command describes it", () => {
      const command: Command<Types, Summary> = {
        type: "edit-nodes",
        edits: [{ nodeId: n("n1"), kind: "clip", edit: { op: "set-title", title: "b" } }],
      };
      const first: Entry = {
        command,
        patch: dataPatch(titleChange("n1", "a", "b")),
        at: 1,
        coalesceKey: "trim:n1",
      };
      const second: Entry = {
        command,
        patch: dataPatch(titleChange("n1", "b", "c")),
        at: 2,
        coalesceKey: "trim:n1",
      };

      const history = pushHistory(pushHistory(createHistory<Types, Summary>(), first), second);
      expect(at(history.past, 0).command).toBeNull();
      // Display timestamp is the newest: the gesture ended then.
      expect(at(history.past, 0).at).toBe(2);
    });

    it("NEVER merges two keyless entries", () => {
      // If `undefined === undefined` counted as a match, every consecutive edit
      // in the whole application would collapse into one undo step.
      const history = pushHistory(
        pushHistory(
          createHistory<Types, Summary>(),
          entryOf(dataPatch(titleChange("n1", "a", "b")), 1),
        ),
        entryOf(dataPatch(titleChange("n1", "b", "c")), 2),
      );
      expect(history.past).toHaveLength(2);
    });

    it("does not merge across different keys", () => {
      const history = pushHistory(
        pushHistory(
          createHistory<Types, Summary>(),
          entryOf(dataPatch(titleChange("n1", "a", "b")), 1, "trim:n1"),
        ),
        entryOf(dataPatch(titleChange("n2", "x", "y")), 2, "trim:n2"),
      );
      expect(history.past).toHaveLength(2);
    });

    it("appends when the two entries share a key but cannot be merged", () => {
      // A refusal must cost the user an extra undo step, never a lost one.
      const history = pushHistory(
        pushHistory(createHistory<Types, Summary>(), entryOf(movedPatch("n1"), 1, "gesture")),
        entryOf(dataPatch(titleChange("n1", "a", "b")), 2, "gesture"),
      );
      expect(history.past).toHaveLength(2);
    });

    it("still clears the redo branch when it merges", () => {
      // The merge path returns its own history value, so it needs its own
      // check — a merged push is still a new command, and the undone branch is
      // still unreachable after it.
      const start: TestHistory = {
        past: [entryOf(dataPatch(titleChange("n1", "a", "b")), 1, "trim:n1")],
        future: [entryOf(movedPatch("stale"), 0)],
        limit: Number.POSITIVE_INFINITY,
      };
      const history = pushHistory(
        start,
        entryOf(dataPatch(titleChange("n1", "b", "c")), 2, "trim:n1"),
      );

      expect(history.past).toHaveLength(1);
      expect(history.future).toEqual([]);
    });

    it("does not consume a limit slot", () => {
      const history = pushHistory(
        pushHistory(
          createHistory<Types, Summary>(1),
          entryOf(dataPatch(titleChange("n1", "a", "b")), 1, "trim:n1"),
        ),
        entryOf(dataPatch(titleChange("n1", "b", "c")), 2, "trim:n1"),
      );
      expect(history.past).toHaveLength(1);
      expect(only(changesOf(at(history.past, 0).patch)).before).toEqual({ title: "a" });
    });
  });
});

// ---------------------------------------------------------------------------
// coalesceEntries
// ---------------------------------------------------------------------------

describe("coalesceEntries", () => {
  it("pairs changes BY NODE, not by position, and keeps the previous entry's order", () => {
    // Positional pairing is the trap: it would give n2 the endpoints of n1 and
    // silently write one node's content into another node's undo record.
    const previous = entryOf(
      dataPatch(titleChange("n2", "a", "b"), titleChange("n1", "x", "y")),
      1,
      "k",
    );
    const next = entryOf(
      dataPatch(titleChange("n1", "y", "z"), titleChange("n2", "b", "c")),
      2,
      "k",
    );

    const merged = coalesceEntries(previous, next);
    expect(merged).not.toBeNull();
    if (merged === null) return;

    const changes = changesOf(merged.patch);
    expect(changes).toHaveLength(2);
    expect(at(changes, 0).nodeId).toBe(n("n2"));
    expect(at(changes, 0).before).toEqual({ title: "a" });
    expect(at(changes, 0).after).toEqual({ title: "c" });
    expect(at(changes, 1).nodeId).toBe(n("n1"));
    expect(at(changes, 1).before).toEqual({ title: "x" });
    expect(at(changes, 1).after).toEqual({ title: "z" });
  });

  it.each([
    ["previous is structural", movedPatch("n1"), dataPatch(titleChange("n1", "a", "b"))],
    ["next is structural", dataPatch(titleChange("n1", "a", "b")), movedPatch("n1")],
    ["both are structural", movedPatch("n1"), movedPatch("n1")],
    ["previous is an insert", insertedPatch("n1", "a"), dataPatch(titleChange("n1", "a", "b"))],
  ])("refuses when %s", (_label, previous, next) => {
    expect(coalesceEntries(entryOf(previous, 1, "k"), entryOf(next, 2, "k"))).toBeNull();
  });

  it("refuses different node sets — a merge is per-node, so an unpaired node would vanish", () => {
    const previous = entryOf(dataPatch(titleChange("n1", "a", "b")), 1, "k");
    const next = entryOf(dataPatch(titleChange("n2", "x", "y")), 2, "k");
    expect(coalesceEntries(previous, next)).toBeNull();
  });

  it("refuses a length mismatch", () => {
    const previous = entryOf(dataPatch(titleChange("n1", "a", "b")), 1, "k");
    const next = entryOf(
      dataPatch(titleChange("n1", "b", "c"), titleChange("n2", "x", "y")),
      2,
      "k",
    );
    expect(coalesceEntries(previous, next)).toBeNull();
  });

  it("refuses a repeated id that hides a dropped node", () => {
    // Equal lengths plus "every previous node exists in next" is NOT set
    // equality when the previous patch repeats an id: [n1, n1] against
    // [n1, n2] passes both while dropping n2's change entirely.
    const previous = entryOf(
      dataPatch(titleChange("n1", "a", "b"), titleChange("n1", "a", "b")),
      1,
      "k",
    );
    const next = entryOf(
      dataPatch(titleChange("n1", "b", "c"), titleChange("n2", "x", "y")),
      2,
      "k",
    );
    expect(coalesceEntries(previous, next)).toBeNull();
  });

  it("refuses when one node id carries two different kinds", () => {
    const previous = entryOf(dataPatch(titleChange("n1", "a", "b")), 1, "k");
    const next = entryOf(dataPatch(nameChange("n1", "b", "c")), 2, "k");
    expect(coalesceEntries(previous, next)).toBeNull();
  });

  it("preserves the kind of each merged change", () => {
    const previous = entryOf(dataPatch(nameChange("f1", "a", "b")), 1, "k");
    const next = entryOf(dataPatch(nameChange("f1", "b", "c")), 2, "k");
    const merged = coalesceEntries(previous, next);
    expect(merged).not.toBeNull();
    if (merged === null) return;
    expect(only(changesOf(merged.patch)).kind).toBe("folder");
  });

  it("carries the newer coalesceKey", () => {
    const merged = coalesceEntries(
      entryOf(dataPatch(titleChange("n1", "a", "b")), 1, "k"),
      entryOf(dataPatch(titleChange("n1", "b", "c")), 2, "k"),
    );
    expect(merged?.coalesceKey).toBe("k");
  });
});

// ---------------------------------------------------------------------------
// peek / commit — separate on purpose
// ---------------------------------------------------------------------------

describe("peek", () => {
  it("returns null on empty stacks", () => {
    const history = createHistory<Types, Summary>();
    expect(peekUndo(history)).toBeNull();
    expect(peekRedo(history)).toBeNull();
  });

  it("returns the newest past entry and the next redo entry", () => {
    const undoable = entryOf(movedPatch("a"), 1);
    const redoable = entryOf(movedPatch("b"), 2);
    const history: TestHistory = {
      past: [entryOf(movedPatch("older"), 0), undoable],
      future: [entryOf(movedPatch("deeper"), 0), redoable],
      limit: Number.POSITIVE_INFINITY,
    };
    expect(peekUndo(history)).toBe(undoable);
    expect(peekRedo(history)).toBe(redoable);
  });

  it("leaves the stack untouched, so a rejected verify loses nothing", () => {
    // This is the whole reason peek and commit are separate: the store peeks,
    // runs verifyPatchApplies, and bails on a dormant patch that no longer
    // applies. If the peek had consumed the entry, that bail would silently
    // destroy it.
    const history = pushHistory(createHistory<Types, Summary>(), entryOf(movedPatch("a")));
    const first = peekUndo(history);
    const second = peekUndo(history);
    expect(first).toBe(second);
    expect(history.past).toHaveLength(1);
    expect(canUndo(history)).toBe(true);
  });
});

describe("commitUndo / commitRedo", () => {
  it("return null when there is nothing to move", () => {
    const history = createHistory<Types, Summary>();
    expect(commitUndo(history)).toBeNull();
    expect(commitRedo(history)).toBeNull();
  });

  it("moves the newest past entry onto the END of future", () => {
    const a = entryOf(movedPatch("a"), 1);
    const b = entryOf(movedPatch("b"), 2);
    const history = pushHistory(pushHistory(createHistory<Types, Summary>(), a), b);

    const committed = commitUndo(history);
    expect(committed).not.toBeNull();
    if (committed === null) return;

    expect(committed.entry).toBe(b);
    expect(committed.history.past).toHaveLength(1);
    expect(at(committed.history.past, 0)).toBe(a);
    expect(committed.history.future).toHaveLength(1);
    expect(at(committed.history.future, 0)).toBe(b);
  });

  it("is LIFO in both directions across a full round trip", () => {
    const a = entryOf(movedPatch("a"), 1);
    const b = entryOf(movedPatch("b"), 2);
    const c = entryOf(movedPatch("c"), 3);
    let history = pushHistory(
      pushHistory(pushHistory(createHistory<Types, Summary>(), a), b),
      c,
    );

    const undoC = commitUndo(history);
    expect(undoC?.entry).toBe(c);
    history = undoC?.history ?? history;
    const undoB = commitUndo(history);
    expect(undoB?.entry).toBe(b);
    history = undoB?.history ?? history;

    // Most-recently-undone LAST.
    expect(history.past).toEqual([a]);
    expect(history.future).toEqual([c, b]);

    const redoB = commitRedo(history);
    expect(redoB?.entry).toBe(b);
    history = redoB?.history ?? history;
    const redoC = commitRedo(history);
    expect(redoC?.entry).toBe(c);
    history = redoC?.history ?? history;

    expect(history.past).toEqual([a, b, c]);
    expect(history.future).toEqual([]);
  });

  it("commitRedo does NOT clear the rest of the future", () => {
    // A redo in the middle of a stack must leave the remaining redos reachable.
    const deeper = entryOf(movedPatch("deeper"), 1);
    const next = entryOf(movedPatch("next"), 2);
    const history: TestHistory = {
      past: [],
      future: [deeper, next],
      limit: Number.POSITIVE_INFINITY,
    };

    const committed = commitRedo(history);
    expect(committed).not.toBeNull();
    if (committed === null) return;
    expect(committed.entry).toBe(next);
    expect(committed.history.future).toEqual([deeper]);
    expect(committed.history.past).toEqual([next]);
  });

  it("preserves the limit and does not mutate the input", () => {
    const history = pushHistory(createHistory<Types, Summary>(4), entryOf(movedPatch("a")));
    const past = history.past;

    const committed = commitUndo(history);
    expect(committed?.history.limit).toBe(4);
    expect(history.past).toBe(past);
    expect(history.future).toEqual([]);
  });

  it("does not re-trim an undone entry out of existence at the limit", () => {
    // Undo must be reversible: an entry pushed off `past` by the limit is gone,
    // but an entry moved to `future` by an undo has to survive to be redone.
    const limited = createHistory<Types, Summary>(1);
    const a = entryOf(movedPatch("a"), 1);
    const committed = commitUndo(pushHistory(limited, a));
    expect(committed?.history.future).toEqual([a]);
    expect(committed?.history.past).toEqual([]);
  });
});

describe("canUndo / canRedo", () => {
  it("track stack emptiness", () => {
    const empty = createHistory<Types, Summary>();
    expect(canUndo(empty)).toBe(false);
    expect(canRedo(empty)).toBe(false);

    const pushed = pushHistory(empty, entryOf(movedPatch("a")));
    expect(canUndo(pushed)).toBe(true);
    expect(canRedo(pushed)).toBe(false);

    const undone = commitUndo(pushed);
    expect(undone).not.toBeNull();
    if (undone === null) return;
    expect(canUndo(undone.history)).toBe(false);
    expect(canRedo(undone.history)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Clearing
// ---------------------------------------------------------------------------

describe("clearing", () => {
  const populated = (): TestHistory => ({
    past: [entryOf(movedPatch("a"), 1)],
    future: [entryOf(movedPatch("b"), 2)],
    limit: 5,
  });

  it("clearFuture keeps past and limit", () => {
    const cleared = clearFuture(populated());
    expect(cleared.past).toHaveLength(1);
    expect(cleared.future).toEqual([]);
    expect(cleared.limit).toBe(5);
  });

  it("clearPast keeps future and limit", () => {
    const cleared = clearPast(populated());
    expect(cleared.past).toEqual([]);
    expect(cleared.future).toHaveLength(1);
    expect(cleared.limit).toBe(5);
  });

  it("clearHistory empties both and keeps limit", () => {
    const cleared = clearHistory(populated());
    expect(cleared.past).toEqual([]);
    expect(cleared.future).toEqual([]);
    expect(cleared.limit).toBe(5);
  });

  it("does not mutate the input", () => {
    const history = populated();
    clearHistory(history);
    expect(history.past).toHaveLength(1);
    expect(history.future).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// scrubHistoryForIngest — the non-undoable write's history half
// ---------------------------------------------------------------------------

describe("scrubHistoryForIngest", () => {
  const noReplacements: ReadonlyMap<NodeId, unknown> = new Map();

  it("returns the same history when nothing was ingested", () => {
    const history = pushHistory(
      createHistory<Types, Summary>(),
      entryOf(dataPatch(titleChange("n1", "a", "b"))),
    );
    expect(scrubHistoryForIngest(history, noReplacements)).toBe(history);
  });

  it("drops an entry whose only change was to an ingested node", () => {
    // Inverting it would restore content the server has already replaced.
    const history = pushHistory(
      createHistory<Types, Summary>(),
      entryOf(dataPatch(titleChange("n1", "a", "b"))),
    );
    const scrubbed = scrubHistoryForIngest(
      history,
      new Map<NodeId, unknown>([[n("n1"), { title: "from-server" }]]),
    );
    expect(scrubbed.past).toEqual([]);
  });

  it("keeps the other nodes' changes in the same entry", () => {
    const history = pushHistory(
      createHistory<Types, Summary>(),
      entryOf(dataPatch(titleChange("n1", "a", "b"), titleChange("n2", "x", "y"))),
    );
    const scrubbed = scrubHistoryForIngest(
      history,
      new Map<NodeId, unknown>([[n("n1"), { title: "from-server" }]]),
    );

    const change = only(changesOf(at(scrubbed.past, 0).patch));
    expect(change.nodeId).toBe(n("n2"));
    expect(change.before).toEqual({ title: "x" });
    expect(change.after).toEqual({ title: "y" });
  });

  it("NEVER truncates — entries beneath a dropped one survive, in order", () => {
    // The predecessor's version stamp nuked the history from the mismatch down,
    // so every remote write destroyed the user's undo. This is the whole point.
    const first = entryOf(dataPatch(titleChange("n2", "a", "b")), 1);
    const doomed = entryOf(dataPatch(titleChange("n1", "a", "b")), 2);
    const last = entryOf(movedPatch("n3"), 3);
    const history: TestHistory = {
      past: [first, doomed, last],
      future: [],
      limit: Number.POSITIVE_INFINITY,
    };

    const scrubbed = scrubHistoryForIngest(
      history,
      new Map<NodeId, unknown>([[n("n1"), { title: "from-server" }]]),
    );

    expect(scrubbed.past).toHaveLength(2);
    expect(only(changesOf(at(scrubbed.past, 0).patch)).nodeId).toBe(n("n2"));
    expect(at(scrubbed.past, 1).patch.type).toBe("moved");
  });

  it("scrubs the future stack too", () => {
    // A dormant REDO is just as capable of clobbering the server's write.
    const history: TestHistory = {
      past: [],
      future: [
        entryOf(dataPatch(titleChange("n1", "a", "b")), 1),
        entryOf(dataPatch(titleChange("n2", "x", "y")), 2),
      ],
      limit: Number.POSITIVE_INFINITY,
    };
    const scrubbed = scrubHistoryForIngest(
      history,
      new Map<NodeId, unknown>([[n("n1"), { title: "from-server" }]]),
    );

    expect(scrubbed.future).toHaveLength(1);
    expect(only(changesOf(at(scrubbed.future, 0).patch)).nodeId).toBe(n("n2"));
  });

  it("leaves structural patches alone — they carry no content", () => {
    const history: TestHistory = {
      past: [entryOf(movedPatch("n1"), 1)],
      future: [],
      limit: Number.POSITIVE_INFINITY,
    };
    const scrubbed = scrubHistoryForIngest(
      history,
      new Map<NodeId, unknown>([[n("n1"), { title: "from-server" }]]),
    );

    expect(scrubbed.past).toHaveLength(1);
    const patch = at(scrubbed.past, 0).patch;
    expect(patch.type).toBe("moved");
  });

  it("rewrites the captured data inside a dormant insert placement", () => {
    // Otherwise undoing the insert and redoing it would resurrect the content
    // the server has since replaced.
    const history: TestHistory = {
      past: [entryOf(insertedPatch("n1", "authored"), 1)],
      future: [],
      limit: Number.POSITIVE_INFINITY,
    };
    const scrubbed = scrubHistoryForIngest(
      history,
      new Map<NodeId, unknown>([[n("n1"), { title: "from-server" }]]),
    );

    const placement = only(placementsOf(at(scrubbed.past, 0).patch));
    expect(dataOf(placement.node)).toEqual({ title: "from-server" });
    // Position is content-independent and must be preserved exactly.
    expect(placement.parentId).toBe(n("root"));
    expect(placement.index).toBe(0);
  });

  it("preserves the limit", () => {
    const history: TestHistory = {
      past: [entryOf(dataPatch(titleChange("n1", "a", "b")), 1)],
      future: [],
      limit: 7,
    };
    expect(
      scrubHistoryForIngest(
        history,
        new Map<NodeId, unknown>([[n("n1"), { title: "from-server" }]]),
      ).limit,
    ).toBe(7);
  });

  it("keeps the entry's command and timestamp", () => {
    const command: Command<Types, Summary> = {
      type: "edit-nodes",
      edits: [{ nodeId: n("n1"), kind: "clip", edit: { op: "set-title", title: "b" } }],
    };
    const history: TestHistory = {
      past: [
        {
          command,
          patch: dataPatch(titleChange("n1", "a", "b"), titleChange("n2", "x", "y")),
          at: 42,
        },
      ],
      future: [],
      limit: Number.POSITIVE_INFINITY,
    };
    const scrubbed = scrubHistoryForIngest(
      history,
      new Map<NodeId, unknown>([[n("n1"), { title: "from-server" }]]),
    );

    expect(at(scrubbed.past, 0).command).toBe(command);
    expect(at(scrubbed.past, 0).at).toBe(42);
  });

  it("does not mutate the history it was handed", () => {
    const original = entryOf(dataPatch(titleChange("n1", "a", "b"), titleChange("n2", "x", "y")), 1);
    const history: TestHistory = {
      past: [original],
      future: [],
      limit: Number.POSITIVE_INFINITY,
    };

    scrubHistoryForIngest(
      history,
      new Map<NodeId, unknown>([[n("n1"), { title: "from-server" }]]),
    );

    expect(history.past).toHaveLength(1);
    expect(changesOf(at(history.past, 0).patch)).toHaveLength(2);
    expect(at(history.past, 0)).toBe(original);
  });

  it("ignores replacements for nodes no entry mentions", () => {
    const history = pushHistory(
      createHistory<Types, Summary>(),
      entryOf(dataPatch(titleChange("n1", "a", "b"))),
    );
    const scrubbed = scrubHistoryForIngest(
      history,
      new Map<NodeId, unknown>([[n("elsewhere"), { title: "from-server" }]]),
    );

    expect(scrubbed.past).toHaveLength(1);
    expect(only(changesOf(at(scrubbed.past, 0).patch)).nodeId).toBe(n("n1"));
  });
});

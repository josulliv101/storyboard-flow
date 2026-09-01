// Fifth review round — the replay gate held one ceiling and not its twin.
//
// `verifyPatchApplies` gained a `maxNodes` check in the fourth round, added as
// "the third growth door and it was the one without the check". `maxDepth`
// never got the same treatment. Before this test it was enforced at exactly
// three forward doors — `applyInsertNodes`, `applyMoveNodes`, and
// `buildDocument` for both ingress paths — and at none of the replay ones. The
// vocabulary said so out loud: `RejectionCode` carried both
// `would-exceed-max-nodes` and `would-exceed-max-depth`, while
// `ReplayRejectionCode` carried only the first.
//
// So the ceiling held against every command and against every document, and not
// against undo or redo.
//
// REACHABLE BY THE LEVER THE NODE CEILING ALREADY NAMES: `Store.load` touches
// neither history stack, so it can change the graph under a sleeping patch.
// Move an UNLOADED container somewhere legal — `subtreeHeight` counts it as one
// level, correctly, because an unloaded branch contributes its placeholder and
// nothing more — then undo, fill it two levels deep while it sits shallow, then
// redo. Every step is legal on its own and the redo was not checked at all.
//
// MEASURED before the fix, at `maxDepth: 4`:
//
//   redo accepted     : true
//   depth before redo : 4
//   depth after redo  : 6
//   serializeGraph    : wrote it happily
//   deserialize, same config : document-too-deep
//
// That is the same terminal state the node-ceiling round describes — "a graph
// the audit calls valid, `serializeGraph` writes happily, and `deserialize`
// refuses at that config forever". `findInvariantViolation` cannot catch it
// either: `ViolationCode` has no depth member, because depth is a ceiling a
// consumer chose rather than a structural truth about the graph.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Graph,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../types";
import { createEngine } from "../engine";

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

const types = [folderType] as const;
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

const loadedNode = (id: string, children: string[]) => ({
  id,
  kind: "folder",
  data: { name: id },
  children,
});
const unloadedNode = (id: string) => ({
  id,
  kind: "folder",
  data: { name: id },
  childrenState: "unloaded" as const,
});

/** Deepest live level, counting a root as 1. Read from the structure rather
 *  than from any engine helper, so the assertion cannot be satisfied by the
 *  same bug it is testing for. */
function deepestLevel<S>(graph: Graph<Types, S>): number {
  let deepest = 0;
  const walk = (id: string, level: number): void => {
    if (level > deepest) deepest = level;
    for (const child of graph.childrenById.get(id as never) ?? []) {
      walk(child, level + 1);
    }
  };
  for (const root of graph.rootIds) walk(root, 1);
  return deepest;
}

const makeEngine = (maxDepth: number) =>
  createEngine<Types, Summary, {}>({ types, summary, folds: {}, maxDepth });

// root(1) -> A(2) -> B(3);  root(1) -> X(2), X an unloaded container.
const doc = {
  formatVersion: 1 as const,
  schemaVersions: { folder: 1 },
  rootIds: ["root"],
  nodes: [
    loadedNode("root", ["A", "X", "C"]),
    loadedNode("A", ["B"]),
    loadedNode("B", []),
    unloadedNode("X"),
    // A second LOADED branch at level 2, so the insert-arm case below has
    // somewhere legal to relocate A to. `X` cannot serve: `planMove` refuses an
    // unloaded target, which is the whole reason it works as the MOVED node in
    // the cases above and not as the destination here.
    loadedNode("C", []),
  ],
};

describe("the replay gate enforces maxDepth, not only maxNodes", () => {
  it("refuses a redo whose subtree grew while the patch slept", () => {
    const engine = makeEngine(4);
    const loaded = engine.deserialize(doc);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    // 1. Legal: X is unloaded, so it costs one level. depth(B)=3 + 1 = 4.
    const moved = store.dispatch({
      type: "move-nodes",
      nodeIds: [parseNodeId("X")],
      toParentId: parseNodeId("B"),
      toIndex: 0,
    });
    expect(moved.ok).toBe(true);

    // 2. The move patch is now asleep on the redo stack.
    expect(store.undo().ok).toBe(true);
    expect(store.canRedo()).toBe(true);

    // 3. `Store.load` touches neither stack, so the redo entry stays put while
    //    X — back at depth 2 — is filled two levels deep. Legal on its own.
    const filled = store.load(parseNodeId("X"), {
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["L"],
      nodes: [loadedNode("L", ["M"]), loadedNode("M", [])],
    });
    expect(filled.ok).toBe(true);
    expect(deepestLevel(store.getGraph())).toBe(4);

    // 4. THE GATE. Replaying the move would put M at level 6.
    const redone = store.redo();
    expect(redone.ok).toBe(false);
    if (redone.ok) return;
    expect(redone.error.code).toBe("would-exceed-max-depth");
    expect(redone.error.limit).toBe(4);
    expect(redone.error.actual).toBe(6);

    // The graph is untouched and the document still loads at the same config —
    // the whole point of refusing rather than applying.
    expect(deepestLevel(store.getGraph())).toBe(4);
    const rewritten = engine.deserialize(engine.serialize(store.getGraph()));
    expect(rewritten.ok).toBe(true);
  });

  it("leaves the refused entry on the stack rather than eating it", () => {
    // The same discipline `review4-a-refused-undo-must-not-be-a-dead-end`
    // establishes: a transient refusal must not destroy the step.
    const engine = makeEngine(4);
    const loaded = engine.deserialize(doc);
    if (!loaded.ok) return;
    const store = engine.createStore(loaded.value.graph);

    store.dispatch({
      type: "move-nodes",
      nodeIds: [parseNodeId("X")],
      toParentId: parseNodeId("B"),
      toIndex: 0,
    });
    store.undo();
    store.load(parseNodeId("X"), {
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["L"],
      nodes: [loadedNode("L", ["M"]), loadedNode("M", [])],
    });

    expect(store.redo().ok).toBe(false);
    expect(store.canRedo()).toBe(true);
  });

  it("refuses the insert arm through the replay door", () => {
    // The engine-level pair is exported precisely so a consumer can drive their
    // own replay, and that is the reachable path for this arm: the store's own
    // stacks are ordered, so a sleeping removal's parent cannot deepen without
    // the move that deepened it being undone first.
    const engine = makeEngine(3);
    const loaded = engine.deserialize(doc);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    // Remove B (level 3) to get a real "removed" patch, then invert it into the
    // insert that would put B back.
    const removed = engine.applyCommand(loaded.value.graph, {
      type: "remove-nodes",
      nodeIds: [parseNodeId("B")],
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    const restore = engine.invertPatch(removed.value.patch);

    // Against the graph B came out of, the restore is fine.
    expect(engine.verifyPatchApplies(removed.value.graph, restore).ok).toBe(true);

    // Move A under C so B's parent now sits one level deeper. Legal on its own:
    // with B gone, A's subtree is one level, and depth(C) 2 + 1 = 3 fits.
    const deeper = engine.applyCommand(removed.value.graph, {
      type: "move-nodes",
      nodeIds: [parseNodeId("A")],
      toParentId: parseNodeId("C"),
      toIndex: 0,
    });
    expect(deeper.ok).toBe(true);
    if (!deeper.ok) return;

    const verdict = engine.verifyPatchApplies(deeper.value.graph, restore);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error.code).toBe("would-exceed-max-depth");
    expect(verdict.error.limit).toBe(3);
    expect(verdict.error.actual).toBe(4);
  });

  it("does not refuse a replay that fits, and stays silent with no ceiling", () => {
    // The guard against a fix that refuses everything. Same gesture, one more
    // level of headroom, and again with `maxDepth` left unset — the default,
    // which means unbounded and must cost nothing.
    for (const maxDepth of [5, undefined]) {
      const engine =
        maxDepth === undefined
          ? createEngine<Types, Summary, {}>({ types, summary, folds: {} })
          : makeEngine(maxDepth);
      const loaded = engine.deserialize(doc);
      if (!loaded.ok) return;
      const store = engine.createStore(loaded.value.graph);

      store.dispatch({
        type: "move-nodes",
        nodeIds: [parseNodeId("X")],
        toParentId: parseNodeId("B"),
        toIndex: 0,
      });
      store.undo();
      store.load(parseNodeId("X"), {
        formatVersion: 1,
        schemaVersions: { folder: 1 },
        rootIds: ["L"],
        nodes: [loadedNode("L", []), loadedNode("M", [])].slice(0, 1),
      });

      const redone = store.redo();
      expect(redone.ok).toBe(true);
      expect(deepestLevel(store.getGraph())).toBe(5);
    }
  });
});

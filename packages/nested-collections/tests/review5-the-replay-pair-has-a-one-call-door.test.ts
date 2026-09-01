// Fifth review round — the precondition that lived only in the implementation.
//
// `applyPatch` says, in ./patches: "PRECONDITION: `verifyPatchApplies` returned
// ok. This function assumes the patch applies and does not re-check — re-checking
// here would either duplicate verify (and drift from it) or tempt a caller to
// skip verify because 'apply validates anyway', which is exactly how the
// dormant-patch corruptions happened."
//
// The PUBLIC contract said none of that. `Engine.applyPatch` carried one line —
// "THE ONE index rewriter — forward application and undo share it" — and returns
// a `Graph`, not a `Result`, so it reads as total. The barrel exports
// `applyPatch`, `invertPatch` and `verifyPatchApplies` as peers with nothing
// linking them, which is precisely the shape a consumer driving its own replay
// picks up.
//
// MEASURED before this round, undoing an insert whose node has since gained a
// child — the case `verifyPatchApplies` exists to answer:
//
//   verifyPatchApplies      ->  node-not-empty
//   applyPatch              ->  did not throw, returned a graph
//   nodes                   ->  3 before, 2 after, the child orphaned
//   findInvariantViolation  ->  parent-index-disagrees
//
// Nothing rejects and nothing throws. `serializeGraph` then writes the result —
// it emits unreachable nodes rather than dropping them — so the document saves
// cleanly and `deserialize` refuses it afterwards.
//
// TWO THINGS FIX IT, and neither alone. The precondition moves onto the public
// type, where the caller reading the contract will meet it. And
// `applyPatchChecked` pairs the gate with the rewrite in one call, the same way
// `serializeChecked` pairs the audit with the bytes — because the two-step
// version being correct does not help if the one-step version is what a caller
// reaches for.
import { describe, expect, it } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Patch,
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

const makeEngine = () =>
  createEngine<Types, Summary, {}>({ types, summary, folds: {} });

const rootId = parseNodeId("root");

/**
 * The stale-patch fixture: insert X under root, then give X a child, so the
 * insert patch's inverse would un-insert a node that is no longer empty.
 */
function staleUndo() {
  const engine = makeEngine();
  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { folder: 1 },
    rootIds: ["root"],
    nodes: [{ id: "root", kind: "folder", data: { name: "R" }, children: [] }],
  });
  if (!loaded.ok) throw new Error("fixture failed to load");

  const inserted = engine.applyCommand(loaded.value.graph, {
    type: "insert-nodes",
    toParentId: rootId,
    toIndex: 0,
    seeds: [{ kind: "folder", data: { name: "X" } }],
  });
  if (!inserted.ok) throw new Error("fixture insert failed");

  // The engine minted X's id, so read it back rather than assuming one.
  const xId = engine
    .serialize(inserted.value.graph)
    .nodes.map((node) => node.id)
    .find((id) => id !== "root");
  if (xId === undefined) throw new Error("fixture lost X");

  const withChild = engine.applyCommand(inserted.value.graph, {
    type: "insert-nodes",
    toParentId: parseNodeId(xId),
    toIndex: 0,
    seeds: [{ kind: "folder", data: { name: "C" } }],
  });
  if (!withChild.ok) throw new Error("fixture child insert failed");

  const undoPatch: Patch<Types, Summary> = engine.invertPatch(
    inserted.value.patch,
  );
  return { engine, graph: withChild.value.graph, undoPatch };
}

describe("the replay pair has a one-call door", () => {
  it("applyPatchChecked refuses what verifyPatchApplies refuses", () => {
    const { engine, graph, undoPatch } = staleUndo();

    const gate = engine.verifyPatchApplies(graph, undoPatch);
    expect(gate.ok).toBe(false);
    if (gate.ok) return;

    const checked = engine.applyPatchChecked(graph, undoPatch);
    expect(checked.ok).toBe(false);
    if (checked.ok) return;
    // The SAME rejection, relayed rather than re-coded — a consumer branching on
    // `node-not-empty` reads the same code whichever of the two doors it used.
    expect(checked.error.code).toBe(gate.error.code);
    expect(checked.error.code).toBe("node-not-empty");
  });

  it("the graph is untouched by a refusal", () => {
    const { engine, graph, undoPatch } = staleUndo();
    const before = graph.nodesById.size;
    const refused = engine.applyPatchChecked(graph, undoPatch);
    expect(refused.ok).toBe(false);
    expect(graph.nodesById.size).toBe(before);
    expect(engine.findInvariantViolation(graph)).toBeNull();
  });

  it("the unchecked door still corrupts — which is what the doc now says", () => {
    // NOT a bug being pinned as correct: `applyPatch` is documented as assuming
    // its precondition, and this is the cost of skipping it, held executable so
    // the paragraph on `Engine.applyPatch` cannot quietly stop being true.
    const { engine, graph, undoPatch } = staleUndo();

    const corrupted = engine.applyPatch(graph, undoPatch);

    expect(graph.nodesById.size).toBe(3);
    expect(corrupted.nodesById.size).toBe(2);
    const violation = engine.findInvariantViolation(corrupted);
    expect(violation).not.toBeNull();
    expect(violation?.code).toBe("parent-index-disagrees");
  });

  it("applies, and returns the same graph the two-step version would", () => {
    // A patch that DOES apply must go through untouched, and must agree with
    // hand-rolling the pair — otherwise the one-call door is a second
    // implementation rather than the same one.
    const engine = makeEngine();
    const loaded = engine.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [
        { id: "root", kind: "folder", data: { name: "R" }, children: ["a"] },
        { id: "a", kind: "folder", data: { name: "A" }, children: [] },
      ],
    });
    if (!loaded.ok) throw new Error("fixture failed to load");

    const inserted = engine.applyCommand(loaded.value.graph, {
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 1,
      seeds: [{ kind: "folder", data: { name: "B" } }],
    });
    if (!inserted.ok) throw new Error("insert failed");

    const undoPatch = engine.invertPatch(inserted.value.patch);
    const graph = inserted.value.graph;

    const checked = engine.applyPatchChecked(graph, undoPatch);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;

    const byHand = engine.verifyPatchApplies(graph, undoPatch);
    expect(byHand.ok).toBe(true);
    const unchecked = engine.applyPatch(graph, undoPatch);

    expect(checked.value.nodesById.size).toBe(unchecked.nodesById.size);
    expect([...checked.value.nodesById.keys()].sort()).toEqual(
      [...unchecked.nodesById.keys()].sort(),
    );
    expect(engine.findInvariantViolation(checked.value)).toBeNull();
  });

  it("inherits the cross-engine guards from the gate it routes through", () => {
    // `verifyPatchApplies` owns these, so routing through it is what gives the
    // checked door them for free — the unchecked door has never had either.
    //
    // TWO DIFFERENT GUARDS, and they are worth keeping apart because the first
    // draft of this test conflated them and asserted the wrong code.
    // `foreign-graph` compares the GRAPH's `engineId` against the engine's; a
    // foreign PATCH on a native graph passes that check and is caught one layer
    // in, by the patch naming nodes this graph does not hold.
    const { graph, undoPatch } = staleUndo();
    const other = makeEngine();
    const loaded = other.deserialize({
      formatVersion: 1,
      schemaVersions: { folder: 1 },
      rootIds: ["root"],
      nodes: [{ id: "root", kind: "folder", data: { name: "R" }, children: [] }],
    });
    if (!loaded.ok) throw new Error("fixture failed to load");

    // A graph from another engine.
    const foreignGraph = other.applyPatchChecked(graph, undoPatch);
    expect(foreignGraph.ok).toBe(false);
    if (foreignGraph.ok) return;
    expect(foreignGraph.error.code).toBe("foreign-graph");

    // A patch from another engine, against a graph of this one's.
    const foreignPatch = other.applyPatchChecked(loaded.value.graph, undoPatch);
    expect(foreignPatch.ok).toBe(false);
    if (foreignPatch.ok) return;
    expect(foreignPatch.error.code).toBe("node-missing");
  });
});

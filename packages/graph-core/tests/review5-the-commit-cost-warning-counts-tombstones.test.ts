// Fifth review round — the one shape the commit-cost warning could not see.
//
// `DEFAULT_INTERACTIVE_NODE_BUDGET` says a commit "copies whole maps ... so
// commit cost is proportional to how many nodes the document HOLDS and not at
// all to how small the edit was". True, and incomplete: a REMOVAL also copies
// `deadRevById`, which holds one entry per id ever removed from this store. That
// map is sized by the session's deletions, not by the document.
//
// So there is a shape where commit cost is invisible from the document — churn.
// MEASURED, insert-then-remove one node in a loop, live count pinned at 1:
//
//     cycles   live   tombstoned   one removal
//      1,000      1        1,000      0.045 ms
//      4,000      1        4,000      0.195 ms
//      8,000      1        8,000      0.478 ms
//
// Linear in the tombstone count, on a ONE-NODE document, so D separate deletions
// copy D^2/2 entries in total — 32.0 M for the 8,000 above. Per operation that
// stays inside a frame at any size a session realistically reaches. The defect
// was the SILENCE: `warnIfCommitCostIsPastInteractive` read `nodesById.size`,
// which is 1 in that table, so the diagnostic that exists for exactly this could
// not fire for it.
//
// NOT FIXED BY EVICTION, and the code says why at length: a tombstone is what
// stops a returning id from restarting at 0 and walking back onto revs its dead
// lineage cached, so dropping one reintroduces the staleness it exists to
// prevent. This round makes the cost audible; removing it needs a different
// mechanism and its own round.
import { describe, expect, it, vi } from "vitest";

import {
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../index";
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

const rootId = parseNodeId("root");

function makeStore(interactiveNodeBudget: number) {
  const engine = createEngine<Types, Summary, {}>({
    types,
    summary,
    folds: {},
    interactiveNodeBudget,
  });
  const loaded = engine.deserialize({
    formatVersion: 1,
    schemaVersions: { folder: 1 },
    rootIds: ["root"],
    nodes: [{ id: "root", kind: "folder", data: { name: "R" }, children: [] }],
  });
  if (!loaded.ok) throw new Error("fixture failed to load");
  return engine.createStore(loaded.value.graph);
}

/** One insert-then-remove cycle. Leaves the document exactly as it found it and
 *  the tombstone store one entry larger. */
function churn(store: ReturnType<typeof makeStore>, times: number): void {
  for (let i = 0; i < times; i += 1) {
    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [{ kind: "folder", data: { name: "N" } }],
    });
    if (!inserted.ok) throw new Error(`insert: ${inserted.error.code}`);
    const kids = store.getGraph().childrenById.get(rootId) ?? [];
    const id = kids[0];
    if (id === undefined) throw new Error("child missing");
    const removed = store.dispatch({ type: "remove-nodes", nodeIds: [id] });
    if (!removed.ok) throw new Error(`remove: ${removed.error.code}`);
    // The undo stack would otherwise retain every patch; the subject here is the
    // tombstone store, not the history.
    store.clearHistory();
  }
}

describe("the commit-cost warning counts tombstones", () => {
  it("fires on churn, where the document never grows at all", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = makeStore(20);
    churn(store, 40);
    const messages = logged.mock.calls.map((call) => String(call[0])).join("\n");
    logged.mockRestore();

    // The document is one node the whole way through — which is exactly why the
    // old check, reading `nodesById.size`, stayed silent.
    expect(store.getGraph().nodesById.size).toBe(1);
    expect(store.getGraph().deadRevById.size).toBe(40);

    expect(messages).toContain("interactive");

    // BOTH NUMBERS, not the sum alone: live-past-budget and tombstoned-past-
    // budget call for different answers, and the message must say which this is.
    //
    // Read out of the message rather than hardcoded, because the warning latches
    // at the FIRST commit to cross the budget and that lands mid-cycle, while
    // the churned node is momentarily live. The property is that tombstones
    // dominate, not that live is any particular number.
    const counts = /\((\d+) live nodes plus (\d+) tombstoned ids\)/.exec(messages);
    expect(counts).not.toBeNull();
    const live = Number(counts?.[1]);
    const dead = Number(counts?.[2]);
    expect(dead).toBeGreaterThan(live);
    expect(messages).toContain("re-creating the store");
  });

  it("still fires on a large document, and does not blame churn for it", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = makeStore(4);
    const seeds = Array.from({ length: 10 }, () => ({
      kind: "folder" as const,
      data: { name: "N" },
    }));
    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds,
    });
    expect(inserted.ok).toBe(true);
    const messages = logged.mock.calls.map((call) => String(call[0])).join("\n");
    logged.mockRestore();

    expect(store.getGraph().deadRevById.size).toBe(0);
    expect(messages).toContain("interactive");
    expect(messages).toContain("11 live nodes plus 0 tombstoned");
    // The churn sentence is conditional on tombstones dominating, so a genuinely
    // large document must not be told to re-create its store.
    expect(messages).not.toContain("re-creating the store");
  });

  it("stays silent below the budget, and once above it", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = makeStore(1_000);
    churn(store, 20);
    expect(logged.mock.calls.length).toBe(0);

    // LATCHED, like both warnings have always been: one integer compare behind a
    // boolean after the first crossing.
    const loud = makeStore(5);
    churn(loud, 30);
    const first = logged.mock.calls.length;
    churn(loud, 30);
    logged.mockRestore();
    expect(first).toBe(1);
  });

  it("a budget of 0 silences it, tombstones included", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const store = makeStore(0);
    churn(store, 50);
    const calls = logged.mock.calls.length;
    logged.mockRestore();
    expect(store.getGraph().deadRevById.size).toBe(50);
    expect(calls).toBe(0);
  });

  it("the tombstone a returning id needs is still there", () => {
    // The guard against "fixing" this by evicting: a re-inserted id must resume
    // ABOVE every revision its dead lineage could have cached, and that is the
    // property any future change here has to keep.
    const store = makeStore(0);
    const inserted = store.dispatch({
      type: "insert-nodes",
      toParentId: rootId,
      toIndex: 0,
      seeds: [{ kind: "folder", data: { name: "N" } }],
    });
    if (!inserted.ok) throw new Error("insert failed");
    const kids = store.getGraph().childrenById.get(rootId) ?? [];
    const id = kids[0];
    if (id === undefined) throw new Error("child missing");

    // Move its revision along, then remove it.
    store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: id, kind: "folder", edit: { name: "edited" } }],
    });
    const revWhileLive = store.getGraph().subtreeRevById.get(id) ?? 0;
    store.dispatch({ type: "remove-nodes", nodeIds: [id] });

    const tombstone = store.getGraph().deadRevById.get(id);
    expect(tombstone).not.toBeUndefined();
    expect(tombstone ?? 0).toBeGreaterThan(revWhileLive);

    // And undo brings it back strictly above where it died.
    expect(store.undo().ok).toBe(true);
    expect(store.getGraph().subtreeRevById.get(id) ?? 0).toBeGreaterThanOrEqual(
      tombstone ?? 0,
    );
  });
});

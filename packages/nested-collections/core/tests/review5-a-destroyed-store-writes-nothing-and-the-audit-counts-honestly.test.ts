// Fifth review round — the tail: two places where the code and its own account
// of itself had come apart.
//
// SELECTION AFTER DESTROY. `destroy()` clears every listener and the fold cache,
// and each write door argues the same thing for refusing afterwards: "a mutation
// after it lands in a graph nothing is subscribed to and no cache reflects — a
// zombie write whose only symptom is a later read disagreeing with the UI".
// `dispatch`, `undo`, `redo`, `load` and `applyNonUndoableWrite` all refuse.
// `selection.set` / `toggle` / `clear` / `selectRange` did not: they moved
// `selectedIds` and `selectedSet` and then notified an empty listener set.
// Measured before this: `dispatch` refused with `"store-destroyed"` on the same
// store where `selection.set([a])` mutated.
//
// The guard goes on `setSelection`, the single place the selection is written,
// rather than on the four entry points — guarding four is how three stay guarded
// and the fourth quietly does not. A silent no-op rather than a rejection,
// matching `markMissing`: these return `void`, so there is nothing to reject
// with.
//
// THE SHADOW BUDGET. `shadowCheck` decremented, announced exhaustion, and
// returned — so the call that took the counter from 1 to 0 reported the budget
// spent and then did not compare. The engine ran 999 of the 1,000 it claimed,
// and the skipped one was a real audited read, on the audit that exists because
// a stale memo entry is otherwise served forever. Worse, that announcement
// asserted "Everything it checked agreed" unconditionally — printed even when a
// STALE entry had already been reported above it. A diagnostic whose closing
// line contradicts its own findings is worse than one that says nothing, because
// the summary is what a reader keeps.
import { describe, expect, it, vi } from "vitest";

import {
  type ConsumerDefinedFold,
  type ConsumerDefinedSummaryType,
  type Issue,
  type Result,
  defineNodeType,
  parseNodeId,
} from "../index";
import { createEngine } from "../engine";
import { SHADOW_REFOLD_BUDGET } from "../engine/constants";

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

const doc = {
  formatVersion: 1 as const,
  schemaVersions: { folder: 1 },
  rootIds: ["root"],
  nodes: [
    { id: "root", kind: "folder", data: { name: "R" }, children: ["a", "b"] },
    { id: "a", kind: "folder", data: { name: "A" }, children: [] },
    { id: "b", kind: "folder", data: { name: "B" }, children: [] },
  ],
};

const aId = parseNodeId("a");
const bId = parseNodeId("b");

function makeStore() {
  const engine = createEngine<Types, Summary, {}>({ types, summary, folds: {} });
  const loaded = engine.deserialize(doc);
  if (!loaded.ok) throw new Error("fixture failed to load");
  return engine.createStore(loaded.value.graph);
}

describe("a destroyed store writes nothing, selection included", () => {
  it("every selection writer is a no-op after destroy", () => {
    const store = makeStore();
    store.selection.set([aId]);
    expect(store.selection.get()).toEqual([aId]);

    store.destroy();

    // All four, because the guard sits at the one place they share and this is
    // what proves they actually share it.
    store.selection.set([bId]);
    expect(store.selection.get()).toEqual([aId]);

    store.selection.toggle(bId);
    expect(store.selection.get()).toEqual([aId]);

    store.selection.selectRange(aId, bId);
    expect(store.selection.get()).toEqual([aId]);

    store.selection.clear();
    expect(store.selection.get()).toEqual([aId]);
    expect(store.selection.has(aId)).toBe(true);
  });

  it("matches the write doors it sits beside", () => {
    // `dispatch` REFUSES with a code; selection is silent. Both are "does not
    // write", and the difference is only that one has a `Result` to say it in.
    const store = makeStore();
    store.destroy();

    const dispatched = store.dispatch({
      type: "edit-nodes",
      edits: [{ nodeId: aId, kind: "folder", edit: { name: "Z" } }],
    });
    expect(dispatched.ok).toBe(false);
    if (!dispatched.ok) expect(dispatched.error.code).toBe("store-destroyed");

    store.selection.set([aId]);
    expect(store.selection.get()).toEqual([]);
  });

  it("a live store is completely unaffected", () => {
    const store = makeStore();
    store.selection.set([aId]);
    store.selection.toggle(bId);
    expect(store.selection.get()).toEqual([aId, bId]);
    store.selection.clear();
    expect(store.selection.get()).toEqual([]);
    store.selection.selectRange(aId, bId);
    expect(store.selection.get()).toEqual([aId, bId]);
  });
});

// ---------------------------------------------------------------------------

describe("the shadow budget spends what it reports", () => {
  /**
   * The real budget, read from the constant rather than restated — 1,000
   * shadowed reads is well under a second on a three-node graph, so the
   * off-by-one can be pinned directly instead of inferred.
   */
  function shadowedReads(
    count: number,
    goStaleAt: number | null,
  ): Readonly<{ comparisons: number; messages: string }> {
    let comparisons = 0;
    let reads = 0;
    let inShadow = false;
    let lying = false;

    const fold: ConsumerDefinedFold<Types, Summary, number> = {
      key: "size",
      leaf() {
        return 1;
      },
      collection(node, children) {
        // ONE PER REFOLD, not one per node: this fixture's root and both of its
        // children are containers, so a cold refold calls `collection` three
        // times and counting every call would report 3x the comparisons. The
        // root is the node the shadow was asked about, so it marks the refold.
        //
        // Counted only while a shadow is running — the live read is a cache hit
        // and never reaches here at all.
        if (inShadow && node.id === "root") comparisons += 1;
        let total = lying ? 1_000 : 1;
        for (const child of children) total += child.value;
        return { value: total, certainty: "exact" };
      },
      placeholder() {
        return { value: 0, certainty: "partial" };
      },
      missing() {
        return { value: 0, certainty: "partial" };
      },
      sealed() {
        return { value: 0, certainty: "partial" };
      },
    };

    const engine = createEngine<Types, Summary, { size: typeof fold }>({
      types,
      summary,
      folds: { size: fold },
      devChecks: true,
    });
    const loaded = engine.deserialize(doc);
    if (!loaded.ok) throw new Error("fixture failed to load");
    const store = engine.createStore(loaded.value.graph);
    const rootId = parseNodeId("root");

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // The first read MISSES and fills the table; only a hit is shadowed.
    store.aggregate("size", rootId);
    inShadow = true;
    for (reads = 0; reads < count; reads += 1) {
      if (goStaleAt !== null && reads === goStaleAt) lying = true;
      store.aggregate("size", rootId);
    }
    const messages = logged.mock.calls.map((call) => String(call[0])).join(String.fromCharCode(10));
    logged.mockRestore();

    // One `collection` call per node the cold refold walks (root, a, b -> the
    // two leaves use `leaf`), so comparisons are counted in whole refolds.
    return { comparisons, messages };
  }

  it("runs the comparison on the call that exhausts the budget", () => {
    // THE OFF-BY-ONE. The announcement used to sit between the decrement and the
    // work, with a `return` after it, so the call that took the counter from 1
    // to 0 reported the budget spent and then did not compare: 999 of the 1,000
    // it claimed, with the skipped one a real audited read.
    const upTo = SHADOW_REFOLD_BUDGET;
    const { comparisons, messages } = shadowedReads(upTo, null);

    // Every one of the 1,000 shadowed reads folded cold — including the last.
    expect(comparisons).toBe(upTo);
    expect(messages).toContain("spent its budget");
    expect(messages).toContain(String(upTo));
  });

  it("stops after the budget rather than merely announcing it", () => {
    const upTo = SHADOW_REFOLD_BUDGET;
    const { comparisons } = shadowedReads(upTo + 50, null);
    // The extra 50 reads are served from the table and audited by nothing.
    expect(comparisons).toBe(upTo);
  });

  it("does not sign off with 'everything agreed' when it found a stale entry", () => {
    // THE FALSE SIGN-OFF. That sentence was printed unconditionally on
    // exhaustion, so a run that had already reported a STALE entry closed by
    // contradicting itself — and the summary is what a reader scrolling a
    // console keeps.
    const { messages } = shadowedReads(SHADOW_REFOLD_BUDGET, 10);
    expect(messages).toContain("STALE");
    expect(messages).toContain("spent its budget");
    expect(messages).toContain("reported at least one STALE entry");
    expect(messages).not.toContain("Everything it checked agreed");
  });

  it("still signs off with 'everything agreed' when nothing disagreed", () => {
    // The other branch, so the fix is not just "never say it".
    const { messages } = shadowedReads(SHADOW_REFOLD_BUDGET, null);
    expect(messages).toContain("Everything it checked agreed");
    expect(messages).not.toContain("STALE");
  });

  it("stays silent when the table and a cold refold agree, before the budget", () => {
    const { messages } = shadowedReads(3, null);
    expect(messages).toBe("");
  });
});

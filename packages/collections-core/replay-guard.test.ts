import { describe, expect, it } from "vitest";

import { applyCommand } from "./commands";
import { verifyPatchApplies, type CollectionsPatch } from "./patches";
import { buildGraph, parseNodeId, type CollectionsGraph, type GraphNodeSpec } from "./graph";

// verifyPatchApplies is the gate that lets undo/redo refuse a dormant patch
// the graph has outgrown (hydration adds nodes while entries sleep on either
// stack). Each case mirrors an assumption the apply functions make and do
// not check themselves.

const media = (id: string): GraphNodeSpec => ({
  kind: "media",
  id,
  name: id,
  durationSeconds: 2,
});

function fixture(): CollectionsGraph {
  const built = buildGraph([
    {
      kind: "collection",
      id: "root",
      name: "root",
      children: [media("a"), { kind: "collection", id: "sub", name: "sub", children: [media("s1")] }],
    },
  ]);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value;
}

const id = parseNodeId;

describe("verifyPatchApplies", () => {
  it("accepts patches produced against the current graph", () => {
    const graph = fixture();
    const moved = applyCommand(graph, {
      type: "move-nodes",
      nodeIds: [id("a")],
      toParentId: id("sub"),
      toIndex: 0,
    });
    if (!moved.ok) throw new Error(moved.error.reason);
    expect(verifyPatchApplies(graph, moved.value.patch).ok).toBe(true);
  });

  it("rejects an add whose id already exists (the redo-after-hydrate collision)", () => {
    const graph = fixture();
    const patch: CollectionsPatch = {
      type: "nodes-added",
      adds: [{ node: { id: id("a"), kind: "media", name: "a", durationSeconds: 2 }, parentId: id("root"), index: 0 }],
    };
    const verdict = verifyPatchApplies(graph, patch);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected rejection");
    expect(verdict.error.reason).toBe("add-id-exists");
  });

  it("rejects an add into a parent that is gone or not a collection", () => {
    const graph = fixture();
    const patch: CollectionsPatch = {
      type: "nodes-added",
      adds: [{ node: { id: id("new"), kind: "media", name: "new", durationSeconds: 2 }, parentId: id("ghost"), index: 0 }],
    };
    const verdict = verifyPatchApplies(graph, patch);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) throw new Error("expected rejection");
    expect(verdict.error.reason).toBe("add-parent-missing");
  });

  it("rejects removing a node that is missing or no longer childless", () => {
    const graph = fixture();
    const missing: CollectionsPatch = {
      type: "nodes-removed",
      removals: [{ node: { id: id("ghost"), kind: "media", name: "g", durationSeconds: 2 }, parentId: id("root"), index: 0 }],
    };
    const missingVerdict = verifyPatchApplies(graph, missing);
    expect(!missingVerdict.ok && missingVerdict.error.reason).toBe("remove-node-missing");

    // "sub" has a child — removing it would orphan s1 (the undo-after-hydrate
    // corruption). applyRemovals deletes the children entry without looking.
    const populated: CollectionsPatch = {
      type: "nodes-removed",
      removals: [{ node: { id: id("sub"), kind: "collection", name: "sub" }, parentId: id("root"), index: 1 }],
    };
    const populatedVerdict = verifyPatchApplies(graph, populated);
    expect(!populatedVerdict.ok && populatedVerdict.error.reason).toBe(
      "remove-node-not-childless"
    );
  });

  it("rejects a move whose node is missing or whose source parent changed", () => {
    const graph = fixture();
    const missing: CollectionsPatch = {
      type: "nodes-moved",
      moves: [{ nodeId: id("ghost"), fromParentId: id("root"), fromIndex: 0, toParentId: id("sub"), toIndex: 0 }],
    };
    const missingVerdict = verifyPatchApplies(graph, missing);
    expect(!missingVerdict.ok && missingVerdict.error.reason).toBe("move-node-missing");

    const wrongParent: CollectionsPatch = {
      type: "nodes-moved",
      moves: [{ nodeId: id("a"), fromParentId: id("sub"), fromIndex: 0, toParentId: id("root"), toIndex: 0 }],
    };
    const parentVerdict = verifyPatchApplies(graph, wrongParent);
    expect(!parentVerdict.ok && parentVerdict.error.reason).toBe("move-parent-mismatch");
  });

  it("rejects an update for a node that no longer exists", () => {
    const graph = fixture();
    const node = { id: id("ghost"), kind: "media", name: "g", durationSeconds: 2 } as const;
    const patch: CollectionsPatch = {
      type: "nodes-updated",
      updates: [{ nodeId: id("ghost"), before: node, after: { ...node, name: "h" } }],
    };
    const verdict = verifyPatchApplies(graph, patch);
    expect(!verdict.ok && verdict.error.reason).toBe("update-node-missing");
  });
});

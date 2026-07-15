import { describe, expect, test } from "vitest";

import {
  buildGraph,
  findGraphInvariantViolation,
  parseNodeId,
  type CollectionItemNode,
  type CollectionsGraph,
} from "./graph";
import { applyPatch, invertPatch, type CollectionsPatch } from "./patches";

// patches.ts is mostly exercised THROUGH applyCommand (commands.test.ts and
// the fuzz suite) — but the nodes-removed → nodes-added inversion never runs
// inside the package at all: the store's undo feed EMITS nodes-removed
// outward (undoing a palette add), and persistence consumers invert it to
// replay. This file gives that public branch first-party coverage, so a
// regression is caught by a test instead of a downstream consumer.

const id = parseNodeId;

function baseGraph(): CollectionsGraph {
  const result = buildGraph([
    {
      kind: "collection",
      id: "root",
      name: "Root",
      children: [
        { kind: "media", id: "a", name: "A", durationSeconds: 2 },
        { kind: "media", id: "b", name: "B", durationSeconds: 3 },
      ],
    },
  ]);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
}

describe("nodes-removed inversion", () => {
  const newNode: CollectionItemNode = {
    id: id("n1"),
    kind: "media",
    mediaKind: "image",
    name: "N1",
    durationSeconds: 5,
  };
  const added: CollectionsPatch = {
    type: "nodes-added",
    adds: [{ node: newNode, parentId: id("root"), index: 1 }],
  };

  test("inverting an add removes the node; inverting THAT restores it exactly", () => {
    const base = baseGraph();
    const withNode = applyPatch(base, added);
    expect([...(withNode.childrenById.get(id("root")) ?? [])]).toEqual(["a", "n1", "b"]);

    // Undo shape: the store feed hands consumers this nodes-removed patch.
    const removal = invertPatch(added);
    expect(removal.type).toBe("nodes-removed");
    const removed = applyPatch(withNode, removal);
    expect(findGraphInvariantViolation(removed)).toBeNull();
    expect(removed.nodesById.has(id("n1"))).toBe(false);
    expect(removed.parentById.has(id("n1"))).toBe(false);
    expect([...(removed.childrenById.get(id("root")) ?? [])]).toEqual(["a", "b"]);

    // Redo shape: consumers invert the removal to replay the add — the FULL
    // node rides in the patch, so restoration is exact (same reference).
    const restore = invertPatch(removal);
    expect(restore.type).toBe("nodes-added");
    const restored = applyPatch(removed, restore);
    expect(findGraphInvariantViolation(restored)).toBeNull();
    expect([...(restored.childrenById.get(id("root")) ?? [])]).toEqual(["a", "n1", "b"]);
    expect(restored.nodesById.get(id("n1"))).toBe(newNode);
  });

  test("removing an added collection also drops its (empty) children entry", () => {
    const folder: CollectionItemNode = { id: id("f1"), kind: "collection", name: "F1" };
    const addFolder: CollectionsPatch = {
      type: "nodes-added",
      adds: [{ node: folder, parentId: id("root"), index: 0 }],
    };
    const withFolder = applyPatch(baseGraph(), addFolder);
    expect(withFolder.childrenById.get(id("f1"))).toEqual([]); // born with an entry

    const removed = applyPatch(withFolder, invertPatch(addFolder));
    expect(findGraphInvariantViolation(removed)).toBeNull();
    expect(removed.childrenById.has(id("f1"))).toBe(false); // and dies with it
  });

  test("structural sharing: a removal leaves unaffected indexes untouched", () => {
    const base = baseGraph();
    const withNode = applyPatch(base, added);
    const removed = applyPatch(withNode, invertPatch(added));
    // rootIds is never touched by add/remove patches.
    expect(removed.rootIds).toBe(withNode.rootIds);
    // The untouched node objects survive by reference.
    expect(removed.nodesById.get(id("a"))).toBe(base.nodesById.get(id("a")));
  });
});

describe("invertPatch involution", () => {
  test("double inversion of a moves patch is the identity, field for field", () => {
    const patch: CollectionsPatch = {
      type: "nodes-moved",
      moves: [
        { nodeId: id("a"), fromParentId: id("root"), fromIndex: 0, toParentId: id("root"), toIndex: 1 },
      ],
    };
    expect(invertPatch(invertPatch(patch))).toEqual(patch);
  });

  test("double inversion of an update patch is the identity", () => {
    const before: CollectionItemNode = {
      id: id("a"), kind: "media", mediaKind: "image", name: "A", durationSeconds: 2,
    };
    const after: CollectionItemNode = { ...before, durationSeconds: 6 };
    const patch: CollectionsPatch = {
      type: "nodes-updated",
      updates: [{ nodeId: id("a"), before, after }],
    };
    expect(invertPatch(invertPatch(patch))).toEqual(patch);
  });
});

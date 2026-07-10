import { describe, expect, test } from "vitest";
import {
  buildGraph,
  findGraphInvariantViolation,
  getChildren,
  getDocumentOrder,
  isSameOrAncestor,
  parseNodeId,
  type GraphNodeSpec,
} from "./graph";

const media = (id: string, name = id): GraphNodeSpec => ({ kind: "media", id, name });
const collection = (
  id: string,
  children: readonly GraphNodeSpec[] = [],
  name = id
): GraphNodeSpec => ({ kind: "collection", id, name, children });

function build(roots: readonly GraphNodeSpec[]) {
  const result = buildGraph(roots);
  if (!result.ok) throw new Error(`buildGraph failed: ${JSON.stringify(result.error)}`);
  return result.value;
}

describe("buildGraph", () => {
  test("denormalizes a nested spec into consistent indexes", () => {
    const graph = build([
      collection("root-a", [media("m1"), collection("folder", [media("m2")])]),
      collection("root-b", [media("m3")]),
    ]);

    expect(graph.rootIds).toEqual(["root-a", "root-b"]);
    expect(getChildren(graph, parseNodeId("root-a"))).toEqual(["m1", "folder"]);
    expect(getChildren(graph, parseNodeId("folder"))).toEqual(["m2"]);
    expect(graph.parentById.get(parseNodeId("m2"))).toBe("folder");
    expect(graph.parentById.get(parseNodeId("root-a"))).toBeNull();
    expect(findGraphInvariantViolation(graph)).toBeNull();
  });

  test("rejects duplicate ids anywhere in the tree", () => {
    const result = buildGraph([
      collection("root", [media("dup"), collection("folder", [media("dup")])]),
    ]);
    expect(result).toEqual({ ok: false, error: { reason: "duplicate-id", id: "dup" } });
  });

  test("rejects a media node as a root", () => {
    const result = buildGraph([media("m1")]);
    expect(result).toEqual({ ok: false, error: { reason: "root-not-collection", id: "m1" } });
  });

  test("rejects empty ids", () => {
    const result = buildGraph([collection("root", [media("")])]);
    expect(result).toEqual({ ok: false, error: { reason: "empty-id" } });
  });

  test("survives pathological depth without recursion", () => {
    let spec: GraphNodeSpec = media("leaf");
    for (let i = 0; i < 20_000; i++) {
      spec = collection(`c${i}`, [spec]);
    }
    const graph = build([collection("root", [spec])]);
    expect(graph.nodesById.size).toBe(20_002);
  });
});

describe("isSameOrAncestor", () => {
  const graph = build([
    collection("root", [collection("outer", [collection("inner", [media("m1")])])]),
  ]);

  test("a node is its own ancestor for guard purposes", () => {
    expect(isSameOrAncestor(graph, parseNodeId("inner"), parseNodeId("inner"))).toBe(true);
  });

  test("walks up through parents", () => {
    expect(isSameOrAncestor(graph, parseNodeId("root"), parseNodeId("m1"))).toBe(true);
    expect(isSameOrAncestor(graph, parseNodeId("outer"), parseNodeId("m1"))).toBe(true);
  });

  test("false for siblings/descendants", () => {
    expect(isSameOrAncestor(graph, parseNodeId("m1"), parseNodeId("inner"))).toBe(false);
  });
});

describe("getDocumentOrder", () => {
  test("depth-first reading order across roots", () => {
    const graph = build([
      collection("a", [media("a1"), collection("af", [media("af1")]), media("a2")]),
      collection("b", [media("b1")]),
    ]);
    const order = getDocumentOrder(graph);
    const rank = (id: string) => order.get(parseNodeId(id))!;
    expect(rank("a")).toBeLessThan(rank("a1"));
    expect(rank("a1")).toBeLessThan(rank("af"));
    expect(rank("af")).toBeLessThan(rank("af1"));
    expect(rank("af1")).toBeLessThan(rank("a2"));
    expect(rank("a2")).toBeLessThan(rank("b"));
  });
});

describe("findGraphInvariantViolation", () => {
  test("catches a child whose parent index disagrees", () => {
    const graph = build([collection("root", [media("m1")])]);
    const corrupted = {
      ...graph,
      parentById: new Map([...graph.parentById, [parseNodeId("m1"), null]]),
    };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "child-parent-mismatch",
      childId: "m1",
      expectedParentId: "root",
    });
  });

  test("catches unreachable nodes", () => {
    const graph = build([collection("root", [media("m1")])]);
    const orphan = { id: parseNodeId("ghost"), kind: "media", name: "Ghost", durationSeconds: 1 } as const;
    const corrupted = {
      ...graph,
      nodesById: new Map([...graph.nodesById, [orphan.id, orphan]]),
      parentById: new Map([...graph.parentById, [orphan.id, null]]),
    };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "unreachable-node",
      id: "ghost",
    });
  });

  test("catches duplicate root ids", () => {
    const graph = build([collection("root", [media("m1")])]);
    const corrupted = { ...graph, rootIds: [parseNodeId("root"), parseNodeId("root")] };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "duplicate-root",
      id: "root",
    });
  });

  test("catches a media node listed as a root", () => {
    const graph = build([collection("root", [media("m1")])]);
    const corrupted = {
      ...graph,
      rootIds: [...graph.rootIds, parseNodeId("m1")],
    };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "root-not-collection",
      id: "m1",
    });
  });

  test("catches a root that also appears in a children list (the root-move corruption shape)", () => {
    // This is exactly the graph shape the cannot-move-root rejection in
    // commands.ts exists to prevent: a node in rootIds AND in some
    // collection's children.
    const graph = build([
      collection("root-a", [media("m1")]),
      collection("root-b", []),
    ]);
    const corrupted = {
      ...graph,
      childrenById: new Map([
        ...graph.childrenById,
        [parseNodeId("root-a"), [parseNodeId("m1"), parseNodeId("root-b")]],
      ]),
      parentById: new Map([...graph.parentById]),
    };
    const violation = findGraphInvariantViolation(corrupted);
    expect(violation && "id" in violation ? violation.id : violation?.reason).toBe("root-b");
  });

  test("catches a collection node with no childrenById entry", () => {
    // buildGraph always creates the entry; this shape only appears in
    // hand-constructed or corrupted graphs — which is what the checker is
    // for. A childless collection with a missing entry used to pass because
    // only parents referenced via parentById were checked.
    const graph = build([collection("root", [collection("leaf", [])])]);
    const prunedChildren = new Map(graph.childrenById);
    prunedChildren.delete(parseNodeId("leaf"));
    const corrupted = { ...graph, childrenById: prunedChildren };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "collection-missing-children-entry",
      id: "leaf",
    });
  });

  test("catches a root collection with no childrenById entry", () => {
    const graph = build([collection("root", [])]);
    const corrupted = { ...graph, childrenById: new Map() };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "collection-missing-children-entry",
      id: "root",
    });
  });

  test("catches a dangling parentById key for a node that does not exist", () => {
    const graph = build([collection("root", [media("m1")])]);
    const corrupted = {
      ...graph,
      parentById: new Map([...graph.parentById, [parseNodeId("ghost"), parseNodeId("root")]]),
    };
    expect(findGraphInvariantViolation(corrupted)).toEqual({
      reason: "missing-node",
      id: "ghost",
    });
  });

  test("catches a parent pointer at a media node", () => {
    const graph = build([collection("root", [media("m1"), media("m2")])]);
    const corrupted = {
      ...graph,
      parentById: new Map([...graph.parentById, [parseNodeId("m2"), parseNodeId("m1")]]),
    };
    const violation = findGraphInvariantViolation(corrupted);
    // Order-insensitive: either the child/parent index disagreement or the
    // media-parent check may fire first, both flag the corruption.
    expect(violation).not.toBeNull();
    expect(["parent-not-collection", "child-parent-mismatch"]).toContain(violation!.reason);
  });
});

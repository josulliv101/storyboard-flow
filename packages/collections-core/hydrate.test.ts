import { describe, expect, it } from "vitest";

import {
  buildGraph,
  findGraphInvariantViolation,
  getChildren,
  parseNodeId,
  type CollectionsGraph,
  type GraphNodeSpec,
} from "./graph";
import { hydrateCollection } from "./hydrate";

function hostGraph(): CollectionsGraph {
  const result = buildGraph([
    {
      kind: "collection",
      id: "root",
      name: "Root",
      children: [
        { kind: "media", id: "m1", name: "Clip 1", durationSeconds: 3 },
        { kind: "collection", id: "placeholder", name: "Lazy", children: [] },
        {
          kind: "collection",
          id: "populated",
          name: "Populated",
          children: [{ kind: "media", id: "m2", name: "Clip 2", durationSeconds: 2 }],
        },
      ],
    },
  ]);
  if (!result.ok) throw new Error("host graph invalid");
  return result.value;
}

const SPECS: readonly GraphNodeSpec[] = [
  { kind: "media", id: "h1", name: "Hydrated 1", durationSeconds: 4 },
  {
    kind: "collection",
    id: "h-nested",
    name: "Nested",
    children: [{ kind: "media", id: "h2", name: "Hydrated 2", durationSeconds: 1 }],
  },
];

describe("hydrateCollection", () => {
  it("fills an empty collection and keeps every index coherent", () => {
    const graph = hostGraph();
    const result = hydrateCollection(graph, parseNodeId("placeholder"), SPECS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.value;

    expect(findGraphInvariantViolation(next)).toBeNull();
    expect(getChildren(next, parseNodeId("placeholder"))).toEqual(["h1", "h-nested"]);
    expect(getChildren(next, parseNodeId("h-nested"))).toEqual(["h2"]);
    expect(next.parentById.get(parseNodeId("h1"))).toBe("placeholder");
    expect(next.parentById.get(parseNodeId("h2"))).toBe("h-nested");
    // The target keeps its own node value and real parent.
    expect(next.nodesById.get(parseNodeId("placeholder"))).toBe(
      graph.nodesById.get(parseNodeId("placeholder")),
    );
    expect(next.parentById.get(parseNodeId("placeholder"))).toBe("root");
    expect(next.rootIds).toBe(graph.rootIds);
  });

  it("is pure and structurally shares everything it didn't touch", () => {
    const graph = hostGraph();
    const result = hydrateCollection(graph, parseNodeId("placeholder"), SPECS);
    if (!result.ok) throw new Error("hydrate failed");
    const next = result.value;

    // Input untouched.
    expect(getChildren(graph, parseNodeId("placeholder"))).toEqual([]);
    expect(graph.nodesById.has(parseNodeId("h1"))).toBe(false);
    // Untouched values keep their identities.
    expect(next.nodesById.get(parseNodeId("m1"))).toBe(graph.nodesById.get(parseNodeId("m1")));
    expect(next.childrenById.get(parseNodeId("root"))).toBe(
      graph.childrenById.get(parseNodeId("root")),
    );
    expect(next.childrenById.get(parseNodeId("populated"))).toBe(
      graph.childrenById.get(parseNodeId("populated")),
    );
  });

  it("returns the SAME graph for an empty spec list", () => {
    const graph = hostGraph();
    const result = hydrateCollection(graph, parseNodeId("placeholder"), []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toBe(graph);
  });

  it("rejects missing, non-collection, and non-empty targets", () => {
    const graph = hostGraph();
    expect(hydrateCollection(graph, parseNodeId("nope"), SPECS)).toMatchObject({
      ok: false,
      error: { reason: "missing-collection" },
    });
    expect(hydrateCollection(graph, parseNodeId("m1"), SPECS)).toMatchObject({
      ok: false,
      error: { reason: "not-a-collection" },
    });
    expect(hydrateCollection(graph, parseNodeId("populated"), SPECS)).toMatchObject({
      ok: false,
      error: { reason: "collection-not-empty" },
    });
  });

  it("rejects spec ids that collide with the host graph", () => {
    const graph = hostGraph();
    const result = hydrateCollection(graph, parseNodeId("placeholder"), [
      { kind: "media", id: "m2", name: "Collides", durationSeconds: 1 },
    ]);
    expect(result).toMatchObject({ ok: false, error: { reason: "duplicate-id", id: "m2" } });
  });

  it("rejects duplicate ids WITHIN the specs", () => {
    const graph = hostGraph();
    const result = hydrateCollection(graph, parseNodeId("placeholder"), [
      { kind: "media", id: "dup", name: "A", durationSeconds: 1 },
      { kind: "media", id: "dup", name: "B", durationSeconds: 1 },
    ]);
    expect(result).toMatchObject({ ok: false, error: { reason: "duplicate-id", id: "dup" } });
  });

  it("rejects a spec reusing the target's own id", () => {
    const graph = hostGraph();
    const result = hydrateCollection(graph, parseNodeId("placeholder"), [
      { kind: "media", id: "placeholder", name: "Self", durationSeconds: 1 },
    ]);
    expect(result).toMatchObject({ ok: false, error: { reason: "duplicate-id", id: "placeholder" } });
  });

  it("rejects malformed specs (media with children) as invalid-spec", () => {
    const graph = hostGraph();
    const badSpec = {
      kind: "media",
      id: "bad",
      name: "Bad",
      durationSeconds: 1,
      children: [],
    } as unknown as GraphNodeSpec;
    const result = hydrateCollection(graph, parseNodeId("placeholder"), [badSpec]);
    expect(result).toMatchObject({ ok: false, error: { reason: "invalid-spec" } });
  });
});

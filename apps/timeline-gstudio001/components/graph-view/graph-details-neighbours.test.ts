import { describe, expect, it } from "vitest";

import { buildGraph, type GraphNodeSpec } from "@storyboard/collections-core";

import { detailsNeighbours, flatOrderRootId } from "./graph-details-neighbours";

// The cases that matter are all STRUCTURAL — the neighbour is inside a nested
// collection, or two collections away, or does not exist because the clip is
// the last thing in the timeline. Sibling arithmetic gets every one of them
// wrong, which is why this defers to the playback order rather than reading the
// subject's own parent.

const media = (id: string, durationSeconds = 4): GraphNodeSpec =>
  ({ kind: "media", id, name: id, durationSeconds }) as GraphNodeSpec;

const collection = (id: string, children: readonly GraphNodeSpec[] = []): GraphNodeSpec => ({
  kind: "collection",
  id,
  name: id,
  children,
});

function graphOf(roots: readonly GraphNodeSpec[]) {
  const built = buildGraph(roots);
  if (!built.ok) throw new Error(JSON.stringify(built.error));
  return built.value;
}

describe("detailsNeighbours", () => {
  it("takes the clips either side within one collection", () => {
    const graph = graphOf([collection("scene", [media("a"), media("b"), media("c")])]);
    expect(detailsNeighbours(graph, "scene", "b")).toMatchObject({
      previousId: "a",
      nextId: "c",
      index: 1,
      total: 3,
    });
  });

  it("DESCENDS into a collection to find the next clip", () => {
    // The thing after `a` is not the collection — it is the first media INSIDE
    // it. This is the case sibling arithmetic answers wrongly.
    const graph = graphOf([
      collection("scene", [media("a"), collection("sub", [media("s1"), media("s2")])]),
    ]);
    expect(detailsNeighbours(graph, "scene", "a").nextId).toBe("s1");
  });

  it("descends through SEVERAL collections to reach the first clip", () => {
    const graph = graphOf([
      collection("scene", [
        media("a"),
        collection("outer", [collection("inner", [media("deep")])]),
      ]),
    ]);
    expect(detailsNeighbours(graph, "scene", "a").nextId).toBe("deep");
  });

  it("CLIMBS OUT of a collection when its last clip is reached", () => {
    // The other half, and the one the user asked for by name: the clip after
    // the last one in a collection is whatever plays next above it, even
    // though it has a different parent.
    const graph = graphOf([
      collection("scene", [
        collection("sub", [media("s1"), media("s2")]),
        media("after"),
      ]),
    ]);
    const at = detailsNeighbours(graph, "scene", "s2");
    expect(at.nextId).toBe("after");
    expect(at.previousId).toBe("s1");
  });

  it("crosses from one collection straight into the next", () => {
    const graph = graphOf([
      collection("scene", [
        collection("one", [media("a1"), media("a2")]),
        collection("two", [media("b1")]),
      ]),
    ]);
    expect(detailsNeighbours(graph, "scene", "a2").nextId).toBe("b1");
    expect(detailsNeighbours(graph, "scene", "b1").previousId).toBe("a2");
  });

  it("is blank at the true ends, not wrapped", () => {
    // Nothing after the last clip in the WHOLE order — the modal draws empty
    // space there. Wrapping would claim a seam that does not exist.
    const graph = graphOf([collection("scene", [media("a"), media("b")])]);
    expect(detailsNeighbours(graph, "scene", "a").previousId).toBeNull();
    expect(detailsNeighbours(graph, "scene", "b").nextId).toBeNull();
  });

  it("ignores empty collections rather than counting them as neighbours", () => {
    const graph = graphOf([
      collection("scene", [media("a"), collection("empty", []), media("b")]),
    ]);
    expect(detailsNeighbours(graph, "scene", "a").nextId).toBe("b");
  });

  it("reports no neighbours for a COLLECTION subject", () => {
    // A collection is not in the media order, so there is no "either side of"
    // it to answer. Reported as index -1 so the caller draws nothing instead
    // of guessing at position 0.
    const graph = graphOf([collection("scene", [media("a"), collection("sub", [media("s")])])]);
    const at = detailsNeighbours(graph, "scene", "sub");
    expect(at.index).toBe(-1);
    expect(at.previousId).toBeNull();
    expect(at.nextId).toBeNull();
  });

  it("answers nothing for a missing root or subject", () => {
    const graph = graphOf([collection("scene", [media("a")])]);
    expect(detailsNeighbours(graph, null, "a").index).toBe(-1);
    expect(detailsNeighbours(graph, "scene", null).index).toBe(-1);
  });

  it("counts the whole order, not the subject's own collection", () => {
    // `total` is what a "3 of 41" readout would use, so it has to span the
    // timeline rather than the folder.
    const graph = graphOf([
      collection("scene", [
        collection("one", [media("a1"), media("a2")]),
        collection("two", [media("b1"), media("b2")]),
      ]),
    ]);
    expect(detailsNeighbours(graph, "scene", "a2")).toMatchObject({ index: 1, total: 4 });
  });
});

describe("flatOrderRootId", () => {
  it("is the graph's own root", () => {
    const graph = graphOf([collection("scene", [media("a")])]);
    expect(flatOrderRootId(graph)).toBe("scene");
  });
});

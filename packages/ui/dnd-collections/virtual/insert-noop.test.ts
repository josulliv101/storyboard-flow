import { describe, expect, it } from "vitest";

import { parseNodeId, type NodeId } from "@storyboard/collections-core/graph";

import { isContiguousReorderNoOp } from "./insert-noop";

function indexMap(ids: readonly string[]): Map<NodeId, number> {
  return new Map(ids.map((id, index) => [parseNodeId(id), index] as const));
}
const ids = (...values: string[]): NodeId[] => values.map(parseNodeId);

describe("isContiguousReorderNoOp", () => {
  const idx = indexMap(["a", "b", "c", "d", "e"]); // a=0 … e=4

  it("is a no-op for a contiguous run dropped anywhere within its own span", () => {
    const active = ids("b", "c"); // positions 1,2
    expect(isContiguousReorderNoOp(idx, active, 1)).toBe(true);
    expect(isContiguousReorderNoOp(idx, active, 2)).toBe(true);
    expect(isContiguousReorderNoOp(idx, active, 3)).toBe(true); // just past the end
  });

  it("is a real move outside the run's span", () => {
    const active = ids("b", "c"); // 1,2
    expect(isContiguousReorderNoOp(idx, active, 0)).toBe(false);
    expect(isContiguousReorderNoOp(idx, active, 4)).toBe(false);
  });

  it("treats a non-contiguous multi-selection as a real move", () => {
    expect(isContiguousReorderNoOp(idx, ids("b", "d"), 2)).toBe(false); // gap at c
  });

  it("is a real move in when any dragged item isn't in this collection", () => {
    expect(isContiguousReorderNoOp(indexMap(["a", "b", "c"]), ids("b", "z"), 1)).toBe(false);
  });

  it("empty selection is never a no-op", () => {
    expect(isContiguousReorderNoOp(idx, [], 0)).toBe(false);
  });

  it("stays correct with thousands of children and a large contiguous selection", () => {
    const N = 20000;
    const all = Array.from({ length: N }, (_, i) => `n${i}`);
    const big = indexMap(all);
    const run = all.slice(5000, 15000).map(parseNodeId); // 10k contiguous
    expect(isContiguousReorderNoOp(big, run, 5000)).toBe(true); // run start
    expect(isContiguousReorderNoOp(big, run, 15000)).toBe(true); // just past end
    expect(isContiguousReorderNoOp(big, run, 4999)).toBe(false);
    expect(isContiguousReorderNoOp(big, run, 15001)).toBe(false);
  });
});

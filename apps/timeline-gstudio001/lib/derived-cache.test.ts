import { describe, expect, it, vi } from "vitest";

import { createDerivedCache } from "./derived-cache";

// The invariant under test mirrors how the graph view uses this: the
// collections store rebuilds its snapshot on EVERY notification (drags
// included) but `snapshot.graph` keeps its reference until a commit — so a
// derivation memoized on input identity must do ZERO compute work across
// interaction-only notifications, and recompute exactly once per commit.

describe("createDerivedCache", () => {
  it("never calls compute while every input is reference-identical", () => {
    const compute = vi.fn((graph: { n: number }) => [graph.n]);
    const derive = createDerivedCache({ compute, contentKey: (v) => String(v[0]) });

    const graph = { n: 1 };
    const first = derive(graph);
    // A drag emits many notifications with the same committed graph — every
    // one must be a pure reference check, not a walk.
    for (let i = 0; i < 50; i += 1) expect(derive(graph)).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes when any single input's identity changes", () => {
    const compute = vi.fn((a: object, b: object) => ({ a, b }));
    const derive = createDerivedCache({ compute, contentKey: () => String(Math.random()) });

    const a1 = {};
    const b1 = {};
    derive(a1, b1);
    derive(a1, b1);
    expect(compute).toHaveBeenCalledTimes(1);

    derive(a1, {}); // details store replaced its table
    expect(compute).toHaveBeenCalledTimes(2);
    derive({}, b1); // a commit replaced the graph
    expect(compute).toHaveBeenCalledTimes(3);
  });

  it("keeps the previous VALUE reference when a recompute yields equal content", () => {
    // An unrelated commit changes the graph identity, so the walk re-runs —
    // but this collection's content is unchanged, and the returned reference
    // must not churn (bystander cards would re-render).
    const derive = createDerivedCache({
      compute: (graph: { items: string[] }) => [...graph.items],
      contentKey: (value) => value.join("\n"),
    });

    const before = derive({ items: ["a", "b"] });
    const after = derive({ items: ["a", "b"] }); // new graph identity, same content
    expect(after).toBe(before);
  });

  it("adopts the new value when content actually changes", () => {
    const derive = createDerivedCache({
      compute: (graph: { items: string[] }) => [...graph.items],
      contentKey: (value) => value.join("\n"),
    });

    const before = derive({ items: ["a"] });
    const after = derive({ items: ["a", "b"] });
    expect(after).not.toBe(before);
    expect(after).toEqual(["a", "b"]);
    // And the new value is then stable in its own right.
    expect(derive({ items: ["a", "b"] })).toBe(after);
  });

  it("handles primitive values (a duration in seconds)", () => {
    const compute = vi.fn((graph: { seconds: number }) => graph.seconds);
    const derive = createDerivedCache({
      compute,
      contentKey: (seconds) => String(Math.round(seconds * 1000)),
    });

    const graph = { seconds: 12.4 };
    expect(derive(graph)).toBe(12.4);
    expect(derive(graph)).toBe(12.4);
    expect(compute).toHaveBeenCalledTimes(1);
    // Sub-millisecond jitter from an equivalent recompute keys equal — the
    // previous value is kept.
    expect(derive({ seconds: 12.4000001 })).toBe(12.4);
  });
});

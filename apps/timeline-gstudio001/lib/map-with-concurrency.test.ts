import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "./map-with-concurrency";

/** Resolves on the next macrotask, `ms` deep. */
const after = <T,>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("mapWithConcurrency", () => {
  it("returns an empty list for no items, without running anything", async () => {
    let ran = 0;
    const out = await mapWithConcurrency([], 3, async () => {
      ran += 1;
      return 1;
    });
    expect(out).toEqual([]);
    expect(ran).toBe(0);
  });

  it("keeps results in INPUT order, not completion order", async () => {
    // The first item finishes last; a naive push-as-you-go pool would invert.
    const out = await mapWithConcurrency([30, 10, 0], 3, (ms) => after(ms, ms));
    expect(out).toEqual([30, 10, 0]);
  });

  it("runs every item exactly once", async () => {
    const seen: number[] = [];
    const items = [1, 2, 3, 4, 5, 6, 7];
    await mapWithConcurrency(items, 3, async (n) => {
      seen.push(n);
      return n;
    });
    expect(seen.slice().sort((a, b) => a - b)).toEqual(items);
  });

  it("never exceeds the concurrency limit", async () => {
    let live = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await after(5, n);
      live -= 1;
      return n;
    });
    expect(peak).toBe(3);
  });

  it("does not spawn more workers than there are items", async () => {
    let live = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2], 10, async (n) => {
      live += 1;
      peak = Math.max(peak, live);
      await after(5, n);
      live -= 1;
      return n;
    });
    expect(peak).toBe(2);
  });

  it("treats a limit below one as one, rather than stalling", async () => {
    const out = await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 2);
    expect(out).toEqual([2, 4, 6]);
  });

  it("propagates a rejection — expected failures belong in the result type", async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      }),
    ).rejects.toThrow("boom");
  });
});

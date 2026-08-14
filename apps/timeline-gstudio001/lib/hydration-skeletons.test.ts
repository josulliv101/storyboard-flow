import { describe, expect, it } from "vitest";

import {
  FALLBACK_HYDRATION_SKELETONS,
  MAX_HYDRATION_SKELETONS,
  hydrationSkeletonCount,
} from "./hydration-skeletons";

const input = (over: Partial<Parameters<typeof hydrationSkeletonCount>[0]> = {}) => ({
  hydrated: false,
  itemCount: 4,
  renderedChildren: 0,
  ...over,
});

describe("hydrationSkeletonCount", () => {
  it("draws one placeholder per expected clip while a collection is unhydrated", () => {
    expect(hydrationSkeletonCount(input({ itemCount: 4 }))).toBe(4);
    expect(hydrationSkeletonCount(input({ itemCount: 1 }))).toBe(1);
  });

  it("draws nothing once the collection is hydrated", () => {
    expect(hydrationSkeletonCount(input({ hydrated: true }))).toBe(0);
  });

  it("treats a missing hydrated flag as not-yet-hydrated", () => {
    // A collection with no side-table entry has not been hydrated either — the
    // absence IS the pre-hydration state, so `undefined` must not read as true.
    expect(hydrationSkeletonCount(input({ hydrated: undefined }))).toBe(4);
  });

  it("suppresses placeholders whenever cards are already on screen", () => {
    // Reachable mid-flight: a re-hydration after a remote change re-runs the
    // fetch with the previous children still mounted. Skeletons beside real
    // cards read as broken cards, not loading ones.
    expect(hydrationSkeletonCount(input({ renderedChildren: 2 }))).toBe(0);
  });

  it("hydrated wins even when children are also present", () => {
    expect(hydrationSkeletonCount(input({ hydrated: true, renderedChildren: 2 }))).toBe(0);
  });

  it("draws nothing for a collection stored as EMPTY", () => {
    // The rule this pins: a stored 0 is a real answer, not a missing one. Its
    // empty state is correct, and a skeleton here is a wait that never
    // resolves because nothing is coming.
    expect(hydrationSkeletonCount(input({ itemCount: 0 }))).toBe(0);
  });

  it("separates a stored zero from an absent count", () => {
    // Both are falsy. A truthiness check would collapse them and give the
    // empty collection three permanent skeletons.
    expect(hydrationSkeletonCount(input({ itemCount: 0 }))).toBe(0);
    expect(hydrationSkeletonCount(input({ itemCount: undefined }))).toBe(
      FALLBACK_HYDRATION_SKELETONS,
    );
  });

  it("falls back to a small count when the summary carries none", () => {
    expect(hydrationSkeletonCount(input({ itemCount: undefined }))).toBe(3);
  });

  it("caps a huge collection at a screenful", () => {
    expect(hydrationSkeletonCount(input({ itemCount: 400 }))).toBe(MAX_HYDRATION_SKELETONS);
    expect(hydrationSkeletonCount(input({ itemCount: MAX_HYDRATION_SKELETONS + 1 }))).toBe(
      MAX_HYDRATION_SKELETONS,
    );
  });

  it("does not cap a collection that is exactly at the ceiling", () => {
    expect(hydrationSkeletonCount(input({ itemCount: MAX_HYDRATION_SKELETONS }))).toBe(
      MAX_HYDRATION_SKELETONS,
    );
  });

  it("survives a corrupt summary rather than handing Array.from a bad length", () => {
    // `Array.from({length: NaN})` renders nothing and `{length: -1}` throws —
    // neither is an acceptable answer to a malformed stored field.
    expect(hydrationSkeletonCount(input({ itemCount: Number.NaN }))).toBe(
      FALLBACK_HYDRATION_SKELETONS,
    );
    expect(hydrationSkeletonCount(input({ itemCount: -3 }))).toBe(FALLBACK_HYDRATION_SKELETONS);
    expect(hydrationSkeletonCount(input({ itemCount: Number.POSITIVE_INFINITY }))).toBe(
      FALLBACK_HYDRATION_SKELETONS,
    );
  });

  it("floors a fractional count", () => {
    expect(hydrationSkeletonCount(input({ itemCount: 3.7 }))).toBe(3);
  });
});

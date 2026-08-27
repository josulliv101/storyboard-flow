import { describe, expect, test } from "vitest";

import {
  finiteNonNegativeOr,
  finitePositiveOr,
  finitePositiveOrUndefined,
  nonNegativeIntegerOr,
  openUnitIntervalOr,
  positiveIntegerOrUndefined,
} from "./numeric";

describe("numeric option normalization", () => {
  test("positive finite values reject zero, negatives, NaN, and infinity", () => {
    expect(finitePositiveOr(2.5, 10)).toBe(2.5);
    for (const value of [undefined, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(finitePositiveOr(value, 10)).toBe(10);
      expect(finitePositiveOrUndefined(value)).toBeUndefined();
    }
    expect(finitePositiveOrUndefined(2.5)).toBe(2.5);
  });

  test("non-negative finite values retain zero", () => {
    expect(finiteNonNegativeOr(0, 10)).toBe(0);
    expect(finiteNonNegativeOr(2.5, 10)).toBe(2.5);
    for (const value of [undefined, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(finiteNonNegativeOr(value, 10)).toBe(10);
    }
  });

  test("integer helpers enforce their lower bounds", () => {
    expect(positiveIntegerOrUndefined(3)).toBe(3);
    expect(positiveIntegerOrUndefined(0)).toBeUndefined();
    expect(positiveIntegerOrUndefined(Number.NaN)).toBeUndefined();
    expect(nonNegativeIntegerOr(0, 7)).toBe(0);
    expect(nonNegativeIntegerOr(-1, 7)).toBe(7);
    expect(nonNegativeIntegerOr(Number.NaN, 7)).toBe(7);
  });

  test("friction-like factors must remain strictly between zero and one", () => {
    expect(openUnitIntervalOr(0.995, 0.5)).toBe(0.995);
    for (const value of [undefined, 0, 1, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(openUnitIntervalOr(value, 0.5)).toBe(0.5);
    }
  });
});

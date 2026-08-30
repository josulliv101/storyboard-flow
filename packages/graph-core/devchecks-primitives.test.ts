// Graph — the two primitives the dev checks are built on.
//
// Both are BOUNDED and TOTAL. Every case below was found by running code
// rather than by reading it, and each one kills a specific line: delete the
// guard named in the comment and exactly that test fails.
import { describe, expect, it } from "vitest";

import {
  DEV_CHECK_BUDGET,
  deepFreezeBounded,
  structurallyEqualBounded,
} from "./types";

describe("structurallyEqualBounded", () => {
  it("terminates on a cycle instead of running forever", () => {
    // THE MEASUREMENT THAT MOTIVATED THE BUDGET: a verbatim transcription of
    // the production `deepEqual` in ./patches ran 2,000,000 iterations on
    // exactly this input without finishing. That function is correct for what
    // it does — it only ever sees SERIALIZED values, which are acyclic — but a
    // parsed value may legitimately hold a back-pointer.
    //
    // Remove the step counter and this test does not fail, it HANGS, and the
    // failure arrives as a suite timeout rather than an assertion.
    const a: Record<string, unknown> = { name: "a" };
    a["self"] = a;
    const b: Record<string, unknown> = { name: "a" };
    b["self"] = b;
    expect(structurallyEqualBounded(a, b)).toBe("unknown");
  });

  it("abstains rather than guessing when the budget runs out", () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < 5_000; i += 1) wide[`k${i}`] = i;
    const same: Record<string, number> = {};
    for (let i = 0; i < 5_000; i += 1) same[`k${i}`] = i;
    // Genuinely equal, and it still answers "unknown" — that is the contract.
    // A comparator that guessed `true` here would silence a real violation on
    // the next payload of the same size.
    expect(structurallyEqualBounded(wide, same, 1_000)).toBe("unknown");
    // Given room, the same pair is decidable.
    expect(structurallyEqualBounded(wide, same, DEV_CHECK_BUDGET)).toBe(true);
  });

  it("treats NaN as equal to itself", () => {
    // `===` would answer false and report a violation on a node type that
    // legitimately stores NaN. Object.is at the leaves is what prevents it.
    expect(structurallyEqualBounded({ n: Number.NaN }, { n: Number.NaN })).toBe(true);
  });

  it("distinguishes a present undefined from an absent key", () => {
    // `{a: undefined}` and `{}` have different SERIALIZED shapes, and a node type
    // is entitled to care. An own-key count plus hasOwnProperty is what keeps
    // them apart; a plain `right[key] === undefined` test would not.
    expect(structurallyEqualBounded({ a: undefined }, {})).toBe(false);
    expect(structurallyEqualBounded({}, { a: undefined })).toBe(false);
  });

  it("compares nested arrays and records by value", () => {
    expect(
      structurallyEqualBounded(
        { xs: [1, { y: "a" }], z: null },
        { xs: [1, { y: "a" }], z: null },
      ),
    ).toBe(true);
    expect(
      structurallyEqualBounded({ xs: [1, { y: "a" }] }, { xs: [1, { y: "b" }] }),
    ).toBe(false);
    expect(structurallyEqualBounded({ xs: [1] }, { xs: [1, 2] })).toBe(false);
  });

  it("does not confuse an array with a record", () => {
    expect(structurallyEqualBounded([], {})).toBe(false);
    expect(structurallyEqualBounded({}, [])).toBe(false);
  });

  it("KNOWN BLIND SPOT: two different Dates compare equal", () => {
    // Written down as a test rather than a comment so it cannot quietly stop
    // being true. `Date`, `Map`, `Set` and class instances all present as `{}`
    // to this walk. Timeline payloads are wire-shaped, so this is a limitation
    // rather than a bug — but a reader who assumes otherwise would be wrong,
    // and the assumption is easy to make.
    expect(
      structurallyEqualBounded(
        { at: new Date("2020-01-01") },
        { at: new Date("1999-12-31") },
      ),
    ).toBe(true);
  });
});

describe("deepFreezeBounded", () => {
  it("does not throw on a typed array", () => {
    // THE SINGLE MOST IMPORTANT LINE IN THE CHECK. `Object.freeze` on a
    // TypedArray with elements THROWS "Cannot freeze array buffer views with
    // elements". A node type returning binary data is conforming, so without the
    // ArrayBuffer.isView guard, turning devChecks on takes the ingress door
    // down for that consumer. Remove the guard and this test fails with that
    // exact message.
    const value = { bytes: new Uint8Array([1, 2, 3]) };
    expect(() => deepFreezeBounded(value)).not.toThrow();
    expect(Object.isFrozen(value)).toBe(true);
    // The view itself is deliberately left unfrozen — that is the trade.
    expect(Object.isFrozen(value.bytes)).toBe(false);
  });

  it("invokes ZERO getters", () => {
    // A descriptor walk, never `Object.values` or `for..in`. Reading through a
    // getter RUNS it, and an audit that is supposed to observe nothing would
    // instead execute consumer code with side effects — the same class of
    // failure as the TypedArray throw, one level subtler.
    let reads = 0;
    const value = {
      plain: 1,
      get lazy(): number {
        reads += 1;
        return 2;
      },
    };
    deepFreezeBounded(value);
    expect(reads).toBe(0);
  });

  it("terminates on a cycle", () => {
    // Freeze-before-recurse is the cycle guard: the second visit sees a frozen
    // object and stops. Move the `Object.freeze` call below the child walk and
    // this hangs.
    const a: Record<string, unknown> = { name: "a" };
    a["self"] = a;
    expect(deepFreezeBounded(a)).toBe(true);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it("freezes nested records and arrays", () => {
    const value = { a: { b: [{ c: 1 }] } };
    expect(deepFreezeBounded(value)).toBe(true);
    expect(Object.isFrozen(value.a)).toBe(true);
    expect(Object.isFrozen(value.a.b)).toBe(true);
    expect(Object.isFrozen(value.a.b[0])).toBe(true);
  });

  it("reports FALSE when the budget stops it short", () => {
    // The return value is the honest half of the contract: a caller that
    // treated a budget bail as success would claim a guarantee it does not
    // have.
    const wide: Record<string, unknown> = {};
    for (let i = 0; i < 500; i += 1) wide[`k${i}`] = { i };
    expect(deepFreezeBounded(wide, 10)).toBe(false);
  });

  it("KNOWN BLIND SPOT: a frozen Map still mutates", () => {
    // Measured, and written down for the same reason as the Date case above.
    // `Object.isFrozen` reads true while the collection's own methods keep
    // working, so freezing does not make a Map-bearing payload immutable.
    const value = { m: new Map<string, number>([["a", 1]]) };
    deepFreezeBounded(value);
    expect(Object.isFrozen(value.m)).toBe(true);
    value.m.set("b", 2);
    expect(value.m.size).toBe(2);
  });
});

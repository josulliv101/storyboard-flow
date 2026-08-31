// Graph — certainty, and the persistence gate that reads it.
//
// Split out of the former single-file `folds.ts`; see ./index.ts.

import type {
  Certainty,
  ExactFolded,
  Folded,
} from "../types";

// ---------------------------------------------------------------------------
// 1. Certainty
// ---------------------------------------------------------------------------

/**
 * Wrap a value with a certainty.
 *
 * `Folded<A>` is a three-member UNION, not a flat `{ value; certainty }`, so
 * that `summaryFrom` can demand the `"exact"` member. This still compiles with
 * a `Certainty`-typed argument because TypeScript normalizes an object whose
 * discriminant property is a union of unit types against a discriminated-union
 * target — verified by compiling both this form and the pre-typed-variable form
 * before relying on it.
 */
export function folded<A>(value: A, certainty: Certainty): Folded<A> {
  return { value, certainty };
}

/** The `"exact"` member specifically — the only thing `summaryFrom` accepts. */
export function foldedExact<A>(value: A): ExactFolded<A> {
  return { value, certainty: "exact" };
}

/**
 * Ordered weakest-first. A plain object literal, not a Map: the key type is a
 * finite union of string literals, so this is a mapped type with three real
 * properties rather than an index signature — which is why indexing it yields
 * `number` and not `number | undefined` under `noUncheckedIndexedAccess`, and
 * why no `!` or fallback is needed below.
 */
const CERTAINTY_RANK: Readonly<Record<Certainty, number>> = {
  partial: 0,
  estimated: 1,
  exact: 2,
};

/**
 * partial < estimated < exact. An EMPTY input is `"exact"` — an aggregate over
 * nothing is not uncertain, it is a known-empty answer, and the alternative
 * would make every leaf-only collection permanently unpersistable.
 *
 * Weakest-wins is correct for a sum. It is NOT correct in general: the rule for
 * a first-frame preview is position-sensitive (a hole AFTER the first hit
 * changes nothing), which is exactly why `ConsumerDefinedFold.collection` returns `Folded<A>`
 * itself and is free to ignore this helper.
 */
export function weakestCertainty(certainties: readonly Certainty[]): Certainty {
  let weakest: Certainty = "exact";
  for (const certainty of certainties) {
    if (CERTAINTY_RANK[certainty] < CERTAINTY_RANK[weakest]) {
      weakest = certainty;
      // Nothing ranks below "partial", so the rest of the list cannot lower it.
      if (weakest === "partial") return weakest;
    }
  }
  return weakest;
}

// ---------------------------------------------------------------------------
// 2. The persistence gate
// ---------------------------------------------------------------------------

/**
 * THE PERSISTENCE GATE. Only an `"exact"` fold may be written back into a
 * stored summary, and the type — not a runtime check a caller can forget — is
 * what enforces it.
 *
 * Aimed at a measured bug: a duration accumulator starting at zero made an
 * empty collection persist `0` where the model's floor was 3, the write path
 * persisted documents THROUGH that projection, and every downstream reader then
 * had to defend against a number that was never a measurement. Persisting an
 * estimate is worse than not persisting: it compounds on every save, and the
 * next reader cannot tell the estimate from a measurement.
 */
export function summaryFrom<A>(folded: ExactFolded<A>): A {
  return folded.value;
}

// ---------------------------------------------------------------------------

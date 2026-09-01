// Graph — part of the former single-file `types.ts`; see ./index.ts.

// Dev-check primitives — bounded, total, and deliberately NOT the production
// versions of the same ideas
// ---------------------------------------------------------------------------

/**
 * Default step budget for the two helpers below. Large enough that no honest
 * timeline payload reaches it, small enough that a pathological one costs
 * microseconds rather than seconds.
 */
export const DEV_CHECK_BUDGET = 20_000;

/**
 * Structural equality that is allowed to say "I don't know".
 *
 * WHY THIS IS NOT `deepEqual` FROM ./patches, and why ~35 lines of deliberate
 * duplication is the right price. That function has one production caller —
 * `verifyPatchApplies` — which needs a DEFINITE verdict: a budget bail there
 * would surface as a spurious `data-mismatch` refusal of a legitimate undo,
 * which is a production behaviour change made by a dev-check refactor. The
 * audit needs a comparator that can abstain; production needs one that cannot.
 * They are different functions and must stay so.
 *
 * BOUNDED, and that is the whole point — but the cycle is no longer why. A
 * PARSED value may legitimately hold a back-pointer, and a verbatim
 * transcription of `deepEqual` once ran 2,000,000 iterations on `a.self=a` vs
 * `b.self=b` without finishing. `deepEqual` now carries a co-inductive pair
 * memo and terminates on exactly that input, so the two functions no longer
 * differ in whether they can survive a cycle — only in whether they may ABSTAIN.
 *
 * The step counter here remains the COST bound, which is the reason a dev check
 * needs one and production does not: this runs on every parsed value at every
 * ingress under `devChecks`, where a 40,000-node document with 200 keyframes a
 * clip reached 2.67 seconds unbudgeted. `verifyPatchApplies` runs its
 * comparison once per changed node on the undo path, and must answer rather
 * than shrug — a budget bail there would be a spurious `data-mismatch`
 * refusing a legitimate undo for being large.
 *
 * `"unknown"` is SILENCE at every call site, never a report. A check that
 * cannot see the whole value has not found a violation.
 *
 * KNOWN BLIND SPOT, documented rather than fixed: `Date`, `Map`, `Set` and
 * class instances all present as `{}` here, so two different `Date`s compare
 * EQUAL. Timeline payloads are wire-shaped — JSON scalars, arrays and plain
 * objects — and widening this to structural equality over host types is a
 * bigger contract than a dev check should own.
 */
export function structurallyEqualBounded(
  a: unknown,
  b: unknown,
  budget: number = DEV_CHECK_BUDGET,
): true | false | "unknown" {
  // Explicit stack, never recursion: the same rule ./patches states for the
  // production comparator — nesting depth is hostile input.
  const stack: Readonly<{ left: unknown; right: unknown }>[] = [
    { left: a, right: b },
  ];
  let steps = 0;
  while (stack.length > 0) {
    if (++steps > budget) return "unknown";
    const frame = stack.pop();
    if (frame === undefined) break;
    const { left, right } = frame;
    // Object.is, not ===, so a node type that legitimately stores NaN compares
    // equal to itself.
    if (Object.is(left, right)) continue;

    const leftIsArray = Array.isArray(left);
    if (leftIsArray || Array.isArray(right)) {
      if (!leftIsArray || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i += 1) {
        stack.push({ left: left[i], right: right[i] });
      }
      continue;
    }

    if (!isPlainRecord(left) || !isPlainRecord(right)) return false;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    for (const key of leftKeys) {
      // An own-key check rather than an undefined test: `{a: undefined}` and
      // `{}` have different serialized shapes and a node type may care.
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
      stack.push({ left: left[key], right: right[key] });
    }
  }
  return true;
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Freeze a parsed value and everything reachable from it. Returns `false` when
 * the budget ran out before the walk finished, so a caller can say "partially
 * frozen" rather than imply a guarantee it does not have.
 *
 * FOUR GUARDS, each of which was found by execution rather than by reading:
 *
 *  1. TYPED ARRAYS ARE SKIPPED. `Object.freeze(new Uint8Array([1]))` THROWS
 *     "Cannot freeze array buffer views with elements". A node type returning
 *     binary data is conforming, and without this line turning `devChecks` on
 *     takes the ingress door down.
 *  2. FREEZE BEFORE RECURSING, and skip anything already frozen. That is the
 *     cycle guard and the idempotence guard at once, and it is measurably
 *     faster than a fresh `WeakSet` per call.
 *  3. DESCRIPTOR WALK, never `Object.values` or `for..in`. Reading a value
 *     through a getter INVOKES it — a lazy or side-effecting accessor would
 *     otherwise run inside an audit that is supposed to observe nothing.
 *  4. A STEP BUDGET, because cost here is O(PAYLOAD), not O(nodes). Measured
 *     across plausible timeline shapes the per-node cost spans 0.39us to
 *     66.75us — a 170x spread — and a 40,000-node document with 200 keyframes
 *     per clip reaches 2.67 SECONDS at load without one.
 *
 * KNOWN BLIND SPOTS, documented rather than fixed. `Object.isFrozen` reads
 * true while `map.set(...)`, `set.add(...)` and `date.setFullYear(...)` all
 * still mutate — measured, a frozen Map went from size 1 to 2. And a consumer
 * module in SLOPPY mode writing to a frozen object no-ops silently with no
 * TypeError, so the mutation is prevented but not reported. Both are real
 * gaps; neither is a reason to skip the eighty percent this does catch.
 */
export function deepFreezeBounded(
  root: unknown,
  budget: number = DEV_CHECK_BUDGET,
): boolean {
  const stack: unknown[] = [root];
  let steps = 0;
  while (stack.length > 0) {
    if (++steps > budget) return false;
    const value = stack.pop();
    if (typeof value !== "object" || value === null) continue;
    // GUARD 1 — see above. This must precede the freeze, not follow it.
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) continue;
    // GUARD 2 — freeze first, then walk, so a cycle terminates.
    if (Object.isFrozen(value)) continue;
    Object.freeze(value);
    // GUARD 3 — descriptors, so getters are never invoked.
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined) continue;
      if (!("value" in descriptor)) continue;
      stack.push(descriptor.value);
    }
  }
  return true;
}

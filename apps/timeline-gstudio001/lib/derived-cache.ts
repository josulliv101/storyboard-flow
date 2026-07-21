// Identity-keyed memoizer for graph-derived summaries (review finding 2).
//
// A hydrated collection card derives its preview frames and total duration by
// WALKING its live descendant subtree. Those derivations used to run inside
// `getSnapshot` on EVERY collections-store notification — and the store
// notifies for interaction-only updates too (drag begin/end, each distinct
// drop intent), so a drag recomputed recursive aggregations for every hydrated
// collection card just to discover nothing changed. The content-key cache only
// stabilized the returned REFERENCE; the walk itself still ran first.
//
// The store's own contract is the way out: the committed `snapshot.graph` is
// immutable and gets a NEW identity exactly on a commit (interaction state is
// separate — a drag never mutates the committed graph), and the details
// side-table's `read()` returns a stable object until an entry actually
// changes. So "may the cached summary still be valid?" is a pure reference
// check on the inputs. This helper memoizes on exactly that: while every
// input is reference-identical, the previous value returns with NO compute
// call — interaction notifications never trigger graph aggregation.
//
// On a real commit the inputs differ and the walk runs once per card (the
// pre-existing cost of a commit); the content-key layer then keeps the
// returned reference stable when the recomputed content is unchanged, so
// bystander cards still don't re-render after unrelated commits.

/** Memoize `compute` on the reference identity of its inputs, with a
 *  content-key second layer that preserves the previous VALUE reference when
 *  a recompute produces equal content. Single-slot cache (last inputs only) —
 *  callers create one per consumer, not one shared instance. */
export function createDerivedCache<Inputs extends readonly unknown[], Value>({
  compute,
  contentKey,
}: Readonly<{
  compute: (...inputs: Inputs) => Value;
  contentKey: (value: Value) => string;
}>): (...inputs: Inputs) => Value {
  let lastInputs: Inputs | null = null;
  let lastKey: string | null = null;
  let lastValue: Value;

  return (...inputs: Inputs): Value => {
    if (
      lastInputs !== null &&
      lastInputs.length === inputs.length &&
      lastInputs.every((input, index) => input === inputs[index])
    ) {
      return lastValue;
    }
    const value = compute(...inputs);
    const key = contentKey(value);
    // Equal content → keep the previous reference (render stability); new
    // content (or first run, lastKey null) → adopt the fresh value.
    if (lastKey !== key) lastValue = value;
    lastInputs = inputs;
    lastKey = key;
    return lastValue;
  };
}

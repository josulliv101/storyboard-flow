// Graph — the shared frozen empties.
//
// The bottom of this folder's dependency order: imports `../types` and nothing
// else, and every other module here may import it.
//
// These were module-private constants while the graph was one file. Splitting it
// made them shared, so they are exported — but only WITHIN this folder. None is
// re-exported from `./index`, because a consumer holding `NO_IDS` by reference
// and mutating it would corrupt every empty answer the graph ever gives.
//
// That sentence used to carry an exception for `NO_DEAD_REVS`, "which
// ./serialize genuinely needs to build a graph that has removed nothing". There
// is no such constant: it belonged to the per-id tombstone store that
// `Graph.revFloor` replaced, and the export went with the store. A named
// exception to a rule, pointing at nothing, is the worst kind of stale comment
// — it reads as permission.

import type { NodeId } from "../types";

// ---------------------------------------------------------------------------
// Shared empties
// ---------------------------------------------------------------------------
//
// Frozen module-level constants rather than a fresh `[]` / `new Map()` per
// call. `getChildren` is called once per rendered row per frame, and a fresh
// array each time defeats every `useMemo` / `Object.is` comparison downstream —
// the caller sees a new identity and re-renders even though nothing changed.

export const NO_IDS: readonly NodeId[] = Object.freeze([]);

/**
 * A permanently empty `ReadonlyMap` that REFUSES to be written to.
 *
 * `Object.freeze` is the whole answer for `NO_IDS` above and is no answer at
 * all here: a Map's entries live in an internal slot, so freezing the object
 * leaves `map.set(...)` working exactly as before. The two constants below were
 * therefore protected in name only, and the difference was invisible because
 * the declared type is `ReadonlyMap` and TypeScript will not let a well-behaved
 * consumer try.
 *
 * WHAT THAT COST, measured through the public surface. These are PROCESS-WIDE
 * singletons and `emptyGraph` hands them out directly, so one cast and one
 * `.set` reached every graph in the process at once:
 *
 *   two independently built empty graphs shared the same map   true
 *   a write through the ReadonlyMap succeeded                  true
 *   it was visible in the OTHER graph                          true
 *
 * The file header argues these are safe because none is re-exported from
 * `./index`. That is true of the BINDINGS and false of the VALUES: every empty
 * graph publishes them as `placementsByContentKey` and `ownerBySourceKey`, and
 * so does every graph whose registry declares no `contentKey` — which is the
 * ordinary case, not an edge one. A guard on one door where the hazard has
 * several is the same shape review 3 kept finding.
 *
 * Sharing them is deliberate and stays: `getChildren` and its neighbours are
 * read once per rendered row per frame, and a fresh empty map per call defeats
 * every `useMemo` and `Object.is` downstream. So the fix is to make the shared
 * value genuinely immutable rather than to stop sharing it.
 *
 * REFUSES rather than no-ops. A silent no-op would leave a consumer believing a
 * write landed, which is the failure mode this package refuses everywhere else
 * — and a throw here can only be reached by code that has already cast away
 * `ReadonlyMap`, so it cannot surprise a caller who respected the type.
 */
function emptyFrozenMap<K, V>(field: string): ReadonlyMap<K, V> {
  const map = new Map<K, V>();
  const refuse = (method: string) => (): never => {
    throw new TypeError(
      `nested-collections: ${method}() on the shared empty ${field}. This map is a ` +
        `process-wide singleton published by every graph that has no entries, so writing ` +
        `to it would change every one of them at once. Build your own Map from it instead.`,
    );
  };
  Object.defineProperties(map, {
    set: { value: refuse("set") },
    delete: { value: refuse("delete") },
    clear: { value: refuse("clear") },
  });
  // Belt and braces, and NOT the mechanism: this stops a property being added
  // or the refusals being swapped back out. The entries are protected by the
  // three overrides above, because freezing cannot reach the internal slot they
  // live in.
  return Object.freeze(map);
}

export const NO_PLACEMENTS: ReadonlyMap<string, readonly NodeId[]> =
  emptyFrozenMap("placementsByContentKey");
export const NO_OWNERS: ReadonlyMap<string, NodeId> =
  emptyFrozenMap("ownerBySourceKey");
/**
 * The revision every node is seeded at, and the floor an empty graph carries.
 *
 * ONE, NOT ZERO, and that is the whole reason this is a named constant rather
 * than a literal at four doors. `getSubtreeRev` answers `0` for an id the graph
 * does not hold, so `0` has to be a value no LIVE node can carry — otherwise a
 * never-edited node reads 0 before its removal and 0 after it, and
 * `commitGraph`, which decides whom to notify by comparing that number across
 * the commit, never tells the deleted node's own subscribers. Seeding at 0 is
 * what made the previous design need a tombstone left behind purely so there
 * was something different to compare against.
 */
export const INITIAL_REV = 1;


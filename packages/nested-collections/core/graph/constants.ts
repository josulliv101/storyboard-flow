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
export const NO_PLACEMENTS: ReadonlyMap<string, readonly NodeId[]> = new Map();
export const NO_OWNERS: ReadonlyMap<string, NodeId> = new Map();
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


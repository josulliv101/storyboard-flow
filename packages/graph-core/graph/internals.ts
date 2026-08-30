// Graph — shared frozen empties.
//
// The bottom of this folder's dependency order: imports `../types` and nothing
// else, and every other module here may import it.
//
// These were module-private constants while the graph was one file. Splitting it
// made them shared, so they are exported — but only WITHIN this folder. None is
// re-exported from `./index`, because a consumer holding `NO_IDS` by reference
// and mutating it would corrupt every empty answer the graph ever gives. The one
// exception is `NO_DEAD_REVS`, which ./serialize genuinely needs to build a graph
// that has removed nothing.

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
/** Shared empty tombstone store. A graph that has never removed anything holds
 *  this one, by reference. */
export const NO_DEAD_REVS: ReadonlyMap<NodeId, number> = new Map();


// Graph — invertPatch — the reversal that backs undo.
//
// Split out of the former single-file `patches.ts`; see ./index.ts.

import {
  makeDataChange,
  type WidenedNodeType,
  type Move,
  type Patch,
} from "../types";

// invertPatch
// ---------------------------------------------------------------------------

/**
 * Swaps before/after, flips inserted<->removed PRESERVING ARRAY ORDER, and
 * swaps move endpoints. Nothing else. Pure, total, never fails.
 *
 * Why array order survives untouched, when the two directions walk it in
 * opposite directions: `applyPatch` owns the walk direction ("inserted" forward,
 * "removed" backward), so the inverter does not have to reverse anything — and
 * must not, or the two would reverse it twice.
 *
 * Why moves invert by swapping endpoints per move, with the array order kept:
 * `fromIndex` is each node's position in the PRE-state array, and re-inserting
 * a removed set at its original indices in ascending order restores the array
 * exactly. `applyCommand` emits moves in document order, which is that
 * ascending order, so the same forward walk serves both directions.
 */
export function invertPatch<Ts extends readonly WidenedNodeType[], S>(
  patch: Patch<Ts, S>,
): Patch<Ts, S> {
  switch (patch.type) {
    case "moved": {
      const moves: Move[] = patch.moves.map((move) => ({
        nodeId: move.nodeId,
        fromParentId: move.toParentId,
        fromIndex: move.toIndex,
        toParentId: move.fromParentId,
        toIndex: move.fromIndex,
      }));
      return { type: "moved", moves };
    }
    case "inserted":
      return { type: "removed", placements: patch.placements };
    case "removed":
      return { type: "inserted", placements: patch.placements };
    case "data-changed": {
      const changes = patch.changes.map((change) =>
        makeDataChange<Ts>(
          change.nodeId,
          change.kind,
          change.after,
          change.before,
        ),
      );
      return { type: "data-changed", changes };
    }
  }
}

// ---------------------------------------------------------------------------

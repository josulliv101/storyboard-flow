// Graph — patch queries.
//
// Split out of the former single-file `patches.ts`; see ./index.ts.

import {
  type WidenedNodeType,
  type NodeId,
  type Patch,
} from "../types";

import { EMPTY_IDS } from "./constants";
import { containerChildrenState } from "./predicates";

// Patch queries
// ---------------------------------------------------------------------------

/** Every node id the patch mentions, deduped, in first-seen order. Parents are
 *  included: a move's endpoints and a placement's parent are nodes whose
 *  rollups changed, and a caller notifying only the named nodes reproduces the
 *  "deep move never re-renders any ancestor" hole. */
export function patchTouchedNodeIds<Ts extends readonly WidenedNodeType[], S>(
  patch: Patch<Ts, S>,
): readonly NodeId[] {
  const seen = new Set<NodeId>();
  const ordered: NodeId[] = [];
  const add = (id: NodeId): void => {
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  };
  switch (patch.type) {
    case "moved":
      for (const move of patch.moves) {
        add(move.nodeId);
        add(move.fromParentId);
        add(move.toParentId);
      }
      break;
    case "inserted":
    case "removed":
      for (const placement of patch.placements) {
        add(placement.node.id);
        add(placement.parentId);
      }
      break;
    case "data-changed":
      for (const change of patch.changes) add(change.nodeId);
      break;
  }
  return ordered;
}

/**
 * Removed containers whose `ChildrenState` was not `loaded` — the ids the change
 * feed reports so a consumer can defer the hard delete instead of orphaning
 * storage it never read.
 *
 * CAVEAT the consumer must honour, because this list cannot express it: a
 * `reference` placement does NOT own its subtree, and a `missing` one is already
 * confirmed gone. Both appear here (they are not `loaded`), and hard-deleting
 * either is wrong — the only id in this list that names storage worth deleting
 * is an `unloaded` owner. Read the node's state before acting on the id.
 */
export function patchDetachedSubtrees<Ts extends readonly WidenedNodeType[], S>(
  patch: Patch<Ts, S>,
): readonly NodeId[] {
  if (patch.type !== "removed") return EMPTY_IDS;
  const detached: NodeId[] = [];
  for (const placement of patch.placements) {
    const state = containerChildrenState(placement.node);
    if (state !== null && state.status !== "loaded") {
      detached.push(placement.node.id);
    }
  }
  return detached;
}

export function isEmptyPatch<Ts extends readonly WidenedNodeType[], S>(
  patch: Patch<Ts, S>,
): boolean {
  switch (patch.type) {
    case "moved":
      return patch.moves.length === 0;
    case "inserted":
    case "removed":
      return patch.placements.length === 0;
    case "data-changed":
      return patch.changes.length === 0;
  }
}

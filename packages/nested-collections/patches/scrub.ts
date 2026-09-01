// Graph — the non-undoable write scrubbing.
//
// Split out of the former single-file `patches.ts`; see ./index.ts.

import {
  makeCollectionNode,
  makeLeafNode,
  type GraphNode,
  type WidenedNodeType,
  type NodeId,
  type Patch,
  type Placement,
} from "../types";

import { EMPTY_IDS } from "./constants";

// The non-undoable write scrubbing
// ---------------------------------------------------------------------------

/**
 * Surgical scrubbing of ONE patch, for a non-undoable write.
 *
 * `applyNonUndoableWrite` is the non-undoable content write: a server stamped a field, a
 * thumbnail arrived. The user must not be able to Ctrl-Z it, and — more
 * importantly — a DORMANT `before` from an older entry must not be able to
 * clobber it later. So for every written node:
 *
 *   - "data-changed": DROP that node's entry. Content changes are per-node
 *     independent within a patch, so every other change in the entry stays
 *     perfectly invertible. The user loses undo of their own edit to that one
 *     node, which is correct — the server has since overwritten it.
 *   - "inserted"/"removed": REWRITE that node's captured `data` to the
 *     replacement, so a dormant restore cannot resurrect stale content.
 *   - "moved": untouched. Structural patches carry no content at all.
 *
 * The alternative shipped in a predecessor design — a version stamp that
 * invalidates the whole entry — means every remote write destroys undo from
 * that entry down. This costs O(entries x changes), where `historyLimit` bounds `entries` only
 * when a consumer set one, and destroys one node's
 * worth.
 *
 * Returns null when the patch is left empty, and the caller drops the entry.
 */
/**
 * The ids `scrubPatchForWrite` can actually touch in this patch.
 *
 * THE COMPANION TO THAT FUNCTION, and it lives here so the two cannot drift.
 * A caller reporting which ids a scrub affected has to ask the same question
 * the scrub answers, and ./commands was asking a different one — it used
 * `patchTouchedNodeIds`, which for an `inserted` or `removed` patch also names
 * every placement's PARENT. A parent is a node whose rollup changed, which is
 * the right answer for notification and the wrong one here: the scrub rewrites
 * a placement's captured `data`, and a parent's data is not in the patch at
 * all. So `Store.applyNonUndoableWrite` reported ids whose history it had not
 * touched, and a consumer using that list to tell a user "undo is gone for
 * these" showed warnings that were not true.
 *
 * "moved" yields nothing: structural patches carry no content, which is exactly
 * why `scrubPatchForWrite` returns them untouched.
 */
export function scrubbableNodeIds<Ts extends readonly WidenedNodeType[], S>(
  patch: Patch<Ts, S>,
): readonly NodeId[] {
  switch (patch.type) {
    case "moved":
      return EMPTY_IDS;
    case "data-changed":
      return patch.changes.map((change) => change.nodeId);
    case "inserted":
    case "removed":
      // The placement's own node, never its parent.
      return patch.placements.map((placement) => placement.node.id);
  }
}

export function scrubPatchForWrite<Ts extends readonly WidenedNodeType[], S>(
  patch: Patch<Ts, S>,
  replacements: ReadonlyMap<NodeId, unknown>,
): Patch<Ts, S> | null {
  if (replacements.size === 0) return patch;

  switch (patch.type) {
    case "moved":
      return patch;

    case "data-changed": {
      const kept = patch.changes.filter(
        (change) => !replacements.has(change.nodeId),
      );
      if (kept.length === 0) return null;
      // Identity is preserved when nothing was dropped, so an untouched history
      // entry stays reference-equal and a consumer diffing the stacks sees no
      // churn.
      if (kept.length === patch.changes.length) return patch;
      return { type: "data-changed", changes: kept };
    }

    case "inserted":
    case "removed": {
      let rewrote = false;
      const next = patch.placements.map((placement): Placement<Ts, S> => {
        const node = placement.node;
        if (!replacements.has(node.id)) return placement;
        // A sealed node carries `raw`, not parsed data, and it is not
        // editable — so it can never be a non-undoable write target and its bytes must
        // survive untouched.
        if (node.sealed) return placement;
        const replacement = replacements.get(node.id);
        rewrote = true;
        const rebuilt: GraphNode<Ts, S> = node.container
          ? makeCollectionNode<Ts, S>(
              node.id,
              node.kind,
              replacement,
              node.children,
              node.summary,
            )
          : makeLeafNode<Ts>(node.id, node.kind, replacement);
        return { node: rebuilt, parentId: placement.parentId, index: placement.index };
      });
      if (!rewrote) return patch;
      return patch.type === "inserted"
        ? { type: "inserted", placements: next }
        : { type: "removed", placements: next };
    }
  }
}

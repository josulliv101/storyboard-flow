import {
  getChildren,
  isSameOrAncestor,
  parseNodeId,
  type CollectionsGraph,
  type NodeId,
} from "@storyboard/ui/dnd-collections";

// Where a NEW card lands when the gesture carries no pointer position — the
// Collection tool's click/keyboard path and the item rail's Paste. Both used
// to answer this question themselves and drifted; this is the one rule.

export type InsertPlacement = Readonly<{
  /** The collection the new nodes join. */
  parentId: NodeId;
  /** Index within that collection's children. */
  toIndex: number;
  /** The card the insert follows, or null when it appended. For announcements. */
  afterId: NodeId | null;
}>;

/**
 * Resolve a selection-aware insert position.
 *
 * The rule: land right AFTER the most recently selected card, inside THAT
 * card's own timeline — which may be any strip on the board, not just the
 * focused one (clicking the rail or the tool never clears the selection, so
 * this works for mouse and keyboard alike). With nothing selected, append to
 * the focused collection: the one spot that needs no explanation.
 *
 * The selection only counts when its parent lies INSIDE the focused
 * collection's subtree (the focused collection itself or a descendant —
 * i.e. a strip the board is actually showing). Selection survives drill-in
 * navigation in this app, so without that guard the copy → drill-in → Paste
 * flow would fire the paste back into the timeline the user just left, at a
 * card that is no longer on screen. Same for the tool: after a drill-in the
 * stale selection would plant the new collection a level up.
 *
 * Pure graph math — no store, no React — so both call sites share it and it
 * unit-tests directly.
 */
export function resolveInsertPlacement(
  graph: CollectionsGraph,
  /** The live selection, in selection order (a Set iterates insertion-first). */
  selectedIds: Iterable<NodeId>,
  /** The open collection's id (a timeline id, which is also its node id). */
  focusedId: string,
): InsertPlacement {
  const focusedNodeId = parseNodeId(focusedId);
  // The LAST entry is the most recent pick — the card a multi-select last
  // touched, and the one the user is looking at.
  let selectedId: NodeId | undefined;
  for (const id of selectedIds) selectedId = id;

  if (selectedId !== undefined) {
    const selectedParentId = graph.parentById.get(selectedId) ?? null;
    // A root has no parent and can't take a sibling. `isSameOrAncestor` is
    // cycle-guarded, so a corrupt parent chain degrades to the append below
    // instead of hanging.
    if (selectedParentId !== null && isSameOrAncestor(graph, focusedNodeId, selectedParentId)) {
      const siblings = getChildren(graph, selectedParentId);
      const at = siblings.indexOf(selectedId);
      if (at >= 0) return { parentId: selectedParentId, toIndex: at + 1, afterId: selectedId };
    }
  }

  return {
    parentId: focusedNodeId,
    toIndex: getChildren(graph, focusedNodeId).length,
    afterId: null,
  };
}

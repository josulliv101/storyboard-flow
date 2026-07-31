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
/**
 * Convert a placement index into the index `move-nodes` actually wants.
 *
 * `resolveInsertPlacement` answers in PRE-removal terms — "this many cards from
 * the start of the list you can see" — which is exactly right for `add-nodes`,
 * where nothing leaves the list. `move-nodes` documents the opposite convention
 * (see `CollectionsCommand`): its `toIndex` is read AFTER the moved nodes have
 * been taken out of the target's children.
 *
 * When the two disagree, a cut+paste lands too far right. Cut the first two
 * cards of [A,B,C,D,E] and paste after D: the visible index is 4, but removing
 * A and B first leaves [C,D,E], where 4 is past the end and clamps — so the
 * items append instead of landing after D. Subtracting the moved siblings that
 * sat BEFORE the destination is the whole correction.
 *
 * Only siblings in the SAME parent count. Nodes arriving from another
 * collection do not shift this list, because they were never in it.
 */
export function toPostRemovalIndex(
  graph: CollectionsGraph,
  parentId: NodeId,
  movingIds: Iterable<NodeId>,
  preRemovalIndex: number,
): number {
  const siblings = getChildren(graph, parentId);
  let removedBefore = 0;
  for (const id of movingIds) {
    const at = siblings.indexOf(id);
    if (at >= 0 && at < preRemovalIndex) removedBefore += 1;
  }
  // Never negative: a caller passing an index inside the moved run itself
  // (paste after a card you just cut) would otherwise ask for a position that
  // does not exist.
  return Math.max(0, preRemovalIndex - removedBefore);
}

export function resolveInsertPlacement(
  graph: CollectionsGraph,
  /** The live selection, in selection order (a Set iterates insertion-first). */
  selectedIds: Iterable<NodeId>,
  /** The open collection's id (a timeline id, which is also its node id). */
  focusedId: string,
  /**
   * The ANCHOR, when there is one — the card showing the `⋮` and its count.
   *
   * This is the destination the user can SEE (R9.2), and the reason it is a
   * parameter rather than derived from `selectedIds` below: right-clicking an
   * already-selected card re-anchors WITHOUT changing the selection, so the
   * selection's own order cannot answer where the paste should land. Before
   * this, "aim at that one" moved the `⋮` and left the paste where it was.
   *
   * Falls back to the last selected id when absent or no longer in the graph,
   * which is what every non-anchor caller (the Collection tool, native drops)
   * still passes.
   */
  anchorId?: NodeId | null,
): InsertPlacement {
  const focusedNodeId = parseNodeId(focusedId);
  // The anchor first; otherwise the LAST entry, which is the most recent pick.
  let selectedId: NodeId | undefined;
  for (const id of selectedIds) selectedId = id;
  if (anchorId != null && graph.nodesById.has(anchorId)) selectedId = anchorId;

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

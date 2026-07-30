import { getChildren, type CollectionsGraph, type NodeId } from "@storyboard/ui/dnd-collections";

// WHICH card the selection is "at" — the one the floating toolbar attaches to
// and the one a paste lands after.
//
// Deliberately DERIVED rather than stored. The selection already carries the
// answer: `selectedIds` is a Set, Sets iterate in insertion order, and every
// mutator appends — `setSelection([id])` rebuilds around the clicked card,
// `toggleSelected(id)` pushes a newly added one onto the end. So "the card the
// user last touched that is still selected" is just the last entry, and adding
// an `anchorId` field to the store would have been a second source of truth for
// something the first one already knows. `resolveInsertPlacement` has been
// reading the selection this way since before there was a toolbar.
//
// The one case the Set cannot answer alone is REMOVAL. Ctrl+clicking the anchor
// off drops it from the set, and what remains last in INSERTION order is
// whichever card happened to be picked before it — an order the user cannot see.
// There the anchor moves to the last remaining card in GRID order, which they
// can. Detecting that case is the only reason this takes a `previous`.

export type SelectionAnchorMemo = Readonly<{
  anchorId: NodeId | null;
  /** The exact Set the anchor was resolved against. Compared by IDENTITY —
   *  the store preserves a snapshot field's reference while its slice is
   *  unchanged, so this is a reliable "nothing moved" test and not a guess. */
  selectedIds: ReadonlySet<NodeId>;
}>;

function lastOf(ids: Iterable<NodeId>): NodeId | null {
  let last: NodeId | null = null;
  for (const id of ids) last = id;
  return last;
}

/**
 * The last SELECTED sibling of `nodeId`, in the order its parent renders them.
 *
 * Grid order is the parent's children array, which is exactly what the grid
 * lays out left-to-right, top-to-bottom and the strip lays out end-to-end. A
 * selection can span parents; only the departing anchor's own parent is
 * consulted, because "the next one along" means nothing across two timelines.
 */
function lastSelectedSiblingInGridOrder(
  graph: CollectionsGraph,
  nodeId: NodeId,
  selectedIds: ReadonlySet<NodeId>,
): NodeId | null {
  const parentId = graph.parentById.get(nodeId) ?? null;
  if (parentId === null) return null;
  let last: NodeId | null = null;
  for (const childId of getChildren(graph, parentId)) {
    if (selectedIds.has(childId)) last = childId;
  }
  return last;
}

/**
 * Resolve the anchor for a selection.
 *
 * Pass the previous result back in; the memo is what makes the answer STABLE.
 * Without it, the grid-order fallback below would apply for exactly one render
 * and then the insertion-order rule would pull the anchor somewhere else on the
 * next one, with no input from the user — the toolbar would hop between cards
 * on an unrelated re-render.
 */
export function resolveAnchorId(
  graph: CollectionsGraph,
  selectedIds: ReadonlySet<NodeId>,
  previous: SelectionAnchorMemo | null,
): NodeId | null {
  if (selectedIds.size === 0) return null;

  // Nothing about the selection changed, so neither does the anchor. Identity,
  // not contents: the store guarantees the reference survives a no-op.
  if (previous !== null && previous.selectedIds === selectedIds) {
    if (previous.anchorId !== null && selectedIds.has(previous.anchorId)) return previous.anchorId;
  }

  // The anchor was deselected (or deleted) while other cards stayed selected.
  // Insertion order would surface whichever card was picked before it, so use
  // the order that is on screen instead.
  const droppedAnchor =
    previous !== null &&
    previous.anchorId !== null &&
    previous.selectedIds.has(previous.anchorId) &&
    !selectedIds.has(previous.anchorId);
  if (droppedAnchor && previous.anchorId !== null) {
    const sibling = lastSelectedSiblingInGridOrder(graph, previous.anchorId, selectedIds);
    // No selected sibling under that parent — the rest of the selection lives
    // elsewhere entirely, so there is no "next one along" to move to.
    if (sibling !== null) return sibling;
  }

  return lastOf(selectedIds);
}

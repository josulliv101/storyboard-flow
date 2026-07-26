// The FLAT reading of a timeline: every media item in the focused closure, in
// playback order, with collections walked THROUGH rather than shown. What the
// strip's "show all items in order" mode renders.
//
// The graph twin of `compilePlaybackManifest`'s walk — same depth-first order,
// same child order — but over the live GRAPH rather than stored documents, and
// with one deliberate difference in MEMBERSHIP (see below). Keeping the two
// orders identical is what stops the flat strip and the preview disagreeing
// about what comes next.
//
// MEMBERSHIP DIFFERS, ON PURPOSE. The manifest emits what PLAYS, so it windows
// a trimmed collection clip down to the leaves overlapping its trim range and
// drops the rest. This emits what the timeline CONTAINS, because the flat strip
// is an editing surface: an item trimmed out of playback still exists, is still
// selectable, and still has to be reachable. So the manifest's leaves are a
// SUBSEQUENCE of this walk, not an equal set — the invariant its parity test
// asserts.

import { getChildren, type CollectionsGraph, type NodeId } from "./engine";

export type FlatItem = Readonly<{
  nodeId: NodeId;
  /**
   * The collection ids from the focused root down to this item's own parent —
   * last entry IS the parent. Empty for a direct child of the focused
   * timeline, which has no collection above it inside this view.
   *
   * Carried because the flat strip needs it twice over: to name the item's
   * collection on the card (a flat run loses that context, which is why
   * reordering is disabled in it), and to resolve a palette drop, which lands
   * in the LEFT neighbour's parent.
   */
  collectionPath: readonly NodeId[];
}>;

/**
 * Every media node under `focusedId`, depth-first in child order.
 *
 * Collections are descended into and never emitted — including DISABLED ones.
 * A disabled collection's children still exist and still show (muted, as
 * "PARENT OFF"), exactly as they do on the nested board; disabling changes
 * what plays, not what the timeline contains.
 *
 * `maxDepth` caps recursion as defensive insurance against pathological data,
 * matching the board's own MAX_SUBTREE_DEPTH. The path-scoped `seen` set is
 * the same kind of insurance: the graph is a single-parent tree by
 * construction, so a cycle cannot occur in a valid one — but this runs on the
 * render path, where hanging is a far worse failure than truncating. Unlike
 * the manifest compiler, which throws on a cycle because it runs server-side
 * and can afford to fail loudly, this simply stops descending.
 */
export function flattenMediaOrder(
  graph: CollectionsGraph,
  focusedId: NodeId,
  maxDepth = 12,
): FlatItem[] {
  const items: FlatItem[] = [];

  const walk = (
    collectionId: NodeId,
    path: readonly NodeId[],
    depth: number,
    seen: ReadonlySet<NodeId>,
  ): void => {
    if (depth > maxDepth || seen.has(collectionId)) return;
    const nextSeen = new Set(seen);
    nextSeen.add(collectionId);

    for (const childId of getChildren(graph, collectionId)) {
      const node = graph.nodesById.get(childId);
      if (!node) continue;
      if (node.kind === "media") {
        items.push({ nodeId: childId, collectionPath: path });
        continue;
      }
      walk(childId, [...path, childId], depth + 1, nextSeen);
    }
  };

  walk(focusedId, [], 0, new Set());
  return items;
}

/**
 * The item immediately LEFT of a flat boundary, and where a palette drop there
 * belongs: that neighbour's own collection, right after it.
 *
 * A flat run spans many parents, so a drop position cannot name a parent by
 * itself — this is the rule that gives it one. At the very start (boundary 0)
 * there is no left neighbour, so the drop goes to the head of the focused
 * timeline.
 *
 * `boundary` is the gap index in the FLAT list: 0 is before the first item,
 * `items.length` is after the last.
 */
export function resolveFlatDropTarget(
  graph: CollectionsGraph,
  items: readonly FlatItem[],
  focusedId: NodeId,
  boundary: number,
): Readonly<{ parentId: NodeId; index: number }> {
  const clamped = Math.max(0, Math.min(items.length, Math.trunc(boundary)));
  if (clamped === 0) return { parentId: focusedId, index: 0 };

  const left = items[clamped - 1];
  const parentId = left.collectionPath[left.collectionPath.length - 1] ?? focusedId;
  const siblings = getChildren(graph, parentId);
  const leftIndex = siblings.indexOf(left.nodeId);
  // A left neighbour that is somehow not among its parent's children means the
  // flat list is stale against the graph; appending is the safe reading.
  return {
    parentId,
    index: leftIndex < 0 ? siblings.length : leftIndex + 1,
  };
}

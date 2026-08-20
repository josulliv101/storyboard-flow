import { flattenMediaOrder, type FlatItem } from "@storyboard/timeline-domain";
import { parseNodeId, type CollectionsGraph, type NodeId } from "@storyboard/collections-core";

// WHAT PLAYS EITHER SIDE of the item whose details are open — the two clips the
// details modal shows flanking its subject.
//
// Pure and framework-free (a .ts, not a .tsx) so the app's vitest can parse it:
// "what comes next" is arithmetic over an order, and the interesting cases are
// all structural — a neighbour inside a nested collection, a neighbour two
// collections away, an item at the very end with nothing after it.

/** The clips either side, by node id. `null` where the sequence runs out. */
export type DetailsNeighbours = Readonly<{
  previousId: string | null;
  nextId: string | null;
  /** Where the subject sits in the flat order, and how long that order is —
   *  reported so the UI can say "3 of 41" without flattening a second time. */
  index: number;
  total: number;
}>;

const NONE: DetailsNeighbours = {
  previousId: null,
  nextId: null,
  index: -1,
  total: 0,
};

/**
 * The media items immediately before and after `nodeId` in PLAYBACK order.
 *
 * COLLECTIONS ARE WALKED THROUGH, NOT PAST, which is the whole reason this
 * defers to `flattenMediaOrder` rather than reading the subject's siblings. The
 * item after a clip may be the first media inside the next collection, or
 * inside a collection inside that one; the item after the LAST clip of a
 * collection is whatever plays next above it. Sibling arithmetic answers none
 * of those, and re-deriving the descent here would be a second implementation
 * of an order the preview and the flat strip already agree on — the exact
 * disagreement `flattenMediaOrder`'s own note exists to prevent.
 *
 * FLATTENED FROM THE ROOT, not from the focused collection, so the sequence is
 * the timeline's rather than the current view's. Opening the last clip of a
 * scene and seeing the first clip of the next one is the point; stopping at the
 * folder edge would make the neighbours a fact about where you happen to be
 * standing.
 *
 * WHAT IT CANNOT SEE. The walk reads the live graph, and a collection that has
 * not been hydrated has no children in it yet — so its media are invisible here
 * exactly as they are to the flat strip. The effect is that a neighbour across
 * an unvisited collection may be missing rather than wrong: the sequence skips
 * to the next thing it can see. This matches the flat strip rather than
 * inventing a second answer, and the fix for both is hydration, not a different
 * traversal.
 *
 * Returns `index: -1` when the subject is not a media item in the order at all
 * — a collection, or a node from another tree — and the caller draws no
 * neighbours rather than guessing.
 */
export function detailsNeighbours(
  graph: CollectionsGraph,
  rootId: string | null,
  nodeId: string | null,
): DetailsNeighbours {
  if (rootId === null || nodeId === null) return NONE;
  const items: readonly FlatItem[] = flattenMediaOrder(graph, parseNodeId(rootId));
  if (items.length === 0) return NONE;

  const subject = parseNodeId(nodeId) as NodeId;
  const index = items.findIndex((item) => item.nodeId === subject);
  if (index === -1) return { ...NONE, total: items.length };

  return {
    previousId: index > 0 ? (items[index - 1]!.nodeId as string) : null,
    nextId: index < items.length - 1 ? (items[index + 1]!.nodeId as string) : null,
    index,
    total: items.length,
  };
}

/**
 * The id to flatten from: the graph's own root.
 *
 * A focused graph is built rooted at the timeline the board opened, so this is
 * the widest order the client actually holds — wider than the collection being
 * viewed, which is what lets neighbours cross a collection edge. More than one
 * root is not a shape this view produces; the first is taken rather than
 * merging them, because a sequence spanning two unrelated roots would describe
 * a playback order that does not exist.
 */
export function flatOrderRootId(graph: CollectionsGraph): string | null {
  return (graph.rootIds[0] as string | undefined) ?? null;
}

/** The whole media order, and where the subject sits in it. */
export type DetailsWindow = Readonly<{
  /** Every clip id in playback order — one row position each. */
  ids: readonly string[];
  /** The subject's index. -1 when it is not in the order. */
  centre: number;
}>;

const EMPTY_WINDOW: DetailsWindow = { ids: [], centre: -1 };

/**
 * The whole playback order, with the subject's place in it.
 *
 * EVERY CLIP GETS A ROW POSITION, not just the visible three, and that is what
 * makes the strip slide rigidly. The row is one element translated by the
 * subject's index, so advancing changes that index and the transform animates
 * one step — every panel travelling the same distance because they are all
 * children of the thing being moved.
 *
 * The obvious economy — render a window of five and re-centre it on each
 * advance — does not work, and the way it fails is worth recording: with the
 * window re-anchored every time, the subject is always the middle of it, so the
 * offset is always the same and the transform never changes. The row stays
 * still and the CONTENT shifts underneath, which is exactly the "not moving as
 * one piece" this replaced. Its geometry is right and its motion is wrong,
 * which is the hardest kind of wrong to see in a screenshot.
 *
 * The cost is bounded elsewhere: the caller mounts a full panel only for the
 * positions that can be seen and a sized placeholder for the rest, so a long
 * timeline costs empty boxes rather than video elements.
 */
export function detailsWindow(
  graph: CollectionsGraph,
  rootId: string | null,
  nodeId: string | null,
): DetailsWindow {
  if (rootId === null || nodeId === null) return EMPTY_WINDOW;
  const items = flattenMediaOrder(graph, parseNodeId(rootId));
  if (items.length === 0) return EMPTY_WINDOW;

  const subject = parseNodeId(nodeId) as NodeId;
  const centre = items.findIndex((item) => item.nodeId === subject);
  if (centre === -1) return EMPTY_WINDOW;
  return { ids: items.map((item) => item.nodeId as string), centre };
}

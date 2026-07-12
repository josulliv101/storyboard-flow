import {
  type CollectionItemNode,
  type CollectionsGraph,
  type NodeId,
  type Result,
  getChildren,
  isSameOrAncestor,
} from "./graph";
import { type AddNodesCommand, type MoveNodesCommand } from "./commands";

// The intent layer answers "what did the user seem to mean?" from raw
// geometry (which droppable, where in its rect), completely separately from
// "is that legal and what mutation happens" (the command reducer). Pointer
// drags resolve here; a future keyboard path can produce the same
// DropIntents from key semantics and share everything downstream.

export type DropTarget =
  | Readonly<{ type: "node"; nodeId: NodeId }>
  | Readonly<{ type: "panel"; collectionId: NodeId }>;

/** Droppable-id string protocol shared by the React layer's registrations. */
export function encodeDropTarget(target: DropTarget): string {
  return target.type === "node" ? `node:${target.nodeId}` : `panel:${target.collectionId}`;
}

export function decodeDropTarget(id: string): DropTarget | null {
  const sep = id.indexOf(":");
  if (sep === -1) return null;
  const prefix = id.slice(0, sep);
  const value = id.slice(sep + 1);
  if (!value) return null;
  if (prefix === "node") return { type: "node", nodeId: value as NodeId };
  if (prefix === "panel") return { type: "panel", collectionId: value as NodeId };
  return null;
}

export type DropIntent =
  | Readonly<{ type: "insert-adjacent"; side: "before" | "after"; targetId: NodeId }>
  | Readonly<{ type: "nest-inside"; collectionId: NodeId }>
  | Readonly<{ type: "append-to-collection"; collectionId: NodeId }>
  /**
   * Insertion at a boundary index computed WITHOUT the neighbor cards —
   * virtualized views resolve pointer offset -> index from virtualizer
   * measurements, since most cards aren't mounted. `index` is a VISIBLE
   * boundary (0..children.length) over the full children list: dragged
   * cards still occupy their slots during a drag, and the post-removal
   * conversion happens in `resolveCommandFromIntent`, nowhere else.
   */
  | Readonly<{ type: "insert-at-index"; collectionId: NodeId; index: number }>;

export type RectLike = Readonly<{ left: number; top: number; width: number; height: number }>;

/** A panel child's card rect, for gap resolution inside panel drops. */
export type PanelChildRect = Readonly<{ id: NodeId; rect: RectLike }>;

/** Central band of a collection card that means "nest inside" rather than "insert next to". */
export const NEST_HOTSPOT_MIN = 0.25;
export const NEST_HOTSPOT_MAX = 0.75;

/**
 * Pure geometry -> intent. Returns null only when there's nothing
 * meaningful to do: hovering a dragged node's own card. Descendants of a
 * dragged collection DO resolve intents — they're geometrically hoverable
 * (cards stay in place during a drag) and the resulting intent is what the
 * interaction layer flags as an invalid (cycle) preview; the reducer
 * rejects it at commit regardless.
 */
export function resolveDropIntent(args: {
  graph: CollectionsGraph;
  target: DropTarget;
  targetRect: RectLike;
  point: Readonly<{ x: number; y: number }>;
  activeIds: readonly NodeId[];
  /**
   * The panel's child-card rects, for panel targets. Without them a pointer
   * in the GAP between two cards (inside the panel, over neither card)
   * degrades to append-to-collection — the flanking cards' rects are what
   * lets it resolve to insert-adjacent between them instead.
   */
  panelChildRects?: readonly PanelChildRect[];
}): DropIntent | null {
  const { graph, target, targetRect, point, activeIds } = args;

  if (target.type === "panel") {
    const between = resolveGapIntent(point, args.panelChildRects ?? [], activeIds);
    return between ?? { type: "append-to-collection", collectionId: target.collectionId };
  }

  // Self-guard: a dragged node's own card is not a drop target. Pointer
  // backends legitimately report it as `over` (it sits dimmed in place) —
  // see the media-strip self-drop bug this guard descends from.
  for (const activeId of activeIds) {
    if (activeId === target.nodeId) return null;
  }

  const node = graph.nodesById.get(target.nodeId);
  if (!node) return null;

  if (node.kind === "collection") {
    const hotspotLeft = targetRect.left + targetRect.width * NEST_HOTSPOT_MIN;
    const hotspotRight = targetRect.left + targetRect.width * NEST_HOTSPOT_MAX;
    if (point.x >= hotspotLeft && point.x <= hotspotRight) {
      return { type: "nest-inside", collectionId: target.nodeId };
    }
  }

  const midpointX = targetRect.left + targetRect.width / 2;
  return {
    type: "insert-adjacent",
    side: point.x < midpointX ? "before" : "after",
    targetId: target.nodeId,
  };
}

/**
 * Pointer inside a panel but over none of its cards: if it sits in the same
 * horizontal row as some card, the user is aiming BETWEEN cards (or at the
 * row's ends), not at the panel — resolve insert-adjacent against the
 * nearest card in that row. Vertical whitespace (below the last row, between
 * rows) stays null, which the caller keeps as append-to-collection.
 */
function resolveGapIntent(
  point: Readonly<{ x: number; y: number }>,
  childRects: readonly PanelChildRect[],
  activeIds: readonly NodeId[]
): DropIntent | null {
  const dragged = new Set(activeIds);

  let nearest: PanelChildRect | null = null;
  let nearestDistance = Infinity;
  for (const child of childRects) {
    // Dragged cards sit dimmed in place; like the droppable filter, they
    // are not anchors — the nearest REAL neighbor should win the gap.
    if (dragged.has(child.id)) continue;
    const { rect } = child;
    if (point.y < rect.top || point.y > rect.top + rect.height) continue; // not this row
    const distance =
      point.x < rect.left
        ? rect.left - point.x
        : Math.max(0, point.x - (rect.left + rect.width));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = child;
    }
  }

  if (!nearest) return null;
  const midpointX = nearest.rect.left + nearest.rect.width / 2;
  return {
    type: "insert-adjacent",
    side: point.x < midpointX ? "before" : "after",
    targetId: nearest.id,
  };
}

/**
 * The collection that would receive the dragged nodes if this intent
 * committed, or null when it can't be determined (target vanished).
 */
export function intentDestination(graph: CollectionsGraph, intent: DropIntent): NodeId | null {
  switch (intent.type) {
    case "nest-inside":
      return intent.collectionId;
    case "append-to-collection":
      return intent.collectionId;
    case "insert-at-index":
      return intent.collectionId;
    case "insert-adjacent":
      return graph.parentById.get(intent.targetId) ?? null;
  }
}

/**
 * Whether committing this intent would be rejected as a cycle — the
 * destination lies inside (or is) one of the dragged nodes. Used for the
 * live "Cannot drop" preview; the reducer independently enforces the same
 * rule at commit, so the preview can never disagree with the outcome.
 */
export function isIntentInvalid(
  graph: CollectionsGraph,
  intent: DropIntent,
  activeIds: readonly NodeId[]
): boolean {
  const destination = intentDestination(graph, intent);
  if (destination === null) return false;
  return activeIds.some((id) => isSameOrAncestor(graph, id, destination));
}

export type IntentRejection = Readonly<{ reason: "missing-node"; nodeId: NodeId }>;

/**
 * Intent -> command, translating on-screen positions into the reducer's
 * post-removal index convention: the insertion index is computed against the
 * target collection's children with the dragged nodes already removed —
 * getting this wrong is exactly the off-by-one class that motivated
 * centralizing it here.
 */
export function resolveCommandFromIntent(
  graph: CollectionsGraph,
  intent: DropIntent,
  draggedIds: readonly NodeId[]
): Result<MoveNodesCommand, IntentRejection> {
  const draggedSet = new Set(draggedIds);

  if (intent.type === "nest-inside" || intent.type === "append-to-collection") {
    const children = getChildren(graph, intent.collectionId);
    const endIndex = children.reduce(
      (count, id) => (draggedSet.has(id) ? count : count + 1),
      0
    );
    return {
      ok: true,
      value: {
        type: "move-nodes",
        nodeIds: draggedIds,
        toParentId: intent.collectionId,
        toIndex: endIndex,
      },
    };
  }

  if (intent.type === "insert-at-index") {
    // Visible boundary -> post-removal index: clamp against the full
    // children list, then subtract dragged nodes sitting before the
    // boundary in this same collection (same convention as the
    // insert-adjacent branch below).
    const siblings = getChildren(graph, intent.collectionId);
    const boundary = Math.max(0, Math.min(intent.index, siblings.length));
    let draggedBeforeBoundary = 0;
    for (let i = 0; i < boundary; i++) {
      if (draggedSet.has(siblings[i])) draggedBeforeBoundary++;
    }
    return {
      ok: true,
      value: {
        type: "move-nodes",
        nodeIds: draggedIds,
        toParentId: intent.collectionId,
        toIndex: boundary - draggedBeforeBoundary,
      },
    };
  }

  const parentId = graph.parentById.get(intent.targetId);
  if (parentId === undefined || parentId === null) {
    return { ok: false, error: { reason: "missing-node", nodeId: intent.targetId } };
  }

  const siblings = getChildren(graph, parentId);
  const targetVisibleIndex = siblings.indexOf(intent.targetId);
  if (targetVisibleIndex === -1) {
    return { ok: false, error: { reason: "missing-node", nodeId: intent.targetId } };
  }

  const boundary = intent.side === "before" ? targetVisibleIndex : targetVisibleIndex + 1;
  // Post-removal index: subtract the dragged nodes sitting before the
  // boundary in this same collection.
  let draggedBeforeBoundary = 0;
  for (let i = 0; i < boundary; i++) {
    if (draggedSet.has(siblings[i])) draggedBeforeBoundary++;
  }

  return {
    ok: true,
    value: {
      type: "move-nodes",
      nodeIds: draggedIds,
      toParentId: parentId,
      toIndex: boundary - draggedBeforeBoundary,
    },
  };
}

/**
 * Intent -> add-nodes command for BRAND-NEW nodes (palette drops). The
 * placement math is identical to a move with an empty drag set — nothing
 * being inserted exists in the graph yet — so it delegates and rewraps.
 */
export function resolveAddCommandFromIntent(
  graph: CollectionsGraph,
  intent: DropIntent,
  nodes: readonly CollectionItemNode[]
): Result<AddNodesCommand, IntentRejection> {
  const placed = resolveCommandFromIntent(graph, intent, []);
  if (!placed.ok) return placed;
  return {
    ok: true,
    value: {
      type: "add-nodes",
      nodes,
      toParentId: placed.value.toParentId,
      toIndex: placed.value.toIndex,
    },
  };
}


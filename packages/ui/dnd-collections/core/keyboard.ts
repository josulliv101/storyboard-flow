import {
  type CollectionsGraph,
  type NodeId,
  type Result,
  getChildren,
} from "./graph";
import {
  type MediaUpdate,
  type MoveNodesCommand,
  type UpdateMediaCommand,
} from "./commands";
import { resolveCommandFromIntent } from "./intents";

// Semantic keyboard layer: keys mean OPERATIONS on the graph (move before
// my previous sibling, nest into my neighboring collection, move out to my
// grandparent), not simulated pointer geometry. Each action resolves to the
// same `move-nodes` command the pointer path produces, so keyboard and
// pointer share every downstream rule — validation, patches, undo, and the
// reducer's cycle/root guards all apply identically. Deliberately
// single-node (the focused card): relative-index semantics on a scattered
// multi-selection are ambiguous, and predictability beats cleverness here.

export type KeyboardMoveAction =
  | "move-prev"
  | "move-next"
  | "move-home"
  | "move-end"
  /** Into the nearest sibling collection — next one first, then previous. */
  | "nest-in-neighbor"
  /** Out to the grandparent, landing right after the parent's own card. */
  | "move-out";

export type KeyboardRejection =
  | Readonly<{ reason: "missing-node"; nodeId: NodeId }>
  | Readonly<{ reason: "cannot-move-root"; nodeId: NodeId }>
  /** Boundary no-ops: already first/last, no adjacent collection, already top-level. */
  | Readonly<{ reason: "no-previous-sibling" }>
  | Readonly<{ reason: "no-next-sibling" }>
  | Readonly<{ reason: "no-neighbor-collection" }>
  | Readonly<{ reason: "no-parent-to-move-out-to" }>;

export function resolveKeyboardCommand(
  graph: CollectionsGraph,
  nodeId: NodeId,
  action: KeyboardMoveAction
): Result<MoveNodesCommand, KeyboardRejection> {
  if (!graph.nodesById.has(nodeId)) {
    return { ok: false, error: { reason: "missing-node", nodeId } };
  }
  const parentId = graph.parentById.get(nodeId);
  if (parentId === undefined) {
    return { ok: false, error: { reason: "missing-node", nodeId } };
  }
  if (parentId === null) {
    return { ok: false, error: { reason: "cannot-move-root", nodeId } };
  }

  const siblings = getChildren(graph, parentId);
  const index = siblings.indexOf(nodeId);
  // Post-removal note: with exactly one dragged node removed from its own
  // collection, "insert at index - 1" and "insert at index + 1" are already
  // post-removal indexes (the base array is siblings minus self).
  const move = (toParentId: NodeId, toIndex: number): Result<MoveNodesCommand, KeyboardRejection> => ({
    ok: true,
    value: { type: "move-nodes", nodeIds: [nodeId], toParentId, toIndex },
  });

  switch (action) {
    case "move-prev":
      if (index <= 0) return { ok: false, error: { reason: "no-previous-sibling" } };
      return move(parentId, index - 1);

    case "move-next":
      if (index === -1 || index >= siblings.length - 1) {
        return { ok: false, error: { reason: "no-next-sibling" } };
      }
      return move(parentId, index + 1);

    case "move-home":
      if (index <= 0) return { ok: false, error: { reason: "no-previous-sibling" } };
      return move(parentId, 0);

    case "move-end":
      if (index === -1 || index >= siblings.length - 1) {
        return { ok: false, error: { reason: "no-next-sibling" } };
      }
      return move(parentId, siblings.length - 1);

    case "nest-in-neighbor": {
      // Next sibling collection wins, then previous — matches the pointer
      // UX where nesting forward is the common gesture.
      const neighbor =
        findSiblingCollection(graph, siblings, index, +1) ??
        findSiblingCollection(graph, siblings, index, -1);
      if (!neighbor) return { ok: false, error: { reason: "no-neighbor-collection" } };
      return move(neighbor, getChildren(graph, neighbor).length);
    }

    case "move-out": {
      const grandparentId = graph.parentById.get(parentId);
      if (grandparentId === undefined || grandparentId === null) {
        return { ok: false, error: { reason: "no-parent-to-move-out-to" } };
      }
      // Land right after the parent collection's own card, so the node
      // surfaces next to where it came from.
      const parentSiblings = getChildren(graph, grandparentId);
      const parentIndex = parentSiblings.indexOf(parentId);
      const toIndex = parentIndex === -1 ? parentSiblings.length : parentIndex + 1;
      return move(grandparentId, toIndex);
    }
  }
}

export type GridRowMoveRejection =
  | Readonly<{ reason: "missing-node"; nodeId: NodeId }>
  | Readonly<{ reason: "cannot-move-root"; nodeId: NodeId }>
  | Readonly<{ reason: "invalid-columns" }>
  | Readonly<{ reason: "already-first-row" }>
  | Readonly<{ reason: "already-last-row" }>;

/**
 * Grid keyboard semantics: move one row up/down (± `columns`), landing in
 * the SAME column; a shorter last row clamps to the end. Pure graph math —
 * the view only supplies its live column count. Delegates the visible-
 * boundary -> post-removal conversion to `resolveCommandFromIntent`, the
 * single place that math lives.
 */
export function resolveGridRowMoveCommand(
  graph: CollectionsGraph,
  nodeId: NodeId,
  direction: "up" | "down",
  columns: number
): Result<MoveNodesCommand, GridRowMoveRejection> {
  if (!Number.isFinite(columns) || columns < 1 || Math.floor(columns) !== columns) {
    return { ok: false, error: { reason: "invalid-columns" } };
  }
  if (!graph.nodesById.has(nodeId)) {
    return { ok: false, error: { reason: "missing-node", nodeId } };
  }
  const parentId = graph.parentById.get(nodeId);
  if (parentId === undefined) {
    return { ok: false, error: { reason: "missing-node", nodeId } };
  }
  if (parentId === null) {
    return { ok: false, error: { reason: "cannot-move-root", nodeId } };
  }
  const siblings = getChildren(graph, parentId);
  const index = siblings.indexOf(nodeId);
  if (index === -1) return { ok: false, error: { reason: "missing-node", nodeId } };

  if (direction === "up" && index < columns) {
    return { ok: false, error: { reason: "already-first-row" } };
  }
  const lastRowStart = Math.floor((siblings.length - 1) / columns) * columns;
  if (direction === "down" && index >= lastRowStart) {
    return { ok: false, error: { reason: "already-last-row" } };
  }

  const boundary =
    direction === "up" ? index - columns : Math.min(index + columns + 1, siblings.length);
  const resolved = resolveCommandFromIntent(
    graph,
    { type: "insert-at-index", collectionId: parentId, index: boundary },
    [nodeId]
  );
  // Unreachable in practice (node and parent were just validated), but keep
  // the rejection typed rather than asserting.
  if (!resolved.ok) return { ok: false, error: { reason: "missing-node", nodeId } };
  return resolved;
}

function findSiblingCollection(
  graph: CollectionsGraph,
  siblings: readonly NodeId[],
  fromIndex: number,
  direction: 1 | -1
): NodeId | null {
  for (let i = fromIndex + direction; i >= 0 && i < siblings.length; i += direction) {
    if (graph.nodesById.get(siblings[i])?.kind === "collection") return siblings[i];
  }
  return null;
}

// Keyboard trim: nudge a media leaf's length by one step, the pointer trim
// handles' semantics without the drag. Every media card has an END edge
// (image duration / video trim-out); video also has a START edge (trim-in).
// "extend" lengthens the clip at that edge, "reduce" shortens it. Resolves to
// the SAME `update-media` command the pointer handles dispatch, so clamping,
// undo, and the reducer's guards apply identically — the resolver only steps
// the raw value; the reducer owns the clamp (and rejects `same-position` at a
// boundary, which the controller turns into an announcement).
export type KeyboardTrimAction =
  | "trim-end-extend"
  | "trim-end-reduce"
  | "trim-start-extend"
  | "trim-start-reduce";

export type KeyboardTrimRejection =
  | Readonly<{ reason: "missing-node"; nodeId: NodeId }>
  | Readonly<{ reason: "not-media-node"; nodeId: NodeId }>
  | Readonly<{ reason: "invalid-step"; stepSeconds: number }>
  /** A start-edge action on an image — images have no start trim. */
  | Readonly<{ reason: "no-start-edge"; nodeId: NodeId }>;

export function resolveTrimCommand(
  graph: CollectionsGraph,
  nodeId: NodeId,
  action: KeyboardTrimAction,
  stepSeconds: number
): Result<UpdateMediaCommand, KeyboardTrimRejection> {
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    return { ok: false, error: { reason: "invalid-step", stepSeconds } };
  }
  const node = graph.nodesById.get(nodeId);
  if (!node) return { ok: false, error: { reason: "missing-node", nodeId } };
  if (node.kind !== "media") return { ok: false, error: { reason: "not-media-node", nodeId } };

  const isStart = action === "trim-start-extend" || action === "trim-start-reduce";
  if (isStart && node.mediaKind !== "video") {
    return { ok: false, error: { reason: "no-start-edge", nodeId } };
  }

  let update: MediaUpdate;
  if (node.mediaKind === "video") {
    // extend = less trimmed off that edge (longer); reduce = more trimmed.
    switch (action) {
      case "trim-end-extend":
        update = { mediaKind: "video", trimOutSeconds: node.trimOutSeconds - stepSeconds };
        break;
      case "trim-end-reduce":
        update = { mediaKind: "video", trimOutSeconds: node.trimOutSeconds + stepSeconds };
        break;
      case "trim-start-extend":
        update = { mediaKind: "video", trimInSeconds: node.trimInSeconds - stepSeconds };
        break;
      case "trim-start-reduce":
        update = { mediaKind: "video", trimInSeconds: node.trimInSeconds + stepSeconds };
        break;
    }
  } else {
    // Image: only the end edge exists — it sets the duration directly.
    const delta = action === "trim-end-extend" ? stepSeconds : -stepSeconds;
    update = { mediaKind: "image", durationSeconds: node.durationSeconds + delta };
  }
  return { ok: true, value: { type: "update-media", nodeId, update } };
}

// Keyboard trash: move the focused node into a designated trash collection —
// the keyboard equivalent of dropping it on the TrashTarget. Resolves to the
// SAME move-nodes command (append to the trash collection's end), so subtrees
// ride along and undo restores exactly like the pointer drop. Nothing is ever
// deleted; trash is just a collection.
export type KeyboardTrashRejection =
  | Readonly<{ reason: "missing-node"; nodeId: NodeId }>
  | Readonly<{ reason: "cannot-move-root"; nodeId: NodeId }>
  /** The supplied trash id is absent or not a collection. */
  | Readonly<{ reason: "no-trash-collection"; trashId: NodeId }>
  /** The node is already directly inside trash — a no-op. */
  | Readonly<{ reason: "already-in-trash"; nodeId: NodeId }>;

export function resolveTrashCommand(
  graph: CollectionsGraph,
  nodeId: NodeId,
  trashId: NodeId
): Result<MoveNodesCommand, KeyboardTrashRejection> {
  if (!graph.nodesById.has(nodeId)) {
    return { ok: false, error: { reason: "missing-node", nodeId } };
  }
  const parentId = graph.parentById.get(nodeId);
  if (parentId === undefined) {
    return { ok: false, error: { reason: "missing-node", nodeId } };
  }
  if (parentId === null) {
    return { ok: false, error: { reason: "cannot-move-root", nodeId } };
  }
  const trash = graph.nodesById.get(trashId);
  if (!trash || trash.kind !== "collection") {
    return { ok: false, error: { reason: "no-trash-collection", trashId } };
  }
  if (parentId === trashId) {
    return { ok: false, error: { reason: "already-in-trash", nodeId } };
  }
  // Trying to trash a collection that itself contains trash resolves to a
  // command the reducer rejects as would-create-cycle — the controller
  // surfaces that the same way it does for keyboard moves.
  return {
    ok: true,
    value: {
      type: "move-nodes",
      nodeIds: [nodeId],
      toParentId: trashId,
      toIndex: getChildren(graph, trashId).length,
    },
  };
}

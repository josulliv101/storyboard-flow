import {
  type CollectionsGraph,
  type NodeId,
  type Result,
  getChildren,
} from "./graph";
import { type CollectionsCommand } from "./commands";

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
): Result<CollectionsCommand, KeyboardRejection> {
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
  const move = (toParentId: NodeId, toIndex: number): Result<CollectionsCommand, KeyboardRejection> => ({
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

// Graph — the `move-nodes` arm.
//
// Split out of the former single-file `commands.ts`; see ./index.ts.

import {
  type EngineContext,
  type Graph,
  type Move,
  type NodeId,
  type Patch,
  type Rejection,
  type Result,
  type WidenedNodeType,
} from "../types";
import {
  getChildren,
  getNode,
  getParent,
  isSameOrAncestor,
  subtreeHeight,
} from "../graph";
import { applyPatch } from "../patches";

import { childSlots, depthOf, inDocumentOrder, isValidIndex, pruneDescendants } from "./queries";
import { fail, ok } from "./results";

// move-nodes
// ---------------------------------------------------------------------------

/** Where a node sits right now. Captured BEFORE anything is spliced. */
type Origin = Readonly<{ parentId: NodeId; index: number }>;

type MovePlan = Readonly<{
  /** Deduped, descendant-pruned, in document order. */
  orderedIds: readonly NodeId[];
  originById: ReadonlyMap<NodeId, Origin>;
  /** The target's children with the moved nodes taken out — the array a
   *  POST-REMOVAL `toIndex` indexes into. */
  postRemovalChildren: readonly NodeId[];
  /** The target's children as they stand — what a view measured against. */
  currentChildren: readonly NodeId[];
}>;

/**
 * Everything a move needs validated EXCEPT the index — because `applyCommand`
 * and `resolveDrop` disagree about which coordinate system the caller handed
 * them, and agree about everything else.
 */
export function planMove<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  nodeIds: readonly NodeId[],
  toParentId: NodeId,
): Result<MovePlan, Rejection> {
  if (nodeIds.length === 0) {
    return fail("empty-command", "move-nodes was given no nodes to move.");
  }

  // A repeated id yields ONE removal and TWO insertions — the node lands in two
  // children arrays while `parentById` names one. A blind retry of a move did
  // exactly this in production, so a duplicate is REFUSED rather than silently
  // deduped: the caller has a bug and should hear about it.
  const unique = new Set<NodeId>(nodeIds);
  if (unique.size !== nodeIds.length) {
    return fail("duplicate-node-ids", "move-nodes listed the same node twice.", {
      nodeIds,
    });
  }

  for (const id of unique) {
    if (getNode(graph, id) === undefined) {
      return fail("unknown-node", `No node ${JSON.stringify(id)} in the graph.`, {
        nodeIds: [id],
      });
    }
    if (getParent(graph, id) === null) {
      // A root has no parent array to splice it out of, and `rootIds` is the
      // document's identity rather than an ordinary children list.
      return fail("cannot-move-root", `Node ${JSON.stringify(id)} is a root.`, {
        nodeIds: [id],
      });
    }
  }

  const target = getNode(graph, toParentId);
  if (target === undefined) {
    return fail(
      "unknown-parent",
      `No node ${JSON.stringify(toParentId)} to move into.`,
      { parentId: toParentId },
    );
  }
  if (!target.container) {
    return fail(
      "not-a-container",
      `Node ${JSON.stringify(toParentId)} is a leaf and cannot hold children.`,
      { parentId: toParentId, kind: target.kind },
    );
  }
  // A post-removal index into children nobody has ever seen has no honest
  // value, so this is a graph-level truth and not an app-level policy. A
  // sealed CONTAINER is allowed here when it is loaded: its children array
  // is real, and the whole point of sealing is that the subtree stays usable.
  if (target.children === null || target.children.status !== "loaded") {
    return fail(
      "target-not-loaded",
      `Node ${JSON.stringify(toParentId)} is a container whose children are not loaded.`,
      { parentId: toParentId },
    );
  }

  for (const id of unique) {
    // Covers "into itself" as well as "into its own descendant" — both make the
    // node its own ancestor.
    if (isSameOrAncestor(graph, id, toParentId)) {
      return fail(
        "would-create-cycle",
        `Cannot move ${JSON.stringify(id)} into itself or one of its descendants.`,
        { nodeIds: [id], parentId: toParentId },
      );
    }
  }

  const kept = new Set<NodeId>(pruneDescendants(graph, unique));
  const orderedIds = inDocumentOrder(graph, kept);

  const originById = new Map<NodeId, Origin>();
  const slotCache = new Map<NodeId, ReadonlyMap<NodeId, number>>();
  for (const id of orderedIds) {
    const parentId = getParent(graph, id);
    if (parentId === null) {
      // Unreachable: roots were refused above. Reported rather than asserted
      // because a corrupt graph must not crash the drag that found it.
      return fail("unknown-node", `Node ${JSON.stringify(id)} lost its parent.`, {
        nodeIds: [id],
      });
    }
    const index = childSlots(graph, parentId, slotCache).get(id);
    if (index === undefined) {
      return fail(
        "unknown-node",
        `Node ${JSON.stringify(id)} is not in its parent's children array.`,
        { nodeIds: [id], parentId },
      );
    }
    originById.set(id, { parentId, index });
  }

  const currentChildren = getChildren(graph, toParentId);
  const postRemovalChildren = currentChildren.filter((id) => !kept.has(id));

  return ok({ orderedIds, originById, postRemovalChildren, currentChildren });
}

/**
 * The moved nodes go in as one contiguous block starting at `toIndex`, keeping
 * their document-order relationship — which is what makes a multi-select drag
 * feel like moving one thing.
 */
export function buildMoves(
  plan: MovePlan,
  toParentId: NodeId,
  toIndex: number,
): Result<readonly Move[], Rejection> {
  const moves: Move[] = [];
  for (const [offset, nodeId] of plan.orderedIds.entries()) {
    const origin = plan.originById.get(nodeId);
    if (origin === undefined) {
      return fail("unknown-node", `Lost the origin of ${JSON.stringify(nodeId)}.`, {
        nodeIds: [nodeId],
      });
    }
    moves.push({
      nodeId,
      fromParentId: origin.parentId,
      fromIndex: origin.index,
      toParentId,
      toIndex: toIndex + offset,
    });
  }
  return ok(moves);
}

/**
 * A gesture that lands where it started.
 *
 * Refused rather than committed, because a history entry that undoes to the
 * same picture is indistinguishable from a broken undo, and a drag released on
 * its own tile is the most common gesture in a list UI. There is no
 * `same-position` rejection code, so it reports as `empty-command` — which is
 * the honest description: after resolution there is no move left to make.
 *
 * Checked over the WHOLE move set, never per node: dropping one no-op node from
 * a multi-node move would silently re-index the rest, because `toIndex` is
 * post-removal of exactly the nodes in the list.
 */
export function isNoOpMove(moves: readonly Move[]): boolean {
  return moves.every(
    (move) =>
      move.fromParentId === move.toParentId && move.fromIndex === move.toIndex,
  );
}

export function applyMoveNodes<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  nodeIds: readonly NodeId[],
  toParentId: NodeId,
  toIndex: number,
  ctx: EngineContext<S>,
): Result<Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>, Rejection> {
  const planned = planMove(graph, nodeIds, toParentId);
  if (!planned.ok) return planned;
  const plan = planned.value;

  if (!isValidIndex(toIndex, plan.postRemovalChildren.length)) {
    return fail(
      "index-out-of-range",
      `toIndex ${toIndex} is outside [0, ${plan.postRemovalChildren.length}] (POST-REMOVAL) for ${JSON.stringify(toParentId)}.`,
      { parentId: toParentId, index: toIndex },
    );
  }

  // DEPTH, checked against the destination rather than the source: relocating a
  // deep subtree under a deep parent adds the two together, and only the
  // ingress doors used to notice.
  if (ctx.maxDepth !== null) {
    const parentDepth = depthOf(graph, toParentId);
    for (const id of plan.orderedIds) {
      const deepest = parentDepth + subtreeHeight<Ts, S>(graph, id);
      if (deepest > ctx.maxDepth) {
        return fail(
          "would-exceed-max-depth",
          `Moving ${JSON.stringify(id)} here would nest ${deepest} levels, above the ` +
            `${ctx.maxDepth} ceiling. Raise or clear EngineConfig.maxDepth if this is legitimate.`,
          { nodeIds: [id], parentId: toParentId, limit: ctx.maxDepth, actual: deepest },
        );
      }
    }
  }

  const built = buildMoves(plan, toParentId, toIndex);
  if (!built.ok) return built;
  const moves = built.value;

  if (isNoOpMove(moves)) {
    return fail(
      "empty-command",
      "Every node is already at the requested position; nothing to move.",
      { nodeIds: plan.orderedIds, parentId: toParentId, index: toIndex },
    );
  }

  const patch: Patch<Ts, S> = { type: "moved", moves };
  return ok({ graph: applyPatch(graph, patch, ctx), patch });
}

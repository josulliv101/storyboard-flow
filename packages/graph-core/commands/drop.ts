// Graph — resolveDrop — pointer intent to a command.
//
// Split out of the former single-file `commands.ts`; see ./index.ts.

import {
  type Command,
  type DropIntent,
  type EngineContext,
  type Graph,
  type NodeId,
  type Rejection,
  type Result,
  type Seed,
  type WidenedNodeType,
} from "../types";
import {
  getChildren,
} from "../graph";

import { fail, foreignGraph, isValidIndex, ok } from "./internals";
import { buildMoves, isNoOpMove, planMove } from "./move";
import { checkInsertTarget } from "./insert";

// resolveDrop
// ---------------------------------------------------------------------------

/**
 * THE ONLY place a post-removal insertion index is computed.
 *
 *   same parent:      toIndex = toIndexBefore - (moved nodes currently before it)
 *   different parent: toIndex = toIndexBefore
 *   insert intent:    toIndex = toIndexBefore   (nothing is removed first)
 *
 * The mixed case — some nodes dragged out of the target, some from elsewhere —
 * falls out of the one formula, because only nodes currently IN the target can
 * shift its indices. Re-deriving this arithmetic anywhere else is how the
 * predecessor came to silently append on cut+paste.
 *
 * IT RUNS THE STRUCTURAL CHECKS, NOT THE BUDGETS, and the distinction matters
 * because an earlier version of this line claimed both: "It runs the same
 * validity checks as the command it produces, so an illegal gesture is refused
 * while it is still a gesture." The first half is what it does — unknown node,
 * unknown parent, not-a-container, target-not-loaded, cycle, root moves — and
 * those really are refused while the drag is still a drag.
 *
 * The CEILINGS are not among them. Measured, `maxNodes: 3` on a 3-node graph:
 *
 *   resolveDrop(insert intent)   -> ok
 *   dispatch(that command)       -> would-exceed-max-nodes
 *
 * So a drop that cannot commit still reads as a legal drop target, and the
 * refusal arrives one step later than the sentence above promised. That is a
 * gap in the gesture layer rather than a correctness bug — the command door
 * still refuses, nothing is written, and `maxNodes` is a trust boundary whose
 * job is bounding the graph, not shaping a drag. Closing it means teaching this
 * function the budgets, which is a deliberate UX change and not a comment fix;
 * until someone makes that call, this says what is true.
 */
export function resolveDrop<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  intent: DropIntent<Ts, S>,
  ctx: EngineContext<S>,
): Result<Command<Ts, S>, Rejection> {
  const foreign = foreignGraph(graph, ctx);
  if (foreign !== null) return { ok: false, error: foreign };

  if (intent.type === "insert") {
    return resolveInsertDrop(
      graph,
      intent.seeds,
      intent.toParentId,
      intent.toIndexBefore,
      ctx,
    );
  }

  const planned = planMove(graph, intent.nodeIds, intent.toParentId);
  if (!planned.ok) return planned;
  const plan = planned.value;

  // `toIndexBefore` is what the VIEW measured, so it is bounded by the list the
  // view can see — the target's children as they stand.
  if (!isValidIndex(intent.toIndexBefore, plan.currentChildren.length)) {
    return fail(
      "index-out-of-range",
      `toIndexBefore ${intent.toIndexBefore} is outside [0, ${plan.currentChildren.length}] for ${JSON.stringify(intent.toParentId)}.`,
      { parentId: intent.toParentId, index: intent.toIndexBefore },
    );
  }

  const moving = new Set<NodeId>(plan.orderedIds);
  let removedBefore = 0;
  for (const [index, childId] of plan.currentChildren.entries()) {
    if (index >= intent.toIndexBefore) break;
    if (moving.has(childId)) removedBefore += 1;
  }
  const toIndex = intent.toIndexBefore - removedBefore;

  // Provably in range given the formula: every counted node occupies a distinct
  // index below `toIndexBefore`, and every uncounted one a distinct index at or
  // above it. Checked anyway, because that proof is a property of the six lines
  // directly above and not of anything the type system is holding.
  if (!isValidIndex(toIndex, plan.postRemovalChildren.length)) {
    return fail(
      "index-out-of-range",
      `Resolved toIndex ${toIndex} is outside [0, ${plan.postRemovalChildren.length}] for ${JSON.stringify(intent.toParentId)}.`,
      { parentId: intent.toParentId, index: toIndex },
    );
  }

  const built = buildMoves(plan, intent.toParentId, toIndex);
  if (!built.ok) return built;
  if (isNoOpMove(built.value)) {
    return fail(
      "empty-command",
      "The drop lands where the nodes already are; nothing to move.",
      { nodeIds: plan.orderedIds, parentId: intent.toParentId, index: toIndex },
    );
  }

  return ok({
    type: "move-nodes",
    // The PRUNED, document-ordered set, so the command and the index it carries
    // describe the same move. Handing back the raw gesture ids would let a
    // caller reorder them and silently change what `toIndex` means.
    nodeIds: plan.orderedIds,
    toParentId: intent.toParentId,
    toIndex,
  });
}

function resolveInsertDrop<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  seeds: readonly Seed<Ts, S>[],
  toParentId: NodeId,
  toIndexBefore: number,
  ctx: EngineContext<S>,
): Result<Command<Ts, S>, Rejection> {
  if (seeds.length === 0) {
    return fail("empty-command", "An insert drop carried no seeds.");
  }
  const targetCheck = checkInsertTarget(graph, toParentId);
  if (!targetCheck.ok) return targetCheck;

  const currentChildren = getChildren(graph, toParentId);
  if (!isValidIndex(toIndexBefore, currentChildren.length)) {
    return fail(
      "index-out-of-range",
      `toIndexBefore ${toIndexBefore} is outside [0, ${currentChildren.length}] for ${JSON.stringify(toParentId)}.`,
      { parentId: toParentId, index: toIndexBefore },
    );
  }

  // The STRUCTURAL seed checks run here — they are free, and refusing an unknown
  // kind while the pointer is still down is the point of this function. The
  // CONTENT parse deliberately does not run twice: it happens once, in
  // `applyCommand`, where its output is the value that actually gets stored.
  for (const seed of seeds) {
    const nodeType = ctx.registry.get(seed.kind);
    if (nodeType === undefined) {
      return fail(
        "unknown-kind",
        `No node type registered for kind ${JSON.stringify(seed.kind)}.`,
        { kind: seed.kind },
      );
    }
    if (!nodeType.container && seed.children !== undefined) {
      return fail(
        "leaf-seed-with-children",
        `Kind ${JSON.stringify(seed.kind)} is a leaf and cannot be seeded with children.`,
        { kind: seed.kind },
      );
    }
  }

  // Nothing is removed first, so the index passes through untouched. Stated
  // explicitly rather than left implicit: it is the half of the post-removal
  // rule people forget exists.
  return ok({ type: "insert-nodes", seeds, toParentId, toIndex: toIndexBefore });
}

// Graph — applyNonUndoableWriteEdits — the non-undoable content write.
//
// Split out of the former single-file `commands.ts`; see ./index.ts.

import {
  type GraphNode,
  type EditOf,
  type EngineContext,
  type Graph,
  type History,
  type NodeId,
  type Rejection,
  type Result,
  makeCollectionNode,
  makeLeafNode,
  type WidenedNodeType,
} from "../types";
import {
  derivedIndexesSurviveDataChange,
  bumpSubtreeRevs,
  rebuildDerivedIndexes,
} from "../graph";
import { scrubbableNodeIds } from "../patches";
import { scrubHistoryForWrite } from "../history";

import { foreignGraph } from "./queries";
import { ok } from "./results";
import { planEdits } from "./edit";

// applyNonUndoableWriteEdits — the non-undoable content write
// ---------------------------------------------------------------------------

/**
 * THE NON-UNDOABLE CONTENT WRITE.
 *
 * Roughly half the fields on a realistic item have a writer that is not user
 * intent: a thumbnail arriving, a server stamping provenance, a load path
 * filling in a duration. If the only door into `data` were a command, then
 * either Ctrl-Z undoes a thumbnail, or a dormant whole-value `before` silently
 * clobbers the server's write on the next undo. This is the third option.
 *
 * It applies each edit exactly as `edit-nodes` does — same node-type path, same
 * rejections — and then:
 *   - produces NO patch, NO history entry, NO change-feed event;
 *   - bumps `subtreeRev` along each edited node's chain, so rollups and
 *     subscribers still see it;
 *   - SCRUBS both history stacks, keyed by the AFTER value of each node.
 *
 * The user loses undo of their own edit to that one node — correct, the server
 * has since overwritten it — and keeps everything else. Cost is
 * O(historyLimit x changes) — bounded only when a consumer SET a
 * `historyLimit`, which is not the default. See `EngineConfig.historyLimit`.
 */
export function applyNonUndoableWriteEditsUnguarded<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  history: History<Ts, S>,
  edits: readonly EditOf<Ts>[],
  ctx: EngineContext<S>,
): Result<
  Readonly<{
    graph: Graph<Ts, S>;
    history: History<Ts, S>;
    scrubbed: readonly NodeId[];
  }>,
  Rejection
> {
  const foreign = foreignGraph(graph, ctx);
  if (foreign !== null) return { ok: false, error: foreign };

  const planned = planEdits(graph, edits, ctx);
  if (!planned.ok) return planned;
  const plans = planned.value;

  // No patch means no `applyPatch`, so the graph is rewritten by hand — but
  // only the fields a content change can touch. Structure is untouched by
  // construction: every children array, every parent link and every root stays
  // exactly where it was, which is also why this needs no `verifyPatchApplies`.
  const nextNodes = new Map(graph.nodesById);
  const editedIds: NodeId[] = [];
  for (const plan of plans) {
    const rebuilt: GraphNode<Ts, S> =
      plan.collection === null
        ? makeLeafNode<Ts>(plan.nodeId, plan.kind, plan.after)
        : makeCollectionNode<Ts, S>(
            plan.nodeId,
            plan.kind,
            plan.after,
            plan.collection.children,
            plan.collection.summary,
          );
    nextNodes.set(plan.nodeId, rebuilt);
    editedIds.push(plan.nodeId);
  }

  const withNodes: Graph<Ts, S> = {
    ...graph,
    nodesById: nextNodes,
    // The non-undoable write bumps too, even though it emits nothing: an arriving thumbnail has
    // to invalidate every ancestor's fold and wake every subscriber, or the
    // rollup summarising it never re-renders. Nothing moved, so there is one
    // chain per node rather than a move's two.
    subtreeRevById: bumpSubtreeRevs(graph.subtreeRevById, graph, editedIds),
  };
  // A `contentKey` or `sourceKey` can move with the data, so the indexes may
  // need rebuilding — but only when a key ACTUALLY moved. This used to rebuild
  // unconditionally, and the comment that stood here claimed it was doing "the
  // same thing `applyPatch` does after a 'data-changed' patch". That stopped
  // being true when `applyPatch`'s data arm gained its guard; the comment had
  // become a description of the defect rather than of the code.
  //
  // MEASURED before this guard, counting `contentKey` on a key-preserving
  // one-node write: the non-undoable write asked 1,000 / 10,000 / 40,000 times at those sizes —
  // exactly the reachable node count, a whole document-order DFS — while
  // `edit-nodes` asked 2, flat. Per CALL, not per edit: a batch of twenty still
  // cost one full walk. This is the path an arriving thumbnail lands on, which
  // makes it the highest-frequency write in the system.
  //
  // The soundness argument is the one ./patches already makes for the same
  // predicate, and it is STRICTLY STRONGER here: the non-undoable write touches only `data`, so
  // document order cannot change (no bucket's ORDER can move) and no node's
  // `ownsItsSubtree` can change (no owner can move). Where the patch arm must
  // also tolerate changes it skipped, `planEdits` refuses a sealed node
  // outright — so every plan here really was applied, and the predicate is
  // evaluated over exactly the nodes that changed.
  //
  // On the no-move path both maps carry forward BY IDENTITY, which is what
  // `walkDerivedIndexes` asks for: a consumer memoising on
  // `placementsByContentKey` stops churning on every server write.
  const movesAKey = plans.some(
    (plan) =>
      !derivedIndexesSurviveDataChange(
        ctx.registry,
        plan.kind,
        plan.before,
        plan.after,
      ),
  );
  const nextGraph: Graph<Ts, S> = movesAKey
    ? { ...withNodes, ...rebuildDerivedIndexes(withNodes, ctx.registry) }
    : withNodes;

  const replacements = new Map<NodeId, unknown>(
    plans.map((plan) => [plan.nodeId, plan.after]),
  );

  // Which ids the scrub actually touched, computed against the PRE-scrub stacks
  // (afterwards the evidence is gone — that is what scrubbing means). A "moved"
  // patch carries no content and is skipped, matching `scrubPatchForWrite`,
  // which leaves structural patches alone.
  // `scrubbableNodeIds`, NOT `patchTouchedNodeIds`. The two answer different
  // questions and this wanted the other one: "touched" includes every
  // placement's PARENT, because a parent's rollup changed and its subscribers
  // must hear about it. A parent's DATA is not in the patch at all, so the
  // scrub cannot rewrite it — and this list was naming parents as scrubbed when
  // nothing of theirs had been. Reproduced: insert a clip into a folder, then
  // write to the FOLDER, and the folder came back in `scrubbed` with its
  // history untouched. A consumer using this to tell a user "undo is gone for
  // these" showed warnings that were not true.
  //
  // It shares its definition with `scrubPatchForWrite` so the report and the
  // scrub cannot drift apart.
  const scrubbable = new Set<NodeId>();
  for (const entry of [...history.past, ...history.future]) {
    for (const id of scrubbableNodeIds(entry.patch)) scrubbable.add(id);
  }
  const scrubbed = editedIds.filter((id) => scrubbable.has(id));

  return ok({
    graph: nextGraph,
    history: scrubHistoryForWrite(history, replacements),
    scrubbed,
  });
}

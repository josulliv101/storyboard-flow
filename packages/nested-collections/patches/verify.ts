// Graph — the gate in front of every dormant patch.
//
// Split out of the former single-file `patches.ts`; see ./index.ts.

import {
  describeThrown,
  type DataChange,
  type EngineContext,
  type Graph,
  type WidenedNodeType,
  type Move,
  type NodeId,
  type Patch,
  type Placement,
  type ReplayRejection,
  type Result,
} from "../types";
import {
  ancestorChain,
  ownsItsSubtree,
  sourceKeyOf,
  sourceKeyForData,
  derivedIndexNeed,
  subtreeHeight,
} from "../graph";

import { EMPTY_IDS, VERIFY_OK } from "./constants";
import { deepEqual, isLoadedContainer } from "./predicates";
import { replayError } from "./results";

// verifyPatchApplies — the gate in front of every dormant patch
// ---------------------------------------------------------------------------

/**
 * A validation-only overlay on `graph.childrenById`.
 *
 * Required, not an optimisation: a subtree insert's later placements land
 * inside its earlier ones, so checking every placement against the UNMODIFIED
 * graph would reject a perfectly good restore for a "missing" parent that the
 * same patch creates two entries earlier. The removal side needs the same
 * overlay to answer "is this node empty yet".
 */
function createChildrenOverlay<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
) {
  // OWNED AND MUTABLE, copied once per parent on first write — not
  // copy-on-write per operation.
  //
  // This overlay is scratch: it is created inside a verify function, read only
  // by that function, and discarded when it returns. Nothing it holds is ever
  // published, so there is no immutability to preserve here — and paying for
  // one anyway was the whole cost.
  //
  // MEASURED, undo of a select-all delete, verification alone:
  //     k = 8,000     54.1 ms
  //     k = 16,000   437.5 ms
  //     k = 32,000 2,858.5 ms      <- 6.5x per doubling
  //
  // Three O(siblings) operations ran per call — `slice`, `splice`, and
  // `indexOf` on the removal side — so verifying K placements against one
  // parent cost O(K x N), the identical shape `spliceOutMany` and
  // `spliceInMany` fix on the applying side. `applyPatch` had already been made
  // linear and verification had not, which is why undo stayed slow after the
  // apply-side fix: at k = 32,000 the split was 2,858 ms verifying against
  // 16.6 ms applying.
  //
  // Owning the array removes the per-call allocation entirely and leaves one
  // `splice`. For the shape that actually hurts — undo of a bulk delete, where
  // the inverted patch inserts at 0, 1, 2, ... into an emptied array — every
  // one of those splices is an APPEND, so the pass becomes linear rather than
  // merely cheaper.
  //
  // WHICH ARM IS WHICH, because this comment listed `indexOf` among the costs
  // it had removed while `indexOf` was still running, and that reading cost a
  // later round a second look at an already-"fixed" quadratic:
  //
  //   removed  ->  `removeAt`, by the index `verifyRemoved` just proved. LINEAR.
  //   inserted ->  `insert`, appending into an emptied array.        LINEAR.
  //   moved    ->  `remove`, which still SCANS with `indexOf`.
  //
  // The move arm is deliberate, not missed. Its `fromIndex` is a PRE-state
  // index checked against the untouched graph (see `verifyMoved`), so it is not
  // an index into the overlay and cannot be spliced by. Making that arm linear
  // means grouping by source parent and doing one filtering pass each, mirroring
  // `spliceOutMany` — worth doing if a patch is ever measured moving thousands
  // of nodes out of ONE parent, which no gesture produces today: a multi-select
  // drag is bounded by what is on screen, where a select-all delete is not.
  const owned = new Map<NodeId, NodeId[]>();
  const read = (id: NodeId): readonly NodeId[] => {
    const local = owned.get(id);
    if (local !== undefined) return local;
    return graph.childrenById.get(id) ?? EMPTY_IDS;
  };
  /** The overlay's own copy, made once. The graph's array is never touched. */
  const mutable = (id: NodeId): NodeId[] => {
    const local = owned.get(id);
    if (local !== undefined) return local;
    const copy = [...(graph.childrenById.get(id) ?? EMPTY_IDS)];
    owned.set(id, copy);
    return copy;
  };
  return {
    read,
    hasEntry: (id: NodeId): boolean =>
      owned.has(id) || graph.childrenById.has(id),
    seedLoaded: (id: NodeId): void => {
      // A FRESH array, never `EMPTY_IDS`. That constant is frozen and shared by
      // every reader in this module, so seeding it here and splicing into it
      // later would throw in strict mode — and would be a process-wide
      // corruption if it did not.
      if (!owned.has(id)) owned.set(id, []);
    },
    insert: (parentId: NodeId, index: number, id: NodeId): void => {
      mutable(parentId).splice(index, 0, id);
    },
    /**
     * By KNOWN index — the fourth O(siblings) operation, and the one the block
     * comment above missed when it listed the three it had removed.
     *
     * `verifyRemoved` proves the exact slot two lines before it removes
     * (`siblings[index] !== node.id`, against this same overlay), so the
     * `indexOf` in `remove` below was re-deriving an index the caller already
     * held. Removal placements are built in ascending document order and
     * `verifyRemoved` walks them BACKWARD, so each target sat at the tail of a
     * shrinking array and `indexOf` rescanned it front-to-back: K^2/2, the
     * exact quadratic `spliceOutMany` fixes on the applying side.
     *
     * MEASURED, undo of a bulk insert through `store.undo()`:
     *     k =  4,000     19.8 ms  ->   1.1 ms
     *     k =  8,000    134.5 ms  ->   1.9 ms
     *     k = 16,000    319.4 ms  ->   2.4 ms
     *     k = 32,000  1,580.3 ms  ->   4.3 ms
     * Redo, which takes the `insert` path that was already linear, was 17.5 ms
     * at k = 32,000 throughout — the 90x gap between the two directions is what
     * said the removal side had been missed.
     *
     * For the backward document-order walk this splice is a `pop`.
     */
    removeAt: (parentId: NodeId, index: number): void => {
      mutable(parentId).splice(index, 1);
    },
    remove: (parentId: NodeId, id: NodeId): void => {
      const current = mutable(parentId);
      const at = current.indexOf(id);
      if (at === -1) return;
      current.splice(at, 1);
    },
  };
}

/**
 * Gates every DORMANT patch before replay.
 *
 * Loading grows the graph while history entries sleep, `markMissing` can empty
 * a container out from under one, and a node can gain children after the insert
 * that created it. Each of those turns a stored patch into a corruption if
 * applied blind.
 *
 * Checks: engineId; node existence (removal, move, edit) or absence (insert);
 * parent existence AND loaded-ness; index bounds; the recorded index still
 * naming the recorded node; kind agreement; `before` still matching on the
 * SERIALIZED form; and that a node about to be un-inserted is childless.
 */
export function verifyPatchAppliesUnguarded<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  patch: Patch<Ts, S>,
  ctx: EngineContext<S>,
): Result<void, ReplayRejection> {
  if (graph.engineId !== ctx.engineId) {
    return replayError(
      "foreign-graph",
      "This graph was produced by a different engine instance.",
    );
  }
  switch (patch.type) {
    case "moved":
      return verifyMoved(graph, patch.moves, ctx);
    case "inserted":
      return verifyInserted(graph, patch.placements, ctx);
    case "removed":
      return verifyRemoved(graph, patch.placements);
    case "data-changed":
      return verifyDataChanged(graph, patch.changes, ctx);
  }
}

function verifyMoved<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  moves: readonly Move[],
  ctx: EngineContext<S>,
): Result<void, ReplayRejection> {
  const overlay = createChildrenOverlay(graph);
  const seen = new Set<NodeId>();

  // Phase 1: validate every source and take every node out. `fromIndex` is a
  // PRE-state index, so it is checked against the untouched graph before any
  // simulated removal.
  for (const move of moves) {
    if (seen.has(move.nodeId)) {
      // One removal, two insertions — the node lands in two children arrays
      // with `parentById` naming one. A blind retry did exactly this in
      // production.
      return replayError(
        "node-exists",
        `Node ${move.nodeId} is moved twice by one patch.`,
        { nodeId: move.nodeId },
      );
    }
    seen.add(move.nodeId);

    if (!graph.nodesById.has(move.nodeId)) {
      return replayError("node-missing", `Node ${move.nodeId} is gone.`, {
        nodeId: move.nodeId,
      });
    }
    const sourceCheck = requireLoadedParent(graph, move.fromParentId);
    if (!sourceCheck.ok) return sourceCheck;

    const sourceChildren = graph.childrenById.get(move.fromParentId) ?? EMPTY_IDS;
    // Exact position, not merely in-bounds. An index that is wrong but in range
    // silently relocates the node when the inverse re-inserts it, and that
    // shows up as "undo moved my clip somewhere else" many steps later.
    if (sourceChildren[move.fromIndex] !== move.nodeId) {
      return replayError(
        "index-out-of-range",
        `Node ${move.nodeId} is no longer at index ${move.fromIndex} of ${move.fromParentId}.`,
        { nodeId: move.nodeId, parentId: move.fromParentId, index: move.fromIndex },
      );
    }
    overlay.remove(move.fromParentId, move.nodeId);
  }

  // Phase 2: validate every destination against the POST-REMOVAL arrays, which
  // is the coordinate system `toIndex` is recorded in.
  for (const move of moves) {
    const targetCheck = requireLoadedParent(graph, move.toParentId);
    if (!targetCheck.ok) return targetCheck;
    const target = overlay.read(move.toParentId);
    if (move.toIndex < 0 || move.toIndex > target.length) {
      return replayError(
        "index-out-of-range",
        `Post-removal index ${move.toIndex} is outside [0, ${target.length}] of ${move.toParentId}.`,
        { nodeId: move.nodeId, parentId: move.toParentId, index: move.toIndex },
      );
    }
    overlay.insert(move.toParentId, move.toIndex, move.nodeId);
  }

  // Phase 3: no node may become its own ancestor.
  //
  // The forward door has this as `isSameOrAncestor` (./commands), and the
  // replay door had no twin for it. `applyPatch` is documented above as
  // deliberately re-checking nothing, so there was no second line of defence:
  // an accepted cyclic move detaches the ring from every root, `serializeGraph`
  // emits unreachable nodes rather than dropping them, and the saved document
  // then fails `deserialize` with `unreachable-node` for good.
  //
  // AGAINST THE POST-STATE, not the graph. The reachable case is a converging
  // swap — A moves Y into X while B moves X into Y — and there neither node is
  // the other's ancestor BEFORE the patch. A check against `graph.parentById`
  // answers "no cycle" and waves it through. So this walks the parent map the
  // whole patch would produce, which is also why it runs once at the end
  // rather than per move: the moves are atomic, and an intermediate state that
  // rings is fine as long as the result does not.
  const nextParent = new Map<NodeId, NodeId | null>(graph.parentById);
  for (const move of moves) nextParent.set(move.nodeId, move.toParentId);

  for (const move of moves) {
    // Bounded by the map rather than trusted to terminate: a pre-state cycle
    // would already be an invariant violation, but a verify door that can hang
    // on a malformed graph is worse than one that refuses it.
    let steps = 0;
    let cursor: NodeId | null | undefined = move.toParentId;
    while (cursor !== null && cursor !== undefined) {
      if (cursor === move.nodeId) {
        return replayError(
          "would-create-cycle",
          `Moving ${move.nodeId} into ${move.toParentId} would make it its own ancestor.`,
          { nodeId: move.nodeId, parentId: move.toParentId },
        );
      }
      if (++steps > nextParent.size) {
        return replayError(
          "would-create-cycle",
          `The parent chain above ${move.toParentId} does not terminate.`,
          { nodeId: move.nodeId, parentId: move.toParentId },
        );
      }
      cursor = nextParent.get(cursor);
    }
  }

  // Phase 4: THE DEPTH CEILING, the exact twin of `verifyInserted`'s node
  // ceiling and missing for as long as that one was present.
  //
  // AGAINST THE POST-STATE, for the reason phase 3 is: a batch can move a node
  // under a parent that is itself moving, and the pre-state chain answers a
  // question about a graph the patch is about to replace. `nextParent` is the
  // map phase 3 just proved terminates, so the walk below needs no budget of
  // its own beyond the one it inherits.
  //
  // `depthPost(toParentId) + subtreeHeight(graph, nodeId)` is verbatim the
  // formula `applyMoveNodes` uses, out of the same `./graph` helper rather than
  // a second copy — two doors computing depth independently is what let this
  // through in the first place.
  //
  // COMPLETE despite only reading the moved nodes: a descendant that did not
  // move travels with its ancestor, and `subtreeHeight` measures to the bottom
  // of that subtree, so the deepest node under any moved id is covered by that
  // id's own check. A node moved INTO a moved subtree is checked at its own
  // final position by its own entry. Anything under neither keeps the depth it
  // already had.
  if (ctx.maxDepth !== null) {
    const depthCache = new Map<NodeId, number>();
    const depthPost = (id: NodeId): number | null => {
      const memo = depthCache.get(id);
      if (memo !== undefined) return memo;
      const path: NodeId[] = [];
      let depth = 0;
      let cursor: NodeId | null | undefined = id;
      while (cursor !== null && cursor !== undefined) {
        const hit = depthCache.get(cursor);
        if (hit !== undefined) {
          depth = hit;
          break;
        }
        if (path.length > nextParent.size) return null;
        path.push(cursor);
        cursor = nextParent.get(cursor) ?? null;
      }
      // Back down the path it just walked up, so a batch sharing one chain pays
      // for it once.
      for (let i = path.length - 1; i >= 0; i -= 1) {
        depth += 1;
        const step = path[i];
        if (step !== undefined) depthCache.set(step, depth);
      }
      return depth;
    };

    for (const move of moves) {
      const parentDepth = depthPost(move.toParentId);
      if (parentDepth === null) {
        // Unreachable — phase 3 refused every non-terminating chain — but
        // refused rather than guessed, because the alternative is a ceiling
        // silently computed from a number this function could not derive.
        return replayError(
          "would-create-cycle",
          `The parent chain above ${move.toParentId} does not terminate.`,
          { nodeId: move.nodeId, parentId: move.toParentId },
        );
      }
      const deepest = parentDepth + subtreeHeight<Ts, S>(graph, move.nodeId);
      if (deepest > ctx.maxDepth) {
        return replayError(
          "would-exceed-max-depth",
          `Replaying this move would nest ${move.nodeId} ${deepest} levels, past the ${ctx.maxDepth} ceiling.`,
          {
            nodeId: move.nodeId,
            parentId: move.toParentId,
            limit: ctx.maxDepth,
            actual: deepest,
          },
        );
      }
    }
  }

  return VERIFY_OK;
}

function requireLoadedParent<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  parentId: NodeId,
): Result<void, ReplayRejection> {
  const parent = graph.nodesById.get(parentId);
  if (parent === undefined) {
    return replayError("parent-missing", `Parent ${parentId} is gone.`, {
      parentId,
    });
  }
  if (!graph.childrenById.has(parentId)) {
    // `markMissing` can turn a loaded container into a confirmed-empty one
    // while a patch sleeps; replaying into it would resurrect children the
    // storage says are gone.
    return replayError(
      "parent-not-loaded",
      `Parent ${parentId} no longer has loaded children.`,
      { parentId },
    );
  }
  return VERIFY_OK;
}

/**
 * Would replaying these ownership claims leave two placements on one
 * `sourceKey`?
 *
 * THE REPLAY DOOR'S HALF OF THE SINGLE-OWNER RULE. The reducer enforces it on
 * the forward path and `findInvariantViolation` audits it, but verification —
 * the one door whose entire job is refusing patches whose world has moved — did
 * not ask. `applyNonUndoableWrite` is what makes that reachable: it is a non-undoable
 * server write, so it can move a live node onto a key a sleeping patch still
 * carries, and the replay then re-installs the original owner beside it.
 *
 * NO `vacating` EXEMPTION, and the reason is worth recording because the first
 * version had one. The case it covered was a single patch re-keying two nodes
 * that swap keys, where the pre-state owner is itself moving off the key it
 * holds. That patch cannot exist: `planEdits` refuses a same-command swap with
 * `duplicate-owner` before any patch is built (measured), so nothing on either
 * history stack can carry one. The exemption cost a second `ReadonlyMap` and a
 * `sourceKey` call per changed node on the undo path — the same path the last
 * round worked to get down to zero node-type calls for a common replay — to guard a
 * state the reducer will not produce. Mutation testing is what surfaced it:
 * deleting the exemption failed no test, which is the signature of code that
 * defends nothing.
 *
 * A hand-built patch could still reach it, and would be refused rather than
 * applied. A refusal on an exotic hand-built patch is the safe direction.
 */
function ownershipConflict<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  claims: ReadonlyMap<NodeId, string | null>,
): ReplayRejection | null {
  const claimedHere = new Map<string, NodeId>();
  for (const [nodeId, key] of claims) {
    if (key === null) continue;

    // BELT AND BRACES, and labelled as such rather than claimed as live: the
    // reducer refuses a command whose own nodes claim one key twice, so no
    // patch on either stack carries this shape and mutation testing correctly
    // reports that deleting these lines fails nothing.
    //
    // Kept anyway, where the `vacating` exemption was deleted, because the two
    // fail in opposite directions. Removing `vacating` made the check STRICTER,
    // and a refusal is the safe answer for a patch nobody can build. Removing
    // this one makes it fail OPEN — neither node is in `ownerBySourceKey` yet,
    // so a hand-built patch claiming one key twice would sail through and
    // install exactly the duplicate owner this function exists to prevent.
    const alreadyHere = claimedHere.get(key);
    if (alreadyHere !== undefined && alreadyHere !== nodeId) {
      return {
        code: "duplicate-owner",
        message: `Replaying this patch would give sourceKey ${JSON.stringify(key)} two owners (${alreadyHere} and ${nodeId}).`,
        nodeId,
      };
    }
    claimedHere.set(key, nodeId);

    const existing = graph.ownerBySourceKey.get(key);
    if (existing === undefined || existing === nodeId) continue;
    return {
      code: "duplicate-owner",
      message: `Replaying this patch would put ${nodeId} on sourceKey ${JSON.stringify(key)}, which ${existing} now owns.`,
      nodeId,
    };
  }
  return null;
}

function verifyInserted<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  placements: readonly Placement<Ts, S>[],
  ctx: EngineContext<S>,
): Result<void, ReplayRejection> {
  // THE CEILING, before the per-placement work — the same position and the
  // same reason as ./serialize's, which calls it "the EARLIEST honest point".
  //
  // This is the third growth door and it was the one without the check. The
  // reducer refuses at `would-exceed-max-nodes`, ingress folds
  // `existingNodeCount` into the same comparison, and replay counted nothing.
  // `Store.load` does not touch history, so a lazy page can legitimately spend
  // the headroom a delete just freed while that removal patch sleeps on the
  // undo stack; undoing it then walked a `maxNodes: 12` graph to 14, 16, 18 —
  // the "no single call is ever the one that is too big" shape ingress already
  // closed. The result is a graph the audit calls valid, `serializeGraph`
  // writes happily, and `deserialize` refuses at that config forever.
  //
  // Refusing the undo is the safe direction and matches the other three doors.
  // Bounding `loadChildren` more tightly instead would make the ceiling depend
  // on how deep the undo stack happens to be, which is worse.
  const wouldHold = graph.nodesById.size + placements.length;
  if (wouldHold > ctx.maxNodes) {
    return replayError(
      "would-exceed-max-nodes",
      `Replaying this insert would take the graph to ${wouldHold} nodes, past the ${ctx.maxNodes} ceiling.`,
      { limit: ctx.maxNodes, actual: wouldHold },
    );
  }

  const overlay = createChildrenOverlay(graph);
  const willExist = new Set<NodeId>();

  // THE DEPTH CEILING, the twin of the node ceiling above, checked INSIDE the
  // structural loop rather than after it.
  //
  // Placements arrive parents-first in document order — the property the
  // `parentIsNew` branch below already relies on — so each one's depth is its
  // parent's plus one, and the parent's is either already computed here (an
  // earlier placement) or read once from the graph. That makes the whole pass
  // O(placements + one ancestor chain per distinct pre-existing parent), which
  // is why it can afford to be exact rather than reuse the forward door's
  // `depthOf(parent) + tallestSeed(seeds)` estimate.
  //
  // Only assembled when a ceiling was named: `maxDepth` is `null` by default,
  // and undo of a bulk insert is the path this file has already spent two
  // rounds making linear.
  const depth =
    ctx.maxDepth === null
      ? null
      : {
          /** A placement created earlier in this same patch. */
          byNew: new Map<NodeId, number>(),
          /** A parent the graph already held — one ancestor chain per parent. */
          ofExisting: new Map<NodeId, number>(),
        };

  for (const placement of placements) {
    const { node, parentId, index } = placement;
    if (graph.nodesById.has(node.id) || willExist.has(node.id)) {
      return replayError(
        "node-exists",
        `Node ${node.id} already exists; re-inserting it would duplicate the id.`,
        { nodeId: node.id },
      );
    }
    // The parent is either already in the graph, or an EARLIER placement in
    // this same patch — document order, parents first, is what makes that true.
    const parentIsNew = willExist.has(parentId);
    if (!parentIsNew && !graph.nodesById.has(parentId)) {
      return replayError("parent-missing", `Parent ${parentId} is gone.`, {
        nodeId: node.id,
        parentId,
      });
    }
    if (!overlay.hasEntry(parentId)) {
      return replayError(
        "parent-not-loaded",
        `Parent ${parentId} does not have loaded children to insert into.`,
        { nodeId: node.id, parentId },
      );
    }
    const siblings = overlay.read(parentId);
    if (index < 0 || index > siblings.length) {
      return replayError(
        "index-out-of-range",
        `Index ${index} is outside [0, ${siblings.length}] of ${parentId}.`,
        { nodeId: node.id, parentId, index },
      );
    }
    if (depth !== null && ctx.maxDepth !== null) {
      let parentDepth = depth.byNew.get(parentId);
      if (parentDepth === undefined) {
        const cached = depth.ofExisting.get(parentId);
        if (cached !== undefined) parentDepth = cached;
        else {
          // `ancestorChain` is bounded by `nodesById.size` and excludes the node
          // itself, so this is the same `depthOf` the forward door computes —
          // one chain per distinct pre-existing parent, memoised because a bulk
          // insert names one parent thousands of times.
          parentDepth = ancestorChain(graph, parentId).length + 1;
          depth.ofExisting.set(parentId, parentDepth);
        }
      }
      const level = parentDepth + 1;
      if (level > ctx.maxDepth) {
        return replayError(
          "would-exceed-max-depth",
          `Replaying this insert would nest ${node.id} ${level} levels, past the ${ctx.maxDepth} ceiling.`,
          {
            nodeId: node.id,
            parentId,
            limit: ctx.maxDepth,
            actual: level,
          },
        );
      }
      depth.byNew.set(node.id, level);
    }

    overlay.insert(parentId, index, node.id);
    willExist.add(node.id);
    if (isLoadedContainer(node)) overlay.seedLoaded(node.id);
  }

  // Checked AFTER the structural pass, so a patch that is structurally
  // impossible reports that rather than an ownership complaint about a node it
  // could never have placed. Nothing is vacating a key here — an insert only
  // adds — so the second argument is null.
  // Gated on the registry, not on the patch: when no node type declares
  // `sourceKey` at all, `ownerBySourceKey` is permanently empty and this check
  // could never fire, so the whole pass — including a `sourceKey` call per
  // arriving node — is skipped rather than run to reach a foregone answer.
  if (derivedIndexNeed(ctx.registry).source) {
    const claims = new Map<NodeId, string | null>();
    for (const { node } of placements) {
      if (!ownsItsSubtree<Ts, S>(node)) continue;
      claims.set(node.id, sourceKeyOf<Ts, S>(ctx.registry, node));
    }
    const conflict = ownershipConflict(graph, claims);
    if (conflict !== null) return { ok: false, error: conflict };
  }

  return VERIFY_OK;
}

function verifyRemoved<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  placements: readonly Placement<Ts, S>[],
): Result<void, ReplayRejection> {
  const overlay = createChildrenOverlay(graph);
  const removed = new Set<NodeId>();

  // BACKWARD, matching the application order: deepest placements first, so a
  // parent's own recorded children are already gone when we ask whether it is
  // empty.
  for (let i = placements.length - 1; i >= 0; i--) {
    const placement = placements[i];
    if (placement === undefined) continue;
    const { node, parentId, index } = placement;

    const live = graph.nodesById.get(node.id);
    if (live === undefined || removed.has(node.id)) {
      return replayError("node-missing", `Node ${node.id} is gone.`, {
        nodeId: node.id,
      });
    }
    if (live.kind !== node.kind) {
      return replayError(
        "kind-mismatch",
        `Node ${node.id} is a "${live.kind}"; the patch recorded a "${node.kind}".`,
        { nodeId: node.id },
      );
    }
    if (removed.has(parentId)) {
      // A parent removed before its child means the placements are not in
      // document order, and the mirror with "inserted" is broken.
      //
      // This is the ONLY check that catches it once the parent is an EMPTY
      // loaded container: the "node-not-empty" check below sails through an
      // empty one, and the child then names a parent that no longer exists.
      // With a non-empty parent, "node-not-empty" gets there first.
      return replayError(
        "parent-missing",
        `Parent ${parentId} is removed before its child ${node.id}; placements are out of document order.`,
        { nodeId: node.id, parentId },
      );
    }
    const parentCheck = requireLoadedParent(graph, parentId);
    if (!parentCheck.ok) return parentCheck;

    const siblings = overlay.read(parentId);
    if (siblings[index] !== node.id) {
      return replayError(
        "index-out-of-range",
        `Node ${node.id} is no longer at index ${index} of ${parentId}.`,
        { nodeId: node.id, parentId, index },
      );
    }

    // THE SUBTREE CHECK. Two distinct failures land here:
    //  - the node gained children after the insert this patch would un-do, so
    //    removing it would orphan them;
    //  - the patch recorded only the named node instead of its whole subtree,
    //    so its descendants were never in `placements` and are still present.
    // Both are "removing this would strand nodes", and both must refuse.
    if (isLoadedContainer(live)) {
      const remaining = overlay.read(node.id);
      if (remaining.length > 0) {
        return replayError(
          "node-not-empty",
          `Node ${node.id} still has ${remaining.length} child(ren) the patch does not account for.`,
          { nodeId: node.id },
        );
      }
    }

    // BY INDEX — `siblings[index] === node.id` was just proved against this
    // same overlay, so scanning for the id again is pure re-derivation, and a
    // quadratic one on the shape this arm exists to serve.
    overlay.removeAt(parentId, index);
    removed.add(node.id);
  }

  return VERIFY_OK;
}

function verifyDataChanged<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  changes: readonly DataChange<Ts>[],
  ctx: EngineContext<S>,
): Result<void, ReplayRejection> {
  for (const change of changes) {
    const node = graph.nodesById.get(change.nodeId);
    if (node === undefined) {
      return replayError("node-missing", `Node ${change.nodeId} is gone.`, {
        nodeId: change.nodeId,
      });
    }
    if (node.sealed) {
      // A sealed node holds `raw`, not parsed data: there is nothing the
      // recorded `before` could match, and writing `after` into it would
      // destroy the byte-exact re-emit sealing exists to guarantee.
      return replayError(
        "data-mismatch",
        `Node ${change.nodeId} is sealed and holds no parsed data.`,
        { nodeId: change.nodeId },
      );
    }
    if (node.kind !== change.kind) {
      return replayError(
        "kind-mismatch",
        `Node ${change.nodeId} is a "${node.kind}"; the patch recorded a "${change.kind}".`,
        { nodeId: change.nodeId },
      );
    }
    const nodeType = ctx.registry.get(change.kind);
    if (nodeType === undefined) {
      return replayError(
        "kind-mismatch",
        `Kind "${change.kind}" is not registered, so its recorded value cannot be compared.`,
        { nodeId: change.nodeId },
      );
    }
    // Compare on the SERIALIZED form. Parsed values may carry identity a node type
    // does not consider meaningful (a normalized copy, a cached derivation), and
    // comparing those would refuse valid undos; the wire form is the node type's own
    // statement of what its value IS.
    // IDENTITY FIRST. `change.before` and the node's live data are usually the
    // very same object — the reducer stores exactly what `applyEdit` returned
    // and the patch records that reference — so the common replay is settled
    // without calling the consumer's `serialize` at all. Sound because same
    // reference implies same serialization for any deterministic node type, and a
    // non-deterministic one already fails the slow path.
    //
    // Worth doing for the same reason the cross-parent move stopped asking for
    // `contentKey`: `serialize` is consumer code of unknown cost, and undo runs
    // it once per changed node per verification.
    if (Object.is(change.before, node.data)) continue;

    // WRAPPED. `serialize` is consumer code, and this function is contracted to
    // return a `Result` — a throw here escaped `verifyPatchApplies` and took
    // `undo` and `redo` with it. A node type that cannot serialize its own value
    // cannot prove the recorded `before` still stands, so the honest verdict is
    // the same one a genuine difference produces: this patch no longer applies.
    // Refusing is safe (the entry stays on the stack, the graph is untouched);
    // proceeding on an unverifiable comparison is not.
    let matches: boolean;
    try {
      matches = deepEqual(
        nodeType.serialize(change.before),
        nodeType.serialize(node.data),
      );
    } catch (thrown) {
      return replayError(
        "data-mismatch",
        `Node ${change.nodeId} could not be compared against this patch's recorded "before": ${JSON.stringify(change.kind)}.serialize threw (${describeThrown(thrown)}).`,
        { nodeId: change.nodeId },
      );
    }
    if (!matches) {
      return replayError(
        "data-mismatch",
        `Node ${change.nodeId} no longer holds the value this patch recorded as "before".`,
        { nodeId: change.nodeId },
      );
    }
  }

  // THE SAME OWNERSHIP HOLE AS `verifyInserted`, through the data path. A
  // `sourceKey` is computed FROM data, so restoring an old value re-claims an
  // old key — and `applyNonUndoableWrite` may have moved another node onto it meanwhile.
  // The original review named only the insert arm; this one reproduces
  // identically (edit a box off its key, let the server move a sibling onto it,
  // then Ctrl-Z) and a fix that guarded one arm would have left the other open.
  //
  // Both maps are keyed by the same node set, so a patch that re-keys several
  // nodes at once — including two swapping keys — is judged on where they all
  // END UP rather than on one intermediate state that never exists.
  // Gated for the same reason as the insert arm, and it matters more here: undo
  // runs this per changed node, and the last round spent real effort getting a
  // common replay down to zero consumer node-type calls.
  if (derivedIndexNeed(ctx.registry).source) {
    const claims = new Map<NodeId, string | null>();
    for (const change of changes) {
      const node = graph.nodesById.get(change.nodeId);
      // Ownership is a property of the node's SHAPE, which a data change cannot
      // alter — so the live node answers it even though its data is about to be
      // replaced.
      //
      // A COST FILTER, not a correctness one, and mutation testing says so:
      // deleting `ownsItsSubtree` here fails nothing, because `ownsItsSubtree`
      // is also what decides who gets INTO `ownerBySourceKey`, so a non-owner's
      // key is never found there anyway. It stays because it is the cheaper of
      // the two ways to reach that answer — a shape check instead of a consumer
      // `sourceKey` call per changed node — and because reading the same
      // predicate the index was built from is what keeps the two in step.
      if (node === undefined || !ownsItsSubtree<Ts, S>(node)) continue;
      claims.set(
        change.nodeId,
        sourceKeyForData(ctx.registry, change.kind, change.after),
      );
    }
    const conflict = ownershipConflict(graph, claims);
    if (conflict !== null) return { ok: false, error: conflict };
  }

  return VERIFY_OK;
}

// ---------------------------------------------------------------------------

// KEEL — the command reducer: THE ONE mutation path.
//
// Every user-intent change to the graph enters here. `applyCommand` validates
// completely, THEN constructs a patch and hands it to `applyPatch` — the same
// code undo/redo replays — so forward application and inversion cannot drift.
// Nothing is ever partially applied: a rejection returns an error and the
// caller's graph, which was never mutated, is still the current one.
//
// Three doors live here, and they differ in exactly one respect — what they
// leave behind:
//
//   applyCommand      -> patch + history entry + change-feed event  (user intent)
//   resolveDrop       -> nothing; it only TRANSLATES a gesture into a command
//   applyIngestEdits  -> no patch, no history entry, no change-feed event, and
//                        it SCRUBS both history stacks             (server write)
//
// PURE. No React, no DOM. Nothing here throws; every failure is Result-shaped.

import {
  describeThrown,
  describeValue,
  structurallyEqualBounded,
  type GraphNode,
  type ChildrenState,
  type Command,
  type DataChange,
  type DropIntent,
  type EditOf,
  type EngineContext,
  type Graph,
  type History,
  type Move,
  type NodeId,
  type Patch,
  type Placement,
  type Rejection,
  type RejectionCode,
  type Result,
  type EditRejection,
  type Seed,
  makeCollectionNode,
  makeDataChange,
  makeLeafNode,
  tryParseNodeId,
} from "./types";
import {
  dataChangeLeavesDerivedIndexesIntact,
  ownsItsSubtree,
  ancestorChain,
  bumpSubtreeRevs,
  documentOrderComparator,
  documentOrder,
  getChildren,
  getNode,
  getParent,
  isSameOrAncestor,
  ownsSubtree,
  rebuildDerivedIndexes,
  sourceKeyOf,
  subtreeIds,
} from "./graph";
import { applyPatch, patchTouchedNodeIds } from "./patches";
import { parseNodeData } from "./serialize";
import { scrubHistoryForIngest } from "./history";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Everything on a `Rejection` except the two fields every rejection has. */
type RejectionContext = Omit<Rejection, "code" | "message">;

function fail<T>(
  code: RejectionCode,
  message: string,
  context?: RejectionContext,
): Result<T, Rejection> {
  // Spreading `undefined` yields `{}`, so the optional argument needs no branch.
  return { ok: false, error: { code, message, ...context } };
}

function ok<T>(value: T): Result<T, Rejection> {
  return { ok: true, value };
}

/**
 * The cross-instance guard. `NodeId` is branded GLOBALLY, not per engine, so an
 * id minted by engine A typechecks against engine B and only this runtime check
 * separates them. Every mutating door runs it first.
 */
function foreignGraph<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  ctx: EngineContext<S>,
): Rejection | null {
  if (graph.engineId !== ctx.engineId) {
    return {
      code: "foreign-graph",
      message: "This graph was produced by a different engine instance.",
    };
  }
  return null;
}

/**
 * Rank every node by its position in a pre-order walk, so a set of ids can be
 * sorted into document order.
 *
 * O(nodes) per call, which is why it is called ONCE per command rather than
 * from inside a comparator. It is the same order `selection.selectRange` uses,
 * so a shift-click range and a multi-node drag agree about what "first" means.
 */
function documentOrderRank<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
): ReadonlyMap<NodeId, number> {
  const rank = new Map<NodeId, number>();
  // `.entries()` rather than an index loop: under `noUncheckedIndexedAccess`
  // `order[i]` is `NodeId | undefined` and the guard would be pure noise.
  for (const [position, id] of documentOrder(graph).entries()) {
    rank.set(id, position);
  }
  return rank;
}

/**
 * Sort into document order. An id with no rank sorts LAST — that can only
 * happen for a node that exists but is unreachable from any root, which is an
 * invariant violation `findInvariantViolation` reports; putting it somewhere
 * deterministic beats crashing the drag that discovered it.
 */
function inDocumentOrder<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  ids: Iterable<NodeId>,
): readonly NodeId[] {
  const list = [...ids];
  if (list.length <= 1) return list;

  // FAST PATH: one parent. Dragging inside a strip is the commonest gesture
  // there is, and the answer is just the sibling slots.
  const first = list[0];
  if (first !== undefined) {
    const parentId = getParent(graph, first);
    if (parentId !== null && list.every((id) => getParent(graph, id) === parentId)) {
      const siblings = getChildren(graph, parentId);
      const slots = new Map<NodeId, number>();
      for (const [index, id] of siblings.entries()) slots.set(id, index);
      if (list.every((id) => slots.has(id))) {
        return list.sort((a, b) => (slots.get(a) ?? 0) - (slots.get(b) ?? 0));
      }
    }
  }

  // GENERAL PATH: compare root-paths, which is O(k log k x depth) and touches
  // only the ancestors of the ids actually named.
  const compare = documentOrderComparator(graph);
  let declined = false;
  const sorted = list.slice().sort((a, b) => {
    const verdict = compare(a, b);
    if (verdict === null) {
      declined = true;
      return 0;
    }
    return verdict;
  });
  if (!declined) return sorted;

  // The comparator says "cannot say" only when `parentById` and `childrenById`
  // disagree, or a node is unreachable from every root — both invariant
  // violations `findInvariantViolation` reports. Fall back to the authoritative
  // walk, which still puts an unranked id LAST deterministically, because a
  // drag that discovered a broken graph should still resolve somewhere rather
  // than crash.
  const rank = documentOrderRank(graph);
  const unreachable = Number.MAX_SAFE_INTEGER;
  return list.sort(
    (a, b) => (rank.get(a) ?? unreachable) - (rank.get(b) ?? unreachable),
  );
}

/**
 * `id -> index` within one parent's children, computed ONCE per parent.
 *
 * Both bulk paths — `planMove` and `applyRemoveNodes` — used
 * `getChildren(graph, parentId).indexOf(id)` once per named node, which is
 * O(siblings) each and therefore O(K x N) for K nodes out of one strip. That is
 * the patch-BUILDING half of the same quadratic `spliceOutMany` fixed on the
 * applying half; fixing one and not the other left select-all-then-Delete at
 * 62x growth for 10x the siblings when a linear reference moved 15x.
 *
 * FIRST occurrence wins, which is what `indexOf` answered. A repeated id in one
 * children array is an invariant violation the audit reports; this is not the
 * place to disagree with the old behaviour about it.
 *
 * Cached per CALL, never across calls: the map is keyed by parent and read off
 * a specific graph, and holding it beyond the command would be a stale index
 * one mutation later.
 */
function childSlots<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  parentId: NodeId,
  cache: Map<NodeId, ReadonlyMap<NodeId, number>>,
): ReadonlyMap<NodeId, number> {
  const hit = cache.get(parentId);
  if (hit !== undefined) return hit;
  const slots = new Map<NodeId, number>();
  const children = getChildren(graph, parentId);
  for (let index = 0; index < children.length; index += 1) {
    const id = children[index];
    if (id !== undefined && !slots.has(id)) slots.set(id, index);
  }
  cache.set(parentId, slots);
  return slots;
}

/**
 * Drop every id that lives under another id in the same set — a subtree travels
 * with its root, so naming both a folder and a clip inside it must not move (or
 * remove) that clip twice.
 *
 * Walks each id's ancestor CHAIN rather than comparing every pair: O(depth) per
 * id instead of O(n^2), and `ancestorChain` needs no visiting set because the
 * `reference` children state makes the placement forest a genuine tree.
 */
function pruneDescendants<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  ids: ReadonlySet<NodeId>,
): readonly NodeId[] {
  const kept: NodeId[] = [];
  for (const id of ids) {
    let coveredByAncestor = false;
    for (const ancestorId of ancestorChain(graph, id)) {
      if (ids.has(ancestorId)) {
        coveredByAncestor = true;
        break;
      }
    }
    if (!coveredByAncestor) kept.push(id);
  }
  return kept;
}

/**
 * The `sourceKey` this node OWNS, or null.
 *
 * A `reference` placement owns nothing — that is the entire point of the state
 * — so it is exempt from the single-owner rule. A quarantined node has no node type
 * and therefore no key at all.
 */
function owningSourceKey<Ts extends readonly unknown[], S>(
  ctx: EngineContext<S>,
  node: GraphNode<Ts, S>,
): string | null {
  const key = sourceKeyOf<Ts, S>(ctx.registry, node);
  if (key === null) return null;
  // DELEGATED, not re-derived. This used to spell the rule out again and
  // disagreed with ./serialize about leaves — see `ownsItsSubtree`.
  if (!ownsItsSubtree<Ts, S>(node)) return null;
  return key;
}

/** An index must be a whole number inside `[0, length]` — `length` itself is the
 *  "append" position, which is why the upper bound is inclusive. */
function isValidIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index <= length;
}

// ---------------------------------------------------------------------------
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
function planMove<Ts extends readonly unknown[], S>(
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
  // quarantined CONTAINER is allowed here when it is loaded: its children array
  // is real, and the whole point of quarantine is that the subtree stays usable.
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
function buildMoves(
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
function isNoOpMove(moves: readonly Move[]): boolean {
  return moves.every(
    (move) =>
      move.fromParentId === move.toParentId && move.fromIndex === move.toIndex,
  );
}

/**
 * The tallest LIVE subtree under `id`, counting `id` itself as 1.
 *
 * `subtreeIds` descends only `loaded` collections, which is the right rule
 * here: an unloaded branch contributes its placeholder and nothing more,
 * exactly as it does when the ingress door measures the same graph. So a move
 * is judged on the depth the graph actually holds, and loading that branch
 * later is bounded by `loadChildrenInto`'s own check rather than pre-refused
 * here on a guess about what it might contain.
 */
function tallestSubtree<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): number {
  const base = ancestorChain(graph, id).length;
  let tallest = 1;
  for (const descendantId of subtreeIds(graph, id)) {
    const depth = ancestorChain(graph, descendantId).length - base + 1;
    if (depth > tallest) tallest = depth;
  }
  return tallest;
}

function applyMoveNodes<Ts extends readonly unknown[], S>(
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
      const deepest = parentDepth + tallestSubtree<Ts, S>(graph, id);
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

// ---------------------------------------------------------------------------
// insert-nodes
// ---------------------------------------------------------------------------

/**
 * Mint an id nothing has claimed.
 *
 * `taken` carries the ids minted EARLIER IN THIS COMMAND as well as the graph's,
 * because a weak `mintId` (a short random suffix, a test stub) collides with its
 * own siblings long before it collides with the document.
 *
 * The bounded retry followed by a deterministic fallback is deliberate. A
 * `mintId` that always returns the same string, or returns whitespace, is a
 * programmer error — but nothing in this module may throw, and an unbounded
 * retry loop is a hang, which is strictly worse than an ugly id.
 */
function mintFreshId<S>(
  taken: ReadonlySet<string>,
  ctx: EngineContext<S>,
): NodeId {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const minted = tryParseNodeId(ctx.mintId());
    if (minted.ok && !taken.has(minted.value)) return minted.value;
  }
  for (let counter = 0; ; counter += 1) {
    const candidate = `keel-node-${counter}`;
    if (!taken.has(candidate)) {
      // Always ok — the literal is non-empty — but branded through the door
      // rather than cast, so this file contains no cast at all.
      const parsed = tryParseNodeId(candidate);
      if (parsed.ok) return parsed.value;
    }
  }
}

/** One frame of the seed walk, plus the ancestor link that turns a cyclic seed
 *  into a rejection rather than a hang. */
type SeedFrame<Ts extends readonly unknown[], S> = Readonly<{
  seed: Seed<Ts, S>;
  parentId: NodeId;
  index: number;
  ancestors: SeedPath<Ts, S> | null;
}>;

/**
 * The ancestor path as a linked list, not a Set: O(1) to extend, and depth is
 * small in practice. It has to be the PATH and not a global visited set —
 * inserting the same seed VALUE twice as two siblings is legitimate (two copies
 * of one thing), while a seed that appears inside itself is a cycle.
 */
type SeedPath<Ts extends readonly unknown[], S> = Readonly<{
  seed: Seed<Ts, S>;
  parent: SeedPath<Ts, S> | null;
}>;

function seedPathContains<Ts extends readonly unknown[], S>(
  path: SeedPath<Ts, S> | null,
  seed: Seed<Ts, S>,
): boolean {
  for (let link = path; link !== null; link = link.parent) {
    if (link.seed === seed) return true;
  }
  return false;
}

function applyInsertNodes<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  seeds: readonly Seed<Ts, S>[],
  toParentId: NodeId,
  toIndex: number,
  ctx: EngineContext<S>,
): Result<Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>, Rejection> {
  if (seeds.length === 0) {
    return fail("empty-command", "insert-nodes was given no seeds.");
  }

  const targetCheck = checkInsertTarget(graph, toParentId);
  if (!targetCheck.ok) return targetCheck;

  const currentChildren = getChildren(graph, toParentId);
  // Nothing is removed first, so this index lives in the target's CURRENT
  // coordinates — the one place insert and move genuinely differ.
  if (!isValidIndex(toIndex, currentChildren.length)) {
    return fail(
      "index-out-of-range",
      `toIndex ${toIndex} is outside [0, ${currentChildren.length}] for ${JSON.stringify(toParentId)}.`,
      { parentId: toParentId, index: toIndex },
    );
  }

  // DEPTH first, because it can be answered from the seeds alone and refusing
  // before `buildSeedPlacements` mints ids keeps a refused command from having
  // consumed any of the id space.
  if (ctx.maxDepth !== null) {
    const deepest = depthOf(graph, toParentId) + tallestSeed<Ts, S>(seeds);
    if (deepest > ctx.maxDepth) {
      return fail(
        "would-exceed-max-depth",
        `Inserting here would nest ${deepest} levels, above the ${ctx.maxDepth} ceiling. ` +
          `Raise or clear EngineConfig.maxDepth if this is legitimate.`,
        { parentId: toParentId, limit: ctx.maxDepth, actual: deepest },
      );
    }
  }

  const built = buildSeedPlacements(graph, seeds, toParentId, toIndex, ctx);
  if (!built.ok) return built;

  // COUNTED FROM THE PLACEMENTS, not from `seeds.length`: one seed may carry a
  // whole subtree, and a per-command check would let three nodes in under a
  // ceiling with room for one.
  const total = graph.nodesById.size + built.value.length;
  if (total > ctx.maxNodes) {
    return fail(
      "would-exceed-max-nodes",
      `Inserting ${built.value.length} node(s) into a graph of ${graph.nodesById.size} would reach ` +
        `${total}, above the ${ctx.maxNodes} ceiling. Raise EngineConfig.maxNodes if this is legitimate.`,
      { parentId: toParentId, limit: ctx.maxNodes, actual: total },
    );
  }

  const patch: Patch<Ts, S> = { type: "inserted", placements: built.value };
  return ok({ graph: applyPatch(graph, patch, ctx), patch });
}

function checkInsertTarget<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  toParentId: NodeId,
): Result<void, Rejection> {
  const target = getNode(graph, toParentId);
  if (target === undefined) {
    return fail(
      "unknown-parent",
      `No node ${JSON.stringify(toParentId)} to insert into.`,
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
  if (target.children === null || target.children.status !== "loaded") {
    return fail(
      "target-not-loaded",
      `Node ${JSON.stringify(toParentId)} is a container whose children are not loaded.`,
      { parentId: toParentId },
    );
  }
  return ok(undefined);
}

/**
 * Expand a seed forest into `inserted` placements: DOCUMENT ORDER, parents
 * first, which is the order `applyPatch` walks forward and `invertPatch`
 * preserves.
 *
 * EXPLICIT STACK, never recursion — seed depth is consumer input.
 */
/**
 * How deep `id` sits, counting the roots as level 1.
 *
 * `ancestorChain` excludes `id` itself, so its length plus one IS the depth —
 * the same arithmetic `loadChildrenInto` uses to tell `buildDocument` where a
 * lazy payload is being attached. Stated once here so the reducer and the
 * ingress door cannot drift about what "depth" counts.
 */
function depthOf<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): number {
  return ancestorChain(graph, id).length + 1;
}

/**
 * The tallest subtree in a seed batch, counting the seed itself as 1.
 *
 * Walked with an explicit stack for the same reason every other walk in this
 * package is: a seed's children are consumer-supplied and their nesting is not
 * this module's to trust.
 */
function tallestSeed<Ts extends readonly unknown[], S>(
  seeds: readonly Seed<Ts, S>[],
): number {
  let tallest = 0;
  const stack: Readonly<{ seed: Seed<Ts, S>; depth: number }>[] = seeds.map(
    (seed) => ({ seed, depth: 1 }),
  );
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    if (frame.depth > tallest) tallest = frame.depth;
    const kids = frame.seed.children;
    if (kids === undefined) continue;
    for (const kid of kids) stack.push({ seed: kid, depth: frame.depth + 1 });
  }
  return tallest;
}

function buildSeedPlacements<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  seeds: readonly Seed<Ts, S>[],
  toParentId: NodeId,
  toIndex: number,
  ctx: EngineContext<S>,
): Result<readonly Placement<Ts, S>[], Rejection> {
  const placements: Placement<Ts, S>[] = [];
  const taken = new Set<string>(graph.nodesById.keys());
  // Owners claimed by THIS batch. The graph's own index cannot see them yet, so
  // without this two sibling seeds could both claim one stored subtree.
  const claimedSourceKeys = new Map<string, NodeId>();

  const stack: SeedFrame<Ts, S>[] = [];
  // Pushed in reverse so the stack pops them in order; a plain DFS from there
  // IS document order.
  for (let i = seeds.length - 1; i >= 0; i -= 1) {
    const seed = seeds[i];
    if (seed === undefined) continue;
    stack.push({ seed, parentId: toParentId, index: toIndex + i, ancestors: null });
  }

  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { seed, parentId, index, ancestors } = frame;

    if (seedPathContains(ancestors, seed)) {
      // A seed that contains itself would expand forever. Reported as
      // "parse-failed" — "we could not build this node" is exactly true, and it
      // is the code that carries `issues`.
      return fail("parse-failed", "A seed contains itself; the seed tree is cyclic.", {
        kind: seed.kind,
        issues: [{ path: "$.children", message: "cyclic seed" }],
      });
    }

    const nodeType = ctx.registry.get(seed.kind);
    if (nodeType === undefined) {
      // On the WIRE an unknown kind quarantines, because forward-incompatible
      // stored data has to stay movable and deletable. On the COMMAND path it
      // is refused: the consumer is right here holding a value it just built,
      // and quarantining a brand-new insert would be nonsense.
      return fail(
        "unknown-kind",
        `No node type registered for kind ${JSON.stringify(seed.kind)}.`,
        { kind: seed.kind },
      );
    }

    const seedChildren = seed.children;
    if (!nodeType.container && seedChildren !== undefined) {
      return fail(
        "leaf-seed-with-children",
        `Kind ${JSON.stringify(seed.kind)} is a leaf and cannot be seeded with children.`,
        { kind: seed.kind },
      );
    }

    const nodeId = mintFreshId(taken, ctx);
    taken.add(nodeId);

    // The seed's `data` is already typed as the kind's `Data`, and it STILL goes
    // through the node type: a normalizing parse must normalize inserts too, and a
    // consumer handing in a value that violates its own invariants deserves to
    // be caught at the same door as wire data. `schemaVersion` is the registry's
    // own, so no migration runs on a value authored against the running code.
    const parsed = parseNodeData<S>(ctx, {
      nodeId,
      kind: seed.kind,
      container: nodeType.container,
      schemaVersion: nodeType.schemaVersion,
      raw: seed.data,
    });
    if (!parsed.ok) {
      return fail(
        parsed.error.reason === "unknown-kind" ? "unknown-kind" : "parse-failed",
        `Seed for kind ${JSON.stringify(seed.kind)} failed its own parse.`,
        { kind: seed.kind, issues: parsed.error.issues },
      );
    }

    const node: GraphNode<Ts, S> = nodeType.container
      ? makeCollectionNode<Ts, S>(
          nodeId,
          seed.kind,
          parsed.value.data,
          // A seed always produces a LOADED collection: the consumer just
          // supplied its whole content, so "we have not read this yet" is false
          // by construction. Omitted children means loaded-and-empty.
          { status: "loaded" },
          seed.summary ?? null,
        )
      : makeLeafNode<Ts>(nodeId, seed.kind, parsed.value.data);

    const sourceKey = owningSourceKey<Ts, S>(ctx, node);
    if (sourceKey !== null) {
      const existingOwner =
        graph.ownerBySourceKey.get(sourceKey) ?? claimedSourceKeys.get(sourceKey);
      if (existingOwner !== undefined) {
        // The typed answer the consumer is meant to give is a `reference`
        // placement. Two owning placements of one stored subtree is the
        // condition the production predecessor survived only by never loading
        // the second one.
        return fail(
          "duplicate-owner",
          `Source ${JSON.stringify(sourceKey)} is already owned by ${JSON.stringify(existingOwner)}.`,
          { kind: seed.kind, sourceKey, ownerId: existingOwner, nodeIds: [nodeId] },
        );
      }
      claimedSourceKeys.set(sourceKey, nodeId);
    }

    placements.push({ node, parentId, index });

    if (seedChildren !== undefined) {
      const path: SeedPath<Ts, S> = { seed, parent: ancestors };
      for (let i = seedChildren.length - 1; i >= 0; i -= 1) {
        const child = seedChildren[i];
        if (child === undefined) continue;
        stack.push({ seed: child, parentId: nodeId, index: i, ancestors: path });
      }
    }
  }

  return ok(placements);
}

// ---------------------------------------------------------------------------
// remove-nodes
// ---------------------------------------------------------------------------

function applyRemoveNodes<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  nodeIds: readonly NodeId[],
  allowUnloaded: boolean,
  ctx: EngineContext<S>,
): Result<Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>, Rejection> {
  if (nodeIds.length === 0) {
    return fail("empty-command", "remove-nodes was given no nodes to remove.");
  }

  // Unlike a move, a repeated id here is DEDUPED rather than refused: removal is
  // idempotent, so "delete this twice" has one obvious meaning and none of the
  // one-removal-two-insertions hazard that makes a duplicated move corrupting.
  const unique = new Set<NodeId>(nodeIds);

  for (const id of unique) {
    if (getNode(graph, id) === undefined) {
      return fail("unknown-node", `No node ${JSON.stringify(id)} in the graph.`, {
        nodeIds: [id],
      });
    }
    if (getParent(graph, id) === null) {
      return fail("cannot-remove-root", `Node ${JSON.stringify(id)} is a root.`, {
        nodeIds: [id],
      });
    }
  }

  // Naming a folder and a clip inside it removes the clip ONCE, via the folder.
  // Not an error — it is what a rubber-band selection produces every time.
  const roots = inDocumentOrder(graph, pruneDescendants(graph, unique));

  const placements: Placement<Ts, S>[] = [];
  const slotCache = new Map<NodeId, ReadonlyMap<NodeId, number>>();
  for (const rootId of roots) {
    // `subtreeIds` is pre-order and descends only `loaded` collections, so an
    // unloaded branch contributes exactly its placeholder — which is the whole
    // reason `allowUnloaded` has to be asked for.
    for (const id of subtreeIds(graph, rootId)) {
      const node = getNode(graph, id);
      if (node === undefined) {
        return fail("unknown-node", `No node ${JSON.stringify(id)} in the graph.`, {
          nodeIds: [id],
        });
      }
      if (node.container && !allowUnloaded) {
        const state = node.children;
        // Literally "not loaded", which sweeps in `reference` and `missing`
        // alongside `unloaded`. Deliberate: `patchDetachedSubtrees` reports the
        // same set on the change feed, and one rule the two modules share beats
        // two subtly different ones that drift.
        if (state === null || state.status !== "loaded") {
          return fail(
            "unloaded-subtree",
            `Node ${JSON.stringify(id)} is a container whose subtree is not loaded; pass allowUnloaded to remove it.`,
            { nodeIds: [id], kind: node.kind },
          );
        }
      }
      const parentId = getParent(graph, id);
      if (parentId === null) {
        return fail("cannot-remove-root", `Node ${JSON.stringify(id)} is a root.`, {
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
      placements.push({ node, parentId, index });
    }
  }

  // The EXACT mirror of the inserted form: same array, same order, same
  // indices. `applyPatch` walks it backward so children leave before parents and
  // a later sibling's splice cannot invalidate an earlier one's index.
  const patch: Patch<Ts, S> = { type: "removed", placements };
  return ok({ graph: applyPatch(graph, patch, ctx), patch });
}

// ---------------------------------------------------------------------------
// edit-nodes
// ---------------------------------------------------------------------------

/**
 * One resolved edit. It carries enough to rebuild the node WITHOUT re-narrowing
 * `GraphNode` later, because `applyIngestEdits` has to reconstruct nodes by hand:
 * it deliberately produces no patch for `applyPatch` to consume.
 */
type EditPlan<S> = Readonly<{
  nodeId: NodeId;
  kind: string;
  before: unknown;
  after: unknown;
  /** `null` when the target is a leaf. */
  collection: Readonly<{ children: ChildrenState; summary: S | null }> | null;
}>;

/**
 * The shared validation and dispatch behind BOTH `edit-nodes` and
 * `applyIngest`. Same path, same rejections — the two doors differ only in what
 * they leave behind, never in what they accept.
 */
function planEdits<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  edits: readonly EditOf<Ts>[],
  ctx: EngineContext<S>,
): Result<readonly EditPlan<S>[], Rejection> {
  if (edits.length === 0) {
    return fail("empty-command", "No edits were supplied.");
  }

  // Two edits to one node in one command would produce two `DataChange` entries
  // for that node, which breaks the per-node independence `scrubPatchForIngest`
  // depends on and leaves the entry's inverse ambiguous.
  const seen = new Set<NodeId>();
  for (const edit of edits) {
    if (seen.has(edit.nodeId)) {
      return fail(
        "duplicate-node-ids",
        `Node ${JSON.stringify(edit.nodeId)} was edited twice in one command.`,
        { nodeIds: [edit.nodeId] },
      );
    }
    seen.add(edit.nodeId);
  }

  const plans: EditPlan<S>[] = [];
  // An edit can move a node's `sourceKey` onto one another node already owns,
  // which would leave the graph violating the single-owner invariant with no
  // rejection anywhere. Not spelled out in the command contract; checked here
  // because this reducer is the only thing that could create it.
  const claimedSourceKeys = new Map<string, NodeId>();

  for (const edit of edits) {
    const node = getNode(graph, edit.nodeId);
    if (node === undefined) {
      return fail(
        "unknown-node",
        `No node ${JSON.stringify(edit.nodeId)} in the graph.`,
        { nodeIds: [edit.nodeId] },
      );
    }
    if (node.quarantined) {
      // Quarantined nodes move, delete and undo. They do not edit: there is no
      // node type, and writing through `raw` would forfeit byte-exact re-emit.
      return fail(
        "node-quarantined",
        `Node ${JSON.stringify(edit.nodeId)} is quarantined (${node.reason}) and cannot be edited.`,
        { nodeIds: [edit.nodeId], kind: node.kind, issues: node.issues },
      );
    }
    if (node.kind !== edit.kind) {
      return fail(
        "kind-mismatch",
        `Edit claims kind ${JSON.stringify(edit.kind)} but node ${JSON.stringify(edit.nodeId)} is ${JSON.stringify(node.kind)}.`,
        { nodeIds: [edit.nodeId], kind: edit.kind },
      );
    }
    const nodeType = ctx.registry.get(node.kind);
    if (nodeType === undefined) {
      // Defensive: a node of an unregistered kind should already be
      // quarantined, so reaching here means the graph and the registry came
      // from different engines.
      return fail(
        "unknown-kind",
        `No node type registered for kind ${JSON.stringify(node.kind)}.`,
        { nodeIds: [edit.nodeId], kind: node.kind },
      );
    }

    // WRAPPED for the same reason ./serialize wraps `parse`: `applyEdit` is
    // consumer code, and a node type that throws must produce the refusal this
    // function is contracted to return rather than an exception out of
    // `dispatch`. A throw and a returned `{ ok: false }` mean the same thing to
    // the user — the node type would not accept this edit — so they get the same
    // code, with the thrown message carried through.
    let applied: Result<unknown, EditRejection>;
    try {
      applied = nodeType.applyEdit(node.data, edit.edit);
    } catch (thrown) {
      return fail(
        "edit-rejected",
        `${JSON.stringify(node.kind)}.applyEdit threw: ${describeThrown(thrown)}`,
        { nodeIds: [edit.nodeId], kind: node.kind },
      );
    }
    if (!applied.ok) {
      return fail(
        "edit-rejected",
        `${JSON.stringify(node.kind)}.applyEdit refused the edit: ${applied.error.message}`,
        { nodeIds: [edit.nodeId], kind: node.kind, editRejection: applied.error },
      );
    }

    // RE-PARSE the node type's own output. `applyEdit` is consumer code, and it is
    // the one ingress the engine would otherwise trust blind — an edit that
    // walks a clip past its own source length is exactly as invalid as the same
    // value arriving off the wire. Round-tripped through `serialize` because
    // that is the form `parse` is defined over, which also means a lossy
    // `serialize` surfaces here rather than three saves later.
    // WRAPPED, like the `applyEdit` above it. `parseNodeData` already guards
    // the `parse` half of this round trip; leaving the `serialize` half bare
    // meant the same class of consumer bug escaped as an exception from one
    // side of one expression and as a `Result` from the other.
    let raw: unknown;
    try {
      raw = nodeType.serialize(applied.value);
    } catch (thrown) {
      return fail(
        "parse-failed",
        `${JSON.stringify(node.kind)}.serialize threw while re-encoding the edited value: ${describeThrown(thrown)}`,
        {
          nodeIds: [edit.nodeId],
          kind: node.kind,
          issues: [{ path: "$", message: describeThrown(thrown) }],
        },
      );
    }

    const reparsed = parseNodeData<S>(ctx, {
      nodeId: edit.nodeId,
      kind: node.kind,
      container: nodeType.container,
      schemaVersion: nodeType.schemaVersion,
      raw,
      // `raw` IS this node type's serialize output, so the generic
      // `parse(serialize(d))` comparison inside `parseNodeData` would re-derive
      // a value from the bytes it just came from and can never fail. The
      // stronger comparison for this door runs below instead.
      rawIsSerializeOutput: true,
    });
    if (!reparsed.ok) {
      return fail(
        "parse-failed",
        `The edit produced a ${JSON.stringify(node.kind)} value that no longer parses.`,
        { nodeIds: [edit.nodeId], kind: node.kind, issues: reparsed.error.issues },
      );
    }

    const nextData = reparsed.value.data;

    // ---- DEV CHECKS AT THE EDIT DOOR ----------------------------------------
    //
    // PLACED HERE, AFTER `raw` and `nextData` exist, and not earlier. Above
    // this point `node.data` is the LIVE value by reference and the engine has
    // not yet captured it as the history entry's `before`. A consumer
    // `applyEdit` or `invertEdit` that normalises its argument in place — a
    // normal performance idiom, and the exact class this file already wraps for
    // — would therefore change what gets recorded, storing different data under
    // `devChecks: true` than under `false` and corrupting the `before` that
    // `verifyPatchApplies` later compares. Undo would fail `data-mismatch` on a
    // node nothing legitimately touched.
    if (ctx.devChecks) {
      // 1. UPSTREAM VS DOWNSTREAM, and it is FREE — both values already exist.
      //
      //    `applied.value` is what the node type's own `applyEdit` produced.
      //    `nextData` is what came back after that value made a round trip
      //    through `serialize` and `parse`, and it is what the engine actually
      //    STORES. If they differ, the edit the consumer asked for is not the
      //    edit that landed, and the difference is exactly what `serialize`
      //    dropped on the way out.
      //
      //    THE FIRST DRAFT OF THIS COMPARED `serialize(nextData)` AGAINST `raw`
      //    and could not fail: for a node type that drops a field, both sides drop
      //    it, so the two agree while the field is being lost. The lossy
      //    fixture in ./devchecks-audits caught that, which is the entire
      //    argument for writing the violating node type before the check.
      const verdict = structurallyEqualBounded(applied.value, nextData);
      if (verdict === false) {
        console.error(
          `keel dev check: editing a ${JSON.stringify(node.kind)} node stored something ` +
            `different from what its own applyEdit returned. The engine stores parse's ` +
            `OUTPUT, so a field this node type's serialize omits is dropped on every edit. ` +
            `node=${JSON.stringify(edit.nodeId)} produced=${describeValue(applied.value)} ` +
            `stored=${describeValue(nextData)}`,
        );
      }

      // 2. THE OPT-IN INVERSE. `invertEdit` is declared on `NodeType` and
      //    documented to satisfy
      //      applyEdit(applyEdit(d, e).value, invertEdit(e, d)) deep-equals d
      //    and the engine never calls it — undo works from whole-value
      //    before/after pairs, which cannot be wrong. So this verifies a
      //    property of a method nothing consults: preparation for the day it is
      //    consulted, not a bug hunt.
      //
      //    `nodeType.applyEdit` is called DIRECTLY. Building a synthetic
      //    `edit-nodes` command and dispatching it would re-enter `planEdits`
      //    without bound — one full validation pass per level, ending in a
      //    stack overflow escaping `dispatch` as an exception, from a function
      //    contracted to return a `Result`.
      const invert = nodeType.invertEdit;
      if (invert !== undefined) {
        try {
          const inverse = invert(edit.edit, node.data);
          const back = nodeType.applyEdit(applied.value, inverse);
          if (!back.ok) {
            console.error(
              `keel dev check: ${JSON.stringify(node.kind)}.invertEdit produced an edit its ` +
                `own applyEdit refuses. node=${JSON.stringify(edit.nodeId)}`,
            );
          } else if (structurallyEqualBounded(back.value, node.data) === false) {
            console.error(
              `keel dev check: ${JSON.stringify(node.kind)}.invertEdit does not undo its edit. ` +
                `applyEdit(applyEdit(d, e), invertEdit(e, d)) did not reproduce d. ` +
                `node=${JSON.stringify(edit.nodeId)}`,
            );
          }
        } catch (thrown) {
          console.error(
            `keel dev check: ${JSON.stringify(node.kind)}.invertEdit threw. ` +
              describeThrown(thrown),
          );
        }
      }
    }

    const collection = node.container
      ? { children: node.children, summary: node.summary }
      : null;

    // A `reference` owns nothing, so its key cannot collide with anyone.
    if (collection === null || ownsSubtree(collection.children)) {
      const nextKey = nodeType.sourceKey?.(nextData) ?? null;
      if (nextKey !== null) {
        const owner = graph.ownerBySourceKey.get(nextKey);
        const claimed = claimedSourceKeys.get(nextKey);
        const conflict =
          owner !== undefined && owner !== edit.nodeId
            ? owner
            : claimed !== undefined && claimed !== edit.nodeId
              ? claimed
              : undefined;
        if (conflict !== undefined) {
          return fail(
            "duplicate-owner",
            `Source ${JSON.stringify(nextKey)} is already owned by ${JSON.stringify(conflict)}.`,
            {
              nodeIds: [edit.nodeId],
              kind: node.kind,
              sourceKey: nextKey,
              ownerId: conflict,
            },
          );
        }
        claimedSourceKeys.set(nextKey, edit.nodeId);
      }
    }

    plans.push({
      nodeId: edit.nodeId,
      kind: node.kind,
      before: node.data,
      after: nextData,
      collection,
    });
  }

  return ok(plans);
}

function applyEditNodes<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  edits: readonly EditOf<Ts>[],
  ctx: EngineContext<S>,
): Result<Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>, Rejection> {
  const planned = planEdits(graph, edits, ctx);
  if (!planned.ok) return planned;

  // WHOLE before/after values, never a delta. A value pair cannot be wrong; a
  // wrong inverse corrupts silently N undos later and is undetectable in
  // production, which is why `invertEdit` is opt-in and off by default.
  const changes: DataChange<Ts>[] = planned.value.map((plan) =>
    makeDataChange<Ts>(plan.nodeId, plan.kind, plan.before, plan.after),
  );
  const patch: Patch<Ts, S> = { type: "data-changed", changes };
  return ok({ graph: applyPatch(graph, patch, ctx), patch });
}

// ---------------------------------------------------------------------------
// The reducer
// ---------------------------------------------------------------------------

/**
 * THE ONLY mutation path.
 *
 * NOTE ON `commandPolicy`: the consumer's pre-commit veto is NOT run here — it
 * is not on `EngineContext`, and the engine wrapper runs it before delegating.
 * That keeps the veto strictly ahead of the reducer, which is the point: a
 * post-commit veto corrupts redo, because the push has already cleared the redo
 * branch and the following undo pushes the refused command onto it.
 */
export function applyCommand<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  command: Command<Ts, S>,
  ctx: EngineContext<S>,
): Result<Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>, Rejection> {
  const foreign = foreignGraph(graph, ctx);
  if (foreign !== null) return { ok: false, error: foreign };

  switch (command.type) {
    case "move-nodes":
      return applyMoveNodes(
        graph,
        command.nodeIds,
        command.toParentId,
        command.toIndex,
        ctx,
      );
    case "insert-nodes":
      return applyInsertNodes(
        graph,
        command.seeds,
        command.toParentId,
        command.toIndex,
        ctx,
      );
    case "remove-nodes":
      return applyRemoveNodes(
        graph,
        command.nodeIds,
        command.allowUnloaded ?? false,
        ctx,
      );
    case "edit-nodes":
      return applyEditNodes(graph, command.edits, ctx);
  }
}

// ---------------------------------------------------------------------------
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
 * It runs the same validity checks as the command it produces, so an illegal
 * gesture is refused while it is still a gesture.
 */
export function resolveDrop<Ts extends readonly unknown[], S>(
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

function resolveInsertDrop<Ts extends readonly unknown[], S>(
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

// ---------------------------------------------------------------------------
// applyIngestEdits — the non-undoable content write
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
export function applyIngestEdits<Ts extends readonly unknown[], S>(
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
    // Ingest bumps too, even though it emits nothing: an arriving thumbnail has
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
  // one-node write: ingest asked 1,000 / 10,000 / 40,000 times at those sizes —
  // exactly the reachable node count, a whole document-order DFS — while
  // `edit-nodes` asked 2, flat. Per CALL, not per edit: a batch of twenty still
  // cost one full walk. This is the path an arriving thumbnail lands on, which
  // makes it the highest-frequency write in the system.
  //
  // The soundness argument is the one ./patches already makes for the same
  // predicate, and it is STRICTLY STRONGER here: ingest touches only `data`, so
  // document order cannot change (no bucket's ORDER can move) and no node's
  // `ownsItsSubtree` can change (no owner can move). Where the patch arm must
  // also tolerate changes it skipped, `planEdits` refuses a quarantined node
  // outright — so every plan here really was applied, and the predicate is
  // evaluated over exactly the nodes that changed.
  //
  // On the no-move path both maps carry forward BY IDENTITY, which is what
  // `walkDerivedIndexes` asks for: a consumer memoising on
  // `placementsByContentKey` stops churning on every server write.
  const movesAKey = plans.some(
    (plan) =>
      !dataChangeLeavesDerivedIndexesIntact(
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
  // patch carries no content and is skipped, matching `scrubPatchForIngest`,
  // which leaves structural patches alone.
  const mentioned = new Set<NodeId>();
  for (const entry of [...history.past, ...history.future]) {
    if (entry.patch.type === "moved") continue;
    for (const id of patchTouchedNodeIds(entry.patch)) mentioned.add(id);
  }
  const scrubbed = editedIds.filter((id) => mentioned.has(id));

  return ok({
    graph: nextGraph,
    history: scrubHistoryForIngest(history, replacements),
    scrubbed,
  });
}

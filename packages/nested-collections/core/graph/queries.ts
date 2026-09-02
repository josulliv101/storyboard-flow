// Graph — the queries. EVERY ONE IS TOTAL.
//
// An unknown id yields an empty or neutral answer, never a throw. React reads
// the graph, and in React a card can outlive its node by a frame; a query that
// throws on that turns a routine race into a crashed subtree. Nothing in this
// file may acquire a throwing path.
//
// `documentOrderComparator` lives here rather than beside the reindexers that
// call it: it answers a question about the graph as it stands, which is what
// every other function in this file does.
//
// Depends on `./internals` and `../types` only — the reindexers and the audit
// import THIS, never the other way round.

import type {
  ChildrenState,
  CollectionNode,
  WidenedNodeType,
  Graph,
  GraphNode,
  NodeId,
  SealedNode,
} from "../types";
import { NO_IDS } from "./constants";

export function getNode<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): GraphNode<Ts, S> | undefined {
  return graph.nodesById.get(id);
}

/**
 * The children of a `loaded` collection, `[]` for everything else.
 *
 * CALLERS MUST NOT READ THIS TO DECIDE "IS IT EMPTY". An unloaded collection
 * and a genuinely empty one both answer `[]`, and collapsing those two is the
 * exact ambiguity this engine exists to remove — the predecessor confesses it
 * in its own source, and every downstream uncertainty flag it grew is scar
 * tissue from that one missing bit. Use `childrenStateOf`.
 */
export function getChildren<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): readonly NodeId[] {
  return graph.childrenById.get(id) ?? NO_IDS;
}

/**
 * How many LIVE nodes the graph holds.
 *
 * Exists because the guard in `./review3-consumers-go-through-the-accessors`
 * had nothing to offer a consumer asking this: every alternative reached past
 * the accessors into `nodesById` for its `.size`, which is the one question the
 * raw map answers correctly and no accessor answered at all.
 *
 * LIVE nodes and nothing else. That qualifier used to be explained by "`
 * deadRevById` is a separate store" — a per-id tombstone map that `revFloor`
 * replaced, so the caveat now names nothing. It is kept because the question it
 * answers is still live: a removed node leaves no entry anywhere for this to
 * count, and "how big is this document" has never meant "plus everything ever
 * deleted from it".
 */
export function nodeCount<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
): number {
  return graph.nodesById.size;
}

export function getParent<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): NodeId | null {
  return graph.parentById.get(id) ?? null;
}

/** 0 for an unknown node, so a subscriber comparing revisions across a removal
 *  sees a change rather than an exception. */
export function getSubtreeRev<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): number {
  // LIVE FIRST. The two maps are disjoint, so the order is not what makes this
  // correct — it is what makes it cheap, since the live map is the one every
  // read of a present node hits. A dead id answers with the revision it held
  // when it was removed, which is what keeps a re-inserted id from landing back
  // on a revision its previous lifetime already cached.
  // `0` FOR AN ABSENT ID, and that is a sentinel rather than a fallback: no
  // live node is ever at 0, because every seed starts at 1 and every bump adds
  // 1. So this answers a number the graph cannot hold for a node it does hold,
  // which is what makes a removal visible to the removed node's OWN subscribers
  // — `commitGraph` compares this across the commit, and the entry is gone on
  // the far side.
  return graph.subtreeRevById.get(id) ?? 0;
}

/** `null` for a leaf, an unknown node, or a SEALD leaf — the three cases
 *  where "what is this subtree's load state" has no answer, because there is no
 *  subtree. */
export function childrenStateOf<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): ChildrenState | null {
  const node = graph.nodesById.get(id);
  if (node === undefined) return null;
  // Discriminate on `sealed` FIRST: `container` is a plain `boolean` on
  // the sealed arm (it comes off the wire), so it is not disjoint from the
  // literal `true` / `false` on the other two and cannot discriminate alone.
  if (node.sealed) return node.children;
  if (node.container) return node.children;
  return null;
}

/**
 * True for every collection AND every sealed node.
 *
 * The sealed half looks over-broad until you check the alternative. The
 * declared predicate narrows the FALSE branch to `LeafNode`, so returning
 * `node.container` alone would let a sealed node whose wire `container`
 * was `false` land in that branch and be read as a parsed leaf — with a `data`
 * field it does not have. `sealed || container` is the only implementation
 * sound in both branches, and it reads as "may own children", which is what
 * every call site actually wants to know.
 */
export function isCollection<Ts extends readonly WidenedNodeType[], S>(
  node: GraphNode<Ts, S>,
): node is CollectionNode<Ts, S> | SealedNode {
  return node.sealed || node.container;
}

export function isLoaded<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): boolean {
  return childrenStateOf(graph, id)?.status === "loaded";
}

/**
 * Does a placement in this CHILDREN-STATE own the subtree beneath it?
 *
 * `loaded`, `unloaded` and `missing` all own it — `missing` included, because
 * confirmed-gone is knowledge about a subtree you own, not a handoff to someone
 * else. Only `reference` disclaims ownership, and that single fact is what
 * makes the placement forest a genuine tree: a reference is structurally
 * childless forever, so no walk can descend through one into a cycle.
 *
 * NAMED FOR ITS ARGUMENT, because the other half of this question lives one
 * layer up as `ownsItsSubtree(node)` in ./keys and the two were previously one
 * word apart — `ownsSubtree` and `ownsItsSubtree`, 42 uses between them, taking
 * different types and answering different questions. Getting ownership wrong in
 * more than one place is the exact bug ./keys' own history is about, so the
 * names should not invite it.
 *
 * THE DIVISION: this one asks about a STATE and knows nothing about the node
 * holding it. `ownsItsSubtree` asks about a NODE, and rules out the two cases
 * that have no state to ask about — sealed, and leaf — before delegating
 * here. Call that one unless you are holding a bare `ChildrenState`.
 */
export function stateOwnsSubtree(state: ChildrenState): boolean {
  return state.status !== "reference";
}

/**
 * Parent-first up to the root, EXCLUDING `id`. `[]` for a root or an unknown
 * node.
 *
 * No visiting set. In a valid graph one is unnecessary — references are leaves,
 * so the placement forest is a forest and a chain cannot revisit; the
 * predecessor's three `visiting` guards existed only because following a
 * duplicate's pointer could re-enter a node already on the stack. The step
 * budget below is not that guard under another name: it is a TERMINATION guard
 * for a graph that is already corrupt, so a bad `parentById` fails finitely
 * instead of hanging a render loop. `findInvariantViolation` is what names the
 * corruption.
 */
export function ancestorChain<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): readonly NodeId[] {
  if (!graph.nodesById.has(id)) return NO_IDS;
  const budget = graph.nodesById.size;
  const chain: NodeId[] = [];
  let current = graph.parentById.get(id) ?? null;
  while (current !== null && chain.length < budget) {
    chain.push(current);
    current = graph.parentById.get(current) ?? null;
  }
  return chain;
}

/**
 * Backs the cycle check on `move-nodes`: moving a node into itself or into one
 * of its own descendants is the one structural mutation that can break the
 * forest.
 *
 * Deliberately does NOT check that either id exists. Equality is equality, and
 * the caller has already resolved both nodes by the time it asks — adding a
 * lookup here would only make an unknown id answer "no relation", which is the
 * more dangerous answer for a cycle test to give.
 */
export function isSameOrAncestor<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  maybeAncestorId: NodeId,
  id: NodeId,
): boolean {
  if (maybeAncestorId === id) return true;
  const budget = graph.nodesById.size;
  let steps = 0;
  let current = graph.parentById.get(id) ?? null;
  while (current !== null && steps < budget) {
    if (current === maybeAncestorId) return true;
    current = graph.parentById.get(current) ?? null;
    steps += 1;
  }
  return false;
}

/**
 * Walk from `roots` in DOCUMENT ORDER, children in array order.
 *
 * Document order is PRE-ORDER — each node, then its whole subtree, then its
 * next sibling — which is the order the rows appear in a fully expanded tree,
 * top to bottom. That equivalence is the definition; this function is named for
 * the result rather than the traversal because the result is what the rest of
 * the package talks about. `documentOrder` and `documentOrderComparator` are
 * public, `selectRange`'s contract is stated in document order, and the derived
 * index buckets are sorted by it. A private helper called `walkPreOrder` made a
 * reader translate twice to reach a word the package uses everywhere.
 *
 * WHAT DEPENDS ON THE ORDER, not just on visiting everything:
 *   - `selectRange` is inclusive in document order, so shift-click selects what
 *     the user sees between two rows.
 *   - `walkDerivedIndexes` iterates this, so every `placementsByContentKey`
 *     bucket comes out already sorted — which is what lets
 *     `placementsAfterInsert` merge two sorted runs instead of re-sorting.
 *   - `subtreeIds` includes its own root FIRST, and a pre-order root precedes
 *     all of its descendants both before and after a permutation confined to
 *     that subtree. `reindexPlacementsWithinSubtree` rests on exactly that.
 *
 * EXPLICIT STACK, never recursion: depth is hostile input — a document is a
 * flat node list off the wire, so nothing bounds nesting except whoever wrote
 * the document.
 *
 * Children are pushed in REVERSE so the LIFO pops them front-to-back; push them
 * forward and every node's children come out mirrored.
 *
 * The `budget` is the same termination guard as `ancestorChain`'s. In a valid
 * graph it is never reached: every reachable id is a node and each is reached
 * once, so the walk length is exactly the number of reachable nodes. It bounds
 * the damage when the graph is not valid.
 */
function walkInDocumentOrder<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  roots: readonly NodeId[],
): NodeId[] {
  const out: NodeId[] = [];
  const budget = graph.nodesById.size;
  const stack: NodeId[] = [];
  // Pushed in reverse so the first root pops first.
  for (let i = roots.length - 1; i >= 0; i -= 1) {
    const rootId = roots[i];
    if (rootId !== undefined) stack.push(rootId);
  }
  while (stack.length > 0 && out.length < budget) {
    const current = stack.pop();
    if (current === undefined) break;
    out.push(current);
    const childIds = graph.childrenById.get(current);
    if (childIds === undefined) continue;
    for (let i = childIds.length - 1; i >= 0; i -= 1) {
      const childId = childIds[i];
      if (childId !== undefined) stack.push(childId);
    }
  }
  return out;
}

/** Pre-order, INCLUDES `id`. `[]` for an unknown node — an id the graph does
 *  not hold has no subtree, not a one-element one. */
export function subtreeIds<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): readonly NodeId[] {
  if (!graph.nodesById.has(id)) return NO_IDS;
  return walkInDocumentOrder(graph, [id]);
}

/**
 * The tallest LIVE subtree under `id`, counting `id` itself as 1.
 *
 * THE SINGLE ANSWER to "how much depth does relocating this node cost", for the
 * same reason `ownsItsSubtree` is the single answer to ownership: it is read by
 * the forward door (`applyMoveNodes` in ./commands) and by the replay door
 * (`verifyMoved` in ./patches), and those two disagreeing about depth is
 * exactly the drift that let a redo walk a graph past `maxDepth`. It lives here
 * because ./commands imports ./patches, so the shared helper cannot live in
 * either of them.
 *
 * `walkInDocumentOrder` descends only `loaded` collections, which is the right
 * rule: an unloaded branch contributes its placeholder and nothing more,
 * exactly as it does when the ingress door measures the same graph. So a move
 * is judged on the depth the graph actually holds, and loading that branch
 * later is bounded by `loadChildrenInto`'s own check rather than pre-refused
 * here on a guess about what it might contain.
 *
 * ONE descent carrying depth, rather than an `ancestorChain` per descendant.
 * The predecessor answered a SUBTREE question with N ROOT-walks: it read
 * `parentById` once per ancestor of every descendant, and allocated a chain
 * array for each one it threw away. MEASURED on a caterpillar subtree, counting
 * `parentById.get` during one depth-checked move:
 *
 *     nodes  depth    reads before -> after
 *       122     20         1,491 ->  9
 *       242     40         5,371 ->  9
 *       482     80        20,331 ->  9
 *       962    160        79,051 ->  9
 *
 * FLAT, because the depth now comes from the descent itself and this function
 * stops reading `parentById` at all.
 *
 * Explicit stack and a visit budget, matching `walkInDocumentOrder`: this
 * function exists to measure depth, so depth is hostile input by construction,
 * and the budget bounds the damage on an invalid graph instead of spinning on a
 * cycle. Two parallel arrays rather than one array of objects — the pairing is
 * local to this loop and allocating a wrapper per node is the cost being
 * removed.
 *
 * `1` for an unknown node, matching what the callers need: a node the graph
 * does not hold still occupies the slot it is being placed into.
 */
export function subtreeHeight<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): number {
  if (!graph.nodesById.has(id)) return 1;

  const budget = graph.nodesById.size;
  const stack: NodeId[] = [id];
  const depths: number[] = [1];
  let visited = 0;
  let tallest = 1;

  while (stack.length > 0 && visited < budget) {
    const current = stack.pop();
    const depth = depths.pop();
    if (current === undefined || depth === undefined) break;
    visited += 1;
    if (depth > tallest) tallest = depth;
    for (const childId of getChildren(graph, current)) {
      stack.push(childId);
      depths.push(depth + 1);
    }
  }

  return tallest;
}

/** Pre-order across every root, in `rootIds` order. Backs `selectRange`, which
 *  is inclusive in DOCUMENT order — the reason selection is engine-owned rather
 *  than a consumer concern. */
export function documentOrder<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
): readonly NodeId[] {
  return walkInDocumentOrder(graph, graph.rootIds);
}

// ---------------------------------------------------------------------------

export function documentOrderComparator<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
): (a: NodeId, b: NodeId) => number | null {
  const pathCache = new Map<NodeId, readonly NodeId[]>();
  // Keyed by parent, with `null` standing for the root list — roots are ordered
  // by `rootIds` and have no parent to be looked up in.
  const slotCache = new Map<NodeId | null, ReadonlyMap<NodeId, number>>();

  const pathOf = (id: NodeId): readonly NodeId[] => {
    const cached = pathCache.get(id);
    if (cached !== undefined) return cached;
    // `ancestorChain` is parent-first and excludes `id`; a document-order
    // comparison wants root-first and inclusive, so this reverses and appends.
    const chain = ancestorChain(graph, id);
    const path: NodeId[] = [];
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      const ancestor = chain[i];
      if (ancestor !== undefined) path.push(ancestor);
    }
    path.push(id);
    pathCache.set(id, path);
    return path;
  };

  const slotsIn = (parentId: NodeId | null): ReadonlyMap<NodeId, number> => {
    const cached = slotCache.get(parentId);
    if (cached !== undefined) return cached;
    const siblings =
      parentId === null ? graph.rootIds : (graph.childrenById.get(parentId) ?? NO_IDS);
    const slots = new Map<NodeId, number>();
    for (let i = 0; i < siblings.length; i += 1) {
      const sibling = siblings[i];
      if (sibling !== undefined) slots.set(sibling, i);
    }
    slotCache.set(parentId, slots);
    return slots;
  };

  return (a, b) => {
    if (a === b) return 0;
    const pathA = pathOf(a);
    const pathB = pathOf(b);
    const shared = Math.min(pathA.length, pathB.length);
    let depth = 0;
    while (depth < shared && pathA[depth] === pathB[depth]) depth += 1;
    // One path is a prefix of the other, so one node is an ancestor of the
    // other, and pre-order puts an ancestor first: the shorter path wins.
    if (depth === shared) return pathA.length - pathB.length;
    const parentId = depth === 0 ? null : (pathA[depth - 1] ?? null);
    const slots = slotsIn(parentId);
    const branchA = pathA[depth];
    const branchB = pathB[depth];
    if (branchA === undefined || branchB === undefined) return null;
    const slotA = slots.get(branchA);
    const slotB = slots.get(branchB);
    if (slotA === undefined || slotB === undefined) return null;
    return slotA - slotB;
  };
}

/**
 * The placement index after a move, repositioning only what travelled.
 *
 * The scope of a move is the MOVED SUBTREES, never a subtree containing both
 * parents. That distinction is the whole function: an earlier version of this
 * file reasoned that a cross-parent scope would have to be the lowest common
 * ancestor of the two parents — the root, in the shape this engine is built for
 * — and concluded that scoping therefore bought nothing, so every cross-parent
 * drag rebuilt the whole index. The reasoning was sound about the LCA and wrong
 * about the scope.
 *
 * WHY THE MOVED SET IS THE RIGHT ONE. Take any two nodes, neither of them in a
 * moved subtree. Their relative document order is decided where their
 * root-paths diverge, by the sibling slots of two branches under one common
 * parent. A move relinks only the moved node and rewrites only the source and
 * destination child arrays — and the moved node is a CHILD of the source, never
 * a sibling of it, so no ancestor's own slot moves. Neither branch slot can
 * change, so their order cannot. `derivedIndexesAfterRemoval` already states
 * the removal half of this argument; this is the same argument carried through
 * the reinsertion.
 *
 * So the survivors in every bucket are still in order, and the complete update
 * is to lift out the ids that travelled and merge them back at their new
 * positions. A bucket holding nothing that moved cannot change at all — which
 * is why the common shape, a content key placed exactly once so that every
 * bucket holds one id, settles in a handful of node-type calls and no comparisons
 * at all, against a full document walk before.
 *
 * Returns `previous` BY IDENTITY when nothing reordered, and `null` for
 * "declined" — never for "invalid" — on the same terms as
 * `reindexPlacementsWithinSubtree`: if `previous` disagrees with the graph it
 * was supposedly built from, this refuses to guess and the caller rebuilds.
 */

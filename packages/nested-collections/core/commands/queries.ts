// Graph — the questions the arms ask about a graph before touching it.
//
// Split out of the former `commands/internals.ts`; see ./index.ts.

import {
  type GraphNode,
  type EngineContext,
  type Graph,
  type NodeId,
  type Rejection,
  type WidenedNodeType,
} from "../types";
import {
  ownsItsSubtree,
  ancestorChain,
  documentOrderComparator,
  documentOrder,
  getChildren,
  getParent,
  sourceKeyOf,
} from "../graph";

// Internal helpers
// ---------------------------------------------------------------------------

/**
 * The cross-instance guard. `NodeId` is branded GLOBALLY, not per engine, so an
 * id minted by engine A typechecks against engine B and only this runtime check
 * separates them. Every mutating door runs it first.
 */
export function foreignGraph<Ts extends readonly WidenedNodeType[], S>(
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
function documentOrderRank<Ts extends readonly WidenedNodeType[], S>(
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
export function inDocumentOrder<Ts extends readonly WidenedNodeType[], S>(
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
export function childSlots<Ts extends readonly WidenedNodeType[], S>(
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
export function pruneDescendants<Ts extends readonly WidenedNodeType[], S>(
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
 * — so it is exempt from the single-owner rule. A sealed node has no node type
 * and therefore no key at all.
 */
export function owningSourceKey<Ts extends readonly WidenedNodeType[], S>(
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
export function isValidIndex(index: number, length: number): boolean {
  return Number.isInteger(index) && index >= 0 && index <= length;
}

/**
 * How deep `id` sits, counting the roots as level 1.
 *
 * `ancestorChain` excludes `id` itself, so its length plus one IS the depth —
 * the same arithmetic `loadChildrenInto` uses to tell `buildDocument` where a
 * lazy payload is being attached. Stated once here so the reducer and the
 * ingress door cannot drift about what "depth" counts.
 */
export function depthOf<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  id: NodeId,
): number {
  return ancestorChain(graph, id).length + 1;
}

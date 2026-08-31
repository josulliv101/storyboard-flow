// Graph — the structural audit.
//
// `findInvariantViolation` is the executable form of the rules the rest of the
// engine assumes without re-checking. It is a DIAGNOSTIC, not a gate: nothing on
// the write path runs it, and a consumer calls it in a dev build or after an
// ingress it does not trust.
//
// Top of this folder's dependency order — it reads the queries, the keys and the
// derived indexes, and nothing reads it.

import type {
  WidenedNodeType,
  Graph,
  NodeId,
  NodeTypeRegistry,
  Violation,
} from "../types";
import { childrenStateOf, documentOrder } from "./queries";
import { KeyHookFailure, keyHookMessage, ownsItsSubtree, sourceKeyOf } from "./keys";
import { rebuildDerivedIndexes } from "./derived-indexes";

/**
 * The first structural violation, or `null`.
 *
 * ORDER MATTERS, cheapest-and-most-fundamental first: every later check assumes
 * the earlier ones passed, which is what lets the reachability walk be a plain
 * stack with no defensive re-resolution. The audit is:
 *
 *   1. `nodesById` keys agree with the nodes they hold, and are non-empty.
 *   2. every `childrenById` entry belongs to a `loaded` collection, every child
 *      id resolves, and no id appears twice as a child — across arrays or
 *      within one.
 *   3. every `loaded` collection HAS an entry — the other direction of (2), so
 *      `ChildrenState` and `childrenById` cannot drift apart.
 *   4. roots resolve, are containers, are listed once, and are nobody's child.
 *   5. `parentById` is total and agrees with `childrenById`.
 *   6. `subtreeRevById` is total.
 *   7. every node is reachable from a root.
 *   8. at most one non-`reference` placement per `sourceKey`.
 *   9. both derived indexes match a fresh rebuild.
 *
 * ACYCLICITY IS NOT A SEPARATE WALK. The graph is a flat node list, and "each
 * id appears at most once as a child, and a root appears as none" IS the forest
 * condition — checks 2, 4 and 7 together make a cycle unrepresentable, because
 * any cycle either duplicates a child (2), makes a root a child (4), or
 * detaches its members from every root (7). The `"cycle"` code is emitted only
 * by the reachability walk's re-visit guard, which in a graph that passed 2 and
 * 4 is unreachable, and which exists to TERMINATE rather than to detect.
 */
function findInvariantViolationUnguarded<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
): Violation | null {
  const { nodesById, childrenById, parentById, rootIds, subtreeRevById } = graph;

  // --- 1. ids -------------------------------------------------------------
  for (const [key, node] of nodesById) {
    if (key.trim() === "") {
      return { code: "empty-node-id", message: "nodesById holds an empty id" };
    }
    if (node.id !== key) {
      // Not merely untidy: the key and the node's own id are both used as "the"
      // id by different modules, so a disagreement means one node reachable
      // under two identities — the duplicate-id failure wearing a disguise.
      return {
        code: "duplicate-node-id",
        message:
          `nodesById key ${JSON.stringify(key)} holds a node whose own id is ` +
          `${JSON.stringify(node.id)}`,
        nodeId: node.id,
        otherNodeId: key,
      };
    }
  }

  // --- 2. children arrays -------------------------------------------------
  // `parentOfChild` is built here and reused by checks 4 and 5, so "who is this
  // node's parent" has exactly one answer for the whole audit.
  const parentOfChild = new Map<NodeId, NodeId>();
  for (const [parentId, childIds] of childrenById) {
    if (!nodesById.has(parentId)) {
      // There is no `unknown-parent` violation code; `dangling-child` is the
      // code for "an id reference that resolves to nothing", and the message
      // names which side dangled.
      return {
        code: "dangling-child",
        message: "childrenById holds an entry keyed by an id that is not a node",
        parentId,
      };
    }
    const state = childrenStateOf(graph, parentId);
    if (state === null) {
      return {
        code: "leaf-with-children",
        message: "a node with no ChildrenState has a childrenById entry",
        nodeId: parentId,
      };
    }
    if (state.status !== "loaded") {
      return {
        code: "unloaded-collection-with-children",
        message:
          `a collection in state ${JSON.stringify(state.status)} has a ` +
          `childrenById entry; only "loaded" may have one`,
        nodeId: parentId,
      };
    }
    for (const childId of childIds) {
      if (!nodesById.has(childId)) {
        return {
          code: "dangling-child",
          message: "a children array names an id that is not a node",
          nodeId: childId,
          parentId,
        };
      }
      const priorParentId = parentOfChild.get(childId);
      if (priorParentId !== undefined) {
        return {
          code: "multi-parent",
          message: "an id appears as a child in two places",
          nodeId: childId,
          parentId,
          otherNodeId: priorParentId,
        };
      }
      parentOfChild.set(childId, parentId);
    }
  }

  // --- 3. loaded => has an entry (the other direction of 2) ---------------
  for (const id of nodesById.keys()) {
    const state = childrenStateOf(graph, id);
    if (state === null) continue;
    if (state.status === "loaded" && !childrenById.has(id)) {
      return {
        code: "loaded-collection-missing-children-entry",
        message: 'a collection in state "loaded" has no childrenById entry',
        nodeId: id,
      };
    }
  }

  // --- 4. roots -----------------------------------------------------------
  const seenRootIds = new Set<NodeId>();
  for (const rootId of rootIds) {
    const node = nodesById.get(rootId);
    if (node === undefined) {
      return {
        code: "dangling-child",
        message: "rootIds names an id that is not a node",
        nodeId: rootId,
      };
    }
    if (seenRootIds.has(rootId)) {
      return {
        code: "duplicate-node-id",
        message: "rootIds lists the same id twice",
        nodeId: rootId,
      };
    }
    seenRootIds.add(rootId);
    // Read straight off the node, not through `isCollection`: a sealed
    // root is judged by the `container` flag its document declared, which is
    // the only evidence there is when no node type would parse it.
    if (!node.container) {
      return {
        code: "root-not-container",
        message: "a root is not a container",
        nodeId: rootId,
      };
    }
    const claimedBy = parentOfChild.get(rootId);
    if (claimedBy !== undefined) {
      return {
        code: "root-is-child",
        message: "a root also appears in a children array",
        nodeId: rootId,
        parentId: claimedBy,
      };
    }
  }

  // --- 5. parentById ------------------------------------------------------
  for (const id of nodesById.keys()) {
    // `has`, not `get`: a root's entry is an explicit `null`, so an absent key
    // and a root are indistinguishable through `get` alone.
    if (!parentById.has(id)) {
      return {
        code: "missing-parent-entry",
        message: "parentById has no entry for a node",
        nodeId: id,
      };
    }
    const recorded = parentById.get(id) ?? null;
    const actual = parentOfChild.get(id) ?? null;
    if (recorded !== actual) {
      const violation: Violation = {
        code: "parent-index-disagrees",
        message:
          `parentById records ${JSON.stringify(recorded)} but childrenById ` +
          `says ${JSON.stringify(actual)}`,
        nodeId: id,
      };
      return actual === null ? violation : { ...violation, parentId: actual };
    }
  }

  // --- 6. subtreeRevById --------------------------------------------------
  for (const id of nodesById.keys()) {
    if (!subtreeRevById.has(id)) {
      return {
        code: "missing-subtree-rev",
        message: "subtreeRevById has no entry for a node",
        nodeId: id,
      };
    }
  }

  // --- 7. reachability, with an EXPLICIT STACK ----------------------------
  const reached = new Set<NodeId>();
  const stack: NodeId[] = [...rootIds];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    if (reached.has(current)) {
      // Unreachable given checks 2 and 4 — a re-visit means an id was reached
      // by two paths, which is a duplicated child or a re-listed root, both
      // already refused. Kept because it is the only thing standing between a
      // corrupt graph and an infinite loop, and because reordering the checks
      // above must not silently reintroduce that hang.
      return {
        code: "cycle",
        message: "the children graph reaches one node twice",
        nodeId: current,
      };
    }
    reached.add(current);
    const childIds = childrenById.get(current);
    if (childIds === undefined) continue;
    for (const childId of childIds) stack.push(childId);
  }
  if (reached.size !== nodesById.size) {
    for (const id of nodesById.keys()) {
      if (!reached.has(id)) {
        return {
          code: "unreachable-node",
          message: "a node is not reachable from any root",
          nodeId: id,
        };
      }
    }
  }

  // --- 8. single owner per sourceKey --------------------------------------
  const owners = new Map<string, NodeId>();
  for (const id of documentOrder(graph)) {
    const node = nodesById.get(id);
    if (node === undefined) continue;
    const sourceKey = sourceKeyOf(registry, node);
    if (sourceKey === null) continue;
    if (!ownsItsSubtree(node)) continue;
    const ownerId = owners.get(sourceKey);
    if (ownerId !== undefined) {
      return {
        code: "duplicate-owner",
        message:
          "two non-reference placements claim one sourceKey; the second must " +
          "be a reference",
        nodeId: id,
        otherNodeId: ownerId,
        sourceKey,
      };
    }
    owners.set(sourceKey, id);
  }

  // --- 9. derived indexes are not stale -----------------------------------
  return findStaleDerivedIndex(graph, rebuildDerivedIndexes(graph, registry));
}

/** Split out only so `findInvariantViolation` stays readable; it is check 9. */
function findStaleDerivedIndex<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  fresh: Pick<Graph<Ts, S>, "placementsByContentKey" | "ownerBySourceKey">,
): Violation | null {
  const placements = graph.placementsByContentKey;
  if (placements.size !== fresh.placementsByContentKey.size) {
    return {
      code: "derived-index-stale",
      message: "placementsByContentKey has the wrong number of keys",
    };
  }
  for (const [contentKey, freshIds] of fresh.placementsByContentKey) {
    const storedIds = placements.get(contentKey);
    if (storedIds === undefined || storedIds.length !== freshIds.length) {
      return {
        code: "derived-index-stale",
        message: `placementsByContentKey disagrees for ${JSON.stringify(contentKey)}`,
      };
    }
    for (let i = 0; i < freshIds.length; i += 1) {
      // ORDER is part of the index's contract — placements are in document
      // order, and a consumer rendering "3 of 7" reads position from here.
      if (storedIds[i] !== freshIds[i]) {
        return {
          code: "derived-index-stale",
          message: `placementsByContentKey is out of order for ${JSON.stringify(contentKey)}`,
        };
      }
    }
  }

  const owners = graph.ownerBySourceKey;
  if (owners.size !== fresh.ownerBySourceKey.size) {
    return {
      code: "derived-index-stale",
      message: "ownerBySourceKey has the wrong number of keys",
    };
  }
  for (const [sourceKey, freshOwnerId] of fresh.ownerBySourceKey) {
    if (owners.get(sourceKey) !== freshOwnerId) {
      return {
        code: "derived-index-stale",
        message: `ownerBySourceKey disagrees for ${JSON.stringify(sourceKey)}`,
        nodeId: freshOwnerId,
        sourceKey,
      };
    }
  }

  return null;
}

/**
 * The audit, guarded.
 *
 * It returns `Violation | null` rather than a `Result`, so the guard has a
 * different job here than at the mutation doors: this function is a
 * DIAGNOSTIC, and a diagnostic that crashes on the graph it was asked to
 * inspect is the least useful failure available. Checks 8 and 9 read the
 * consumer's key hooks over every node, so a throwing hook took out the one
 * tool a consumer has for asking "is my document sound?" — including inside a
 * dev-check, where it turned an advisory into a crash.
 *
 * Reported AS a violation, not swallowed: the graph genuinely cannot be audited
 * while a node type refuses to answer for one of its nodes, and saying so with
 * the node's id is the honest answer. `instanceof` the private tag, so a real
 * bug in the audit still surfaces as itself.
 */
export function findInvariantViolation<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  registry: NodeTypeRegistry,
): Violation | null {
  try {
    return findInvariantViolationUnguarded<Ts, S>(graph, registry);
  } catch (thrown) {
    if (thrown instanceof KeyHookFailure) {
      return {
        code: "node-type-threw",
        message: keyHookMessage(thrown),
        ...(thrown.nodeId === null ? {} : { nodeId: thrown.nodeId }),
      };
    }
    throw thrown;
  }
}

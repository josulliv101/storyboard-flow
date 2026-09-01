// Graph — the `remove-nodes` arm.
//
// Split out of the former single-file `commands.ts`; see ./index.ts.

import {
  type EngineContext,
  type Graph,
  type NodeId,
  type Patch,
  type Placement,
  type Rejection,
  type Result,
  type WidenedNodeType,
} from "../types";
import {
  getNode,
  getParent,
  subtreeIds,
} from "../graph";
import { applyPatch } from "../patches";

import { childSlots, inDocumentOrder, pruneDescendants } from "./queries";
import { fail, ok } from "./results";

// remove-nodes
// ---------------------------------------------------------------------------

export function applyRemoveNodes<Ts extends readonly WidenedNodeType[], S>(
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

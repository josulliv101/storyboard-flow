import {
  getChildren,
  type CollectionsGraph,
  type CollectionsPatch,
  type NodeId,
} from "@storyboard/collections-core";

// The pure half of RemoteChangesBridge: given the live graph and one freshly
// fetched from storage, what changed under this collection?
//
// Split out of the .tsx because the app's vitest cannot parse TSX, and this is
// the part worth testing — the component around it is a poll timer and a fetch.

export type RemoteDiff = Readonly<{
  /** Children present remotely but not locally, in remote order. */
  added: readonly NodeId[];
  /** Children present locally but not remotely. */
  departed: readonly NodeId[];
}>;

export function diffRemoteChildren(
  live: CollectionsGraph,
  fetched: CollectionsGraph,
  parentId: NodeId,
): RemoteDiff {
  const liveChildren = getChildren(live, parentId);
  const fetchedChildren = getChildren(fetched, parentId);
  const known = new Set(liveChildren.map(String));
  const remote = new Set(fetchedChildren.map(String));
  return {
    added: fetchedChildren.filter((id) => !known.has(String(id))),
    departed: liveChildren.filter((id) => !remote.has(String(id))),
  };
}

/**
 * A `nodes-removed` patch for children that departed remotely.
 *
 * There is no remove COMMAND in this engine — deletion is a move into the
 * trash, and the trash is not necessarily loaded in a board's graph. But
 * `applyRemotePatch` takes a PATCH, and `nodes-removed` is one, so the removal
 * is expressed directly rather than faked as a move to somewhere.
 *
 * Built against the graph as it stands at call time (`current`), NOT the graph
 * the diff was computed from: additions are applied first and shift indices.
 *
 * Returns null when there is nothing to remove, so the caller can skip the
 * verify/apply round trip entirely.
 */
export function buildRemovalPatch(
  current: CollectionsGraph,
  parentId: NodeId,
  departed: readonly NodeId[],
): CollectionsPatch | null {
  const children = getChildren(current, parentId);
  const removals = departed.flatMap((nodeId) => {
    const node = current.nodesById.get(nodeId);
    if (!node) return [];
    const index = children.indexOf(nodeId);
    if (index < 0) return [];
    return [{ node, parentId, index }];
  });
  if (removals.length === 0) return null;
  return { type: "nodes-removed", removals };
}

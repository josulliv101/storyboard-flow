// The normalized collections graph — the single source of truth for
// dnd-collections. Everything is a node: media leaves and collections alike
// live flat in `nodesById`, ordering lives in `childrenById`, and the
// reverse index `parentById` makes ancestor walks O(depth). The UI is a
// projection of this graph; a "strip"/"panel" is just a collection some view
// chose to render expanded. Mutation happens ONLY through the command
// reducer in ./commands.ts, which returns a new graph plus a reversible
// patch — nothing else in the package writes graph state.

declare const nodeIdBrand: unique symbol;

/** Branded node id — plain string at runtime, nominal at compile time. */
export type NodeId = string & { readonly [nodeIdBrand]: true };

export type Result<T, E> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: E }>;

/** Parse-or-throw for authoring-time-trusted ids (literals in stories/tests). */
export function parseNodeId(id: string): NodeId {
  if (!id || !id.trim()) {
    throw new Error(`Invalid NodeId: ${JSON.stringify(id)}`);
  }
  return id as NodeId;
}

export type MediaNode = Readonly<{
  id: NodeId;
  kind: "media";
  name: string;
  /** Optional thumbnail/source url — display-only, the graph doesn't care. */
  src?: string;
  durationSeconds: number;
}>;

export type CollectionNode = Readonly<{
  id: NodeId;
  kind: "collection";
  name: string;
}>;

export type CollectionItemNode = MediaNode | CollectionNode;

export type CollectionsGraph = Readonly<{
  nodesById: ReadonlyMap<NodeId, CollectionItemNode>;
  /** Ordered children for every collection node (always present, possibly empty). */
  childrenById: ReadonlyMap<NodeId, readonly NodeId[]>;
  /** Reverse index: node -> containing collection, or null for roots. */
  parentById: ReadonlyMap<NodeId, NodeId | null>;
  /** Ordered top-level collections. */
  rootIds: readonly NodeId[];
}>;

export const EMPTY_GRAPH: CollectionsGraph = {
  nodesById: new Map(),
  childrenById: new Map(),
  parentById: new Map(),
  rootIds: [],
};

// --- Building --------------------------------------------------------------

/** Author-friendly nested spec, denormalized into the graph by buildGraph. */
export type GraphNodeSpec =
  | Readonly<{ kind: "media"; id: string; name: string; src?: string; durationSeconds?: number }>
  | Readonly<{ kind: "collection"; id: string; name: string; children?: readonly GraphNodeSpec[] }>;

export type BuildGraphError =
  | Readonly<{ reason: "duplicate-id"; id: string }>
  | Readonly<{ reason: "empty-id" }>
  | Readonly<{ reason: "root-not-collection"; id: string }>;

/**
 * Denormalizes a nested spec into a `CollectionsGraph`. Fails (rather than
 * silently merging) on duplicate ids anywhere in the tree — ids are the
 * graph's addressing scheme, so a collision would corrupt every index.
 */
export function buildGraph(
  roots: readonly GraphNodeSpec[]
): Result<CollectionsGraph, BuildGraphError> {
  const nodesById = new Map<NodeId, CollectionItemNode>();
  const childrenById = new Map<NodeId, readonly NodeId[]>();
  const parentById = new Map<NodeId, NodeId | null>();

  // Iterative walk (explicit stack): externally-supplied specs must not be
  // able to blow the call stack with pathological depth.
  type Frame = Readonly<{ spec: GraphNodeSpec; parentId: NodeId | null }>;
  const stack: Frame[] = [];

  for (const root of roots) {
    if (root.kind !== "collection") {
      return { ok: false, error: { reason: "root-not-collection", id: root.id } };
    }
    stack.push({ spec: root, parentId: null });
  }

  while (stack.length > 0) {
    const { spec, parentId } = stack.pop()!;
    if (!spec.id || !spec.id.trim()) {
      return { ok: false, error: { reason: "empty-id" } };
    }
    const id = spec.id as NodeId;
    if (nodesById.has(id)) {
      return { ok: false, error: { reason: "duplicate-id", id: spec.id } };
    }

    if (spec.kind === "media") {
      nodesById.set(id, {
        id,
        kind: "media",
        name: spec.name,
        src: spec.src,
        durationSeconds: spec.durationSeconds ?? 4,
      });
    } else {
      nodesById.set(id, { id, kind: "collection", name: spec.name });
      const children = spec.children ?? [];
      childrenById.set(id, children.map((child) => child.id as NodeId));
      // Push in reverse so pop() visits children in document order — keeps
      // duplicate-id reporting deterministic (first duplicate in reading
      // order wins the error).
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ spec: children[i], parentId: id });
      }
    }
    parentById.set(id, parentId);
  }

  return {
    ok: true,
    value: {
      nodesById,
      childrenById,
      parentById,
      rootIds: roots.map((root) => root.id as NodeId),
    },
  };
}

// --- Queries ----------------------------------------------------------------

export function isCollection(node: CollectionItemNode): node is CollectionNode {
  return node.kind === "collection";
}

export function getChildren(graph: CollectionsGraph, collectionId: NodeId): readonly NodeId[] {
  return graph.childrenById.get(collectionId) ?? [];
}

/**
 * True if `possibleAncestorId` is `id` itself or an ancestor of it.
 * Iterative walk over `parentById` — O(depth), cycle-guarded so a corrupt
 * graph degrades to `false` instead of hanging.
 */
export function isSameOrAncestor(
  graph: CollectionsGraph,
  possibleAncestorId: NodeId,
  id: NodeId
): boolean {
  const seen = new Set<NodeId>();
  let current: NodeId | null = id;
  while (current !== null) {
    if (current === possibleAncestorId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    current = graph.parentById.get(current) ?? null;
  }
  return false;
}

/**
 * The document-order index of every node, for sorting arbitrary id sets into
 * reading order (multi-node moves preserve the dragged nodes' relative
 * order). Depth-first over roots.
 */
export function getDocumentOrder(graph: CollectionsGraph): ReadonlyMap<NodeId, number> {
  const order = new Map<NodeId, number>();
  const stack: NodeId[] = [];
  for (let i = graph.rootIds.length - 1; i >= 0; i--) stack.push(graph.rootIds[i]);

  while (stack.length > 0) {
    const id = stack.pop()!;
    if (order.has(id)) continue; // corrupt-graph guard
    order.set(id, order.size);
    const children = graph.childrenById.get(id);
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }
  return order;
}

export type GraphInvariantViolation =
  | Readonly<{ reason: "missing-node"; id: NodeId }>
  | Readonly<{ reason: "child-parent-mismatch"; childId: NodeId; expectedParentId: NodeId | null }>
  | Readonly<{ reason: "duplicate-child"; id: NodeId }>
  | Readonly<{ reason: "duplicate-root"; id: NodeId }>
  | Readonly<{ reason: "root-not-collection"; id: NodeId }>
  | Readonly<{ reason: "root-is-also-child"; id: NodeId }>
  | Readonly<{ reason: "parent-not-collection"; childId: NodeId; parentId: NodeId }>
  | Readonly<{ reason: "collection-missing-children-entry"; id: NodeId }>
  | Readonly<{ reason: "media-with-children"; id: NodeId }>
  | Readonly<{ reason: "unreachable-node"; id: NodeId }>;

/**
 * Development/testing invariant check: every reference resolves, roots are
 * unique collections that appear in no children list, the parent/children
 * indexes agree (and parents are collections with a children entry), media
 * nodes have no children, and every node is reachable from a root. Returns
 * the first violation, or null.
 */
export function findGraphInvariantViolation(
  graph: CollectionsGraph
): GraphInvariantViolation | null {
  const rootSet = new Set<NodeId>();
  for (const rootId of graph.rootIds) {
    const rootNode = graph.nodesById.get(rootId);
    if (!rootNode) return { reason: "missing-node", id: rootId };
    if (rootNode.kind !== "collection") return { reason: "root-not-collection", id: rootId };
    if (rootSet.has(rootId)) return { reason: "duplicate-root", id: rootId };
    rootSet.add(rootId);
    if (graph.parentById.get(rootId) !== null) {
      return { reason: "child-parent-mismatch", childId: rootId, expectedParentId: null };
    }
  }

  const seenChildren = new Set<NodeId>();
  for (const [collectionId, children] of graph.childrenById) {
    const collection = graph.nodesById.get(collectionId);
    if (!collection) return { reason: "missing-node", id: collectionId };
    if (collection.kind !== "collection") return { reason: "media-with-children", id: collectionId };

    for (const childId of children) {
      if (!graph.nodesById.has(childId)) return { reason: "missing-node", id: childId };
      if (seenChildren.has(childId)) return { reason: "duplicate-child", id: childId };
      seenChildren.add(childId);
      if (rootSet.has(childId)) return { reason: "root-is-also-child", id: childId };
      if (graph.parentById.get(childId) !== collectionId) {
        return { reason: "child-parent-mismatch", childId, expectedParentId: collectionId };
      }
    }
  }

  // parentById entries must point at collections that actually have a
  // children entry (a dangling parent pointer would make ancestor walks and
  // patch application disagree about the tree).
  for (const [childId, parentId] of graph.parentById) {
    if (parentId === null) continue;
    const parentNode = graph.nodesById.get(parentId);
    if (!parentNode) return { reason: "missing-node", id: parentId };
    if (parentNode.kind !== "collection") {
      return { reason: "parent-not-collection", childId, parentId };
    }
    if (!graph.childrenById.has(parentId)) {
      return { reason: "collection-missing-children-entry", id: parentId };
    }
  }

  const reachable = getDocumentOrder(graph);
  for (const id of graph.nodesById.keys()) {
    if (!reachable.has(id)) return { reason: "unreachable-node", id };
  }

  return null;
}

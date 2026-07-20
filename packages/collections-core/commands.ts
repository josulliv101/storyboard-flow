import {
  type CollectionItemNode,
  type CollectionsValidationError,
  type CollectionsGraph,
  type NodeId,
  type Result,
  getChildren,
  getDocumentOrder,
  isSameOrAncestor,
  parseCollectionItemNode,
} from "./graph";
import { type CollectionsPatch, type NodeAdd, type NodeMove, applyPatch } from "./patches";

// Commands are the ONLY way graph state changes. `applyCommand` validates,
// constructs a reversible patch, and applies it via `applyPatch` — the same
// code path undo/redo replays, so forward and inverse application can't
// drift apart. `move-nodes` covers every structural mutation (reorder, cross-
// collection move, nest, multi-node); `add-nodes` inserts brand-new nodes;
// `update-media` is the one DATA mutation (image duration / video trim).

/**
 * A media node's new trim/duration, discriminated to match the node's kind.
 * For video, omitted `trim*` fields keep the current value (change one end).
 */
export type MediaUpdate =
  | Readonly<{ mediaKind: "image"; durationSeconds: number }>
  | Readonly<{ mediaKind: "video"; trimInSeconds?: number; trimOutSeconds?: number }>;

export type CollectionsCommand =
  | Readonly<{
      type: "move-nodes";
      /** In any order; descendants of other dragged nodes are pruned (a subtree moves with its root). */
      nodeIds: readonly NodeId[];
      toParentId: NodeId;
      /**
       * Insertion index in the target's children AFTER the dragged nodes have
       * been removed from it (post-removal index). `resolveCommandFromIntent`
       * does that math from on-screen positions — callers constructing commands
       * directly must apply the same convention.
       */
      toIndex: number;
    }>
  | Readonly<{
      type: "add-nodes";
      /** Brand-new nodes (palette drops); ids must not exist in the graph. New collections start empty. */
      nodes: readonly CollectionItemNode[];
      toParentId: NodeId;
      toIndex: number;
    }>
  | Readonly<{
      type: "update-media";
      /** A media node to re-trim; structure is untouched. */
      nodeId: NodeId;
      update: MediaUpdate;
    }>;

export type CommandRejection =
  | Readonly<{ reason: "missing-node"; nodeId: NodeId }>
  | Readonly<{ reason: "target-not-collection"; nodeId: NodeId }>
  | Readonly<{ reason: "would-create-cycle"; nodeId: NodeId }>
  | Readonly<{ reason: "cannot-move-root"; nodeId: NodeId }>
  | Readonly<{ reason: "duplicate-node-id"; nodeId: NodeId }>
  /** An added node's id is empty or whitespace-only — ids are the addressing scheme. */
  | Readonly<{ reason: "invalid-node-id"; nodeId: NodeId }>
  /** An added node failed runtime shape/value validation. */
  | Readonly<{
      reason: "invalid-node";
      index: number;
      validationError: CollectionsValidationError;
    }>
  /** `update-media` targeted a collection (not a media node). */
  | Readonly<{ reason: "not-media-node"; nodeId: NodeId }>
  /** `update-media`'s payload doesn't match the node's mediaKind, or carries non-finite values. */
  | Readonly<{ reason: "invalid-media-update"; nodeId: NodeId }>
  | Readonly<{ reason: "nothing-to-move" }>
  | Readonly<{ reason: "nothing-to-add" }>
  | Readonly<{ reason: "invalid-index" }>
  /** The command would leave the graph identical — a no-op, nothing pushed to history. */
  | Readonly<{ reason: "same-position" }>;

/** The `move-nodes` variant — what the intent/keyboard resolvers always produce. */
export type MoveNodesCommand = Extract<CollectionsCommand, { type: "move-nodes" }>;
/** The `add-nodes` variant — what the palette resolver produces. */
export type AddNodesCommand = Extract<CollectionsCommand, { type: "add-nodes" }>;
/** The `update-media` variant — what the pointer trim handles and keyboard trim produce. */
export type UpdateMediaCommand = Extract<CollectionsCommand, { type: "update-media" }>;

export type ApplyCommandSuccess = Readonly<{
  graph: CollectionsGraph;
  patch: CollectionsPatch;
}>;

export function applyCommand(
  graph: CollectionsGraph,
  command: CollectionsCommand
): Result<ApplyCommandSuccess, CommandRejection> {
  // Data mutation (media trim) — no target parent/index, so handle it first.
  if (command.type === "update-media") {
    return applyMediaUpdate(graph, command.nodeId, command.update);
  }

  const { toParentId, toIndex } = command;

  const target = graph.nodesById.get(toParentId);
  if (!target) return { ok: false, error: { reason: "missing-node", nodeId: toParentId } };
  if (target.kind !== "collection") {
    return { ok: false, error: { reason: "target-not-collection", nodeId: toParentId } };
  }
  // Only whole numbers index an array. NaN/±Infinity survive Math.min/max and
  // splice at 0; a fraction is recorded verbatim in the patch but truncated
  // by splice, so forward apply and replay would disagree. Reject all three.
  if (!Number.isInteger(toIndex)) {
    return { ok: false, error: { reason: "invalid-index" } };
  }

  if (command.type === "add-nodes") {
    if (command.nodes.length === 0) return { ok: false, error: { reason: "nothing-to-add" } };
    const batchIds = new Set<NodeId>();
    const validatedNodes: CollectionItemNode[] = [];
    for (let index = 0; index < command.nodes.length; index++) {
      const candidate = command.nodes[index];
      const parsed = parseCollectionItemNode(candidate);
      if (!parsed.ok) {
        // Keep the established, more specific rejection for empty string ids.
        // All other malformed runtime values include their batch index and
        // validator path so consumers can identify the faulty palette item.
        const candidateId = getRuntimeNodeId(candidate);
        if (
          candidateId !== null &&
          parsed.error.reason === "invalid-value" &&
          parsed.error.path === "$.id"
        ) {
          return { ok: false, error: { reason: "invalid-node-id", nodeId: candidateId } };
        }
        return {
          ok: false,
          error: { reason: "invalid-node", index, validationError: parsed.error },
        };
      }
      const node = parsed.value;
      // A colliding id — with the graph or within the batch — would corrupt
      // every index; ids are the addressing scheme.
      if (graph.nodesById.has(node.id) || batchIds.has(node.id)) {
        return { ok: false, error: { reason: "duplicate-node-id", nodeId: node.id } };
      }
      batchIds.add(node.id);
      validatedNodes.push(node);
    }
    const insertAt = Math.max(0, Math.min(toIndex, getChildren(graph, toParentId).length));
    const adds: NodeAdd[] = validatedNodes.map((node, k) => ({
      node,
      parentId: toParentId,
      index: insertAt + k,
    }));
    const patch: CollectionsPatch = { type: "nodes-added", adds };
    return { ok: true, value: { graph: applyPatch(graph, patch), patch } };
  }

  // Validate every dragged id AND capture its parent up front. Roots are
  // structurally unmovable: they are the graph's top-level anchors
  // (`rootIds` isn't part of the patch model, so "moving" one would leave
  // it both a root and a child — the exact corruption the invariant checker
  // exists to catch). Rejecting here is what lets the move construction
  // below read parents with no non-null assertions.
  const parentByMovingId = new Map<NodeId, NodeId>();
  for (const id of command.nodeIds) {
    // A duplicated id would survive pruning and yield two moves for one
    // node — applyPatch would remove it once but insert it twice, leaving a
    // duplicate child. Duplicates mean the caller has a bug: reject loudly
    // rather than silently deduping.
    if (parentByMovingId.has(id)) {
      return { ok: false, error: { reason: "duplicate-node-id", nodeId: id } };
    }
    if (!graph.nodesById.has(id)) {
      return { ok: false, error: { reason: "missing-node", nodeId: id } };
    }
    const parentId = graph.parentById.get(id);
    if (parentId === undefined) {
      // Present in nodesById but unindexed — a corrupt graph; treat as missing.
      return { ok: false, error: { reason: "missing-node", nodeId: id } };
    }
    if (parentId === null) {
      return { ok: false, error: { reason: "cannot-move-root", nodeId: id } };
    }
    parentByMovingId.set(id, parentId);
  }

  // Prune descendants of other dragged nodes: moving a collection moves its
  // whole subtree implicitly, so an explicitly-selected descendant would
  // otherwise be ripped out of its (also moving) parent.
  const draggedSet = new Set(command.nodeIds);
  const pruned = command.nodeIds.filter((id) => {
    // Cycle-guarded like isSameOrAncestor: a corrupt parentById chain would
    // otherwise spin this loop forever. A detected cycle degrades to "keep"
    // (the reducer's other guards reject the resulting move).
    const seen = new Set<NodeId>();
    let parent = graph.parentById.get(id) ?? null;
    while (parent !== null) {
      if (draggedSet.has(parent)) return false;
      if (seen.has(parent)) return true;
      seen.add(parent);
      parent = graph.parentById.get(parent) ?? null;
    }
    return true;
  });
  if (pruned.length === 0) return { ok: false, error: { reason: "nothing-to-move" } };

  // Cycle guard: a node can't move into itself or its own descendant.
  for (const id of pruned) {
    if (isSameOrAncestor(graph, id, toParentId)) {
      return { ok: false, error: { reason: "would-create-cycle", nodeId: id } };
    }
  }

  // Multi-node moves preserve the dragged nodes' relative document order,
  // regardless of selection order. `getDocumentOrder` is a DFS over the WHOLE
  // graph, so it is skipped for the single-node case — which is every ordinary
  // drag — where there is no relative order to preserve.
  const moving =
    pruned.length === 1
      ? pruned
      : (() => {
          const order = getDocumentOrder(graph);
          return [...pruned].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
        })();
  const movingSet = new Set(moving);

  // Clamp the post-removal insertion index against the target's children
  // with dragged nodes removed.
  const targetChildren = getChildren(graph, toParentId);
  const baseLength = targetChildren.reduce(
    (count, id) => (movingSet.has(id) ? count : count + 1),
    0
  );
  const insertAt = Math.max(0, Math.min(toIndex, baseLength));

  // Index each affected source collection once. Calling `indexOf` per moved
  // node turns a large same-parent selection into O(m Ã— n); this stays
  // O(total children in affected parents + m).
  const sourceIndexById = new Map<NodeId, number>();
  const indexedParents = new Set(parentByMovingId.values());
  for (const parentId of indexedParents) {
    const children = getChildren(graph, parentId);
    for (let index = 0; index < children.length; index++) {
      sourceIndexById.set(children[index], index);
    }
  }

  const moves: NodeMove[] = moving.map((id, k) => {
    // Non-null by construction: `moving` ⊆ `command.nodeIds`, and every one
    // of those was validated (and its parent captured) in the loop above —
    // roots and unindexed ids were rejected there.
    const fromParentId = parentByMovingId.get(id)!;
    return {
      nodeId: id,
      fromParentId,
      fromIndex: sourceIndexById.get(id)!,
      toParentId,
      toIndex: insertAt + k,
    };
  });

  const nextGraph = applyPatch(graph, { type: "nodes-moved", moves });

  // No-op detection AFTER applying: same-position moves (including
  // multi-node arrangements that happen to land where they started) produce
  // an identical children layout. Only the parents this patch TOUCHED can
  // differ — applyPatch shares every other array by reference — so the
  // comparison is scoped to them instead of walking every collection.
  const touchedParents = new Set<NodeId>([toParentId]);
  for (const parentId of parentByMovingId.values()) touchedParents.add(parentId);
  if (childrenEqualForParents(graph, nextGraph, touchedParents)) {
    return { ok: false, error: { reason: "same-position" } };
  }

  return { ok: true, value: { graph: nextGraph, patch: { type: "nodes-moved", moves } } };
}

function getRuntimeNodeId(value: unknown): NodeId | null {
  if (typeof value !== "object" || value === null || !("id" in value)) return null;
  return typeof value.id === "string" ? (value.id as NodeId) : null;
}

/**
 * Whether the given parents hold identical children in both graphs.
 *
 * Scoped deliberately: a move only rewrites the arrays of the parents it
 * touched, and `applyPatch` hands every other array through by reference, so
 * comparing the whole map made a single drag O(collections) for no added
 * information.
 */
function childrenEqualForParents(
  a: CollectionsGraph,
  b: CollectionsGraph,
  parentIds: ReadonlySet<NodeId>
): boolean {
  if (a.childrenById === b.childrenById) return true;
  for (const id of parentIds) {
    const childrenA = a.childrenById.get(id);
    const childrenB = b.childrenById.get(id);
    if (childrenA === childrenB) continue;
    if (!childrenA || !childrenB || childrenA.length !== childrenB.length) return false;
    for (let i = 0; i < childrenA.length; i++) {
      if (childrenA[i] !== childrenB[i]) return false;
    }
  }
  return true;
}

function applyMediaUpdate(
  graph: CollectionsGraph,
  nodeId: NodeId,
  update: MediaUpdate
): Result<ApplyCommandSuccess, CommandRejection> {
  const node = graph.nodesById.get(nodeId);
  if (!node) return { ok: false, error: { reason: "missing-node", nodeId } };
  if (node.kind !== "media") {
    return { ok: false, error: { reason: "not-media-node", nodeId } };
  }

  let after: CollectionItemNode;
  if (update.mediaKind === "video") {
    // The update must match the node's kind — an image can't be trimmed as a video.
    if (node.mediaKind !== "video") {
      return { ok: false, error: { reason: "invalid-media-update", nodeId } };
    }
    const nextIn = update.trimInSeconds ?? node.trimInSeconds;
    const nextOut = update.trimOutSeconds ?? node.trimOutSeconds;
    if (!Number.isFinite(nextIn) || !Number.isFinite(nextOut)) {
      return { ok: false, error: { reason: "invalid-media-update", nodeId } };
    }
    // Clamp so both ends are >= 0 and together never exceed the source length
    // (effective duration stays >= 0) — a drag past the limit lands at it.
    const trimInSeconds = Math.max(0, Math.min(nextIn, node.fullDurationSeconds));
    const trimOutSeconds = Math.max(0, Math.min(nextOut, node.fullDurationSeconds - trimInSeconds));
    if (trimInSeconds === node.trimInSeconds && trimOutSeconds === node.trimOutSeconds) {
      return { ok: false, error: { reason: "same-position" } };
    }
    after = { ...node, trimInSeconds, trimOutSeconds };
  } else {
    // update.mediaKind === "image"
    if (node.mediaKind === "video") {
      return { ok: false, error: { reason: "invalid-media-update", nodeId } };
    }
    if (!Number.isFinite(update.durationSeconds)) {
      return { ok: false, error: { reason: "invalid-media-update", nodeId } };
    }
    const durationSeconds = Math.max(0, update.durationSeconds);
    if (durationSeconds === node.durationSeconds) {
      return { ok: false, error: { reason: "same-position" } };
    }
    after = { ...node, durationSeconds };
  }

  const patch: CollectionsPatch = {
    type: "nodes-updated",
    updates: [{ nodeId, before: node, after }],
  };
  return { ok: true, value: { graph: applyPatch(graph, patch), patch } };
}

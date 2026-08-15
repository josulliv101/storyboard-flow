import {
  type CollectionItemNode,
  type CollectionsValidationError,
  type CollectionsGraph,
  type NodeId,
  type Result,
  getChildren,
  getDocumentOrder,
  hasSourceWindow,
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
 * The shortest a media clip may be left showing.
 *
 * THE REDUCER IS WHERE THIS BELONGS, because every surface reaches media
 * duration through it: pointer drags on the trim handles, the keyboard trim
 * actions (which resolve to an `update-media` command and do no clamping of
 * their own), and the agent's `trim_clip`. Putting a floor in the UI instead
 * would leave the other two free to go under it, which is how the paths came
 * to disagree — the reducer let the trim ends meet while the agent path
 * refused the same edit outright.
 *
 * 0.1s matches the finest keyboard trim step (`FINE_TRIM_STEP_SECONDS`), so
 * stepping down lands exactly on the floor rather than stopping short of it.
 *
 * A zero-length clip is not a rendering hazard — `durationToWidth` floors
 * every slot at `MIN_ITEM_WIDTH`, so it stays visible and grabbable. It is
 * simply not a thing the product means to store: it plays nothing, counts as
 * nothing, and the agent path has always said so.
 */
export const MIN_MEDIA_DURATION_SECONDS = 0.1;

/**
 * A media node's new trim/duration, discriminated to match the node's kind.
 * For video, omitted `trim*` fields keep the current value (change one end).
 */
export type MediaUpdate =
  | Readonly<{ mediaKind: "image"; durationSeconds: number }>
  | Readonly<{
      /**
       * The WINDOWED kinds. Both carry a source length and trims, so both take
       * the same update — see `hasSourceWindow`. Audio's trim UI is deferred,
       * but the command path is correct now so enabling it later is a
       * front-end change rather than a data migration.
       */
      mediaKind: "video" | "audio";
      trimInSeconds?: number;
      trimOutSeconds?: number;
    }>;

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
    }>
  | Readonly<{
      type: "rename-node";
      /** Any node — media or collection. Structure is untouched. */
      nodeId: NodeId;
      /** Non-blank; callers trim. */
      name: string;
    }>
  | Readonly<{
      type: "set-node-disabled";
      /**
       * Any nodes — media or collection. Structure is untouched.
       *
       * A LIST, because disabling a multi-selection is ONE user action and has
       * to be one command: dispatching per node produced N history entries (so
       * undo restored one item at a time), N reducer passes, and N persistence
       * notifications. The `nodes-updated` patch already carried an array of
       * updates, so the batch costs nothing structurally.
       */
      nodeIds: readonly NodeId[];
      /** True to skip the nodes (and their subtrees) in playback and totals.
       *  One decision for the whole batch — a mixed selection resolves to a
       *  single target state rather than each item flipping its own way. */
      disabled: boolean;
    }>
  | Readonly<{
      type: "set-node-placement";
      /**
       * Any nodes — media or collection. Structure is untouched.
       *
       * A LIST for the same reason `set-node-disabled` is one: moving a
       * multi-selection onto a lane is ONE user action, and per-node dispatch
       * would give it N history entries to undo one at a time.
       */
      nodeIds: readonly NodeId[];
      /**
       * Which lane, and where on it. `undefined` LEAVES A FIELD ALONE; null
       * CLEARS it back to the default. The two are distinct because the common
       * drag sets both while a lane change on its own must not silently
       * un-place a clip.
       *
       * The engine stores these and never reads them — see the note on
       * `ImageMediaNode`. It is the consumer that decides what lane 0 means
       * and how a placed start packs.
       */
      placement: Readonly<{
        trackIndex?: number | null;
        placedStart?: number | null;
      }>;
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
  /** `rename-node` was given a blank name. */
  | Readonly<{ reason: "invalid-node-name"; nodeId: NodeId }>
  /** `set-node-placement` was given a non-finite lane or start. */
  | Readonly<{ reason: "invalid-placement"; nodeId: NodeId }>
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
  // Data mutations — no target parent/index, so handle them first.
  if (command.type === "update-media") {
    return applyMediaUpdate(graph, command.nodeId, command.update);
  }
  if (command.type === "set-node-disabled") {
    return applySetDisabled(graph, command.nodeIds, command.disabled);
  }
  if (command.type === "set-node-placement") {
    return applySetPlacement(graph, command.nodeIds, command.placement);
  }
  if (command.type === "rename-node") {
    return applyRename(graph, command.nodeId, command.name);
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
    for (const [index, childId] of children.entries()) {
      sourceIndexById.set(childId, index);
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

/**
 * A node's display name is graph DATA, and until this existed there was no
 * way to change it — so an app that let users rename a collection had to keep
 * the new name somewhere else, leaving `node.name` stale for everything that
 * reads it: card `aria-label`s, the drag ghost, and every pickup/drop
 * announcement. Renaming rides the same `nodes-updated` patch as a media
 * trim, so it inherits undo/redo, the change feed, and structural sharing.
 */
function applyRename(
  graph: CollectionsGraph,
  nodeId: NodeId,
  name: string
): Result<ApplyCommandSuccess, CommandRejection> {
  const node = graph.nodesById.get(nodeId);
  if (!node) return { ok: false, error: { reason: "missing-node", nodeId } };
  // Names are shown to people; a blank one leaves a nameless card and an
  // announcement that says "Moved "" to …". Callers trim before dispatching.
  if (name.trim().length === 0) {
    return { ok: false, error: { reason: "invalid-node-name", nodeId } };
  }
  if (node.name === name) return { ok: false, error: { reason: "same-position" } };

  const after: CollectionItemNode = { ...node, name };
  const patch: CollectionsPatch = {
    type: "nodes-updated",
    updates: [{ nodeId, before: node, after }],
  };
  return { ok: true, value: { graph: applyPatch(graph, patch), patch } };
}

/**
 * Mark a node skipped (or un-skipped). Like a rename this is pure DATA — no
 * structure changes, so a disabled node keeps its slot, its order, and its
 * trim — and it rides the same `nodes-updated` patch, inheriting undo/redo,
 * the change feed and structural sharing.
 *
 * The engine gives `disabled` no meaning beyond storing it. Who skips what is
 * a DOMAIN decision (see the playback manifest and the collection-summary
 * derivation, which drop disabled clips and repack around them); teaching the
 * graph about it would put timing policy inside the reducer.
 *
 * Enabling DELETES the key rather than writing `false`, so an untouched
 * document never grows a field and `before`/`after` stay minimal.
 */
function applySetDisabled(
  graph: CollectionsGraph,
  nodeIds: readonly NodeId[],
  disabled: boolean
): Result<ApplyCommandSuccess, CommandRejection> {
  if (nodeIds.length === 0) return { ok: false, error: { reason: "nothing-to-add" } };

  const updates: { nodeId: NodeId; before: CollectionItemNode; after: CollectionItemNode }[] = [];
  const seen = new Set<NodeId>();
  for (const nodeId of nodeIds) {
    // A repeated id would emit two updates for one node, and the second's
    // `before` would already be the first's `after` — an unreversible patch.
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = graph.nodesById.get(nodeId);
    // A MISSING node is still an error: the caller named something that does
    // not exist, and silently skipping it would hide a real bug.
    if (!node) return { ok: false, error: { reason: "missing-node", nodeId } };
    // A node already in the target state contributes nothing. Skipped rather
    // than rejected, so disabling a partly-disabled selection still works —
    // the whole batch is only a no-op when EVERY node is already there.
    if ((node.disabled ?? false) === disabled) continue;

    let after: CollectionItemNode;
    if (disabled) {
      after = { ...node, disabled: true };
    } else {
      const { disabled: _enabled, ...rest } = node;
      after = rest as CollectionItemNode;
    }
    updates.push({ nodeId, before: node, after });
  }

  if (updates.length === 0) return { ok: false, error: { reason: "same-position" } };

  const patch: CollectionsPatch = { type: "nodes-updated", updates };
  return { ok: true, value: { graph: applyPatch(graph, patch), patch } };
}

/**
 * Set the lane and/or the placed start of a batch of nodes.
 *
 * Deliberately the same shape as `applySetDisabled`, because it is the same
 * kind of change: a DOMAIN fact the engine carries and never interprets,
 * emitted as `nodes-updated` so it rides the patch path — which is what makes
 * undo and redo work on it for free, since that patch already inverts by
 * swapping before/after.
 *
 * `undefined` leaves a field untouched; `null` clears it. Only actual changes
 * become updates, so a batch that asks for what is already true is a no-op
 * rather than a history entry.
 */
function applySetPlacement(
  graph: CollectionsGraph,
  nodeIds: readonly NodeId[],
  placement: Readonly<{ trackIndex?: number | null; placedStart?: number | null }>
): Result<ApplyCommandSuccess, CommandRejection> {
  if (nodeIds.length === 0) return { ok: false, error: { reason: "nothing-to-add" } };

  const updates: { nodeId: NodeId; before: CollectionItemNode; after: CollectionItemNode }[] = [];
  const seen = new Set<NodeId>();
  for (const nodeId of nodeIds) {
    // A repeated id would emit two updates for one node, and the second's
    // `before` would already be the first's `after` — an unreversible patch.
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = graph.nodesById.get(nodeId);
    // A MISSING node is still an error: the caller named something that does
    // not exist, and silently skipping it would hide a real bug.
    if (!node) return { ok: false, error: { reason: "missing-node", nodeId } };

    const next: Record<string, unknown> = { ...node };
    let changed = false;
    for (const field of ["trackIndex", "placedStart"] as const) {
      const wanted = placement[field];
      if (wanted === undefined) continue;
      const current = node[field];
      if (wanted === null) {
        if (current === undefined) continue;
        delete next[field];
        changed = true;
        continue;
      }
      // A non-finite value would be stored verbatim and read back as a
      // placement nobody can express — rejected rather than silently dropped,
      // because unlike hydration this is a caller naming a value.
      if (!Number.isFinite(wanted)) {
        return { ok: false, error: { reason: "invalid-placement", nodeId } };
      }
      if (current === wanted) continue;
      next[field] = wanted;
      changed = true;
    }
    // A node already in the target state contributes nothing. Skipped rather
    // than rejected, so placing a partly-placed selection still works.
    if (!changed) continue;
    updates.push({ nodeId, before: node, after: next as CollectionItemNode });
  }

  if (updates.length === 0) return { ok: false, error: { reason: "same-position" } };

  const patch: CollectionsPatch = { type: "nodes-updated", updates };
  return { ok: true, value: { graph: applyPatch(graph, patch), patch } };
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
  // Tested image-first so the else narrows to the WINDOWED member cleanly: its
  // discriminant is itself a union ("video" | "audio"), and TS does not
  // eliminate such a member from a compound `=== "video" || === "audio"` test.
  if (update.mediaKind !== "image") {
    // The update must match the node's kind — an image can't be trimmed as a
    // windowed clip, and a video must not be trimmed by an audio update.
    if (!hasSourceWindow(node) || node.mediaKind !== update.mediaKind) {
      return { ok: false, error: { reason: "invalid-media-update", nodeId } };
    }
    const nextIn = update.trimInSeconds ?? node.trimInSeconds;
    const nextOut = update.trimOutSeconds ?? node.trimOutSeconds;
    if (!Number.isFinite(nextIn) || !Number.isFinite(nextOut)) {
      return { ok: false, error: { reason: "invalid-media-update", nodeId } };
    }
    // Clamp so both ends are >= 0 and together leave at least
    // MIN_MEDIA_DURATION_SECONDS showing — a drag past the limit lands at it.
    //
    // It used to allow the ends to meet, so `trimIn + trimOut` could equal the
    // source length and the clip persisted showing nothing. A source SHORTER
    // than the floor cannot honour it, and the whole clip is then the most it
    // can show, so the floor is itself clamped to the source.
    const full = node.fullDurationSeconds;
    const floor = Math.min(MIN_MEDIA_DURATION_SECONDS, full);
    const trimInSeconds = Math.max(0, Math.min(nextIn, full - floor));
    const trimOutSeconds = Math.max(0, Math.min(nextOut, full - trimInSeconds - floor));
    if (trimInSeconds === node.trimInSeconds && trimOutSeconds === node.trimOutSeconds) {
      return { ok: false, error: { reason: "same-position" } };
    }
    after = { ...node, trimInSeconds, trimOutSeconds };
  } else {
    // update.mediaKind === "image". Reject every WINDOWED node, not just video
    // — an audio node has no `durationSeconds` to set, and treating it as an
    // image here is exactly the silent coercion this feature had to remove.
    if (hasSourceWindow(node)) {
      return { ok: false, error: { reason: "invalid-media-update", nodeId } };
    }
    if (!Number.isFinite(update.durationSeconds)) {
      return { ok: false, error: { reason: "invalid-media-update", nodeId } };
    }
    // An image has no source length to bound it, so the floor always applies.
    const durationSeconds = Math.max(MIN_MEDIA_DURATION_SECONDS, update.durationSeconds);
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

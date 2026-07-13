import {
  parseCollectionItemNode,
  validateGraph,
  type CollectionItemNode,
  type CollectionsGraph,
  type CollectionsValidationError,
  type GraphValidationError,
  type NodeId,
  type Result,
} from "./graph";
import {
  applyPatch,
  type CollectionsPatch,
  type NodeAdd,
  type NodeMove,
  type NodeUpdate,
} from "./patches";

/** Current durable patch-envelope schema. Increment only with a migration. */
export const PATCH_ENVELOPE_SCHEMA_VERSION = 1 as const;

/**
 * Persistence/replay wrapper. `baseRevision` must equal the caller's current
 * revision; `revision` becomes current only after a successful checked replay.
 */
export type PatchEnvelope = Readonly<{
  schemaVersion: typeof PATCH_ENVELOPE_SCHEMA_VERSION;
  baseRevision: string;
  revision: string;
  patch: CollectionsPatch;
}>;

export type PatchReplaySuccess = Readonly<{
  graph: CollectionsGraph;
  revision: string;
}>;

export type PatchReplayError =
  | Readonly<{ reason: "unsupported-schema"; schemaVersion: unknown }>
  | Readonly<{ reason: "invalid-envelope"; validationError: CollectionsValidationError }>
  | Readonly<{
      reason: "revision-mismatch";
      expectedBaseRevision: string;
      actualRevision: string;
    }>
  | Readonly<{ reason: "patch-conflict"; path: string; message: string }>
  | Readonly<{ reason: "invalid-graph"; validationError: GraphValidationError }>;

/** Authoring helper for trusted in-memory patches. Replay still validates it. */
export function createPatchEnvelope(
  patch: CollectionsPatch,
  baseRevision: string,
  revision: string
): PatchEnvelope {
  if (!baseRevision.trim() || !revision.trim() || baseRevision === revision) {
    throw new Error("Patch revisions must be non-empty and must advance.");
  }
  return {
    schemaVersion: PATCH_ENVELOPE_SCHEMA_VERSION,
    baseRevision,
    revision,
    patch,
  };
}

/**
 * Checked replay for deserialized/untrusted patch data. No graph mutation is
 * published unless schema, revision, patch shape, adjacency, and result all
 * validate.
 */
export function replayPatchEnvelope(
  graph: CollectionsGraph,
  currentRevision: string,
  value: unknown
): Result<PatchReplaySuccess, PatchReplayError> {
  const graphValidation = validateGraph(graph);
  if (!graphValidation.ok) {
    return {
      ok: false,
      error: { reason: "invalid-graph", validationError: graphValidation.error },
    };
  }

  const envelope = parsePatchEnvelope(value);
  if (!envelope.ok) return envelope;
  if (envelope.value.baseRevision !== currentRevision) {
    return {
      ok: false,
      error: {
        reason: "revision-mismatch",
        expectedBaseRevision: envelope.value.baseRevision,
        actualRevision: currentRevision,
      },
    };
  }

  const conflict = findPatchConflict(graph, envelope.value.patch);
  if (conflict) return { ok: false, error: conflict };

  const nextGraph = applyPatch(graph, envelope.value.patch);
  const resultValidation = validateGraph(nextGraph);
  if (!resultValidation.ok) {
    return {
      ok: false,
      error: { reason: "invalid-graph", validationError: resultValidation.error },
    };
  }
  return {
    ok: true,
    value: { graph: nextGraph, revision: envelope.value.revision },
  };
}

function parsePatchEnvelope(value: unknown): Result<PatchEnvelope, PatchReplayError> {
  if (!isRecord(value)) return invalidEnvelope("$", "Expected an envelope object.", "invalid-type");
  if (value.schemaVersion !== PATCH_ENVELOPE_SCHEMA_VERSION) {
    return {
      ok: false,
      error: { reason: "unsupported-schema", schemaVersion: value.schemaVersion },
    };
  }
  if (typeof value.baseRevision !== "string") {
    return invalidEnvelope("$.baseRevision", "Expected a string.", "invalid-type");
  }
  if (!value.baseRevision.trim()) {
    return invalidEnvelope("$.baseRevision", "Expected a non-empty revision.");
  }
  if (typeof value.revision !== "string") {
    return invalidEnvelope("$.revision", "Expected a string.", "invalid-type");
  }
  if (!value.revision.trim() || value.revision === value.baseRevision) {
    return invalidEnvelope("$.revision", "Expected a non-empty, advancing revision.");
  }
  const patch = parseCollectionsPatch(value.patch, "$.patch");
  if (!patch.ok) {
    return {
      ok: false,
      error: { reason: "invalid-envelope", validationError: patch.error },
    };
  }
  return {
    ok: true,
    value: {
      schemaVersion: PATCH_ENVELOPE_SCHEMA_VERSION,
      baseRevision: value.baseRevision,
      revision: value.revision,
      patch: patch.value,
    },
  };
}

function parseCollectionsPatch(
  value: unknown,
  path: string
): Result<CollectionsPatch, CollectionsValidationError> {
  if (!isRecord(value)) return invalidType(path, "Expected a patch object.");
  switch (value.type) {
    case "nodes-moved": {
      const parsed = parsePatchEntries(value.moves, `${path}.moves`, parseNodeMove);
      return parsed.ok
        ? { ok: true, value: { type: "nodes-moved", moves: parsed.value } }
        : parsed;
    }
    case "nodes-added": {
      const parsed = parsePatchEntries(value.adds, `${path}.adds`, parseNodeAdd);
      return parsed.ok
        ? { ok: true, value: { type: "nodes-added", adds: parsed.value } }
        : parsed;
    }
    case "nodes-removed": {
      const parsed = parsePatchEntries(value.removals, `${path}.removals`, parseNodeAdd);
      return parsed.ok
        ? { ok: true, value: { type: "nodes-removed", removals: parsed.value } }
        : parsed;
    }
    case "nodes-updated": {
      const parsed = parsePatchEntries(value.updates, `${path}.updates`, parseNodeUpdate);
      return parsed.ok
        ? { ok: true, value: { type: "nodes-updated", updates: parsed.value } }
        : parsed;
    }
    default:
      return invalidValue(`${path}.type`, "Expected a supported patch type.");
  }
}

function parsePatchEntries<T>(
  value: unknown,
  path: string,
  parse: (entry: unknown, path: string) => Result<T, CollectionsValidationError>
): Result<readonly T[], CollectionsValidationError> {
  if (!Array.isArray(value)) return invalidType(path, "Expected an array.");
  if (value.length === 0) return invalidValue(path, "Expected at least one patch entry.");
  const entries: T[] = [];
  for (let index = 0; index < value.length; index++) {
    const parsed = parse(value[index], `${path}[${index}]`);
    if (!parsed.ok) return parsed;
    entries.push(parsed.value);
  }
  return { ok: true, value: entries };
}

function parseNodeMove(value: unknown, path: string): Result<NodeMove, CollectionsValidationError> {
  if (!isRecord(value)) return invalidType(path, "Expected a move object.");
  const nodeId = readNodeId(value, "nodeId", path);
  if (!nodeId.ok) return nodeId;
  const fromParentId = readNodeId(value, "fromParentId", path);
  if (!fromParentId.ok) return fromParentId;
  const fromIndex = readIndex(value, "fromIndex", path);
  if (!fromIndex.ok) return fromIndex;
  const toParentId = readNodeId(value, "toParentId", path);
  if (!toParentId.ok) return toParentId;
  const toIndex = readIndex(value, "toIndex", path);
  if (!toIndex.ok) return toIndex;
  return {
    ok: true,
    value: {
      nodeId: nodeId.value,
      fromParentId: fromParentId.value,
      fromIndex: fromIndex.value,
      toParentId: toParentId.value,
      toIndex: toIndex.value,
    },
  };
}

function parseNodeAdd(value: unknown, path: string): Result<NodeAdd, CollectionsValidationError> {
  if (!isRecord(value)) return invalidType(path, "Expected an add/remove object.");
  const node = parseCollectionItemNode(value.node);
  if (!node.ok) return { ok: false, error: prefixValidationPath(node.error, `${path}.node`) };
  const parentId = readNodeId(value, "parentId", path);
  if (!parentId.ok) return parentId;
  const index = readIndex(value, "index", path);
  if (!index.ok) return index;
  return { ok: true, value: { node: node.value, parentId: parentId.value, index: index.value } };
}

function parseNodeUpdate(
  value: unknown,
  path: string
): Result<NodeUpdate, CollectionsValidationError> {
  if (!isRecord(value)) return invalidType(path, "Expected an update object.");
  const nodeId = readNodeId(value, "nodeId", path);
  if (!nodeId.ok) return nodeId;
  const before = parseCollectionItemNode(value.before);
  if (!before.ok) return { ok: false, error: prefixValidationPath(before.error, `${path}.before`) };
  const after = parseCollectionItemNode(value.after);
  if (!after.ok) return { ok: false, error: prefixValidationPath(after.error, `${path}.after`) };
  if (before.value.id !== nodeId.value || after.value.id !== nodeId.value) {
    return invalidValue(path, "Update node ids must match nodeId.");
  }
  if (
    before.value.kind !== "media" ||
    after.value.kind !== "media" ||
    (before.value.mediaKind === "video") !== (after.value.mediaKind === "video")
  ) {
    return invalidValue(path, "Updates must preserve a media node's kind.");
  }
  if (!updatePreservesStaticMedia(before.value, after.value)) {
    return invalidValue(path, "Updates may change only media trim or duration fields.");
  }
  return {
    ok: true,
    value: { nodeId: nodeId.value, before: before.value, after: after.value },
  };
}

function updatePreservesStaticMedia(
  before: Extract<CollectionItemNode, { kind: "media" }>,
  after: Extract<CollectionItemNode, { kind: "media" }>
): boolean {
  if (before.name !== after.name || before.src !== after.src) return false;
  if (before.mediaKind !== "video" || after.mediaKind !== "video") return true;
  return (
    before.fullDurationSeconds === after.fullDurationSeconds &&
    stringArraysEqual(before.posterSrcs, after.posterSrcs)
  );
}

function findPatchConflict(
  graph: CollectionsGraph,
  patch: CollectionsPatch
): Extract<PatchReplayError, { reason: "patch-conflict" }> | null {
  switch (patch.type) {
    case "nodes-moved":
      return findMoveConflict(graph, patch.moves);
    case "nodes-added":
      return findAddConflict(graph, patch.adds);
    case "nodes-removed":
      return findRemovalConflict(graph, patch.removals);
    case "nodes-updated":
      return findUpdateConflict(graph, patch.updates);
  }
}

function findMoveConflict(
  graph: CollectionsGraph,
  moves: readonly NodeMove[]
): Extract<PatchReplayError, { reason: "patch-conflict" }> | null {
  const seenNodes = new Set<NodeId>();
  const targetSlots = new Set<string>();
  const insertCountByParent = new Map<NodeId, number>();
  const removeCountByParent = new Map<NodeId, number>();
  for (const move of moves) {
    removeCountByParent.set(
      move.fromParentId,
      (removeCountByParent.get(move.fromParentId) ?? 0) + 1
    );
    insertCountByParent.set(
      move.toParentId,
      (insertCountByParent.get(move.toParentId) ?? 0) + 1
    );
  }
  for (let index = 0; index < moves.length; index++) {
    const move = moves[index];
    const path = `$.patch.moves[${index}]`;
    if (seenNodes.has(move.nodeId)) return conflict(path, "A node can move only once per patch.");
    seenNodes.add(move.nodeId);
    if (graph.parentById.get(move.nodeId) !== move.fromParentId) {
      return conflict(`${path}.fromParentId`, "The node is not in the recorded source parent.");
    }
    if (graph.childrenById.get(move.fromParentId)?.[move.fromIndex] !== move.nodeId) {
      return conflict(`${path}.fromIndex`, "The recorded source slot does not contain the node.");
    }
    if (graph.nodesById.get(move.toParentId)?.kind !== "collection") {
      return conflict(`${path}.toParentId`, "The destination is not an existing collection.");
    }
    const slot = `${move.toParentId}\u0000${move.toIndex}`;
    if (targetSlots.has(slot)) return conflict(`${path}.toIndex`, "Destination slots must be unique.");
    targetSlots.add(slot);
    const finalLength =
      (graph.childrenById.get(move.toParentId)?.length ?? 0) -
      (removeCountByParent.get(move.toParentId) ?? 0) +
      (insertCountByParent.get(move.toParentId) ?? 0);
    if (move.toIndex >= finalLength) {
      return conflict(`${path}.toIndex`, "The destination slot is outside the post-patch collection.");
    }
  }
  return null;
}

function findAddConflict(
  graph: CollectionsGraph,
  adds: readonly NodeAdd[]
): Extract<PatchReplayError, { reason: "patch-conflict" }> | null {
  const seenNodes = new Set<NodeId>();
  const targetSlots = new Set<string>();
  const countByParent = countEntriesByParent(adds);
  for (let index = 0; index < adds.length; index++) {
    const add = adds[index];
    const path = `$.patch.adds[${index}]`;
    if (graph.nodesById.has(add.node.id) || seenNodes.has(add.node.id)) {
      return conflict(`${path}.node.id`, "The added node id already exists.");
    }
    seenNodes.add(add.node.id);
    if (graph.nodesById.get(add.parentId)?.kind !== "collection") {
      return conflict(`${path}.parentId`, "The destination is not an existing collection.");
    }
    const slot = `${add.parentId}\u0000${add.index}`;
    if (targetSlots.has(slot)) return conflict(`${path}.index`, "Destination slots must be unique.");
    targetSlots.add(slot);
    const finalLength =
      (graph.childrenById.get(add.parentId)?.length ?? 0) + (countByParent.get(add.parentId) ?? 0);
    if (add.index >= finalLength) {
      return conflict(`${path}.index`, "The destination slot is outside the post-patch collection.");
    }
  }
  return null;
}

function findRemovalConflict(
  graph: CollectionsGraph,
  removals: readonly NodeAdd[]
): Extract<PatchReplayError, { reason: "patch-conflict" }> | null {
  const seenNodes = new Set<NodeId>();
  for (let index = 0; index < removals.length; index++) {
    const removal = removals[index];
    const path = `$.patch.removals[${index}]`;
    const current = graph.nodesById.get(removal.node.id);
    if (!current || seenNodes.has(removal.node.id)) {
      return conflict(`${path}.node.id`, "The removed node is missing or duplicated.");
    }
    seenNodes.add(removal.node.id);
    if (!nodesEqual(current, removal.node)) {
      return conflict(`${path}.node`, "The recorded node does not match current state.");
    }
    if (graph.parentById.get(removal.node.id) !== removal.parentId) {
      return conflict(`${path}.parentId`, "The node is not in the recorded parent.");
    }
    if (graph.childrenById.get(removal.parentId)?.[removal.index] !== removal.node.id) {
      return conflict(`${path}.index`, "The recorded source slot does not contain the node.");
    }
    if (removal.node.kind === "collection" && (graph.childrenById.get(removal.node.id)?.length ?? 0) > 0) {
      return conflict(`${path}.node`, "A non-empty collection cannot be removed by this patch.");
    }
  }
  return null;
}

function findUpdateConflict(
  graph: CollectionsGraph,
  updates: readonly NodeUpdate[]
): Extract<PatchReplayError, { reason: "patch-conflict" }> | null {
  const seenNodes = new Set<NodeId>();
  for (let index = 0; index < updates.length; index++) {
    const update = updates[index];
    const path = `$.patch.updates[${index}]`;
    if (seenNodes.has(update.nodeId)) return conflict(path, "A node can update only once per patch.");
    seenNodes.add(update.nodeId);
    const current = graph.nodesById.get(update.nodeId);
    if (!current || !nodesEqual(current, update.before)) {
      return conflict(`${path}.before`, "The recorded before node does not match current state.");
    }
  }
  return null;
}

function nodesEqual(a: CollectionItemNode, b: CollectionItemNode): boolean {
  if (a.id !== b.id || a.kind !== b.kind || a.name !== b.name) return false;
  if (a.kind === "collection" || b.kind === "collection") return a.kind === b.kind;
  const aVideo = a.mediaKind === "video";
  const bVideo = b.mediaKind === "video";
  if (aVideo !== bVideo || a.src !== b.src) return false;
  if (!aVideo && !bVideo) return a.durationSeconds === b.durationSeconds;
  if (!aVideo || !bVideo) return false;
  return (
    a.fullDurationSeconds === b.fullDurationSeconds &&
    a.trimInSeconds === b.trimInSeconds &&
    a.trimOutSeconds === b.trimOutSeconds &&
    stringArraysEqual(a.posterSrcs, b.posterSrcs)
  );
}

function stringArraysEqual(a?: readonly string[], b?: readonly string[]): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function countEntriesByParent(entries: readonly NodeAdd[]): Map<NodeId, number> {
  const counts = new Map<NodeId, number>();
  for (const entry of entries) counts.set(entry.parentId, (counts.get(entry.parentId) ?? 0) + 1);
  return counts;
}

function readNodeId(
  value: Readonly<Record<string, unknown>>,
  field: string,
  path: string
): Result<NodeId, CollectionsValidationError> {
  const candidate = value[field];
  if (typeof candidate !== "string") return invalidType(`${path}.${field}`, "Expected a string.");
  if (!candidate.trim()) return invalidValue(`${path}.${field}`, "Expected a non-empty node id.");
  return { ok: true, value: candidate as NodeId };
}

function readIndex(
  value: Readonly<Record<string, unknown>>,
  field: string,
  path: string
): Result<number, CollectionsValidationError> {
  const candidate = value[field];
  return typeof candidate === "number" && Number.isInteger(candidate) && candidate >= 0
    ? { ok: true, value: candidate }
    : invalidValue(`${path}.${field}`, "Expected a non-negative integer.");
}

function conflict(
  path: string,
  message: string
): Extract<PatchReplayError, { reason: "patch-conflict" }> {
  return { reason: "patch-conflict", path, message };
}

function invalidEnvelope(
  path: string,
  message: string,
  reason: CollectionsValidationError["reason"] = "invalid-value"
): Result<never, PatchReplayError> {
  return {
    ok: false,
    error: { reason: "invalid-envelope", validationError: { reason, path, message } },
  };
}

function invalidType(path: string, message: string): Result<never, CollectionsValidationError> {
  return { ok: false, error: { reason: "invalid-type", path, message } };
}

function invalidValue(path: string, message: string): Result<never, CollectionsValidationError> {
  return { ok: false, error: { reason: "invalid-value", path, message } };
}

function prefixValidationPath(
  error: CollectionsValidationError,
  prefix: string
): CollectionsValidationError {
  return { ...error, path: `${prefix}${error.path.slice(1)}` };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

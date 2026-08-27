// KEEL — patches: the reversible record of a mutation, and the ONE index rewriter.
//
// PURE. No React, no DOM, no "use client".
//
// Three functions carry the weight of this module and it is worth naming what
// each one is defending against:
//
//  - `applyPatch` is the ONLY code in keel that rewrites `childrenById`,
//    `parentById` or `subtreeRevById`. Forward application, undo and redo all
//    route through it, so they cannot drift. The predecessor engine had a
//    separate undo path and it drifted.
//  - `invertPatch` swaps before/after, flips inserted<->removed PRESERVING
//    ARRAY ORDER, and swaps move endpoints. Nothing else. Every extra thing an
//    inverter does is a thing that can be wrong N undos later, silently.
//  - `verifyPatchApplies` gates every DORMANT patch before replay. Loading
//    grows the graph while history entries sleep; omitting this check
//    reproduced two real corruptions in the predecessor.
//
// THE ORDER CONTRACT, stated once because three functions depend on it:
//
//   "inserted"  — DOCUMENT ORDER, parents before children. Walked FORWARD.
//   "removed"   — the EXACT mirror: same array, same order, same indices.
//                 Walked BACKWARD, so children leave before parents and a later
//                 sibling's splice cannot invalidate an earlier one's index.
//   "moved"     — remove ALL, then insert ALL; `toIndex` is POST-REMOVAL.
//
// `invertPatch` preserving array order is what makes the mirror hold: removing
// [A@1, B@2] backward (B, then A) and re-inserting forward (A@1, then B@2)
// lands both nodes exactly where they were.
//
// A removal patch MUST record the WHOLE SUBTREE, not just the named node.
// Recording only the named node loses every descendant on undo, and
// `verifyPatchApplies` refuses such a patch with "node-not-empty" rather than
// letting it corrupt quietly. Building the patch is commands.ts's job; refusing
// a bad one is this module's.

import {
  makeCollectionNode,
  makeDataChange,
  makeLeafNode,
  type AnyNode,
  type ChildrenState,
  type DataChange,
  type EngineContext,
  type Graph,
  type Move,
  type NodeId,
  type Patch,
  type Placement,
  type ReplayRejection,
  type ReplayRejectionCode,
  type Result,
} from "./types";
import { bumpSubtreeRevs, rebuildDerivedIndexes } from "./graph";

/** Shared empty array. Frozen because it is handed out from several readers and
 *  a caller mutating it would corrupt every other reader's view. */
const EMPTY_IDS: readonly NodeId[] = Object.freeze([]);

const VERIFY_OK: Result<void, ReplayRejection> = { ok: true, value: undefined };

function replayError(
  code: ReplayRejectionCode,
  message: string,
  detail?: Readonly<{ nodeId?: NodeId; parentId?: NodeId; index?: number }>,
): Result<void, ReplayRejection> {
  return { ok: false, error: { code, message, ...detail } };
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/**
 * The node's `ChildrenState`, or `null` when it has none (a leaf, or a
 * quarantined leaf).
 *
 * Discriminates on `quarantined` FIRST and `container` second, which is the
 * only order that works: `container` is plain `boolean` on the quarantined arm
 * (it comes off the wire), so it is not disjoint from the `true` / `false`
 * literals on the other two and cannot discriminate on its own.
 */
function containerChildrenState<Ts extends readonly unknown[], S>(
  node: AnyNode<Ts, S>,
): ChildrenState | null {
  if (node.quarantined) return node.children;
  if (node.container) return node.children;
  return null;
}

/** `true` when this node owns a `childrenById` entry — i.e. it is a `loaded`
 *  container. Exactly one state has an entry; the other three have none. */
function isLoadedContainer<Ts extends readonly unknown[], S>(
  node: AnyNode<Ts, S>,
): boolean {
  const state = containerChildrenState(node);
  return state !== null && state.status === "loaded";
}

/**
 * Structural equality over a SERIALIZED value.
 *
 * Explicit stack, never recursion: `data` is consumer-shaped and arrives from
 * the wire, so its nesting depth is hostile input. This is the same rule the
 * graph walks follow, applied to content.
 *
 * Object.is (not ===) so a codec that legitimately stores NaN compares equal to
 * itself; otherwise a `data-changed` undo of a NaN-bearing node would be
 * refused forever with "data-mismatch".
 */
function deepEqual(a: unknown, b: unknown): boolean {
  const stack: Readonly<{ left: unknown; right: unknown }>[] = [
    { left: a, right: b },
  ];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) break;
    const { left, right } = frame;
    if (Object.is(left, right)) continue;

    const leftIsArray = Array.isArray(left);
    if (leftIsArray || Array.isArray(right)) {
      if (!leftIsArray || !Array.isArray(right)) return false;
      if (left.length !== right.length) return false;
      for (let i = 0; i < left.length; i++) {
        stack.push({ left: left[i], right: right[i] });
      }
      continue;
    }

    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) return false;
    for (const key of leftKeys) {
      // An own-key check, not just `right[key] !== undefined`: `{a: undefined}`
      // and `{}` have different serialized shapes and a codec is entitled to
      // care about the difference.
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
      stack.push({ left: left[key], right: right[key] });
    }
  }
  return true;
}

/** A type predicate rather than a cast — keel-core's only sanctioned casts live
 *  in the four boundary constructors in ./types, and this needs none. */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// invertPatch
// ---------------------------------------------------------------------------

/**
 * Swaps before/after, flips inserted<->removed PRESERVING ARRAY ORDER, and
 * swaps move endpoints. Nothing else. Pure, total, never fails.
 *
 * Why array order survives untouched, when the two directions walk it in
 * opposite directions: `applyPatch` owns the walk direction ("inserted" forward,
 * "removed" backward), so the inverter does not have to reverse anything — and
 * must not, or the two would reverse it twice.
 *
 * Why moves invert by swapping endpoints per move, with the array order kept:
 * `fromIndex` is each node's position in the PRE-state array, and re-inserting
 * a removed set at its original indices in ascending order restores the array
 * exactly. `applyCommand` emits moves in document order, which is that
 * ascending order, so the same forward walk serves both directions.
 */
export function invertPatch<Ts extends readonly unknown[], S>(
  patch: Patch<Ts, S>,
): Patch<Ts, S> {
  switch (patch.type) {
    case "moved": {
      const moves: Move[] = patch.moves.map((move) => ({
        nodeId: move.nodeId,
        fromParentId: move.toParentId,
        fromIndex: move.toIndex,
        toParentId: move.fromParentId,
        toIndex: move.fromIndex,
      }));
      return { type: "moved", moves };
    }
    case "inserted":
      return { type: "removed", placements: patch.placements };
    case "removed":
      return { type: "inserted", placements: patch.placements };
    case "data-changed": {
      const changes = patch.changes.map((change) =>
        makeDataChange<Ts>(
          change.nodeId,
          change.kind,
          change.after,
          change.before,
        ),
      );
      return { type: "data-changed", changes };
    }
  }
}

// ---------------------------------------------------------------------------
// applyPatch — THE ONLY index rewriter
// ---------------------------------------------------------------------------

/**
 * PRECONDITION: `verifyPatchApplies` returned ok. This function assumes the
 * patch applies and does not re-check — re-checking here would either duplicate
 * verify (and drift from it) or tempt a caller to skip verify because "apply
 * validates anyway", which is exactly how the dormant-patch corruptions
 * happened.
 */
export function applyPatch<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  patch: Patch<Ts, S>,
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  switch (patch.type) {
    case "moved":
      return applyMoved(graph, patch.moves, ctx);
    case "inserted":
      return applyInserted(graph, patch.placements, ctx);
    case "removed":
      return applyRemoved(graph, patch.placements, ctx);
    case "data-changed":
      return applyDataChanged(graph, patch.changes, ctx);
  }
}

/** Copy-on-write splice into a parent's children array. */
function spliceIn(
  children: Map<NodeId, readonly NodeId[]>,
  parentId: NodeId,
  index: number,
  id: NodeId,
): void {
  // `?? EMPTY_IDS` cannot fire for a verified patch — the parent is either a
  // loaded container in the graph or a loaded container this patch seeded two
  // steps earlier. It is here so a hand-built patch produces a wrong array
  // rather than a crash.
  const next = (children.get(parentId) ?? EMPTY_IDS).slice();
  const at = index < 0 ? 0 : index > next.length ? next.length : index;
  next.splice(at, 0, id);
  children.set(parentId, next);
}

/**
 * Copy-on-write removal BY IDENTITY, not by index.
 *
 * Deliberate: a "moved" patch removes several nodes before inserting any, and
 * index-based removal would need every subsequent index rebased. Identity
 * removal is order-independent, so the recorded `fromIndex` is needed only by
 * the inverse — which is precisely what makes swapping endpoints a complete
 * inversion.
 */
function spliceOut(
  children: Map<NodeId, readonly NodeId[]>,
  parentId: NodeId,
  id: NodeId,
): void {
  const current = children.get(parentId);
  if (current === undefined) return;
  const at = current.indexOf(id);
  if (at === -1) return;
  const next = current.slice();
  next.splice(at, 1);
  children.set(parentId, next);
}

function withDerivedIndexes<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  return { ...graph, ...rebuildDerivedIndexes(graph, ctx.registry) };
}

function applyMoved<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  moves: readonly Move[],
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  // A move carries NO content and NO rollups, so `nodesById` is untouched —
  // every node object keeps its identity, which is what lets a selector store
  // skip re-rendering uninvolved cards.
  const children = new Map<NodeId, readonly NodeId[]>(graph.childrenById);
  const parents = new Map<NodeId, NodeId | null>(graph.parentById);

  // Remove ALL, then insert ALL. `toIndex` is a POST-REMOVAL index, so the two
  // phases cannot be interleaved.
  for (const move of moves) spliceOut(children, move.fromParentId, move.nodeId);
  for (const move of moves) {
    spliceIn(children, move.toParentId, move.toIndex, move.nodeId);
    parents.set(move.nodeId, move.toParentId);
  }

  // THE TRAP THIS FUNCTION EXISTS TO AVOID: a move has TWO ancestor chains, and
  // the SOURCE chain exists only in the PRE-state `parentById`. Bumping once,
  // against the post-state graph, updates the destination's rollups and leaves
  // the source's silently stale — the node re-renders, the old ancestors never
  // do. Hence two calls against two different graphs.
  const afterSourceBump = bumpSubtreeRevs(
    graph.subtreeRevById,
    graph,
    moves.map((move) => move.fromParentId),
  );
  const relocated: Graph<Ts, S> = {
    ...graph,
    childrenById: children,
    parentById: parents,
    subtreeRevById: afterSourceBump,
  };
  const afterTargetBump = bumpSubtreeRevs(
    afterSourceBump,
    relocated,
    moves.map((move) => move.toParentId),
  );

  // `placementsByContentKey` is in DOCUMENT order, so a pure reorder changes it
  // even though no data did.
  return withDerivedIndexes(
    { ...relocated, subtreeRevById: afterTargetBump },
    ctx,
  );
}

function applyInserted<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  placements: readonly Placement<Ts, S>[],
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  const nodes = new Map<NodeId, AnyNode<Ts, S>>(graph.nodesById);
  const children = new Map<NodeId, readonly NodeId[]>(graph.childrenById);
  const parents = new Map<NodeId, NodeId | null>(graph.parentById);
  const revs = new Map<NodeId, number>(graph.subtreeRevById);

  // FORWARD walk. Document order guarantees a placement's parent was either
  // already in the graph or created by an earlier placement in this same array.
  for (const placement of placements) {
    const { node, parentId, index } = placement;
    nodes.set(node.id, node);
    parents.set(node.id, parentId);
    spliceIn(children, parentId, index, node.id);
    // Seeding the entry is what gives this node's own children — which arrive
    // as LATER placements — somewhere to land. An empty loaded collection ends
    // up with `[]`, which is the whole point of the loaded/unloaded split.
    if (isLoadedContainer(node) && !children.has(node.id)) {
      children.set(node.id, EMPTY_IDS);
    }
    // `subtreeRevById` is TOTAL over `nodesById`. Seeding before the bump means
    // this holds regardless of how `bumpSubtreeRevs` treats an absent id.
    if (!revs.has(node.id)) revs.set(node.id, 0);
  }

  const grown: Graph<Ts, S> = {
    ...graph,
    nodesById: nodes,
    childrenById: children,
    parentById: parents,
    subtreeRevById: revs,
  };

  // Bump from every inserted node, against the POST-state graph: each id's
  // chain runs up through its (possibly also-new) parent to a root, so one call
  // covers every inserted node and every surviving ancestor.
  //
  // KNOWN RESIDUAL, documented rather than hidden: an id that was removed and
  // is now being re-inserted restarts from 0, because removal drops its rev
  // entry to keep `subtreeRevById` exactly total. A fold cache entry keyed on
  // that id at a low rev is therefore reachable again. It only bites when the
  // same id is edited, removed, and restored — the fold cache is per-store and
  // cleared on `destroy`, so the blast radius is one session.
  const bumped = bumpSubtreeRevs(
    revs,
    grown,
    placements.map((placement) => placement.node.id),
  );

  return withDerivedIndexes({ ...grown, subtreeRevById: bumped }, ctx);
}

function applyRemoved<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  placements: readonly Placement<Ts, S>[],
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  // Bump BEFORE the structural edit and against the PRE-state graph: a nested
  // placement's parent is itself being removed, so its ancestor chain exists
  // only here. Redundant bumps of soon-to-be-deleted ids are harmless; their
  // entries are dropped below.
  const bumped = bumpSubtreeRevs(
    graph.subtreeRevById,
    graph,
    placements.map((placement) => placement.parentId),
  );

  const nodes = new Map<NodeId, AnyNode<Ts, S>>(graph.nodesById);
  const children = new Map<NodeId, readonly NodeId[]>(graph.childrenById);
  const parents = new Map<NodeId, NodeId | null>(graph.parentById);
  const revs = new Map<NodeId, number>(bumped);

  // BACKWARD walk: children leave before parents, and a later sibling's splice
  // cannot invalidate an earlier one's recorded index.
  for (let i = placements.length - 1; i >= 0; i--) {
    const placement = placements[i];
    // `noUncheckedIndexedAccess` — a real check, not a `!`. The loop bounds make
    // this unreachable; TypeScript cannot see that and neither should a reader.
    if (placement === undefined) continue;
    const id = placement.node.id;
    spliceOut(children, placement.parentId, id);
    nodes.delete(id);
    parents.delete(id);
    children.delete(id);
    revs.delete(id);
  }

  return withDerivedIndexes(
    {
      ...graph,
      nodesById: nodes,
      childrenById: children,
      parentById: parents,
      subtreeRevById: revs,
    },
    ctx,
  );
}

function applyDataChanged<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  changes: readonly DataChange<Ts>[],
  ctx: EngineContext<S>,
): Graph<Ts, S> {
  const nodes = new Map<NodeId, AnyNode<Ts, S>>(graph.nodesById);

  for (const change of changes) {
    const node = nodes.get(change.nodeId);
    // A verified patch never names a missing or quarantined node; skipping
    // rather than throwing keeps `applyPatch` total, which is what lets it be
    // the single rewriter.
    if (node === undefined || node.quarantined) continue;
    // Structure, `summary` and `children` are preserved verbatim — a
    // "data-changed" patch changes content and nothing else. The boundary
    // constructors are used instead of a spread so this module contains no cast.
    nodes.set(
      change.nodeId,
      node.container
        ? makeCollectionNode<Ts, S>(
            node.id,
            node.kind,
            change.after,
            node.children,
            node.summary,
          )
        : makeLeafNode<Ts>(node.id, node.kind, change.after),
    );
  }

  const bumped = bumpSubtreeRevs(
    graph.subtreeRevById,
    graph,
    changes.map((change) => change.nodeId),
  );

  // `contentKey` and `sourceKey` are read off `data`, so both derived indexes
  // can move under a pure content edit.
  return withDerivedIndexes(
    { ...graph, nodesById: nodes, subtreeRevById: bumped },
    ctx,
  );
}

// ---------------------------------------------------------------------------
// verifyPatchApplies — the gate in front of every dormant patch
// ---------------------------------------------------------------------------

/**
 * A validation-only overlay on `graph.childrenById`.
 *
 * Required, not an optimisation: a subtree insert's later placements land
 * inside its earlier ones, so checking every placement against the UNMODIFIED
 * graph would reject a perfectly good restore for a "missing" parent that the
 * same patch creates two entries earlier. The removal side needs the same
 * overlay to answer "is this node empty yet".
 */
function createChildrenOverlay<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
) {
  const overlay = new Map<NodeId, readonly NodeId[]>();
  const read = (id: NodeId): readonly NodeId[] => {
    const local = overlay.get(id);
    if (local !== undefined) return local;
    return graph.childrenById.get(id) ?? EMPTY_IDS;
  };
  return {
    read,
    hasEntry: (id: NodeId): boolean =>
      overlay.has(id) || graph.childrenById.has(id),
    seedLoaded: (id: NodeId): void => {
      if (!overlay.has(id)) overlay.set(id, EMPTY_IDS);
    },
    insert: (parentId: NodeId, index: number, id: NodeId): void => {
      const next = read(parentId).slice();
      next.splice(index, 0, id);
      overlay.set(parentId, next);
    },
    remove: (parentId: NodeId, id: NodeId): void => {
      const current = read(parentId);
      const at = current.indexOf(id);
      if (at === -1) return;
      const next = current.slice();
      next.splice(at, 1);
      overlay.set(parentId, next);
    },
  };
}

/**
 * Gates every DORMANT patch before replay.
 *
 * Loading grows the graph while history entries sleep, `markMissing` can empty
 * a container out from under one, and a node can gain children after the insert
 * that created it. Each of those turns a stored patch into a corruption if
 * applied blind.
 *
 * Checks: engineId; node existence (removal, move, edit) or absence (insert);
 * parent existence AND loaded-ness; index bounds; the recorded index still
 * naming the recorded node; kind agreement; `before` still matching on the
 * SERIALIZED form; and that a node about to be un-inserted is childless.
 */
export function verifyPatchApplies<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  patch: Patch<Ts, S>,
  ctx: EngineContext<S>,
): Result<void, ReplayRejection> {
  if (graph.engineId !== ctx.engineId) {
    return replayError(
      "foreign-graph",
      "This graph was produced by a different engine instance.",
    );
  }
  switch (patch.type) {
    case "moved":
      return verifyMoved(graph, patch.moves);
    case "inserted":
      return verifyInserted(graph, patch.placements);
    case "removed":
      return verifyRemoved(graph, patch.placements);
    case "data-changed":
      return verifyDataChanged(graph, patch.changes, ctx);
  }
}

function verifyMoved<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  moves: readonly Move[],
): Result<void, ReplayRejection> {
  const overlay = createChildrenOverlay(graph);
  const seen = new Set<NodeId>();

  // Phase 1: validate every source and take every node out. `fromIndex` is a
  // PRE-state index, so it is checked against the untouched graph before any
  // simulated removal.
  for (const move of moves) {
    if (seen.has(move.nodeId)) {
      // One removal, two insertions — the node lands in two children arrays
      // with `parentById` naming one. A blind retry did exactly this in
      // production.
      return replayError(
        "node-exists",
        `Node ${move.nodeId} is moved twice by one patch.`,
        { nodeId: move.nodeId },
      );
    }
    seen.add(move.nodeId);

    if (!graph.nodesById.has(move.nodeId)) {
      return replayError("node-missing", `Node ${move.nodeId} is gone.`, {
        nodeId: move.nodeId,
      });
    }
    const sourceCheck = requireLoadedParent(graph, move.fromParentId);
    if (!sourceCheck.ok) return sourceCheck;

    const sourceChildren = graph.childrenById.get(move.fromParentId) ?? EMPTY_IDS;
    // Exact position, not merely in-bounds. An index that is wrong but in range
    // silently relocates the node when the inverse re-inserts it, and that
    // shows up as "undo moved my clip somewhere else" many steps later.
    if (sourceChildren[move.fromIndex] !== move.nodeId) {
      return replayError(
        "index-out-of-range",
        `Node ${move.nodeId} is no longer at index ${move.fromIndex} of ${move.fromParentId}.`,
        { nodeId: move.nodeId, parentId: move.fromParentId, index: move.fromIndex },
      );
    }
    overlay.remove(move.fromParentId, move.nodeId);
  }

  // Phase 2: validate every destination against the POST-REMOVAL arrays, which
  // is the coordinate system `toIndex` is recorded in.
  for (const move of moves) {
    const targetCheck = requireLoadedParent(graph, move.toParentId);
    if (!targetCheck.ok) return targetCheck;
    const target = overlay.read(move.toParentId);
    if (move.toIndex < 0 || move.toIndex > target.length) {
      return replayError(
        "index-out-of-range",
        `Post-removal index ${move.toIndex} is outside [0, ${target.length}] of ${move.toParentId}.`,
        { nodeId: move.nodeId, parentId: move.toParentId, index: move.toIndex },
      );
    }
    overlay.insert(move.toParentId, move.toIndex, move.nodeId);
  }

  return VERIFY_OK;
}

function requireLoadedParent<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  parentId: NodeId,
): Result<void, ReplayRejection> {
  const parent = graph.nodesById.get(parentId);
  if (parent === undefined) {
    return replayError("parent-missing", `Parent ${parentId} is gone.`, {
      parentId,
    });
  }
  if (!graph.childrenById.has(parentId)) {
    // `markMissing` can turn a loaded container into a confirmed-empty one
    // while a patch sleeps; replaying into it would resurrect children the
    // storage says are gone.
    return replayError(
      "parent-not-loaded",
      `Parent ${parentId} no longer has loaded children.`,
      { parentId },
    );
  }
  return VERIFY_OK;
}

function verifyInserted<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  placements: readonly Placement<Ts, S>[],
): Result<void, ReplayRejection> {
  const overlay = createChildrenOverlay(graph);
  const willExist = new Set<NodeId>();

  for (const placement of placements) {
    const { node, parentId, index } = placement;
    if (graph.nodesById.has(node.id) || willExist.has(node.id)) {
      return replayError(
        "node-exists",
        `Node ${node.id} already exists; re-inserting it would duplicate the id.`,
        { nodeId: node.id },
      );
    }
    // The parent is either already in the graph, or an EARLIER placement in
    // this same patch — document order, parents first, is what makes that true.
    const parentIsNew = willExist.has(parentId);
    if (!parentIsNew && !graph.nodesById.has(parentId)) {
      return replayError("parent-missing", `Parent ${parentId} is gone.`, {
        nodeId: node.id,
        parentId,
      });
    }
    if (!overlay.hasEntry(parentId)) {
      return replayError(
        "parent-not-loaded",
        `Parent ${parentId} does not have loaded children to insert into.`,
        { nodeId: node.id, parentId },
      );
    }
    const siblings = overlay.read(parentId);
    if (index < 0 || index > siblings.length) {
      return replayError(
        "index-out-of-range",
        `Index ${index} is outside [0, ${siblings.length}] of ${parentId}.`,
        { nodeId: node.id, parentId, index },
      );
    }
    overlay.insert(parentId, index, node.id);
    willExist.add(node.id);
    if (isLoadedContainer(node)) overlay.seedLoaded(node.id);
  }

  return VERIFY_OK;
}

function verifyRemoved<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  placements: readonly Placement<Ts, S>[],
): Result<void, ReplayRejection> {
  const overlay = createChildrenOverlay(graph);
  const removed = new Set<NodeId>();

  // BACKWARD, matching the application order: deepest placements first, so a
  // parent's own recorded children are already gone when we ask whether it is
  // empty.
  for (let i = placements.length - 1; i >= 0; i--) {
    const placement = placements[i];
    if (placement === undefined) continue;
    const { node, parentId, index } = placement;

    const live = graph.nodesById.get(node.id);
    if (live === undefined || removed.has(node.id)) {
      return replayError("node-missing", `Node ${node.id} is gone.`, {
        nodeId: node.id,
      });
    }
    if (live.kind !== node.kind) {
      return replayError(
        "kind-mismatch",
        `Node ${node.id} is a "${live.kind}"; the patch recorded a "${node.kind}".`,
        { nodeId: node.id },
      );
    }
    if (removed.has(parentId)) {
      // A parent removed before its child means the placements are not in
      // document order, and the mirror with "inserted" is broken.
      //
      // This is the ONLY check that catches it once the parent is an EMPTY
      // loaded container: the "node-not-empty" check below sails through an
      // empty one, and the child then names a parent that no longer exists.
      // With a non-empty parent, "node-not-empty" gets there first.
      return replayError(
        "parent-missing",
        `Parent ${parentId} is removed before its child ${node.id}; placements are out of document order.`,
        { nodeId: node.id, parentId },
      );
    }
    const parentCheck = requireLoadedParent(graph, parentId);
    if (!parentCheck.ok) return parentCheck;

    const siblings = overlay.read(parentId);
    if (siblings[index] !== node.id) {
      return replayError(
        "index-out-of-range",
        `Node ${node.id} is no longer at index ${index} of ${parentId}.`,
        { nodeId: node.id, parentId, index },
      );
    }

    // THE SUBTREE CHECK. Two distinct failures land here:
    //  - the node gained children after the insert this patch would un-do, so
    //    removing it would orphan them;
    //  - the patch recorded only the named node instead of its whole subtree,
    //    so its descendants were never in `placements` and are still present.
    // Both are "removing this would strand nodes", and both must refuse.
    if (isLoadedContainer(live)) {
      const remaining = overlay.read(node.id);
      if (remaining.length > 0) {
        return replayError(
          "node-not-empty",
          `Node ${node.id} still has ${remaining.length} child(ren) the patch does not account for.`,
          { nodeId: node.id },
        );
      }
    }

    overlay.remove(parentId, node.id);
    removed.add(node.id);
  }

  return VERIFY_OK;
}

function verifyDataChanged<Ts extends readonly unknown[], S>(
  graph: Graph<Ts, S>,
  changes: readonly DataChange<Ts>[],
  ctx: EngineContext<S>,
): Result<void, ReplayRejection> {
  for (const change of changes) {
    const node = graph.nodesById.get(change.nodeId);
    if (node === undefined) {
      return replayError("node-missing", `Node ${change.nodeId} is gone.`, {
        nodeId: change.nodeId,
      });
    }
    if (node.quarantined) {
      // A quarantined node holds `raw`, not parsed data: there is nothing the
      // recorded `before` could match, and writing `after` into it would
      // destroy the byte-exact re-emit quarantine exists to guarantee.
      return replayError(
        "data-mismatch",
        `Node ${change.nodeId} is quarantined and holds no parsed data.`,
        { nodeId: change.nodeId },
      );
    }
    if (node.kind !== change.kind) {
      return replayError(
        "kind-mismatch",
        `Node ${change.nodeId} is a "${node.kind}"; the patch recorded a "${change.kind}".`,
        { nodeId: change.nodeId },
      );
    }
    const codec = ctx.registry.get(change.kind);
    if (codec === undefined) {
      return replayError(
        "kind-mismatch",
        `Kind "${change.kind}" is not registered, so its recorded value cannot be compared.`,
        { nodeId: change.nodeId },
      );
    }
    // Compare on the SERIALIZED form. Parsed values may carry identity a codec
    // does not consider meaningful (a normalized copy, a cached derivation), and
    // comparing those would refuse valid undos; the wire form is the codec's own
    // statement of what its value IS.
    if (!deepEqual(codec.serialize(change.before), codec.serialize(node.data))) {
      return replayError(
        "data-mismatch",
        `Node ${change.nodeId} no longer holds the value this patch recorded as "before".`,
        { nodeId: change.nodeId },
      );
    }
  }
  return VERIFY_OK;
}

// ---------------------------------------------------------------------------
// Patch queries
// ---------------------------------------------------------------------------

/** Every node id the patch mentions, deduped, in first-seen order. Parents are
 *  included: a move's endpoints and a placement's parent are nodes whose
 *  rollups changed, and a caller notifying only the named nodes reproduces the
 *  "deep move never re-renders any ancestor" hole. */
export function patchTouchedNodeIds<Ts extends readonly unknown[], S>(
  patch: Patch<Ts, S>,
): readonly NodeId[] {
  const seen = new Set<NodeId>();
  const ordered: NodeId[] = [];
  const add = (id: NodeId): void => {
    if (seen.has(id)) return;
    seen.add(id);
    ordered.push(id);
  };
  switch (patch.type) {
    case "moved":
      for (const move of patch.moves) {
        add(move.nodeId);
        add(move.fromParentId);
        add(move.toParentId);
      }
      break;
    case "inserted":
    case "removed":
      for (const placement of patch.placements) {
        add(placement.node.id);
        add(placement.parentId);
      }
      break;
    case "data-changed":
      for (const change of patch.changes) add(change.nodeId);
      break;
  }
  return ordered;
}

/**
 * Removed containers whose `ChildrenState` was not `loaded` — the ids the change
 * feed reports so a consumer can defer the hard delete instead of orphaning
 * storage it never read.
 *
 * CAVEAT the consumer must honour, because this list cannot express it: a
 * `reference` placement does NOT own its subtree, and a `missing` one is already
 * confirmed gone. Both appear here (they are not `loaded`), and hard-deleting
 * either is wrong — the only id in this list that names storage worth deleting
 * is an `unloaded` owner. Read the node's state before acting on the id.
 */
export function patchDetachedSubtrees<Ts extends readonly unknown[], S>(
  patch: Patch<Ts, S>,
): readonly NodeId[] {
  if (patch.type !== "removed") return EMPTY_IDS;
  const detached: NodeId[] = [];
  for (const placement of patch.placements) {
    const state = containerChildrenState(placement.node);
    if (state !== null && state.status !== "loaded") {
      detached.push(placement.node.id);
    }
  }
  return detached;
}

export function isEmptyPatch<Ts extends readonly unknown[], S>(
  patch: Patch<Ts, S>,
): boolean {
  switch (patch.type) {
    case "moved":
      return patch.moves.length === 0;
    case "inserted":
    case "removed":
      return patch.placements.length === 0;
    case "data-changed":
      return patch.changes.length === 0;
  }
}

// ---------------------------------------------------------------------------
// Ingest scrubbing
// ---------------------------------------------------------------------------

/**
 * Surgical ingest scrubbing for ONE patch.
 *
 * `applyIngest` is the non-undoable content write: a server stamped a field, a
 * thumbnail arrived. The user must not be able to Ctrl-Z it, and — more
 * importantly — a DORMANT `before` from an older entry must not be able to
 * clobber it later. So for every ingested node:
 *
 *   - "data-changed": DROP that node's entry. Content changes are per-node
 *     independent within a patch, so every other change in the entry stays
 *     perfectly invertible. The user loses undo of their own edit to that one
 *     node, which is correct — the server has since overwritten it.
 *   - "inserted"/"removed": REWRITE that node's captured `data` to the
 *     replacement, so a dormant restore cannot resurrect stale content.
 *   - "moved": untouched. Structural patches carry no content at all.
 *
 * The alternative shipped in a predecessor design — a version stamp that
 * invalidates the whole entry — means every remote write destroys undo from
 * that entry down. This costs O(historyLimit x changes) and destroys one node's
 * worth.
 *
 * Returns null when the patch is left empty, and the caller drops the entry.
 */
export function scrubPatchForIngest<Ts extends readonly unknown[], S>(
  patch: Patch<Ts, S>,
  replacements: ReadonlyMap<NodeId, unknown>,
): Patch<Ts, S> | null {
  if (replacements.size === 0) return patch;

  switch (patch.type) {
    case "moved":
      return patch;

    case "data-changed": {
      const kept = patch.changes.filter(
        (change) => !replacements.has(change.nodeId),
      );
      if (kept.length === 0) return null;
      // Identity is preserved when nothing was dropped, so an untouched history
      // entry stays reference-equal and a consumer diffing the stacks sees no
      // churn.
      if (kept.length === patch.changes.length) return patch;
      return { type: "data-changed", changes: kept };
    }

    case "inserted":
    case "removed": {
      let rewrote = false;
      const next = patch.placements.map((placement): Placement<Ts, S> => {
        const node = placement.node;
        if (!replacements.has(node.id)) return placement;
        // A quarantined node carries `raw`, not parsed data, and it is not
        // editable — so it can never be an ingest target and its bytes must
        // survive untouched.
        if (node.quarantined) return placement;
        const replacement = replacements.get(node.id);
        rewrote = true;
        const rebuilt: AnyNode<Ts, S> = node.container
          ? makeCollectionNode<Ts, S>(
              node.id,
              node.kind,
              replacement,
              node.children,
              node.summary,
            )
          : makeLeafNode<Ts>(node.id, node.kind, replacement);
        return { node: rebuilt, parentId: placement.parentId, index: placement.index };
      });
      if (!rewrote) return patch;
      return patch.type === "inserted"
        ? { type: "inserted", placements: next }
        : { type: "removed", placements: next };
    }
  }
}

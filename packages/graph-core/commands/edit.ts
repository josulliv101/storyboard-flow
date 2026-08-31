// Graph — the `edit-nodes` arm.
//
// Split out of the former single-file `commands.ts`; see ./index.ts.

import {
  describeThrown,
  describeValue,
  structurallyEqualBounded,
  type ChildrenState,
  type DataChange,
  type EditOf,
  type EngineContext,
  type Graph,
  type NodeId,
  type Patch,
  type Rejection,
  type Result,
  type EditRejection,
  makeDataChange,
  type WidenedNodeType,
} from "../types";
import {
  ownsItsSubtree,
  getNode,
} from "../graph";
import { applyPatch } from "../patches";
import { parseNodeData } from "../serialize";

import { fail, ok } from "./internals";

// edit-nodes
// ---------------------------------------------------------------------------

/**
 * One resolved edit. It carries enough to rebuild the node WITHOUT re-narrowing
 * `GraphNode` later, because `applyNonUndoableWriteEdits` has to reconstruct nodes by hand:
 * it deliberately produces no patch for `applyPatch` to consume.
 */
type EditPlan<S> = Readonly<{
  nodeId: NodeId;
  kind: string;
  before: unknown;
  after: unknown;
  /** `null` when the target is a leaf. */
  collection: Readonly<{ children: ChildrenState; summary: S | null }> | null;
}>;

/**
 * The shared validation and dispatch behind BOTH `edit-nodes` and
 * `applyNonUndoableWrite`. Same path, same rejections — the two doors differ only in what
 * they leave behind, never in what they accept.
 */
export function planEdits<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  edits: readonly EditOf<Ts>[],
  ctx: EngineContext<S>,
): Result<readonly EditPlan<S>[], Rejection> {
  if (edits.length === 0) {
    return fail("empty-command", "No edits were supplied.");
  }

  // Two edits to one node in one command would produce two `DataChange` entries
  // for that node, which breaks the per-node independence `scrubPatchForWrite`
  // depends on and leaves the entry's inverse ambiguous.
  const seen = new Set<NodeId>();
  for (const edit of edits) {
    if (seen.has(edit.nodeId)) {
      return fail(
        "duplicate-node-ids",
        `Node ${JSON.stringify(edit.nodeId)} was edited twice in one command.`,
        { nodeIds: [edit.nodeId] },
      );
    }
    seen.add(edit.nodeId);
  }

  const plans: EditPlan<S>[] = [];
  // An edit can move a node's `sourceKey` onto one another node already owns,
  // which would leave the graph violating the single-owner invariant with no
  // rejection anywhere. Not spelled out in the command contract; checked here
  // because this reducer is the only thing that could create it.
  const claimedSourceKeys = new Map<string, NodeId>();

  for (const edit of edits) {
    const node = getNode(graph, edit.nodeId);
    if (node === undefined) {
      return fail(
        "unknown-node",
        `No node ${JSON.stringify(edit.nodeId)} in the graph.`,
        { nodeIds: [edit.nodeId] },
      );
    }
    if (node.quarantined) {
      // Quarantined nodes move, delete and undo. They do not edit: there is no
      // node type, and writing through `raw` would forfeit byte-exact re-emit.
      return fail(
        "node-quarantined",
        `Node ${JSON.stringify(edit.nodeId)} is quarantined (${node.reason}) and cannot be edited.`,
        { nodeIds: [edit.nodeId], kind: node.kind, issues: node.issues },
      );
    }
    if (node.kind !== edit.kind) {
      return fail(
        "kind-mismatch",
        `Edit claims kind ${JSON.stringify(edit.kind)} but node ${JSON.stringify(edit.nodeId)} is ${JSON.stringify(node.kind)}.`,
        { nodeIds: [edit.nodeId], kind: edit.kind },
      );
    }
    const nodeType = ctx.registry.get(node.kind);
    if (nodeType === undefined) {
      // Defensive: a node of an unregistered kind should already be
      // quarantined, so reaching here means the graph and the registry came
      // from different engines.
      return fail(
        "unknown-kind",
        `No node type registered for kind ${JSON.stringify(node.kind)}.`,
        { nodeIds: [edit.nodeId], kind: node.kind },
      );
    }

    // WRAPPED for the same reason ./serialize wraps `parse`: `applyEdit` is
    // consumer code, and a node type that throws must produce the refusal this
    // function is contracted to return rather than an exception out of
    // `dispatch`. A throw and a returned `{ ok: false }` mean the same thing to
    // the user — the node type would not accept this edit — so they get the same
    // code, with the thrown message carried through.
    let applied: Result<unknown, EditRejection>;
    try {
      applied = nodeType.applyEdit(node.data, edit.edit);
    } catch (thrown) {
      return fail(
        "edit-rejected",
        `${JSON.stringify(node.kind)}.applyEdit threw: ${describeThrown(thrown)}`,
        { nodeIds: [edit.nodeId], kind: node.kind },
      );
    }
    if (!applied.ok) {
      return fail(
        "edit-rejected",
        `${JSON.stringify(node.kind)}.applyEdit refused the edit: ${applied.error.message}`,
        { nodeIds: [edit.nodeId], kind: node.kind, editRejection: applied.error },
      );
    }

    // RE-PARSE the node type's own output. `applyEdit` is consumer code, and it is
    // the one ingress the engine would otherwise trust blind — an edit that
    // walks a clip past its own source length is exactly as invalid as the same
    // value arriving off the wire. Round-tripped through `serialize` because
    // that is the form `parse` is defined over, which also means a lossy
    // `serialize` surfaces here rather than three saves later.
    // WRAPPED, like the `applyEdit` above it. `parseNodeData` already guards
    // the `parse` half of this round trip; leaving the `serialize` half bare
    // meant the same class of consumer bug escaped as an exception from one
    // side of one expression and as a `Result` from the other.
    let raw: unknown;
    try {
      raw = nodeType.serialize(applied.value);
    } catch (thrown) {
      return fail(
        "parse-failed",
        `${JSON.stringify(node.kind)}.serialize threw while re-encoding the edited value: ${describeThrown(thrown)}`,
        {
          nodeIds: [edit.nodeId],
          kind: node.kind,
          issues: [{ path: "$", message: describeThrown(thrown) }],
        },
      );
    }

    const reparsed = parseNodeData<S>(ctx, {
      nodeId: edit.nodeId,
      kind: node.kind,
      container: nodeType.container,
      schemaVersion: nodeType.schemaVersion,
      raw,
      // `raw` IS this node type's serialize output, so the generic
      // `parse(serialize(d))` comparison inside `parseNodeData` would re-derive
      // a value from the bytes it just came from and can never fail. The
      // stronger comparison for this door runs below instead.
      rawIsSerializeOutput: true,
    });
    if (!reparsed.ok) {
      return fail(
        "parse-failed",
        `The edit produced a ${JSON.stringify(node.kind)} value that no longer parses.`,
        { nodeIds: [edit.nodeId], kind: node.kind, issues: reparsed.error.issues },
      );
    }

    const nextData = reparsed.value.data;

    // ---- DEV CHECKS AT THE EDIT DOOR ----------------------------------------
    //
    // PLACED HERE, AFTER `raw` and `nextData` exist, and not earlier. Above
    // this point `node.data` is the LIVE value by reference and the engine has
    // not yet captured it as the history entry's `before`. A consumer
    // `applyEdit` or `invertEdit` that normalises its argument in place — a
    // normal performance idiom, and the exact class this file already wraps for
    // — would therefore change what gets recorded, storing different data under
    // `devChecks: true` than under `false` and corrupting the `before` that
    // `verifyPatchApplies` later compares. Undo would fail `data-mismatch` on a
    // node nothing legitimately touched.
    if (ctx.devChecks) {
      // 1. UPSTREAM VS DOWNSTREAM, and it is FREE — both values already exist.
      //
      //    `applied.value` is what the node type's own `applyEdit` produced.
      //    `nextData` is what came back after that value made a round trip
      //    through `serialize` and `parse`, and it is what the engine actually
      //    STORES. If they differ, the edit the consumer asked for is not the
      //    edit that landed, and the difference is exactly what `serialize`
      //    dropped on the way out.
      //
      //    THE FIRST DRAFT OF THIS COMPARED `serialize(nextData)` AGAINST `raw`
      //    and could not fail: for a node type that drops a field, both sides drop
      //    it, so the two agree while the field is being lost. The lossy
      //    fixture in ./devchecks-audits caught that, which is the entire
      //    argument for writing the violating node type before the check.
      const verdict = structurallyEqualBounded(applied.value, nextData);
      if (verdict === false) {
        console.error(
          `graph dev check: editing a ${JSON.stringify(node.kind)} node stored something ` +
            `different from what its own applyEdit returned. The engine stores parse's ` +
            `OUTPUT, so a field this node type's serialize omits is dropped on every edit. ` +
            `node=${JSON.stringify(edit.nodeId)} produced=${describeValue(applied.value)} ` +
            `stored=${describeValue(nextData)}`,
        );
      }

      // 2. THE OPT-IN INVERSE. `invertEdit` is declared on `ConsumerDefinedNodeType` and
      //    documented to satisfy
      //      applyEdit(applyEdit(d, e).value, invertEdit(e, d)) deep-equals d
      //    and the engine never calls it — undo works from whole-value
      //    before/after pairs, which cannot be wrong. So this verifies a
      //    property of a method nothing consults: preparation for the day it is
      //    consulted, not a bug hunt.
      //
      //    `nodeType.applyEdit` is called DIRECTLY. Building a synthetic
      //    `edit-nodes` command and dispatching it would re-enter `planEdits`
      //    without bound — one full validation pass per level, ending in a
      //    stack overflow escaping `dispatch` as an exception, from a function
      //    contracted to return a `Result`.
      const invert = nodeType.invertEdit;
      if (invert !== undefined) {
        try {
          const inverse = invert(edit.edit, node.data);
          const back = nodeType.applyEdit(applied.value, inverse);
          if (!back.ok) {
            console.error(
              `graph dev check: ${JSON.stringify(node.kind)}.invertEdit produced an edit its ` +
                `own applyEdit refuses. node=${JSON.stringify(edit.nodeId)}`,
            );
          } else if (structurallyEqualBounded(back.value, node.data) === false) {
            console.error(
              `graph dev check: ${JSON.stringify(node.kind)}.invertEdit does not undo its edit. ` +
                `applyEdit(applyEdit(d, e), invertEdit(e, d)) did not reproduce d. ` +
                `node=${JSON.stringify(edit.nodeId)}`,
            );
          }
        } catch (thrown) {
          console.error(
            `graph dev check: ${JSON.stringify(node.kind)}.invertEdit threw. ` +
              describeThrown(thrown),
          );
        }
      }
    }

    const collection = node.container
      ? { children: node.children, summary: node.summary }
      : null;

    // DELEGATED, not re-derived — the same correction `owningSourceKey` above
    // already carries. This used to read
    // `collection === null || stateOwnsSubtree(collection.children)`, and
    // `collection === null` IS the leaf case, so it made a leaf an owner. That
    // is verbatim the predicate review3 deleted from ./graph, and it left this
    // door disagreeing with the other four: `walkDerivedIndexes`, invariant
    // check 8, `findDuplicateOwner` in ./serialize, and `owningSourceKey` 900
    // lines above. Both edit doors share `planEdits`, so a leaf sharing a key
    // with an owning container could not be edited through `applyEditNodes`
    // OR `applyNonUndoableWriteEdits` — uneditable on a graph
    // `findInvariantViolation` returns null for, which is exactly the
    // unrepairable state `ownsItsSubtree` was made THE SINGLE ANSWER to end.
    //
    // Total on its own terms: false for quarantined, for a leaf, and for a
    // `reference` — subsuming the `stateOwnsSubtree` branch this replaced.
    if (ownsItsSubtree<Ts, S>(node)) {
      const nextKey = nodeType.sourceKey?.(nextData) ?? null;
      if (nextKey !== null) {
        const owner = graph.ownerBySourceKey.get(nextKey);
        const claimed = claimedSourceKeys.get(nextKey);
        const conflict =
          owner !== undefined && owner !== edit.nodeId
            ? owner
            : claimed !== undefined && claimed !== edit.nodeId
              ? claimed
              : undefined;
        if (conflict !== undefined) {
          return fail(
            "duplicate-owner",
            `Source ${JSON.stringify(nextKey)} is already owned by ${JSON.stringify(conflict)}.`,
            {
              nodeIds: [edit.nodeId],
              kind: node.kind,
              sourceKey: nextKey,
              ownerId: conflict,
            },
          );
        }
        claimedSourceKeys.set(nextKey, edit.nodeId);
      }
    }

    plans.push({
      nodeId: edit.nodeId,
      kind: node.kind,
      before: node.data,
      after: nextData,
      collection,
    });
  }

  return ok(plans);
}

export function applyEditNodes<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  edits: readonly EditOf<Ts>[],
  ctx: EngineContext<S>,
): Result<Readonly<{ graph: Graph<Ts, S>; patch: Patch<Ts, S> }>, Rejection> {
  const planned = planEdits(graph, edits, ctx);
  if (!planned.ok) return planned;

  // WHOLE before/after values, never a delta. A value pair cannot be wrong; a
  // wrong inverse corrupts silently N undos later and is undetectable in
  // production, which is why `invertEdit` is opt-in and off by default.
  const changes: DataChange<Ts>[] = planned.value.map((plan) =>
    makeDataChange<Ts>(plan.nodeId, plan.kind, plan.before, plan.after),
  );
  const patch: Patch<Ts, S> = { type: "data-changed", changes };
  return ok({ graph: applyPatch(graph, patch, ctx), patch });
}

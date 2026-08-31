// Graph — patches: the reversible record of a mutation, and the ONE index rewriter.
//
// PURE. No React, no DOM, no "use client".
//
// Three functions carry the weight of this module and it is worth naming what
// each one is defending against:
//
//  - `applyPatch` is the ONLY code in graph-core that rewrites `childrenById`,
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


// ---------------------------------------------------------------------------
// This file was 1,914 lines. The split follows the seven sections it already
// declared plus the guard tail. Dependency order:
//
//   internals   frozen empties, replayError, small shared helpers
//   invert      invertPatch, the reversal behind undo
//   apply       applyPatch — THE ONLY index rewriter
//   arms        the four apply arms and the commit cost rules
//   verify      the gate in front of every dormant patch
//   queries     patchTouchedNodeIds, patchDetachedSubtrees, isEmptyPatch
//   scrub       the non-undoable write scrubbing
//
// The guarded `verifyPatchApplies` stays here beside the barrel because it is
// the door; its unguarded body lives in ./verify.
// ---------------------------------------------------------------------------

import {
  type EngineContext,
  type Graph,
  type WidenedNodeType,
  type Patch,
  type ReplayRejection,
  type Result,
} from "../types";
import {
  KeyHookFailure,
  keyHookMessage,
} from "../graph";

import { replayError } from "./internals";
import { verifyPatchAppliesUnguarded } from "./verify";

export { invertPatch } from "./invert";
export { applyPatch } from "./apply";
export { patchTouchedNodeIds, patchDetachedSubtrees, isEmptyPatch } from "./queries";
export { scrubbableNodeIds, scrubPatchForWrite } from "./scrub";

/**
 * The key-hook guard, for the same reason ./commands has one and with the same
 * `instanceof` discipline — see `guardKeyHooks` there.
 *
 * This door in particular: undo runs the consumer's key hooks to prove a
 * recorded `before` still stands, so a throwing `contentKey` took out undo
 * exactly the way it took out `dispatch`. review3 names both by name.
 */
export function verifyPatchApplies<Ts extends readonly WidenedNodeType[], S>(
  graph: Graph<Ts, S>,
  patch: Patch<Ts, S>,
  ctx: EngineContext<S>,
): Result<void, ReplayRejection> {
  try {
    return verifyPatchAppliesUnguarded<Ts, S>(graph, patch, ctx);
  } catch (thrown) {
    if (thrown instanceof KeyHookFailure) {
      return replayError(
        "node-type-threw",
        keyHookMessage(thrown),
        thrown.nodeId === null ? undefined : { nodeId: thrown.nodeId },
      );
    }
    throw thrown;
  }
}

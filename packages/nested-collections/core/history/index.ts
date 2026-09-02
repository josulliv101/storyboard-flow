// Graph — history: pure undo/redo values, dispatch coalescing, and the
// non-undoable write's history scrub.
//
// PURE. No React, no DOM, no "use client". Imports ./types and ./patches only.
//
// `History<Ts, S>` is a VALUE, not a mutable handle. It has to be: `applyNonUndoableWrite`
// rewrites both stacks and returns the new history alongside the new graph, and
// a mutable history would make that operation unobservable and untestable. Every
// function here returns a fresh value and mutates nothing.
//
// Three things here are load-bearing and none of them are obvious:
//
//  1. PEEK AND COMMIT ARE SEPARATE. A dormant patch must be verified against the
//     CURRENT graph before the stack moves — loading grows the graph while
//     history entries sleep. If commit came first, a rejected undo would still
//     have consumed its entry and the user would silently lose it. The store's
//     undo is exactly:
//       peekUndo -> invertPatch -> verifyPatchApplies (bail here, stack
//       untouched) -> commitUndo -> applyPatch
//
//  2. COALESCING KEEPS THE OLDEST `before` AND THE NEWEST `after`. A drag emits
//     a command per pointer move; without this, Ctrl-Z would rewind one frame of
//     a trim. Getting the direction backwards is invisible until someone undoes
//     a drag and lands in the middle of it.
//
//  3. `scrubHistoryForWrite` is the history half of `applyNonUndoableWrite`, the
//     non-undoable content write. Roughly half the fields on a realistic item
//     have a writer that is not user intent (a thumbnail arriving, a server
//     stamping provenance). If the only door into `data` were a command, either
//     Ctrl-Z would undo a thumbnail, or a dormant whole-value `before` would
//     silently clobber the server's write on the next undo. Scrubbing removes
//     exactly the overwritten node from the sleeping entries and leaves every
//     other change perfectly invertible — content changes are per-node
//     independent within a patch, which is what makes surgical removal sound.

// ---------------------------------------------------------------------------
// This file was 363 lines. Five modules — the six sections it declared, with
// construction and push kept together because they are one gesture and each is
// under thirty lines:
//
//   stack     construction and push
//   read      peek and commit, deliberately separate
//   clear     clearing
//   coalesce  coalescing
//   scrub     the non-undoable write scrub
// ---------------------------------------------------------------------------

export { createHistory, pushHistory, DEFAULT_HISTORY_LIMIT } from "./stack";
export {
  peekUndo, peekRedo, commitUndo, commitRedo, canUndo, canRedo,
} from "./read";
export { clearFuture, clearPast, clearHistory } from "./clear";
export { coalesceEntries } from "./coalesce";
export { scrubHistoryForWrite } from "./scrub";

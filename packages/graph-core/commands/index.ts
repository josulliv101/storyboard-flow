// Graph — the command reducer: THE ONE mutation path.
//
// Every user-intent change to the graph enters here. `applyCommand` validates
// completely, THEN constructs a patch and hands it to `applyPatch` — the same
// code undo/redo replays — so forward application and inversion cannot drift.
// Nothing is ever partially applied: a rejection returns an error and the
// caller's graph, which was never mutated, is still the current one.
//
// Three doors live here, and they differ in exactly one respect — what they
// leave behind:
//
//   applyCommand      -> patch + history entry + change-feed event  (user intent)
//   resolveDrop       -> nothing; it only TRANSLATES a gesture into a command
//   applyNonUndoableWriteEdits  -> no patch, no history entry, no change-feed event, and
//                        it SCRUBS both history stacks             (server write)
//
// PURE. No React, no DOM. Nothing here throws; every failure is Result-shaped.

// ---------------------------------------------------------------------------
// This file was 1,792 lines. The split follows the nine sections it already
// declared, so the seams are the ones the module always had. Dependency order:
//
//   internals            fail/ok, document order, child slots, depthOf
//   move insert remove edit    one file per command arm
//   reducer              dispatches to the four arms; THE one mutation path
//   drop                 resolveDrop — pointer intent to a command
//   non-undoable-write   the content write that does not enter history
//   guards               the key-hook guard around the public doors
//
// `depthOf` moved to ./internals rather than staying with the insert arm: it is
// a general query about the graph, and leaving it in ./insert would have made
// the move arm import from the insert arm to ask how deep a node sits.
//
// The surface below is exactly what the single file exported.
// ---------------------------------------------------------------------------

export { resolveDrop } from "./drop";
export { applyCommand, applyNonUndoableWriteEdits } from "./guards";

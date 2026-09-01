// Graph — the non-undoable write scrub.
//
// Split out of the former single-file `history.ts`; see ./index.ts.

import type {
  History,
  HistoryEntry,
  NodeId,
  WidenedNodeType,
} from "../types";
import { scrubPatchForWrite } from "../patches";

// The non-undoable write scrub
// ---------------------------------------------------------------------------

/**
 * Maps `scrubPatchForWrite` over BOTH stacks, dropping entries whose patch is
 * left empty.
 *
 * NEVER TRUNCATES AND NEVER REORDERS. That is the whole point of the mechanism:
 * the predecessor's answer to "the server overwrote a field a dormant patch
 * remembers" was a version stamp that nuked the history from the mismatch down,
 * so every remote write destroyed the user's undo. Here the user loses undo of
 * their own edit to the one overwritten node — correct, the server has since
 * overwritten it — and keeps every other entry, in order, fully invertible.
 *
 * Cost is O(entries x changes). `historyLimit` bounds `entries` only when a
 * consumer SET one — it defaults to unbounded, so by default the bound named
 * here is the one that does not exist.
 */
export function scrubHistoryForWrite<Ts extends readonly WidenedNodeType[], S>(
  history: History<Ts, S>,
  replacements: ReadonlyMap<NodeId, unknown>,
): History<Ts, S> {
  // Nothing was written: not merely an optimization, it keeps the History
  // reference stable so a store can skip notifying on a no-op write.
  if (replacements.size === 0) return history;

  const past = scrubStack(history.past, replacements);
  const future = scrubStack(history.future, replacements);
  if (past === history.past && future === history.future) return history;
  return { past, future, limit: history.limit };
}

function scrubStack<Ts extends readonly WidenedNodeType[], S>(
  stack: readonly HistoryEntry<Ts, S>[],
  replacements: ReadonlyMap<NodeId, unknown>,
): readonly HistoryEntry<Ts, S>[] {
  const kept: HistoryEntry<Ts, S>[] = [];
  let changed = false;

  for (const entry of stack) {
    const patch = scrubPatchForWrite(entry.patch, replacements);
    if (patch === null) {
      // The entry recorded a change to nothing BUT the written nodes, so
      // inverting it would restore content the server has already replaced.
      changed = true;
      continue;
    }
    if (patch === entry.patch) {
      kept.push(entry);
      continue;
    }
    changed = true;
    // `command` is deliberately carried through rather than nulled. It records
    // what the user did, which is still true; only the patch has been narrowed,
    // and nothing in the engine replays a command — only patches.
    kept.push({ ...entry, patch });
  }

  // Identity is only best-effort: it holds when `scrubPatchForWrite` returns
  // its input unchanged, which the contract permits but does not promise.
  return changed ? kept : stack;
}

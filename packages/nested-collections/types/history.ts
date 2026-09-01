// Graph — part of the former single-file `types.ts`; see ./index.ts.

import type { Command } from "./commands";
import type { WidenedNodeType } from "./node-types";
import type { Patch } from "./patches";

// ---------------------------------------------------------------------------
// 9. History — pure values
// ---------------------------------------------------------------------------

/**
 * `command` is `null` for an entry the engine synthesized rather than a user
 * issuing it (currently only a coalesced merge, whose original commands no
 * longer describe the merged patch).
 */
export type HistoryEntry<Ts extends readonly WidenedNodeType[], S> = Readonly<{
  command: Command<Ts, S> | null;
  patch: Patch<Ts, S>;
  /** Milliseconds since epoch, for display/inspection only. */
  at: number;
  /** Set by `dispatch(cmd, { coalesceKey })`; merges with the top entry when it
   *  matches — keeping the OLDEST `before` and the NEWEST `after`. */
  coalesceKey?: string;
}>;

/**
 * A PURE VALUE, unlike the predecessor's mutable handle. It has to be:
 * `applyNonUndoableWrite` rewrites both stacks and returns the new history alongside the
 * new graph, and a mutable history would make that operation unobservable and
 * untestable.
 */
export type History<Ts extends readonly WidenedNodeType[], S> = Readonly<{
  /** Oldest first; the newest applied entry is LAST. */
  past: readonly HistoryEntry<Ts, S>[];
  /** The most-recently-undone entry is LAST (it is what `redo` takes next). */
  future: readonly HistoryEntry<Ts, S>[];
  /** Oldest entries fall off past this. `Number.POSITIVE_INFINITY` = unbounded. */
  limit: number;
}>;

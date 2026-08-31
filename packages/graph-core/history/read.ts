// Graph — peek and commit, deliberately separate.
//
// Split out of the former single-file `history.ts`; see ./index.ts.

import type {
  History,
  HistoryEntry,
  WidenedNodeType,
} from "../types";

// Peek / commit — deliberately separate, see the header
// ---------------------------------------------------------------------------

export function peekUndo<Ts extends readonly WidenedNodeType[], S>(
  history: History<Ts, S>,
): HistoryEntry<Ts, S> | null {
  return history.past.at(-1) ?? null;
}

export function peekRedo<Ts extends readonly WidenedNodeType[], S>(
  history: History<Ts, S>,
): HistoryEntry<Ts, S> | null {
  return history.future.at(-1) ?? null;
}

/**
 * Moves the newest past entry onto the END of `future` — `future`'s last element
 * is what `redo` takes next, so undo/redo is LIFO in both directions and two
 * undos then two redos return the stacks to their original contents.
 *
 * Returns `null` rather than an empty-ish value when there is nothing to undo,
 * so a caller cannot accidentally apply an undefined patch.
 */
export function commitUndo<Ts extends readonly WidenedNodeType[], S>(
  history: History<Ts, S>,
): Readonly<{ history: History<Ts, S>; entry: HistoryEntry<Ts, S> }> | null {
  const entry = history.past.at(-1);
  if (entry === undefined) return null;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, entry],
      limit: history.limit,
    },
    entry,
  };
}

/**
 * The mirror of `commitUndo`. It does NOT clear `future` and does NOT coalesce —
 * a redo in the middle of a stack must leave the remaining redos reachable, and
 * re-merging a redone entry into the one below it would destroy an undo step
 * that the user has already seen as separate.
 */
export function commitRedo<Ts extends readonly WidenedNodeType[], S>(
  history: History<Ts, S>,
): Readonly<{ history: History<Ts, S>; entry: HistoryEntry<Ts, S> }> | null {
  const entry = history.future.at(-1);
  if (entry === undefined) return null;
  return {
    history: {
      past: [...history.past, entry],
      future: history.future.slice(0, -1),
      limit: history.limit,
    },
    entry,
  };
}

export function canUndo<Ts extends readonly WidenedNodeType[], S>(
  history: History<Ts, S>,
): boolean {
  return history.past.length > 0;
}

export function canRedo<Ts extends readonly WidenedNodeType[], S>(
  history: History<Ts, S>,
): boolean {
  return history.future.length > 0;
}

// ---------------------------------------------------------------------------

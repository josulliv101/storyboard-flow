// Graph — construction and push — how an entry enters history.
//
// Split out of the former single-file `history.ts`; see ./index.ts.

import type {
  History,
  HistoryEntry,
  WidenedNodeType,
} from "../types";

import { coalesceEntries } from "./coalesce";

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/**
 * ONE rule for what a limit means, applied both here and by the trimmer, so a
 * hand-built `History` value cannot be interpreted one way at construction and
 * another way at push time.
 *
 * Anything that is not a positive integer — `0`, a negative, a fraction, `NaN`,
 * `Infinity`, or omitted — means unbounded. A fractional limit is treated as
 * garbage rather than rounded: `historyLimit: 2.5` is a typo, and silently
 * choosing 2 or 3 for the consumer hides it.
 */
function effectiveLimit(limit: number | undefined): number {
  if (limit === undefined) return Number.POSITIVE_INFINITY;
  return Number.isInteger(limit) && limit > 0 ? limit : Number.POSITIVE_INFINITY;
}

export function createHistory<Ts extends readonly WidenedNodeType[], S>(
  limit?: number,
): History<Ts, S> {
  return { past: [], future: [], limit: effectiveLimit(limit) };
}

/** Drops the OLDEST entries — `past` is oldest-first, and the entry a user is
 *  most likely to want back is the newest. */
function trimPast<Ts extends readonly WidenedNodeType[], S>(
  past: readonly HistoryEntry<Ts, S>[],
  limit: number,
): readonly HistoryEntry<Ts, S>[] {
  const bound = effectiveLimit(limit);
  if (past.length <= bound) return past;
  return past.slice(past.length - bound);
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * Appends `entry`, clears the redo branch, and trims the oldest past entries
 * past `limit`.
 *
 * Clearing `future` is standard linear history: once a new command lands, the
 * undone branch is unreachable, and keeping it would let a later redo apply a
 * patch recorded against a graph that no longer exists.
 *
 * COALESCING: when `entry.coalesceKey` matches the top past entry's, the two are
 * merged instead of appended, so one gesture stays one undo step. BOTH keys must
 * be defined — two keyless entries never merge. That check is not paranoia: if
 * `undefined === undefined` counted as a match, every consecutive edit in the
 * whole application would silently collapse into a single undo step.
 */
export function pushHistory<Ts extends readonly WidenedNodeType[], S>(
  history: History<Ts, S>,
  entry: HistoryEntry<Ts, S>,
): History<Ts, S> {
  const top = history.past.at(-1);
  const key = entry.coalesceKey;

  if (top !== undefined && key !== undefined && top.coalesceKey === key) {
    const merged = coalesceEntries(top, entry);
    // `null` means these two cannot be merged without losing information (see
    // coalesceEntries). Appending is always the safe answer: the user gets one
    // extra undo step, never a lost one.
    if (merged !== null) {
      const past = [...history.past.slice(0, -1), merged];
      return { past: trimPast(past, history.limit), future: [], limit: history.limit };
    }
  }

  const past = [...history.past, entry];
  return { past: trimPast(past, history.limit), future: [], limit: history.limit };
}

// ---------------------------------------------------------------------------

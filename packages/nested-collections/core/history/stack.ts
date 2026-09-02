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
 * The default ceiling on undo entries, applied by `createEngine` when
 * `EngineConfig.historyLimit` is omitted.
 *
 * THERE WAS NO DEFAULT, and `historyLimit` was the one field in `EngineConfig`
 * carrying no doc comment either — the two omissions were the same omission.
 * Unbounded is a strange default for this particular stack, because undo here
 * is deliberately built on WHOLE-VALUE before/after pairs (see
 * `ConsumerDefinedNodeType.invertEdit`: "Undo works from whole-value
 * before/after pairs, which cannot be wrong"). That choice is right and it
 * means every entry retains two complete copies of the edited node's `Data`, so
 * an unbounded stack retains two copies per gesture for the life of the
 * session.
 *
 * IT IS ALSO WHAT MAKES THE PUSH SUPERLINEAR. `pushHistory` returns a new
 * `History`, so it copies `past` — O(entries) per push, and O(entries^2) over a
 * session. MEASURED, microseconds per push against a FULL stack, one
 * `edit-nodes` on one node:
 *
 *      limit      us/push          limit          us/push
 *        100         3.59            2,500           6.61
 *        250         3.21            5,000          12.89
 *        500         3.29           10,000          20.56
 *      1,000         5.07           25,000         239.70
 *
 *   unbounded, at  5,000 edits    12.00
 *   unbounded, at 20,000 edits   135.81
 *   unbounded, at 50,000 edits   293.21
 *
 * Flat to 500, 1.5x the floor at 1,000, and off a cliff past 10,000. The
 * unbounded rows are the same curve with nothing stopping it: a session simply
 * walks down the table.
 *
 * 1,000, and the binding constraint is RETENTION rather than that curve — 5 us
 * on a gesture that happens a few times a second is not a cost anybody can
 * perceive. A thousand gestures of undo is past what a session reaches and well
 * past what a user will ever walk back, while 2,000 retained `Data` copies is a
 * number a consumer can multiply by their own value's size and act on.
 *
 * A FLOOR ON DEPTH, NOT A BOUND ON MEMORY, and that distinction is
 * `DEFAULT_FOLD_CACHE_LIMIT`'s: the entry holds the consumer's `Data`, whose
 * size this package cannot know. A consumer whose nodes carry anything larger
 * than a scalar should size this against their own value.
 *
 * `historyLimit: null` opts out and restores unbounded — the same escape hatch
 * `maxNodeIdLength` offers, spelled the same way. It is not `0`: that is
 * refused at `createEngine`, along with every other value that would silently
 * mean unbounded.
 */
export const DEFAULT_HISTORY_LIMIT = 1_000;

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

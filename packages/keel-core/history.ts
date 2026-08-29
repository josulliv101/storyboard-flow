// KEEL — history: pure undo/redo values, dispatch coalescing, and the ingest
// scrub.
//
// PURE. No React, no DOM, no "use client". Imports ./types and ./patches only.
//
// `History<Ts, S>` is a VALUE, not a mutable handle. It has to be: `applyIngest`
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
//  3. `scrubHistoryForIngest` is the history half of `applyIngest`, the
//     non-undoable content write. Roughly half the fields on a realistic item
//     have a writer that is not user intent (a thumbnail arriving, a server
//     stamping provenance). If the only door into `data` were a command, either
//     Ctrl-Z would undo a thumbnail, or a dormant whole-value `before` would
//     silently clobber the server's write on the next undo. Scrubbing removes
//     exactly the overwritten node from the sleeping entries and leaves every
//     other change perfectly invertible — content changes are per-node
//     independent within a patch, which is what makes surgical removal sound.

import type {
  DataChange,
  History,
  HistoryEntry,
  NodeId,
  Patch,
} from "./types";
import { makeDataChange } from "./types";
import { scrubPatchForIngest } from "./patches";

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

export function createHistory<Ts extends readonly unknown[], S>(
  limit?: number,
): History<Ts, S> {
  return { past: [], future: [], limit: effectiveLimit(limit) };
}

/** Drops the OLDEST entries — `past` is oldest-first, and the entry a user is
 *  most likely to want back is the newest. */
function trimPast<Ts extends readonly unknown[], S>(
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
export function pushHistory<Ts extends readonly unknown[], S>(
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
// Peek / commit — deliberately separate, see the header
// ---------------------------------------------------------------------------

export function peekUndo<Ts extends readonly unknown[], S>(
  history: History<Ts, S>,
): HistoryEntry<Ts, S> | null {
  return history.past.at(-1) ?? null;
}

export function peekRedo<Ts extends readonly unknown[], S>(
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
export function commitUndo<Ts extends readonly unknown[], S>(
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
export function commitRedo<Ts extends readonly unknown[], S>(
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

export function canUndo<Ts extends readonly unknown[], S>(
  history: History<Ts, S>,
): boolean {
  return history.past.length > 0;
}

export function canRedo<Ts extends readonly unknown[], S>(
  history: History<Ts, S>,
): boolean {
  return history.future.length > 0;
}

// ---------------------------------------------------------------------------
// Clearing
// ---------------------------------------------------------------------------

export function clearFuture<Ts extends readonly unknown[], S>(
  history: History<Ts, S>,
): History<Ts, S> {
  if (history.future.length === 0) return history;
  return { past: history.past, future: [], limit: history.limit };
}

/**
 * The only recovery for a dormant entry whose world moved. Entries replay in
 * order, so one inapplicable entry makes everything beneath it unreachable too —
 * there is no way to skip past a broken entry and keep undoing.
 */
export function clearPast<Ts extends readonly unknown[], S>(
  history: History<Ts, S>,
): History<Ts, S> {
  if (history.past.length === 0) return history;
  return { past: [], future: history.future, limit: history.limit };
}

export function clearHistory<Ts extends readonly unknown[], S>(
  history: History<Ts, S>,
): History<Ts, S> {
  if (history.past.length === 0 && history.future.length === 0) return history;
  return { past: [], future: [], limit: history.limit };
}

// ---------------------------------------------------------------------------
// Coalescing
// ---------------------------------------------------------------------------

/**
 * Merge two entries that share a `coalesceKey`, keeping the OLDEST `before` and
 * the NEWEST `after` per node. Returns `null` when they cannot be merged, and
 * the caller appends instead.
 *
 * Refusal cases, each one a place where merging would LOSE a change rather than
 * combine two:
 *   - either patch is not `"data-changed"`. Structural patches do not compose
 *     into one reversible record by keeping endpoints: two moves of one node
 *     through three parents are not a single move, because the intermediate
 *     parent's `subtreeRev` chain was really bumped.
 *   - the two patches touch different node sets. A merge is per-node, so a node
 *     present in only one of them would have no partner and would silently
 *     vanish from history — becoming permanently un-undoable.
 *   - the same node id carries a different `kind` in the two patches. That is
 *     corrupt input, not something to paper over.
 *
 * NOT checked: that `previous`'s `after` equals `next`'s `before`. `Data` is
 * opaque to the engine, and the only sanctioned equality on it goes through a
 * node type's `serialize` — which needs an `EngineContext` this function
 * deliberately does not take. Coalescing is driven by a caller-supplied key; a
 * caller that reuses one key across unrelated edits gets a merged entry that
 * skips an intermediate value, which is exactly what coalescing is for.
 */
export function coalesceEntries<Ts extends readonly unknown[], S>(
  previous: HistoryEntry<Ts, S>,
  next: HistoryEntry<Ts, S>,
): HistoryEntry<Ts, S> | null {
  const olderPatch = previous.patch;
  const newerPatch = next.patch;
  if (olderPatch.type !== "data-changed" || newerPatch.type !== "data-changed") {
    return null;
  }
  if (olderPatch.changes.length !== newerPatch.changes.length) return null;

  const newerByNode = new Map<NodeId, DataChange<Ts>>();
  for (const change of newerPatch.changes) newerByNode.set(change.nodeId, change);

  const merged: DataChange<Ts>[] = [];
  // Which of the newer patch's nodes actually found a partner. Equal lengths
  // plus "every older node exists in newer" is NOT set equality when the older
  // patch repeats an id: `[n1, n1]` against `[n1, n2]` passes both checks while
  // dropping n2's change entirely. Counting the distinct nodes consumed closes
  // that hole.
  const consumed = new Set<NodeId>();

  for (const older of olderPatch.changes) {
    const newer = newerByNode.get(older.nodeId);
    if (newer === undefined) return null;
    if (newer.kind !== older.kind) return null;
    consumed.add(older.nodeId);
    merged.push(
      makeDataChange<Ts>(older.nodeId, older.kind, older.before, newer.after),
    );
  }
  if (consumed.size !== newerByNode.size) return null;

  const patch: Patch<Ts, S> = { type: "data-changed", changes: merged };
  // `command: null` because neither original command describes the merged patch
  // any more — the merged entry is engine-synthesized, and a stale command on it
  // would be a lie for anything that inspects history.
  //
  // `at` is the NEWEST timestamp: the merged entry stands for a gesture that
  // ended when the user stopped dragging.
  if (next.coalesceKey === undefined) {
    return { command: null, patch, at: next.at };
  }
  // The NEWER key, because it is what the next push will compare against — a
  // gesture that keeps emitting must keep merging.
  return { command: null, patch, at: next.at, coalesceKey: next.coalesceKey };
}

// ---------------------------------------------------------------------------
// The ingest scrub
// ---------------------------------------------------------------------------

/**
 * Maps `scrubPatchForIngest` over BOTH stacks, dropping entries whose patch is
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
export function scrubHistoryForIngest<Ts extends readonly unknown[], S>(
  history: History<Ts, S>,
  replacements: ReadonlyMap<NodeId, unknown>,
): History<Ts, S> {
  // Nothing was ingested: not merely an optimization, it keeps the History
  // reference stable so a store can skip notifying on a no-op ingest.
  if (replacements.size === 0) return history;

  const past = scrubStack(history.past, replacements);
  const future = scrubStack(history.future, replacements);
  if (past === history.past && future === history.future) return history;
  return { past, future, limit: history.limit };
}

function scrubStack<Ts extends readonly unknown[], S>(
  stack: readonly HistoryEntry<Ts, S>[],
  replacements: ReadonlyMap<NodeId, unknown>,
): readonly HistoryEntry<Ts, S>[] {
  const kept: HistoryEntry<Ts, S>[] = [];
  let changed = false;

  for (const entry of stack) {
    const patch = scrubPatchForIngest(entry.patch, replacements);
    if (patch === null) {
      // The entry recorded a change to nothing BUT the ingested nodes, so
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

  // Identity is only best-effort: it holds when `scrubPatchForIngest` returns
  // its input unchanged, which the contract permits but does not promise.
  return changed ? kept : stack;
}

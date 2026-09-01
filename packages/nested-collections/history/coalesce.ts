// Graph — coalescing.
//
// Split out of the former single-file `history.ts`; see ./index.ts.

import type {
  DataChange,
  HistoryEntry,
  NodeId,
  Patch,
  WidenedNodeType,
} from "../types";
import { makeDataChange } from "../types";

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
export function coalesceEntries<Ts extends readonly WidenedNodeType[], S>(
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

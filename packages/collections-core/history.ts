import { type CollectionsCommand } from "./commands";
import { type CollectionsPatch, invertPatch } from "./patches";

// Undo/redo as a pair of patch stacks. Entries keep the originating command
// alongside the patch so devtools/history views can show WHAT the user did,
// not just which indexes shuffled. Patches are serializable, so this same
// log doubles as a persistence journal.

export type HistoryEntry = Readonly<{
  command: CollectionsCommand;
  patch: CollectionsPatch;
  /** Milliseconds since epoch, for display/inspection only. */
  at: number;
}>;

export type CollectionsHistory = Readonly<{
  push: (entry: HistoryEntry) => void;
  /** The patch that undoes the most recent entry, or null. Moves the entry to the redo stack. */
  undo: () => CollectionsPatch | null;
  /** The patch that re-applies the most recently undone entry, or null. */
  redo: () => CollectionsPatch | null;
  /** What `undo()` WOULD apply, without moving anything — so callers can
   *  verify a dormant patch still applies before committing to the pop. */
  peekUndo: () => CollectionsPatch | null;
  /** What `redo()` would apply, without moving anything. */
  peekRedo: () => CollectionsPatch | null;
  /** Drop only the redo branch — it no longer applies to this graph. */
  clearFuture: () => void;
  /** Drop only the undo stack. Entries replay in order, so one inapplicable
   *  entry makes everything beneath it unreachable too. */
  clearPast: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Oldest-first log of applied entries (undone entries excluded). */
  entries: () => readonly HistoryEntry[];
  /** Drop both stacks — nothing is undoable or redoable afterward. Used when the graph is replaced wholesale (old patches no longer apply). */
  clear: () => void;
}>;

export function createHistory(
  options?: Readonly<{
    /**
     * Oldest entries fall off past this count (they stop being undoable).
     * Must be a positive integer; any other value (0, negative, fractional,
     * NaN, omitted) is treated as unbounded — the default.
     */
    maxEntries?: number;
  }>
): CollectionsHistory {
  const requested = options?.maxEntries;
  const maxEntries =
    requested !== undefined && Number.isInteger(requested) && requested > 0
      ? requested
      : Number.POSITIVE_INFINITY;
  const past: HistoryEntry[] = [];
  const future: HistoryEntry[] = [];

  return {
    push: (entry) => {
      past.push(entry);
      if (past.length > maxEntries) past.shift();
      // A new action invalidates the redo branch — standard linear history.
      future.length = 0;
    },
    undo: () => {
      const entry = past.pop();
      if (!entry) return null;
      future.push(entry);
      return invertPatch(entry.patch);
    },
    redo: () => {
      const entry = future.pop();
      if (!entry) return null;
      past.push(entry);
      return entry.patch;
    },
    peekUndo: () => {
      const entry = past[past.length - 1];
      return entry ? invertPatch(entry.patch) : null;
    },
    peekRedo: () => {
      const entry = future[future.length - 1];
      return entry ? entry.patch : null;
    },
    clearFuture: () => {
      future.length = 0;
    },
    clearPast: () => {
      past.length = 0;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    entries: () => [...past],
    clear: () => {
      past.length = 0;
      future.length = 0;
    },
  };
}

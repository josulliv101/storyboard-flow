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
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Oldest-first log of applied entries (undone entries excluded). */
  entries: () => readonly HistoryEntry[];
}>;

export function createHistory(
  options?: Readonly<{
    /** Oldest entries fall off past this count (they stop being undoable). Default: unbounded. */
    maxEntries?: number;
  }>
): CollectionsHistory {
  const maxEntries = options?.maxEntries ?? Number.POSITIVE_INFINITY;
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
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    entries: () => [...past],
  };
}

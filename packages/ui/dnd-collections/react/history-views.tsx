"use client";

import { useCollectionsSelector, useCollectionsStore } from "./collections-store";

// Devtools-style widgets over the store's patch history: undo/redo controls
// and a human-readable command/patch log. The same history entries are
// serializable, so a real devtools panel or persistence layer consumes the
// identical data.

export function UndoRedoControls() {
  const store = useCollectionsStore();
  const canUndo = useCollectionsSelector((s) => s.canUndo);
  const canRedo = useCollectionsSelector((s) => s.canRedo);

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={!canUndo}
        onClick={() => store.undo()}
        className="rounded border px-3 py-1 text-xs font-medium disabled:opacity-40"
      >
        Undo
      </button>
      <button
        type="button"
        disabled={!canRedo}
        onClick={() => store.redo()}
        className="rounded border px-3 py-1 text-xs font-medium disabled:opacity-40"
      >
        Redo
      </button>
    </div>
  );
}

export function HistoryLog() {
  const entries = useCollectionsSelector((s) => s.historyEntries);

  return (
    <ol data-testid="history-log" className="flex flex-col gap-1 text-xs text-muted-foreground">
      {entries.length === 0 && <li data-testid="history-empty">No changes yet.</li>}
      {entries.map((entry, index) => (
        <li key={`${entry.at}-${index}`} data-history-entry={index}>
          <code>
            {entry.command.type === "move-nodes"
              ? `move [${entry.command.nodeIds.join(", ")}]`
              : `add [${entry.command.nodes.map((node) => node.id).join(", ")}]`}
            {" → "}
            {entry.command.toParentId}@{entry.command.toIndex}
          </code>
        </li>
      ))}
    </ol>
  );
}

"use client";

import { useContext } from "react";

import { type CollectionsCommand } from "../core/commands";
import { useCollectionsSelector, useCollectionsStore } from "./collections-store";
import { CollectionsContainerContext } from "./container-context";

// Devtools-style widgets over the store's patch history: undo/redo controls
// and a human-readable command/patch log. The same history entries are
// serializable, so a real devtools panel or persistence layer consumes the
// identical data.

function describeCommand(command: CollectionsCommand): string {
  switch (command.type) {
    case "move-nodes":
      return `move [${command.nodeIds.join(", ")}] → ${command.toParentId}@${command.toIndex}`;
    case "add-nodes":
      return `add [${command.nodes.map((node) => node.id).join(", ")}] → ${command.toParentId}@${command.toIndex}`;
    case "update-media":
      return `trim ${command.nodeId} (${command.update.mediaKind})`;
  }
}

export function UndoRedoControls() {
  const store = useCollectionsStore();
  const canUndo = useCollectionsSelector((s) => s.canUndo);
  const canRedo = useCollectionsSelector((s) => s.canRedo);
  // Nullable on purpose: these controls also work under a bare
  // CollectionsStoreProvider (headless hosting), where there is no provider
  // live region — announcing is best-effort, undo/redo never depends on it.
  const announce = useContext(CollectionsContainerContext)?.announce;

  return (
    <div className="flex gap-2">
      <button
        type="button"
        disabled={!canUndo}
        onClick={() => {
          // Every other mutation path announces its outcome; undo/redo must
          // too, or a screen-reader user activating the button hears nothing.
          if (store.undo()) announce?.("Change undone.");
        }}
        className="rounded border px-3 py-1 text-xs font-medium disabled:opacity-40"
      >
        Undo
      </button>
      <button
        type="button"
        disabled={!canRedo}
        onClick={() => {
          if (store.redo()) announce?.("Change redone.");
        }}
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
          <code>{describeCommand(entry.command)}</code>
        </li>
      ))}
    </ol>
  );
}

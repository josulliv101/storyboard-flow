"use client";

import { useState } from "react";

import {
  useCollectionsSelector,
  useCollectionsStore,
  type CollectionsPatch,
} from "@storyboard/ui/dnd-collections";

import {
  describeChange,
  type ChangeDirection,
  type ChangeNote,
} from "./graph-item-details-change-note";

/**
 * Undo/redo SCOPED to this clip's trims (PL10-009).
 *
 * History is global and linear, so a bare undo button in a modal would reach
 * past what the scrim is covering — three presses could revert a delete made
 * on the board before the modal opened, invisibly. Undo is therefore offered
 * only while the next entry to be undone is an `update-media` on THIS node:
 * it steps back through the trims you made in here and then greys out at the
 * boundary of them, which teaches the limit without a word of copy.
 *
 * Redo is counted rather than inspected, because `historyEntries` is the
 * APPLIED log — the redo branch isn't in it. Every scoped undo adds one, every
 * redo spends one, and any fresh commit clears the branch (canRedo goes false)
 * which zeroes the count.
 */
export function useScopedHistory(nodeId: string, label?: string | null) {
  const store = useCollectionsStore();
  const canRedo = useCollectionsSelector((s) => s.canRedo);
  const undoableHere = useCollectionsSelector((s) => {
    if (!s.canUndo) return false;
    const last = s.historyEntries[s.historyEntries.length - 1];
    if (!last) return false;
    // Whatever this ITEM can do to itself: trim (media), rename (either), or
    // a disable toggle. Structural commands name a parent and a set of moved
    // nodes rather than "this item", so they stay out of reach here — which
    // is the point of scoping.
    const command = last.command;
    if (command.type === "update-media" || command.type === "rename-node") {
      return command.nodeId === nodeId;
    }
    if (command.type === "set-node-disabled") {
      return command.nodeIds.length === 1 && command.nodeIds[0] === nodeId;
    }
    return false;
  });
  const [undoneHere, setUndoneHere] = useState(0);
  const redoableHere = canRedo && undoneHere > 0;
  // A commit from anywhere else drops the redo branch; the count has to follow
  // it down or the button would offer a redo the store no longer has.
  if (!canRedo && undoneHere !== 0) setUndoneHere(0);

  // WHAT THE LAST PRESS DID, for the notice in the header. Held here rather
  // than in the header because only this hook knows whether the press was
  // taken — a refused undo must not announce one.
  const [note, setNote] = useState<ChangeNote | null>(null);
  // Bumped with every note so the header can restart its dismiss timer even
  // when two presses produce identical words — undoing two equal trims in a
  // row is a real sequence, and a notice that silently stayed put would look
  // like the second press did nothing.
  const [noteKey, setNoteKey] = useState(0);
  const describe = (
    entry: { command: unknown; patch: CollectionsPatch } | undefined,
    direction: ChangeDirection,
  ) => {
    if (entry === undefined) return;
    const command = entry.command as Readonly<{
      type: string;
      nodeId?: string;
      nodeIds?: readonly string[];
    }>;
    const described = describeChange({
      command,
      patch: entry.patch,
      direction,
      label: label ?? null,
      name: null,
    });
    if (described === null) return;
    setNote(described);
    setNoteKey((key) => key + 1);
  };

  return {
    undoableHere,
    redoableHere,
    note,
    noteKey,
    undo: () => {
      if (!undoableHere) return;
      // READ THE ENTRY FIRST. `undo` pops it off the applied log, so after the
      // call the thing being described is no longer in `historyEntries`.
      const entries = store.getSnapshot().historyEntries;
      const undoing = entries[entries.length - 1];
      if (store.undo()) {
        setUndoneHere((n) => n + 1);
        describe(undoing, "undo");
      }
    },
    redo: () => {
      if (!redoableHere) return;
      // AND READ IT AFTER, for the opposite reason: the redo branch is not in
      // the applied log until the redo lands, at which point the entry is back
      // on the end of it.
      if (store.redo()) {
        setUndoneHere((n) => Math.max(0, n - 1));
        const entries = store.getSnapshot().historyEntries;
        describe(entries[entries.length - 1], "redo");
      }
    },
  };
}

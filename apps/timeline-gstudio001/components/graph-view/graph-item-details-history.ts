"use client";

import { useState } from "react";

import {
  useCollectionsSelector,
  useCollectionsStore,
} from "@storyboard/ui/dnd-collections";

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
export function useScopedHistory(nodeId: string) {
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

  return {
    undoableHere,
    redoableHere,
    undo: () => {
      if (!undoableHere) return;
      if (store.undo()) setUndoneHere((n) => n + 1);
    },
    redo: () => {
      if (!redoableHere) return;
      if (store.redo()) setUndoneHere((n) => Math.max(0, n - 1));
    },
  };
}

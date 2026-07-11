"use client";

import { useCallback, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

import { type NodeId } from "../core/graph";
import {
  resolveGridRowMoveCommand,
  resolveKeyboardCommand,
  type KeyboardMoveAction,
} from "../core/keyboard";
import { type CollectionsStore } from "./collections-store";

// Semantic keyboard moves (Alt+key on a focused card), by event delegation
// on the provider wrapper so no per-card wiring is needed. Alt combos
// deliberately avoid dnd-kit's KeyboardSensor grammar (Enter/Space to grab,
// bare arrows while grabbed) — the two coexist. Each action resolves
// through core/ into the SAME move-nodes command the pointer path
// dispatches, so validation/undo/announcements are shared. Inside a grid
// container (marked data-grid-columns), Alt+ArrowUp/Down become ROW moves.

const KEYBOARD_ACTION_BY_KEY: Readonly<Record<string, KeyboardMoveAction | undefined>> = {
  ArrowLeft: "move-prev",
  ArrowRight: "move-next",
  Home: "move-home",
  End: "move-end",
  ArrowDown: "nest-in-neighbor",
  ArrowUp: "move-out",
  // Arrow-free synonyms — the only nest/move-out bindings available inside
  // grids, where Alt+Arrows are row moves.
  Enter: "nest-in-neighbor",
  Backspace: "move-out",
};

const GRID_BOUNDARY_MESSAGES: Readonly<Record<string, string | undefined>> = {
  "already-first-row": "Already in the first row.",
  "already-last-row": "Already in the last row.",
};

const KEYBOARD_BOUNDARY_MESSAGES: Readonly<Record<string, string>> = {
  "missing-node": "Nothing to move.",
  "cannot-move-root": "Top-level collections cannot be moved.",
  "no-previous-sibling": "Already first in its collection.",
  "no-next-sibling": "Already last in its collection.",
  "no-neighbor-collection": "No adjacent collection to nest into.",
  "no-parent-to-move-out-to": "Already at the top level.",
};

export function useCollectionsKeyboard(args: {
  store: CollectionsStore;
  announce: (message: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}): Readonly<{
  handleKeyDownCapture: (event: ReactKeyboardEvent) => void;
  /** Re-focus a card after a move unmounts/remounts it (new parent or virtual slot). */
  restoreFocus: (nodeId: NodeId) => void;
}> {
  const { store, announce, containerRef } = args;

  const restoreFocus = useCallback(
    (nodeId: NodeId) => {
      requestAnimationFrame(() => {
        containerRef.current
          ?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`)
          ?.focus();
      });
    },
    [containerRef]
  );

  const handleGridRowMove = useCallback(
    (nodeId: NodeId, key: "ArrowUp" | "ArrowDown", columns: number) => {
      const { graph } = store.getSnapshot();
      const resolved = resolveGridRowMoveCommand(
        graph,
        nodeId,
        key === "ArrowUp" ? "up" : "down",
        columns
      );
      if (!resolved.ok) {
        const message = GRID_BOUNDARY_MESSAGES[resolved.error.reason];
        if (message) announce(message);
        return;
      }
      if (!store.dispatch(resolved.value).ok) return;

      const name = graph.nodesById.get(nodeId)?.name ?? "item";
      announce(`Moved "${name}" ${key === "ArrowUp" ? "up" : "down"} one row.`);
      restoreFocus(nodeId);
    },
    [store, announce, restoreFocus]
  );

  const handleKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      // The focused element is either the card button (data-node-id) or its
      // grip bar — a sibling inside the data-node-wrapper host.
      const card = (event.target as HTMLElement).closest?.(
        "[data-node-id], [data-node-wrapper]"
      );
      const rawId =
        card?.getAttribute("data-node-id") ?? card?.getAttribute("data-node-wrapper");
      if (!rawId) return;
      const nodeId = rawId as NodeId;

      // Inside a grid container, Alt+ArrowUp/Down mean ROW moves (± the
      // grid's column count) instead of the global nest/move-out — the
      // grid declares its scope (and live column count) on the container.
      const gridEl = card?.closest?.("[data-grid-columns]");
      if (gridEl && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        event.stopPropagation();
        handleGridRowMove(nodeId, event.key, Number(gridEl.getAttribute("data-grid-columns")));
        return;
      }

      const action = KEYBOARD_ACTION_BY_KEY[event.key];
      if (!action) return;

      event.preventDefault();
      event.stopPropagation();

      const { graph } = store.getSnapshot();
      const name = graph.nodesById.get(nodeId)?.name ?? "item";
      const resolved = resolveKeyboardCommand(graph, nodeId, action);
      if (!resolved.ok) {
        announce(KEYBOARD_BOUNDARY_MESSAGES[resolved.error.reason]);
        return;
      }

      const dispatched = store.dispatch(resolved.value);
      if (!dispatched.ok) {
        if (dispatched.error.reason === "would-create-cycle") {
          store.flashRejection([nodeId]);
          announce("Cannot move a collection into itself or one of its nested collections.");
        }
        return;
      }

      const targetName = graph.nodesById.get(resolved.value.toParentId)?.name ?? "collection";
      announce(`Moved "${name}" in "${targetName}".`);

      restoreFocus(nodeId);
    },
    [store, announce, handleGridRowMove, restoreFocus]
  );

  return { handleKeyDownCapture, restoreFocus };
}

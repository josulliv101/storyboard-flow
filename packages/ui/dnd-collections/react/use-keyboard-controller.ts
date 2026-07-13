"use client";

import { useCallback, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

import { mediaDurationSeconds, type NodeId } from "../core/graph";
import {
  resolveGridRowMoveCommand,
  resolveKeyboardCommand,
  resolveTrimCommand,
  type GridRowMoveRejection,
  type KeyboardMoveAction,
  type KeyboardRejection,
  type KeyboardTrimAction,
  type KeyboardTrimRejection,
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

// Keyed by the rejection unions (not `string`) so adding a reason to
// core/keyboard forces a decision here at compile time instead of silently
// announcing `undefined`. `undefined` = intentionally silent (a corrupt-input
// or out-of-scope reason with no user-facing message).
const GRID_BOUNDARY_MESSAGES: Readonly<
  Record<GridRowMoveRejection["reason"], string | undefined>
> = {
  "already-first-row": "Already in the first row.",
  "already-last-row": "Already in the last row.",
  "missing-node": undefined,
  "cannot-move-root": undefined,
  "invalid-columns": undefined,
};

const KEYBOARD_BOUNDARY_MESSAGES: Readonly<Record<KeyboardRejection["reason"], string>> = {
  "missing-node": "Nothing to move.",
  "cannot-move-root": "Top-level collections cannot be moved.",
  "no-previous-sibling": "Already first in its collection.",
  "no-next-sibling": "Already last in its collection.",
  "no-neighbor-collection": "No adjacent collection to nest into.",
  "no-parent-to-move-out-to": "Already at the top level.",
};

// Alt+SHIFT+Arrows trim the focused media card (the pointer handles' semantics
// without a drag): horizontal = the END edge every media has, vertical = the
// video START edge. Held Shift is what tells the handler apart from a bare
// Alt+Arrow move — the trim branch runs first and returns.
const TRIM_ACTION_BY_KEY: Readonly<Record<string, KeyboardTrimAction | undefined>> = {
  ArrowRight: "trim-end-extend", // end edge out -> longer
  ArrowLeft: "trim-end-reduce", // end edge in  -> shorter
  ArrowUp: "trim-start-reduce", // video: trim more off the start
  ArrowDown: "trim-start-extend", // video: give the start back
};

/** One keypress = one second, clamped by the reducer exactly like a drag. */
const TRIM_STEP_SECONDS = 1;

// `undefined` = intentionally silent (corrupt/out-of-scope input). Keyed by the
// rejection union so a new reason forces a decision here at compile time.
const TRIM_REJECTION_MESSAGES: Readonly<
  Record<KeyboardTrimRejection["reason"], string | undefined>
> = {
  "no-start-edge": "Images can only be trimmed at the end.",
  "not-media-node": undefined,
  "missing-node": undefined,
};

export function useCollectionsKeyboard(args: {
  store: CollectionsStore;
  announce: (message: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
}): Readonly<{
  handleKeyDownCapture: (event: ReactKeyboardEvent) => void;
  /** Re-focus a card after a move unmounts/remounts it (new parent or virtual slot). */
  restoreFocus: (nodeId: NodeId, fallbackId?: NodeId) => void;
}> {
  const { store, announce, containerRef } = args;

  // A cross-parent move unmounts the card and remounts it under a new React
  // parent; a cross-row grid move recreates its DOM element. Either can lag a
  // frame or two, so a single rAF often misses and focus drops to <body>.
  // Retry across a short window, and if the card genuinely never reappears
  // (it moved into a collection this view doesn't render as a panel), fall
  // back to the destination's own card so focus lands somewhere sensible.
  const restoreFocus = useCallback(
    (nodeId: NodeId, fallbackId?: NodeId) => {
      let attempts = 12;
      const tryFocus = () => {
        const root = containerRef.current;
        if (!root) return;
        const card = root.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(nodeId)}"]`);
        if (card) {
          card.focus();
          return;
        }
        if (--attempts > 0) {
          requestAnimationFrame(tryFocus);
          return;
        }
        if (fallbackId) {
          root
            .querySelector<HTMLElement>(`[data-node-id="${CSS.escape(fallbackId)}"]`)
            ?.focus();
        }
      };
      requestAnimationFrame(tryFocus);
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

  const handleTrim = useCallback(
    (nodeId: NodeId, action: KeyboardTrimAction) => {
      const { graph } = store.getSnapshot();
      const name = graph.nodesById.get(nodeId)?.name ?? "item";
      const resolved = resolveTrimCommand(graph, nodeId, action, TRIM_STEP_SECONDS);
      if (!resolved.ok) {
        const message = TRIM_REJECTION_MESSAGES[resolved.error.reason];
        if (message) announce(message);
        return;
      }
      const dispatched = store.dispatch(resolved.value);
      if (!dispatched.ok) {
        // The reducer clamped the step to no change — the edge is at its limit.
        if (dispatched.error.reason === "same-position") {
          const extend = action === "trim-end-extend" || action === "trim-start-extend";
          announce(
            extend ? `"${name}" is already at its full length.` : `"${name}" is already trimmed all the way.`
          );
        }
        return;
      }
      // A trim keeps the card mounted (structure is untouched), so focus stays
      // put — just announce the new length.
      const after = store.getSnapshot().graph.nodesById.get(nodeId);
      const seconds = after && after.kind === "media" ? mediaDurationSeconds(after) : 0;
      announce(`Trimmed "${name}" to ${seconds}s.`);
    },
    [store, announce]
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

      // Alt+SHIFT+Arrows TRIM the media card — checked before the move/grid
      // logic so a held Shift never falls through to a move. (A non-arrow
      // Shift combo is left alone: return without consuming the event.)
      if (event.shiftKey) {
        const trimAction = TRIM_ACTION_BY_KEY[event.key];
        if (!trimAction) return;
        event.preventDefault();
        event.stopPropagation();
        handleTrim(nodeId, trimAction);
        return;
      }

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

      // nest-in-neighbor/move-out can land the card in a collection this view
      // doesn't render — fall back to the destination collection's own card.
      restoreFocus(nodeId, resolved.value.toParentId);
    },
    [store, announce, handleGridRowMove, handleTrim, restoreFocus]
  );

  return { handleKeyDownCapture, restoreFocus };
}

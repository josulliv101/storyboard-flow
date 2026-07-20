"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";

import { getChildren, mediaDurationSeconds, type NodeId } from "../core/graph";
import {
  resolveGridRowMoveCommand,
  resolveKeyboardCommand,
  resolveTrashCommand,
  resolveTrimCommand,
  resolveWindowMoveCommand,
  type GridRowMoveRejection,
  type KeyboardMoveAction,
  type KeyboardRejection,
  type KeyboardTrashRejection,
  type KeyboardTrimAction,
  type KeyboardTrimRejection,
  type KeyboardWindowMoveAction,
  type KeyboardWindowMoveRejection,
} from "../core/keyboard";
import { type CollectionsStore } from "./collections-store";
import { roundSecondsForDisplay } from "./duration-format";
import { findNodeElement, focusNodeWhenMounted, isEditableKeyboardTarget } from "./node-dom";

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

// Alt+Shift+Home/End SLIDE a video's source window (trim-in/out shift
// together, showing duration constant) — the keyboard equivalent of dragging
// the overview filmstrip. Home = earlier footage, End = later.
const WINDOW_MOVE_ACTION_BY_KEY: Readonly<
  Record<string, KeyboardWindowMoveAction | undefined>
> = {
  Home: "window-earlier",
  End: "window-later",
};

// `undefined` = intentionally silent; keyed by the rejection union so a new
// reason forces a decision here at compile time.
const WINDOW_MOVE_REJECTION_MESSAGES: Readonly<
  Record<KeyboardWindowMoveRejection["reason"], string | undefined>
> = {
  "no-source-window": "Only videos have a source window.",
  "not-media-node": undefined,
  "missing-node": undefined,
  "invalid-step": undefined,
};

// `undefined` = intentionally silent (corrupt/out-of-scope input). Keyed by the
// rejection union so a new reason forces a decision here at compile time.
const TRIM_REJECTION_MESSAGES: Readonly<
  Record<KeyboardTrimRejection["reason"], string | undefined>
> = {
  "no-start-edge": "Images can only be trimmed at the end.",
  "not-media-node": undefined,
  "missing-node": undefined,
  "invalid-step": undefined,
};

// Alt+Delete moves the focused card to the designated trash collection (the
// keyboard equivalent of dropping it on the TrashTarget). `undefined` = silent
// (corrupt/out-of-scope input); keyed by the rejection union so a new reason
// forces a decision here at compile time.
const TRASH_REJECTION_MESSAGES: Readonly<
  Record<KeyboardTrashRejection["reason"], string | undefined>
> = {
  "already-in-trash": "Already in trash.",
  "cannot-move-root": "Top-level collections cannot be moved to trash.",
  "missing-node": undefined,
  "no-trash-collection": undefined,
};

/** Focus a mounted <TrashTarget> by its collection id (attribute-value match,
 *  so ids with arbitrary characters need no CSS escaping). */
function focusTrashTargetElement(root: HTMLElement | null, trashId: NodeId): void {
  if (!root) return;
  for (const el of root.querySelectorAll<HTMLElement>("[data-trash-target]")) {
    if (el.dataset.trashTarget === trashId) {
      el.focus();
      return;
    }
  }
}

export function useCollectionsKeyboard(args: {
  store: CollectionsStore;
  announce: (message: string) => void;
  containerRef: RefObject<HTMLDivElement | null>;
  /** Where a mounted <TrashTarget> registers its id, for Alt+Delete. */
  trashRef: RefObject<NodeId | null>;
}): Readonly<{
  handleKeyDownCapture: (event: ReactKeyboardEvent) => void;
  /** Re-focus a card after a move unmounts/remounts it (new parent or virtual slot). */
  restoreFocus: (nodeId: NodeId, fallbackId?: NodeId) => void;
}> {
  const { store, announce, containerRef, trashRef } = args;
  const pendingFocusRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => {
      pendingFocusRef.current?.();
    },
    []
  );

  // A cross-parent move unmounts the card and remounts it under a new React
  // parent; a cross-row grid move recreates its DOM element. Either can lag a
  // frame or two, so a single rAF often misses and focus drops to <body>.
  // Retry across a short window, and if the card genuinely never reappears
  // (it moved into a collection this view doesn't render as a panel), fall
  // back to the destination's own card so focus lands somewhere sensible.
  const restoreFocus = useCallback(
    (nodeId: NodeId, fallbackId?: NodeId) => {
      pendingFocusRef.current?.();
      pendingFocusRef.current = null;
      const root = containerRef.current;
      if (!root) return;
      pendingFocusRef.current = focusNodeWhenMounted(
        root,
        nodeId,
        fallbackId === undefined ? {} : { fallbackId }
      );
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
      announce(`Trimmed "${name}" to ${roundSecondsForDisplay(seconds)}s.`);
    },
    [store, announce]
  );

  const handleWindowMove = useCallback(
    (nodeId: NodeId, action: KeyboardWindowMoveAction) => {
      const { graph } = store.getSnapshot();
      const name = graph.nodesById.get(nodeId)?.name ?? "item";
      const resolved = resolveWindowMoveCommand(graph, nodeId, action, TRIM_STEP_SECONDS);
      if (!resolved.ok) {
        const message = WINDOW_MOVE_REJECTION_MESSAGES[resolved.error.reason];
        if (message) announce(message);
        return;
      }
      const dispatched = store.dispatch(resolved.value);
      if (!dispatched.ok) {
        // No room left in that direction (or no trimmed room at all) — the
        // resolver clamped to the current values and the reducer rejected
        // the no-op. Announce the boundary.
        if (dispatched.error.reason === "same-position") {
          announce(
            action === "window-earlier"
              ? `"${name}" source window is at the start.`
              : `"${name}" source window is at the end.`
          );
        }
        return;
      }
      // A window move keeps the card mounted and its width constant — just
      // announce the slide.
      announce(
        `Moved "${name}" source window ${action === "window-earlier" ? "earlier" : "later"}.`
      );
    },
    [store, announce]
  );

  const handleTrash = useCallback(
    (nodeId: NodeId, trashId: NodeId) => {
      const { graph } = store.getSnapshot();
      const name = graph.nodesById.get(nodeId)?.name ?? "item";
      // Compute the neighbor BEFORE the move so focus can land on whatever
      // takes the vacated slot (next sibling, else previous) once the card
      // leaves for the usually-hidden trash collection.
      const parentId = graph.parentById.get(nodeId);
      const siblings = parentId ? getChildren(graph, parentId) : [];
      const selfIndex = siblings.indexOf(nodeId);
      const neighbor = siblings[selfIndex + 1] ?? siblings[selfIndex - 1];

      const resolved = resolveTrashCommand(graph, nodeId, trashId);
      if (!resolved.ok) {
        const message = TRASH_REJECTION_MESSAGES[resolved.error.reason];
        if (message) announce(message);
        return;
      }
      const dispatched = store.dispatch(resolved.value);
      if (!dispatched.ok) {
        if (dispatched.error.reason === "would-create-cycle") {
          store.flashRejection([nodeId]);
          announce("Cannot move a collection into itself or one of its nested collections.");
        }
        if (dispatched.error.reason === "blocked-by-policy") {
          store.flashRejection([nodeId]);
          if (dispatched.error.message) announce(dispatched.error.message);
        }
        return;
      }
      announce(`Moved "${name}" to trash.`);
      if (neighbor) {
        restoreFocus(neighbor, trashId);
        return;
      }
      // The panel just emptied. The trash collection is usually a HIDDEN
      // root (only the <TrashTarget> chrome renders), so falling back to its
      // node card would find nothing and focus would drop to <body>. Prefer
      // the card when a view does render it; otherwise focus the trash
      // target itself (tabIndex -1 for exactly this).
      const root = containerRef.current;
      if (root && findNodeElement(root, trashId)) {
        restoreFocus(trashId, trashId);
        return;
      }
      focusTrashTargetElement(root, trashId);
    },
    [store, announce, restoreFocus, containerRef]
  );

  const handleKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      // A control inside the card owns its own keys — see
      // `isEditableKeyboardTarget`. Without this, Alt+Arrow in an <input>
      // reordered the card instead of moving the caret by word.
      if (isEditableKeyboardTarget(event.target)) return;
      // The focused element is either the card button (data-node-id) or its
      // grip bar — a sibling inside the data-node-wrapper host.
      const card = (event.target as HTMLElement).closest?.(
        "[data-node-id], [data-node-wrapper]"
      );
      const rawId =
        card?.getAttribute("data-node-id") ?? card?.getAttribute("data-node-wrapper");
      if (!rawId) return;
      const nodeId = rawId as NodeId;

      // Alt+Delete moves the focused card to the registered trash collection.
      // EXACTLY Alt+Delete: a held Shift makes it a different chord, left for
      // the app/browser like any other unrecognized combo (the trim branch
      // below guards held Shift the same way). Only consumed when a
      // <TrashTarget> is mounted and no dnd-kit drag owns movement.
      if (event.key === "Delete") {
        if (event.shiftKey) return;
        const trashId = trashRef.current;
        if (trashId === null || store.getSnapshot().interaction.isDragging) return;
        event.preventDefault();
        event.stopPropagation();
        handleTrash(nodeId, trashId);
        return;
      }

      const isCollectionsCommand = event.shiftKey
        ? TRIM_ACTION_BY_KEY[event.key] !== undefined ||
          WINDOW_MOVE_ACTION_BY_KEY[event.key] !== undefined
        : KEYBOARD_ACTION_BY_KEY[event.key] !== undefined;
      if (isCollectionsCommand && store.getSnapshot().interaction.isDragging) {
        // A live dnd-kit drag owns movement until it commits or cancels. Do
        // not let the direct Alt grammar mutate the graph underneath it.
        // Consume only recognized commands; bare arrows and Escape still
        // reach dnd-kit's keyboard sensor.
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      // Alt+SHIFT+Arrows TRIM the media card, Alt+SHIFT+Home/End SLIDE a
      // video's source window — both checked before the move/grid logic so a
      // held Shift never falls through to a move. (Any other Shift combo is
      // left alone: return without consuming the event.)
      if (event.shiftKey) {
        const windowAction = WINDOW_MOVE_ACTION_BY_KEY[event.key];
        if (windowAction) {
          event.preventDefault();
          event.stopPropagation();
          handleWindowMove(nodeId, windowAction);
          return;
        }
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
        if (dispatched.error.reason === "blocked-by-policy") {
          store.flashRejection([nodeId]);
          if (dispatched.error.message) announce(dispatched.error.message);
        }
        return;
      }

      const targetName = graph.nodesById.get(resolved.value.toParentId)?.name ?? "collection";
      announce(`Moved "${name}" in "${targetName}".`);

      // nest-in-neighbor/move-out can land the card in a collection this view
      // doesn't render — fall back to the destination collection's own card.
      restoreFocus(nodeId, resolved.value.toParentId);
    },
    [store, announce, trashRef, handleGridRowMove, handleTrim, handleWindowMove, handleTrash, restoreFocus]
  );

  return { handleKeyDownCapture, restoreFocus };
}

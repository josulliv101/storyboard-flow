"use client";

import { useCallback, useEffect, useState } from "react";

import { useCollectionsStore, type NodeId } from "@storyboard/ui/dnd-collections";

import {
  GRAPH_RENAME_ITEM_EVENT,
  type GraphRenameRequest,
  type GraphRenameSite,
} from "@/lib/graph-view-events";

/**
 * In-place rename LOGIC for a collection node, single-sourced so the card, the
 * breadcrumb, and the sub-timeline row all rename the same way (R6 #10).
 *
 * Commit dispatches `rename-node` on the GRAPH, not just the document: the
 * visible title reads the gateway, but a card's `aria-label`, the drag ghost,
 * and every pickup/drop announcement read `node.name`. Renaming only the
 * document left those speaking the old name indefinitely. The PersistenceBridge
 * turns this patch into the document write (and reverses it on undo). A blank
 * or unchanged name is a no-op — the reducer would reject it anyway, but not
 * dispatching keeps a stray empty commit out of history.
 */
export function useInlineRename(
  nodeId: NodeId,
  currentName: string,
  /** Which surface this instance IS. A node id names up to three mounted sites
   *  at once, and only the addressed one may open — see the event's own note. */
  site: GraphRenameSite,
) {
  const store = useCollectionsStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const begin = useCallback(() => {
    setDraft(currentName);
    setEditing(true);
  }, [currentName]);

  // Keyboard rename: the board's OpenKeyBoundary catches F2 and dispatches this
  // event with the node id; the matching site (card, breadcrumb, sub-row) opens
  // its editor — the keyboard twin of double-clicking the label.
  useEffect(() => {
    const onRename = (event: Event) => {
      const request = (event as CustomEvent<GraphRenameRequest>).detail;
      if (request.nodeId === (nodeId as string) && request.site === site) begin();
    };
    window.addEventListener(GRAPH_RENAME_ITEM_EVENT, onRename);
    return () => window.removeEventListener(GRAPH_RENAME_ITEM_EVENT, onRename);
  }, [nodeId, site, begin]);

  const cancel = useCallback(() => setEditing(false), []);

  const commit = useCallback(() => {
    setEditing(false);
    const next = draft.trim();
    if (!next || next === currentName) return;
    store.dispatch({ type: "rename-node", nodeId, name: next });
  }, [draft, currentName, nodeId, store]);

  return { editing, draft, setDraft, begin, cancel, commit } as const;
}

/**
 * The inline editor: one real `<input>` shared by every rename site — the
 * collection card, the breadcrumb crumb, and the sub-timeline row heading.
 *
 * It used to be a `contentEditable` span because the card's editor rendered
 * INSIDE the NodeCard `<button>` shell, where an `<input>` is invalid
 * interactive content. The graph now renders its collection items through the
 * package's item-shell seam (see GraphCollectionItem), which composes this
 * editor as a SIBLING of the selection surface — so a native input is legal
 * everywhere it appears, with real caret/selection/IME behavior for free.
 *
 * Uncontrolled on purpose: the value is seeded once (`defaultValue`) and
 * reported through `onInput`; select-on-focus lets the first keystroke replace
 * the old name.
 *
 * What actually keeps a press here from starting a drag, a pan, or toggling
 * selection is the composition, not these handlers: the editor renders as a
 * SIBLING of any selection surface (never nested in its <button>), and the
 * strip's pan surface excludes editable targets (isPannableStripSurface), so
 * neither drag wiring nor the pan sensor sees this input. The pointer/click
 * stopPropagation calls are therefore defensive isolation — cheap insurance
 * that this shared editor stays inert in whatever host renders it (card,
 * breadcrumb, sub-timeline row). Keyboard chords already skip editable targets
 * (isEditableKeyboardTarget); the keydown stopPropagation is the same
 * belt-and-braces. Enter commits, Escape cancels, blur commits.
 */
export function InlineNameEditor({
  initialValue,
  onInput,
  onCommit,
  onCancel,
  className,
}: Readonly<{
  initialValue: string;
  onInput: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
}>) {
  const setRef = useCallback((element: HTMLInputElement | null) => {
    if (!element) return;
    element.focus();
    // Select all so the first keystroke replaces the old name.
    element.select();
  }, []);

  return (
    <input
      ref={setRef}
      aria-label="Timeline name"
      defaultValue={initialValue}
      spellCheck={false}
      onChange={(event) => onInput(event.target.value)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") onCommit();
        else if (event.key === "Escape") onCancel();
      }}
      onBlur={onCommit}
      className={className}
    />
  );
}

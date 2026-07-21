"use client";

import { useCallback, useState } from "react";

import { useCollectionsStore, type NodeId } from "@storyboard/ui/dnd-collections";

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
export function useInlineRename(nodeId: NodeId, currentName: string) {
  const store = useCollectionsStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const begin = useCallback(() => {
    setDraft(currentName);
    setEditing(true);
  }, [currentName]);

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
 * The inline editor, as a `contentEditable` span rather than an `<input>`.
 *
 * A strip/grid card's content renders INSIDE the NodeCard `<button>` shell. An
 * `<input>` there is invalid interactive content and the parser hoists it OUT
 * of the button on hydration; a `<span>` is phrasing content and stays put —
 * which is why this is a contentEditable span. That dodges the hoist, but be
 * honest: a focusable `role="textbox"` inside a `<button>` is still not clean
 * a11y (nested interactive semantics). The correct fix is to render the editor
 * OUTSIDE the button — a sibling of a selection surface — which needs an
 * item-shell override on VirtualStrip/VirtualGrid that the graph does not have
 * yet. Until then this is a pragmatic, edit-only (transient) editor; `role` +
 * `aria-label` keep it testable and named. The text is seeded once via the ref
 * (never bound as React children, which would reset the caret every keystroke)
 * and read back through `onInput`.
 *
 * Placed within the card's drag sensor, so a press or click here must not start
 * a drag or toggle selection — hence the stopPropagation. The card's keyboard
 * chords already skip editable targets, so typing is safe; Enter commits (no
 * newline) and Escape cancels.
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
  const setRef = useCallback(
    (element: HTMLSpanElement | null) => {
      if (!element) return;
      element.textContent = initialValue;
      element.focus();
      // Select all so the first keystroke replaces the old name.
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    },
    [initialValue],
  );

  return (
    <span
      ref={setRef}
      role="textbox"
      aria-label="Timeline name"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={(event) => onInput(event.currentTarget.textContent ?? "")}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault(); // commit instead of inserting a newline
          onCommit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCommit}
      className={className}
    />
  );
}

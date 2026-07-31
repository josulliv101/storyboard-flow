"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { X } from "lucide-react";

import { isEditableKeyboardTarget } from "@storyboard/ui/dnd-collections";

// The shortcuts sheet (PL11-007).
//
// Nearly every gesture in this view is invisible: press-and-hold to drag, O to
// drill in, F2 to rename, the whole Alt-key layer, and — until recently — no
// keyboard undo at all. None of it was written down anywhere a user could
// reach. This is that page.
//
// Every row below was verified against the handler that implements it rather
// than written from memory: the app-level keys in `graph-item-actions`, the
// board keys in `OpenKeyBoundary`, and the card grammar in the package's
// `use-keyboard-controller`. A shortcut sheet that lies is worse than none.

export const GRAPH_SHORTCUTS_EVENT = "graph-view:show-shortcuts";

/** Ask the graph view to open the shortcuts sheet (the board menu does). */
export function requestGraphShortcuts(): void {
  window.dispatchEvent(new Event(GRAPH_SHORTCUTS_EVENT));
}

type Row = Readonly<{ keys: string; what: string }>;
type Section = Readonly<{ title: string; note?: string; rows: readonly Row[] }>;

const SECTIONS: readonly Section[] = [
  {
    title: "Anywhere in the view",
    rows: [
      { keys: "Ctrl/⌘ Z", what: "Undo" },
      { keys: "Ctrl/⌘ ⇧ Z  ·  Ctrl Y", what: "Redo" },
      { keys: "Ctrl/⌘ C", what: "Copy the selection" },
      { keys: "Ctrl/⌘ X", what: "Cut — paste to move it" },
      { keys: "Ctrl/⌘ V", what: "Paste" },
      { keys: "Ctrl/⌘ D", what: "Duplicate in place" },
      { keys: "Ctrl/⌘ A", what: "Select everything in this timeline" },
      { keys: "?", what: "This sheet" },
    ],
  },
  {
    title: "On a focused card",
    note: "Tab reaches one card per surface; arrows move the selection between them.",
    rows: [
      { keys: "Space", what: "Select this card" },
      { keys: "Ctrl/⌘ Space", what: "Add or remove it from a multi-selection" },
      { keys: "⇧ Arrows", what: "Extend the selection to here" },
      { keys: "Escape", what: "Clear the selection" },
      { keys: "Enter", what: "Grab it — arrows move, Enter drops, Escape cancels" },
      { keys: "O", what: "Open a timeline card (drill in) — or double-click it" },
      { keys: "F2", what: "Rename in place" },
      { keys: "Delete  ·  Backspace", what: "Move the selection to trash" },
    ],
  },
  {
    title: "Reordering (Alt)",
    rows: [
      { keys: "Alt ←  ·  Alt →", what: "Move one place earlier / later" },
      { keys: "Alt Home  ·  Alt End", what: "Move to the start / end" },
      { keys: "Alt ↓", what: "Nest into the neighbouring timeline" },
      { keys: "Alt ↑", what: "Move out to the parent timeline" },
      { keys: "Alt Delete", what: "Move just this card to trash" },
    ],
  },
  {
    title: "Trimming (Alt + Shift)",
    note: "One second per press. The details view takes exact numbers.",
    rows: [
      { keys: "Alt ⇧ →  ·  Alt ⇧ ←", what: "End edge later / earlier" },
      { keys: "Alt ⇧ ↑  ·  Alt ⇧ ↓", what: "Video start edge in / out" },
      { keys: "Alt ⇧ Home  ·  Alt ⇧ End", what: "Slide the source window, same duration" },
    ],
  },
  {
    title: "Playhead",
    note: "With a seek rail focused.",
    rows: [
      { keys: "←  ·  →", what: "Step one second" },
      { keys: "Home  ·  End", what: "Jump to the start / end of that row" },
    ],
  },
];

/** Split out so the focus hook mounts and unmounts WITH the dialog — a hook
 *  inside `GraphShortcuts` would run while it is closed and there is nothing
 *  to trap. */
function ShortcutsSheet({ onClose }: Readonly<{ onClose: () => void }>) {
  const { dialogProps } = useDialogFocus<HTMLDivElement>();

  return createPortal(
    <div
      data-graph-shortcuts
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
    >
      <div
        {...dialogProps}
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-950 p-5 shadow-2xl shadow-black/60 focus-visible:outline-none"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Keyboard shortcuts</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the shortcuts sheet"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {SECTIONS.map((section) => (
            <section key={section.title}>
              <h3 className="text-[11px] font-semibold tracking-wide text-amber-200/80 uppercase">
                {section.title}
              </h3>
              {section.note && (
                <p className="mt-0.5 text-[11px] text-zinc-500">{section.note}</p>
              )}
              <dl className="mt-2 space-y-1.5">
                {section.rows.map((row) => (
                  <div key={row.keys} className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 font-mono text-[11px] text-zinc-300">{row.keys}</dt>
                    <dd className="min-w-0 text-right text-[12px] text-zinc-400">{row.what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function GraphShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onRequest = () => setOpen(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && open) {
        setOpen(false);
        return;
      }
      // "?" is Shift+/ on most layouts, so match the CHARACTER rather than the
      // physical key — and never while typing.
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey) return;
      if (isEditableKeyboardTarget(event.target)) return;
      event.preventDefault();
      setOpen((previous) => !previous);
    };
    window.addEventListener(GRAPH_SHORTCUTS_EVENT, onRequest);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener(GRAPH_SHORTCUTS_EVENT, onRequest);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!open) return null;

  return <ShortcutsSheet onClose={() => setOpen(false)} />;
}

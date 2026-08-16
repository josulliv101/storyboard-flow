"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FolderPlus, GripVertical, Image as ImageIcon } from "lucide-react";

import { ADD_ITEM_TOOL, TOOL_MIME } from "./graph-native-drop-model";

/**
 * "Add item" — one control for the two things a timeline can hold.
 *
 * Two gestures, one question. CLICK it and you are asked which kind, and the
 * answer lands at the END. DRAG it onto a strip or a grid and you are asked the
 * same question at the spot you let go, and the answer lands THERE. The
 * question is identical either way, which is the whole point of merging what
 * used to be a collection-only tool with a media route that existed only at the
 * end of a surface.
 *
 * The drag half rides the existing tool MIME with a payload of its own, so
 * every drop surface accepts it, draws its indicator, and resolves its anchor
 * with no changes at all — see ADD_ITEM_TOOL. Only the commit differs.
 */

/** Menu chrome, shared so the two callers cannot drift apart visually. */
const MENU_CLASS =
  "z-50 flex w-56 flex-col rounded-md bg-zinc-900 p-1.5 shadow-lg ring-1 ring-white/15";

const ITEM_CLASS =
  "flex h-8 w-full items-center gap-2 rounded px-1.5 text-left text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:bg-zinc-800 focus-visible:text-zinc-100 focus-visible:outline-none";

/**
 * The two choices, plus the file input that backs the media one.
 *
 * `onFiles` is called with the picked files; `onDismiss` fires when the picker
 * is CANCELLED. That second one matters: choosing media does not resolve the
 * pending choice — the files have not arrived yet — so without a cancel signal
 * a dismissed OS picker would leave the menu open over the board with no way to
 * tell it nothing is coming. The `cancel` event on a file input is what says so.
 */
function AddItemChoices({
  onCollection,
  onFiles,
  onDismiss,
  hint,
}: Readonly<{
  onCollection: () => void;
  onFiles: (files: readonly File[]) => void;
  onDismiss: () => void;
  /** Shown under the choices. The button's menu carries the drag hint; the
   *  drop-point menu does not — you got there BY dragging. */
  hint?: ReactNode;
}>) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // `cancel` is bound imperatively: React's `InputHTMLAttributes` has no
  // `onCancel`, so there is no JSX prop for it. Worth the effect — without it,
  // dismissing the OS picker leaves the drop-point menu open over the board
  // waiting for files that are never coming, and the only way out is to notice
  // it and click elsewhere.
  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    const onCancel = () => onDismiss();
    input.addEventListener("cancel", onCancel);
    return () => input.removeEventListener("cancel", onCancel);
  }, [onDismiss]);

  return (
    <>
      <button
        type="button"
        role="menuitem"
        data-add-item-collection
        onClick={onCollection}
        className={ITEM_CLASS}
      >
        {/* The SAME glyphs the trailing add slot uses for the same two things,
            so the two routes to one action look like one action. */}
        <FolderPlus aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.7} />
        Add collection
      </button>
      <button
        type="button"
        role="menuitem"
        data-add-item-media
        onClick={() => fileInputRef.current?.click()}
        className={ITEM_CLASS}
      >
        <ImageIcon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.7} />
        Add media item
      </button>
      {hint}
      {/* `sr-only` rather than `display:none`: it must stay a real form control
          for the button above to be able to open it. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        tabIndex={-1}
        aria-hidden="true"
        data-add-item-input
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          // Reset BEFORE handing off, so picking the same file twice running
          // fires `change` again — the input compares against its own value,
          // and an unchanged one is silently inert.
          event.target.value = "";
          onFiles(files);
        }}
      />
    </>
  );
}

/**
 * Move focus to the first choice when a menu opens, and back to the trigger
 * when it closes.
 *
 * THE KEYBOARD ROUTE, not a nicety. Activating the button used to insert
 * outright; it now opens a menu, so without this the keystroke that used to add
 * a collection leaves focus on the trigger and the answer an unknown number of
 * Tabs away. With it the sequence is Enter, Enter.
 *
 * Returning focus matters just as much: a menu that closes while focus sits on
 * a button that no longer exists drops focus to `<body>`, and the next Tab
 * starts over at the top of the page.
 */
function useMenuFocus(
  open: boolean,
  menuRef: React.RefObject<HTMLElement | null>,
  triggerRef: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      // "Did focus fall to <body>", NOT "is focus still inside the menu".
      //
      // The obvious check — `menuRef.current?.contains(document.activeElement)`
      // — cannot ever be true: React removes the menu from the DOM and detaches
      // the ref BEFORE running this cleanup, so it reads null every time and
      // silently restores focus never.
      //
      // Focus landing on <body> IS the signal, and it distinguishes the two
      // cases exactly. Removing the focused element drops focus to the body, so
      // that means the menu closed under it. Clicking a card elsewhere leaves
      // focus on that card, so this does not fire and does not fight the user.
      const active = document.activeElement;
      if (active === null || active === document.body) triggerRef.current?.focus();
    };
  }, [open, menuRef, triggerRef]);
}

/** Escape, and a click anywhere outside `ref`, both dismiss. */
function useDismiss(
  open: boolean,
  ref: React.RefObject<HTMLElement | null>,
  onDismiss: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) onDismiss();
    };
    // Captured, so it closes THIS before the key reaches the board — where the
    // same key drops the selection or leaves select mode, which is not what
    // someone with a menu open means by it.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onDismiss();
    };
    document.addEventListener("mousedown", onDocPointerDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocPointerDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, ref, onDismiss]);
}

/**
 * The menu a DROPPED add-item opens, at the point it was let go.
 *
 * `fixed` at the drop's viewport coordinates, clamped in CSS rather than by
 * measuring: `min(x, calc(100vw - …))` keeps it on screen without a layout
 * pass, a ref, or the frame of "rendered off-screen, then corrected" that
 * measuring would cost.
 *
 * No drag hint here — you arrived by dragging.
 */
export function AddItemDropMenu({
  clientX,
  clientY,
  onCollection,
  onFiles,
  onDismiss,
}: Readonly<{
  clientX: number;
  clientY: number;
  onCollection: () => void;
  onFiles: (files: readonly File[]) => void;
  onDismiss: () => void;
}>) {
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(true, ref, onDismiss);
  // Focus the first choice, same as the button's menu. No trigger to return to
  // — a drag has no focused element to go back to — so the ref is the menu's
  // own, which the cleanup then finds detached and skips.
  useMenuFocus(true, ref, ref);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Add an item here"
      data-add-item-drop-menu
      className={`fixed ${MENU_CLASS}`}
      style={{
        left: `min(${clientX}px, calc(100vw - 15rem))`,
        top: `min(${clientY}px, calc(100vh - 8rem))`,
      }}
    >
      <AddItemChoices
        onCollection={onCollection}
        onFiles={onFiles}
        onDismiss={onDismiss}
      />
    </div>
  );
}

/**
 * The controls-row button: a GRIP and the words.
 *
 * LABELLED, unlike every other control in that row. It first shipped icon-only
 * on the argument that a bare glyph is what the row's language is; the label is
 * a deliberate reversal, and it earns the width — this is the only control in
 * the row that WRITES rather than changing a view, and the only one carrying
 * two different gestures. Being the odd one out is the point: it is the odd one
 * out.
 *
 * The grip is the drag tell, and it is the ONE glyph left. A plus sat beside it
 * for a while and was pure redundancy once the button said "Add item" in words —
 * two symbols for the same verb, with the grip's own meaning competing against
 * it. A control whose second gesture is invisible is a control whose second
 * gesture nobody finds, so the glyph that survives is the one saying something
 * the label cannot; the hint at the foot of the menu is the other half of it.
 *
 * The visible words do NOT replace `aria-label`: the label reads "Add an item
 * to this timeline", which says WHERE, and an accessible name is the one place
 * that context is free.
 */
export function AddItemButton({
  onCollection,
  onFiles,
  open,
  onOpenChange,
}: Readonly<{
  onCollection: () => void;
  onFiles: (files: readonly File[]) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useDismiss(open, wrapRef, () => onOpenChange(false));
  useMenuFocus(open, menuRef, triggerRef);

  const handleDragStart = (event: React.DragEvent) => {
    // A menu open while the drag begins would hang over the board for the
    // whole gesture and then be answered at the wrong place.
    onOpenChange(false);
    event.dataTransfer.setData(TOOL_MIME, ADD_ITEM_TOOL);
    event.dataTransfer.effectAllowed = "copy";
    const img = new window.Image();
    img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    event.dataTransfer.setDragImage(img, 0, 0);

    // The browser shows a "no-drop" cursor wherever a dragover handler doesn't
    // preventDefault — i.e. everywhere except directly over a strip/grid — so
    // the cursor flickers to no-drop as the pointer crosses the gaps between
    // them (and at the very start, up here in the controls row). Claim EVERY
    // dragover at the document level for the drag's lifetime so the cursor
    // stays a valid "copy" throughout; the surfaces still own the drop position
    // and the actual add. A matching document drop swallows a stray drop that
    // misses every surface so the browser takes no default action.
    const onDocDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDocDrop = (e: DragEvent) => {
      e.preventDefault();
    };
    const cleanup = () => {
      document.removeEventListener("dragover", onDocDragOver, true);
      document.removeEventListener("drop", onDocDrop, true);
      document.removeEventListener("dragend", cleanup);
    };
    // Capture before nested surfaces. Chromium can briefly expose an empty
    // `types` list while crossing DOM boundaries, so the drag-lifetime guard
    // must not depend on reading our MIME type back from each event.
    document.addEventListener("dragover", onDocDragOver, true);
    document.addEventListener("drop", onDocDrop, true);
    document.addEventListener("dragend", cleanup, { once: true });
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        draggable
        data-add-item-button
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add an item to this timeline"
        title="Add item — click to add at the end, or drag onto the board to choose a spot"
        onDragStart={handleDragStart}
        onClick={() => onOpenChange(!open)}
        // NO BORDER at rest, matching every toggle beside it — a bordered box
        // would read as a different KIND of control rather than as this row's
        // tool. `cursor-grab` is what says it is also draggable, and the grip
        // glyph is what says it before you hover.
        //
        // `h-8` is load-bearing: the row pins every control to one height, and
        // the last thing to break that was a single stray height on a labelled
        // button. `whitespace-nowrap` so the label cannot wrap and take the
        // row's height with it when the viewport tightens.
        //
        // `gap-2` between the grip and the label, wider than the `gap-1` it
        // started at. The grip is a column of dots roughly 4px wide sitting in
        // a 14px icon box, so the box edge the gap measures from is not where
        // the mark ends — 4px of gap read as almost none, and the label looked
        // stuck to it.
        className="flex h-8 shrink-0 cursor-grab items-center gap-2 rounded-md pr-2 pl-1 text-[11px] font-medium whitespace-nowrap text-zinc-400 transition-colors hover:bg-sky-950/30 hover:text-sky-400 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
      >
        <GripVertical aria-hidden="true" className="size-3.5 shrink-0 opacity-60" />
        Add item
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Add an item to the end"
          data-add-item-menu
          // `right-0`: the button sits at the left of a full-width row, but the
          // menu is wider than it is, so an end-aligned drop is what keeps it
          // from hanging off. `top-full` puts it under the row, over the board.
          className={`absolute top-full left-0 mt-1.5 ${MENU_CLASS}`}
        >
          <AddItemChoices
            onCollection={() => {
              onOpenChange(false);
              onCollection();
            }}
            onFiles={(files) => {
              onOpenChange(false);
              onFiles(files);
            }}
            onDismiss={() => onOpenChange(false)}
            hint={
              // THE DISCOVERABILITY HALF. The grip says "draggable" to someone
              // already looking at the button; this says what dragging it is
              // FOR, to someone who has just opened the menu and is therefore
              // definitely paying attention.
              <p
                data-add-item-drag-hint
                className="mt-1 border-t border-white/10 px-1.5 pt-1.5 text-[10px] leading-snug text-zinc-500"
              >
                Tip: drag this button onto the board to add at a specific spot.
              </p>
            }
          />
        </div>
      ) : null}
    </div>
  );
}

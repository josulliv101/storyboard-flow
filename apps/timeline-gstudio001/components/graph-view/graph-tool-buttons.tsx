"use client";

import { useCallback, useEffect, useRef } from "react";
import { GripVertical } from "lucide-react";

import { MEDIA_TOOL, TOOL_MIME } from "./graph-native-drop-model";

/**
 * The board's two ADD tools: Collection and Media.
 *
 * One shape, two payloads. Each is a grip and a word: CLICK adds at the end,
 * DRAG places at the spot you let go. That symmetry is the point — the two
 * things a timeline can hold are added the same way, and neither is buried
 * behind the other.
 *
 * They replace a single "Add item" control that asked which kind in a menu.
 * The menu was a step that existed only because one button had to serve two
 * jobs; two buttons answer the question by being two buttons, and a drag no
 * longer has to be interpreted before it can be acted on.
 *
 * WHERE THEY DIFFER is unavoidable and worth naming. A collection can be minted
 * from nothing, so its drop commits immediately. Media cannot — there are no
 * files yet — so its drop parks the position and asks for them. See
 * `MediaDropTarget` for how that second half lands.
 */

/** Grip, then the word. Shared so the two cannot drift apart. */
export function ToolButton({
  label,
  payload,
  title,
  testId,
  onActivate,
}: Readonly<{
  label: string;
  /** The `TOOL_MIME` value this drags as. */
  payload: string;
  title: string;
  testId: string;
  onActivate: () => void;
}>) {
  return (
    <button
      type="button"
      draggable
      data-tool-button={testId}
      aria-label={title}
      title={title}
      onDragStart={(event) => beginToolDrag(event, payload)}
      onClick={onActivate}
      // NO BORDER at rest, matching every toggle in this row — a bordered box
      // would read as a different KIND of control rather than as one of the
      // row's tools. `cursor-grab` says it is draggable; the grip says so
      // before you hover.
      //
      // `h-8` is load-bearing: the row pins every control to one height.
      // `whitespace-nowrap` so a label cannot wrap and take the row's height
      // with it when the viewport tightens.
      className="flex h-8 shrink-0 cursor-grab items-center gap-2 rounded-md pr-2 pl-1 text-[11px] font-medium whitespace-nowrap text-zinc-400 transition-colors hover:bg-sky-950/30 hover:text-sky-400 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      <GripVertical aria-hidden="true" className="size-3.5 shrink-0 opacity-60" />
      {label}
    </button>
  );
}

/**
 * Start a native drag carrying `payload` on the tool MIME, and keep the cursor
 * sane for the whole gesture.
 *
 * The awkward half is not the `setData` — it is everything after it, and a
 * second copy is how two draggable controls drift.
 *
 * The drag image is a 1x1 transparent gif: the surfaces draw their own drop
 * indicator, and the browser's default ghost of the button competes with it.
 *
 * The document-level handlers are the cursor fix. A browser shows "no-drop"
 * wherever a dragover handler does not `preventDefault` — i.e. everywhere
 * except directly over a strip or grid — so the cursor flickers to no-drop as
 * the pointer crosses the gaps between them, and at the very start, up in the
 * controls row. Claiming every dragover for the drag's lifetime keeps it a
 * valid "copy" throughout; the surfaces still own the drop position and the
 * actual add. The matching document drop swallows a stray drop that misses
 * every surface, so the browser takes no default action.
 */
export function beginToolDrag(event: React.DragEvent, payload: string): void {
  event.dataTransfer.setData(TOOL_MIME, payload);
  event.dataTransfer.effectAllowed = "copy";
  const img = new window.Image();
  img.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
  event.dataTransfer.setDragImage(img, 0, 0);

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
  // `types` list while crossing DOM boundaries, so the drag-lifetime guard must
  // not depend on reading our MIME type back from each event.
  document.addEventListener("dragover", onDocDragOver, true);
  document.addEventListener("drop", onDocDrop, true);
  document.addEventListener("dragend", cleanup, { once: true });
}

/** The MEDIA tool, as a drag payload the surfaces recognise. */
export const MEDIA_TOOL_PAYLOAD = MEDIA_TOOL;

/**
 * What a dropped MEDIA tool turns into: the file picker, at the parked position.
 *
 * ── The activation problem, and why there are two paths ────────────────────
 *
 * A browser only opens a file picker under TRANSIENT USER ACTIVATION, and
 * `drop` is not on the spec's list of events that grant it. What a drag does
 * have is the `mousedown` that STARTED it, which does grant activation — with a
 * lifetime (about five seconds in Chrome). So a brisk drag still has it at drop
 * time and a slow one does not, which would make the picker open sometimes and
 * silently do nothing other times. That is the worst of all outcomes: it works
 * in every test and fails for whoever hesitates.
 *
 * So: TRY the picker, and when activation has expired, fall back to a prompt at
 * the drop point that costs one click and cannot fail. `navigator.userActivation`
 * is what decides, rather than calling `click()` and hoping — a refused picker
 * is not observable, so there is nothing to catch.
 *
 * This could not be verified end-to-end here: neither Playwright's synthetic
 * mouse nor the browser tooling can drive a NATIVE HTML5 drag, so the trusted
 * path has no automated coverage and the fallback is what makes that acceptable.
 */
export function MediaDropTarget({
  hadUserActivation,
  clientX,
  clientY,
  onFiles,
  onDismiss,
}: Readonly<{
  /** Measured at the DROP, not here — see the field on `PendingMediaDrop`. */
  hadUserActivation: boolean;
  clientX: number;
  clientY: number;
  onFiles: (files: readonly File[]) => void;
  onDismiss: () => void;
}>) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const promptRef = useRef<HTMLButtonElement | null>(null);

  const open = useCallback(() => inputRef.current?.click(), []);

  // Which path this drop takes is decided by a PROP, so there is no state to
  // set and no cascading render: the answer was known at the drop, and by the
  // time this mounts it is history rather than something to go and measure.
  useEffect(() => {
    if (hadUserActivation) open();
    else promptRef.current?.focus();
  }, [hadUserActivation, open]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onDismiss();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // React's `InputHTMLAttributes` has no `onCancel`, so this is bound
    // imperatively. Without it, dismissing the OS picker would leave the parked
    // drop waiting for files that are never coming.
    const onCancel = () => onDismiss();
    input.addEventListener("cancel", onCancel);
    return () => input.removeEventListener("cancel", onCancel);
  }, [onDismiss]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        tabIndex={-1}
        aria-hidden="true"
        data-media-drop-input
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
      {!hadUserActivation ? (
        <button
          ref={promptRef}
          type="button"
          data-media-drop-prompt
          onClick={open}
          // Clamped in CSS rather than by measuring: `min(x, calc(100vw - …))`
          // keeps it on screen without a layout pass or a corrective frame.
          style={{
            left: `min(${clientX}px, calc(100vw - 11rem))`,
            top: `min(${clientY}px, calc(100vh - 4rem))`,
          }}
          className="fixed z-50 flex h-8 items-center gap-2 rounded-md bg-zinc-900 px-2.5 text-[11px] font-medium text-zinc-200 shadow-lg ring-1 ring-white/15 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        >
          Choose files…
        </button>
      ) : null}
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef } from "react";
import { GripVertical, type LucideIcon } from "lucide-react";

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

/**
 * Grip, glyph, then the word. Shared so the two cannot drift apart.
 *
 * THE GLYPH MATCHES THE THING, not the other add affordance. `Layers` is what a
 * collection card draws in the middle of its thumbnail, and `Image` is the clip
 * card's picture glyph — so the tool that makes one looks like what it makes.
 *
 * That is a choice between two defensible consistencies, and worth recording
 * because the other one is also written down: the end-of-row add slot draws
 * `FolderPlus`, and its comment claims that glyph is "the same FolderPlus the
 * controls row uses". These buttons had no glyph at all when they became
 * grip-and-label, so that claim was already stale; matching the CARD keeps it
 * stale on purpose. The pairing that matters more is button-to-object — you
 * look at collection cards constantly and at the add slot rarely.
 *
 * Three elements need the spacing to say what belongs together. The grip is a
 * different KIND of thing from the other two — it is the drag affordance, not
 * part of the name — so it sits tight to the left edge (`pl-1.5`) while a
 * uniform `gap-1.5` keeps glyph and word reading as one label rather than as
 * two more controls. `pr-2.5` against `pl-1.5` is deliberate optical balance:
 * a glyph carries less visual weight than text, so equal padding would look
 * lopsided.
 */
export function ToolButton({
  label,
  payload,
  title,
  testId,
  icon: Icon,
  onActivate,
}: Readonly<{
  label: string;
  /** The `TOOL_MIME` value this drags as. */
  payload: string;
  title: string;
  testId: string;
  /** The kind this tool adds, as a lucide component. */
  icon: LucideIcon;
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
      // A FILL AT REST, which reverses what this used to say.
      //
      // It carried "NO BORDER at rest, matching every toggle in this row — a
      // bordered box would read as a different KIND of control". The intent was
      // right and the result was not: with no fill, three elements and no edge,
      // you cannot see where one button ends and the next begins, and the pair
      // read as loose icons dropped in the row rather than as two things you can
      // pick up.
      //
      // Still not a border — a fill, and NO ring or outline at rest either.
      // These two ARE a different kind of control from the toggles beside them:
      // the toggles change what the board shows, these are things you drag onto
      // it, and being visibly grabbable is the point.
      //
      // `zinc-700/70`, and the number was measured rather than picked. The row's
      // panel is `bg-zinc-900/60` over a near-black page, so the first attempt
      // (`zinc-800/40`) resolved to about SEVEN levels of brightness above its
      // own backdrop — present in the computed style, invisible on screen. A
      // lighter base at a higher alpha lands ~30 levels up, which is what it
      // takes for a fill alone to bound a control on this surface.
      //
      // Hover has to go LIGHTER than that, not darker: `sky-950` was a fine
      // hover against nothing and would read as a press against this fill, so
      // the hover moved up the sky ramp to stay a lift.
      //
      // `h-8` is load-bearing: the row pins every control to one height.
      // `whitespace-nowrap` so a label cannot wrap and take the row's height
      // with it when the viewport tightens.
      className="flex h-8 shrink-0 cursor-grab items-center gap-1.5 rounded-md bg-zinc-700/70 pr-2.5 pl-1.5 text-[11px] font-medium whitespace-nowrap text-zinc-200 transition-colors hover:bg-sky-800/60 hover:text-sky-200 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
    >
      {/* Smaller than the kind glyph beside it, deliberately: the grip is an
          affordance, not information. At the same size the two competed and the
          button read as having two icons. */}
      <GripVertical aria-hidden="true" className="size-3 shrink-0 opacity-60" />
      {/* 3.5 rather than the slot's 4: this sits beside an 11px label and a
          3.5 grip, and a 16px glyph between them reads as the loudest thing in
          a row of quiet controls. */}
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
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
 * So: the prompt is ALWAYS rendered, and the picker is opened on top of it when
 * activation allows. Not one path or the other — both, layered.
 *
 * That is a correction. The first version showed the prompt only when
 * activation had lapsed, and it lost drops: a picker that opens and is then
 * dismissed fires `cancel`, which tore down the pending drop and left nothing
 * behind — no prompt, no trace, the dropped position simply gone. Headless
 * Chromium cancels instantly, which is how it was caught, but a real person
 * closing a picker they opened by accident hits exactly the same path.
 *
 * `cancel` therefore does NOT dismiss. An OS picker closing is ambiguous — "I
 * changed my mind" and "that picker never opened" look identical from here —
 * and the two possible mistakes are not symmetric: leaving the prompt up costs
 * one Escape, while tearing it down costs the drop and offers no way back. So
 * the prompt survives, and only Escape or a click elsewhere dismisses.
 *
 * The trusted path still has no automated coverage — nothing here can drive a
 * NATIVE HTML5 drag — which is the other reason the prompt is unconditional
 * rather than a fallback nobody exercises.
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

  /**
   * Whether the picker has already been opened FOR US, by the effect below.
   *
   * ONE DROP WAS OPENING TWO PICKERS (PL15-019). The effect called `open()`
   * with no guard, and `reactStrictMode` is on — StrictMode deliberately
   * double-invokes mount effects (mount, unmount, remount) to surface effects
   * that are not idempotent, and this was one: `open()` does something TO THE
   * USER rather than setting something up, so running it twice opened the OS
   * file picker twice, one behind the other.
   *
   * A ref rather than state: it must not re-render, and it survives
   * StrictMode's simulated remount for the same reason state does — the
   * component instance is the same one.
   *
   * IT GUARDS THE EFFECT, NOT `open`. The prompt button below calls `open` too,
   * and that call is the user asking again — after cancelling the first picker,
   * most likely. Guarding `open` itself would make "Choose files…" work once
   * and then silently do nothing, which is a worse bug than the one being
   * fixed.
   */
  const autoOpenedRef = useRef(false);

  // Open the picker when the drop still had activation; the prompt is rendered
  // either way, so this is an accelerator rather than a branch. Whether it was
  // possible is a PROP — decided at the drop, when it was true — so there is no
  // state to set here and no cascading render.
  useEffect(() => {
    if (!hadUserActivation) {
      promptRef.current?.focus();
      return;
    }
    if (autoOpenedRef.current) return;
    autoOpenedRef.current = true;
    open();
  }, [hadUserActivation, open]);

  // Dismissal: Escape, or a click anywhere that is not the prompt. Not the
  // picker's `cancel` — see the note above.
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (promptRef.current?.contains(event.target as Node)) return;
      onDismiss();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onDismiss]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onDismiss();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
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
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { flushSync } from "react-dom";
import { Redo2, Undo2, X } from "lucide-react";

import {
  TrimOverviewStrip,
  isEditableKeyboardTarget,
  useCollectionsSelector,
  useCollectionsStore,
  useLiveTrim,
  type VideoMediaNode,
} from "@storyboard/ui/dnd-collections";

import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { useTrimPanel } from "./graph-trim-panel-context";

// The trim MODAL (PL10-008, an experiment replacing the docked map).
//
// The board had too much on it: a strip, a tree, a preview, a ruler, a rail,
// and then a source map wedged under all of it. Rather than find the map a
// better spot, this takes the other road — the selected clip GROWS into a
// modal (CSS view transitions), everything else goes behind a scrim, and the
// clip gets the screen for as long as you are working on it.
//
// The morph is the point of using view transitions rather than a fade: the
// card you clicked becomes the frame you trim, so the modal reads as the same
// object enlarged instead of a dialog that appeared about it.

/** The one name shared by the card and the modal's frame. Only ONE element
 *  may carry it at a time — two would make the browser skip the morph — so it
 *  is handed over inside the transition callback, never held by both. */
const HERO = "trim-subject";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => { finished: Promise<void> };
};

/**
 * Runs `mutate` inside a view transition when the browser has one, and plainly
 * when it doesn't (or when the user asked for less motion). `flushSync` is
 * required, not decorative: the browser captures the "after" state the moment
 * the callback returns, and a normal React update would still be queued.
 */
function withViewTransition(mutate: () => void): Promise<void> {
  const doc = document as ViewTransitionDocument;
  if (!doc.startViewTransition || prefersReducedMotion()) {
    mutate();
    return Promise.resolve();
  }
  return doc.startViewTransition(() => {
    flushSync(mutate);
  }).finished.catch(() => {
    // A transition can be abandoned (another one starts, the tab hides).
    // The DOM change has already happened either way.
  });
}

function cardElement(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(id)}"]`);
}

/** The moving edge's time in SOURCE seconds, or the in-point at rest. */
function previewTime(node: VideoMediaNode, trimIn: number, trimOut: number, side: string | null) {
  return side === "right"
    ? Math.max(0, node.fullDurationSeconds - trimOut)
    : Math.max(0, trimIn);
}

function useSeekedVideo(time: number) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const targetRef = useRef(time);

  useEffect(() => {
    targetRef.current = time;
  }, [time]);

  const attachVideo = useCallback((video: HTMLVideoElement | null) => {
    videoRef.current = video;
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const video = videoRef.current;
      if (
        video &&
        video.readyState >= 1 &&
        !video.seeking &&
        Math.abs(video.currentTime - targetRef.current) > 0.03
      ) {
        try {
          video.currentTime = targetRef.current;
        } catch {
          // metadata raced away; next frame retries
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return attachVideo;
}

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
function useScopedHistory(nodeId: string) {
  const store = useCollectionsStore();
  const canRedo = useCollectionsSelector((s) => s.canRedo);
  const undoableHere = useCollectionsSelector((s) => {
    if (!s.canUndo) return false;
    const last = s.historyEntries[s.historyEntries.length - 1];
    return last?.command.type === "update-media" && last.command.nodeId === nodeId;
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

function ModalBody({ node, onClose }: Readonly<{ node: VideoMediaNode; onClose: () => void }>) {
  const live = useLiveTrim(node.id);
  const history = useScopedHistory(node.id);
  const rename = useInlineRename(node.id, node.name, "trim-modal");
  const trimIn = live ? live.trimInSeconds : node.trimInSeconds;
  const trimOut = live ? live.trimOutSeconds : node.trimOutSeconds;
  const showing = Math.max(0, node.fullDurationSeconds - trimIn - trimOut);
  const rawTime = previewTime(node, trimIn, trimOut, live?.side ?? null);
  const videoRef = useSeekedVideo(Math.round(rawTime * 25) / 25);

  const [stripWidth, setStripWidth] = useState(0);
  const stripSlot = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    setStripWidth(element.getBoundingClientRect().width);
  }, []);

  // Escape closes and F2 renames. Both listen in CAPTURE, which is what makes
  // the editable guard load-bearing rather than defensive: a capture listener
  // on the document runs BEFORE the rename input's own keydown, so without it
  // Escape would close the whole modal instead of cancelling the edit — the
  // input's stopPropagation never gets the chance to speak.
  const beginRename = rename.begin;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableKeyboardTarget(event.target)) return;
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === "F2") {
        event.preventDefault();
        event.stopPropagation();
        beginRename();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, beginRename]);

  return createPortal(
    <div
      data-trim-modal={node.id}
      role="dialog"
      aria-modal="true"
      aria-label={`Trim ${node.name}`}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        // Scrim only: a press that starts on the panel must never close it,
        // including one that ends outside after a trim drag.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="flex w-full max-w-3xl flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-2xl shadow-black/60"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          {/* The clip's name, editable here (PL10-010) — the same hook the
              collection card, breadcrumb and sub-row rename through, so the
              grammar is identical: double-click or F2 to open, Enter commits,
              Escape cancels, blur commits. For MEDIA the name is the stored
              `alt`, which the persistence bridge updates on this patch. */}
          {rename.editing ? (
            <InlineNameEditor
              initialValue={node.name}
              onInput={rename.setDraft}
              onCommit={rename.commit}
              onCancel={rename.cancel}
              ariaLabel="Clip name"
              className="min-w-0 flex-1 rounded-sm bg-zinc-900 px-1 py-0.5 text-sm font-semibold text-zinc-100 outline-none ring-1 ring-amber-400/70"
            />
          ) : (
            <span
              onDoubleClick={rename.begin}
              title="Double-click or press F2 to rename"
              className="min-w-0 flex-1 cursor-text truncate text-sm font-semibold text-zinc-100"
            >
              {node.name}
            </span>
          )}
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] tabular-nums text-zinc-400">
              {showing.toFixed(2)}s of {node.fullDurationSeconds.toFixed(2)}s
            </span>
            {/* Scoped to this clip's own trims — see useScopedHistory. Each
                release is one commit, so these step through the adjustments
                one at a time. */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-trim-modal-undo
                disabled={!history.undoableHere}
                onClick={history.undo}
                aria-label="Undo the last trim"
                title="Undo the last trim on this clip"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
              >
                <Undo2 aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-trim-modal-redo
                disabled={!history.redoableHere}
                onClick={history.redo}
                aria-label="Redo the last trim"
                title="Redo the last trim on this clip"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
              >
                <Redo2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the trim view"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* The hero: this is what the card morphs INTO. */}
        <div
          data-trim-modal-frame
          style={{ viewTransitionName: HERO }}
          className="relative overflow-hidden rounded-md bg-black"
        >
          <video
            ref={videoRef}
            src={node.src}
            poster={node.posterSrcs?.[0]}
            muted
            playsInline
            preload="auto"
            className="max-h-[46vh] w-full bg-black object-contain"
          />
          {live !== null && (
            <span
              data-trim-modal-edge={live.side === "right" ? "right" : "left"}
              className={[
                "absolute inset-y-0 w-1.5 bg-amber-400",
                live.side === "right" ? "right-0" : "left-0",
              ].join(" ")}
            />
          )}
          <span className="absolute right-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-amber-200">
            {rawTime.toFixed(2)}s
          </span>
        </div>

        {/* The whole source, with the showing window and its grips — the trim
            handles, at a width the board could never give them. */}
        <div ref={stripSlot} className="w-full">
          {stripWidth > 0 ? (
            <TrimOverviewStrip
              node={node}
              width={stripWidth}
              trimInSeconds={trimIn}
              trimOutSeconds={trimOut}
            />
          ) : null}
        </div>

        <div className="flex items-center justify-between font-mono text-[10px] text-zinc-500">
          <span className="text-amber-200/90">
            in {trimIn.toFixed(2)}s → out {(trimIn + showing).toFixed(2)}s
          </span>
          <span>drag the amber edges to trim, the film to move the window</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Opens when the toolbar's trim toggle is pinned and a video is selected. The
 * card grows into it and shrinks back out of it; closing goes through the same
 * transition in reverse, which is why the hero name is handed back to the card
 * INSIDE the closing callback rather than after it.
 */
export function GraphTrimModal() {
  const { pinned, setPinned } = useTrimPanel();
  const node = useCollectionsSelector((s) => {
    for (const id of s.interaction.selectedIds) {
      const found = s.graph.nodesById.get(id);
      if (found?.kind === "media" && found.mediaKind === "video") return found;
    }
    return null;
  });
  const [open, setOpen] = useState(false);
  const openIdRef = useRef<string | null>(null);

  // Opening and closing are driven by the pinned flag so the toolbar button,
  // Escape, and the scrim all go through one path.
  useEffect(() => {
    const wanted = pinned && node !== null && !!node.src;
    if (wanted === open) return;

    if (wanted && node) {
      openIdRef.current = node.id;
      const card = cardElement(node.id);
      card?.style.setProperty("view-transition-name", HERO);
      void withViewTransition(() => {
        // Hand the name over: the card gives it up in the same frame the
        // modal takes it, so exactly one element ever carries it.
        card?.style.removeProperty("view-transition-name");
        setOpen(true);
      });
      return;
    }

    const card = openIdRef.current ? cardElement(openIdRef.current) : null;
    void withViewTransition(() => {
      setOpen(false);
      card?.style.setProperty("view-transition-name", HERO);
    }).then(() => {
      card?.style.removeProperty("view-transition-name");
      openIdRef.current = null;
    });
  }, [pinned, node, open]);

  if (!open || node === null || !node.src) return null;
  return <ModalBody node={node} onClose={() => setPinned(false)} />;
}

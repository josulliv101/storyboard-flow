"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { flushSync } from "react-dom";
import { Redo2, Undo2, X } from "lucide-react";

import {
  TrimOverviewStrip,
  isEditableKeyboardTarget,
  mediaDurationSeconds,
  parseNodeId,
  useCollectionsSelector,
  useCollectionsStore,
  useLiveTrim,
  type CollectionItemNode,
  type MediaNode,
  type VideoMediaNode,
} from "@storyboard/ui/dnd-collections";

import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { DETAILS_HERO_FILL_CLASS, DETAILS_PANEL_HEIGHT_CLASS } from "./graph-view-config";
import { useSeekedVideo } from "@/hooks/use-seeked-video";
import { formatSeconds } from "@/lib/format-duration";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { TagEditor } from "./graph-tag-editor";
import { CollectionDetailsBody } from "./graph-collection-details";
import { ItemDisableToggle } from "./graph-item-disable-toggle";
import { useItemDetails } from "./graph-item-details-context";

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
  // Announce the transition on the root, SYNCHRONOUSLY, before it starts.
  // While one runs the browser paints a snapshot over the page and every
  // pointer event lands on <html>, so "is a transition in flight?" is a real
  // question about whether the UI is inert — and polling
  // `getAnimations()` cannot answer it, because the animations only exist
  // after the browser has captured a frame. Anything waiting for the UI to be
  // live again (the e2e does) watches this attribute instead.
  doc.documentElement.dataset.viewTransition = "running";
  return doc
    .startViewTransition(() => {
      flushSync(mutate);
    })
    .finished.catch(() => {
      // A transition can be abandoned (another one starts, the tab hides).
      // The DOM change has already happened either way.
    })
    .finally(() => {
      delete doc.documentElement.dataset.viewTransition;
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
    if (!last) return false;
    // Whatever this ITEM can do to itself: trim (media), rename (either), or
    // a disable toggle. Structural commands name a parent and a set of moved
    // nodes rather than "this item", so they stay out of reach here — which
    // is the point of scoping.
    const command = last.command;
    if (command.type === "update-media" || command.type === "rename-node") {
      return command.nodeId === nodeId;
    }
    if (command.type === "set-node-disabled") {
      return command.nodeIds.length === 1 && command.nodeIds[0] === nodeId;
    }
    return false;
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

/** Two decimals, and never NaN — a half-typed field must not dispatch. */
function parseSeconds(raw: string): number | null {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Typed in/out points for a video (PL11-006).
 *
 * Each field commits on blur or Enter, as ONE `update-media` — the same
 * command the grips dispatch, so this is a second input method for one
 * behaviour rather than a second path into the model. Escape reverts the
 * field to the committed value.
 *
 * Clamping is deliberate rather than validating-and-refusing: an out point
 * before the in point (or past the source) is a typo, and snapping to the
 * nearest legal value is faster to correct than an error message. The 0.05s
 * floor keeps a clip from being trimmed to nothing by a stray keystroke.
 */
function TrimNumbers({
  node,
  trimIn,
  trimOut,
  disabled,
}: Readonly<{ node: VideoMediaNode; trimIn: number; trimOut: number; disabled: boolean }>) {
  const store = useCollectionsStore();
  const full = node.fullDurationSeconds;
  const inPoint = trimIn;
  const outPoint = full - trimOut;

  const commit = (side: "in" | "out", raw: string) => {
    const typed = parseSeconds(raw);
    if (typed === null) return;
    const next =
      side === "in"
        ? {
            trimInSeconds: Math.min(Math.max(0, typed), Math.max(0, outPoint - MIN_SHOWING_SECONDS)),
            trimOutSeconds: trimOut,
          }
        : {
            trimInSeconds: trimIn,
            trimOutSeconds: Math.min(
              Math.max(0, full - typed),
              Math.max(0, full - inPoint - MIN_SHOWING_SECONDS),
            ),
          };
    if (next.trimInSeconds === trimIn && next.trimOutSeconds === trimOut) return;
    store.dispatch({
      type: "update-media",
      nodeId: node.id,
      update: { mediaKind: "video", ...next },
    });
  };

  return (
    <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-400">
      <SecondsField label="in" value={inPoint} disabled={disabled} onCommit={(raw) => commit("in", raw)} />
      <span aria-hidden="true" className="text-zinc-600">
        →
      </span>
      <SecondsField label="out" value={outPoint} disabled={disabled} onCommit={(raw) => commit("out", raw)} />
      <span className="text-zinc-600">of {formatSeconds(full)}</span>
    </div>
  );
}

/** The smallest clip a typed edge may leave behind. */
const MIN_SHOWING_SECONDS = 0.05;

function SecondsField({
  label,
  value,
  disabled,
  onCommit,
}: Readonly<{
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (raw: string) => void;
}>) {
  // Uncontrolled between commits, keyed by the committed value: a controlled
  // input would fight the caret while typing "1" on the way to "12.5", and
  // the key makes it re-seed whenever the value changes underneath (a grip
  // drag, an undo).
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-zinc-500">{label}</span>
      <input
        key={value}
        type="text"
        inputMode="decimal"
        aria-label={`${label} point, seconds`}
        data-trim-field={label}
        defaultValue={value.toFixed(2)}
        disabled={disabled}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            onCommit((event.target as HTMLInputElement).value);
            (event.target as HTMLInputElement).blur();
          } else if (event.key === "Escape") {
            (event.target as HTMLInputElement).value = value.toFixed(2);
            (event.target as HTMLInputElement).blur();
          }
        }}
        onBlur={(event) => onCommit(event.target.value)}
        className="w-16 rounded-sm bg-zinc-900 px-1.5 py-0.5 text-right tabular-nums text-blue-300/90 outline-none ring-1 ring-zinc-700 focus:ring-blue-500/70 disabled:opacity-40"
      />
      <span className="text-zinc-600">s</span>
    </label>
  );
}

/**
 * The collection half of the view. Split into its own module because the
 * two bodies share only their frame — the header, the hero and the facts
 * below it answer different questions for a timeline than for a clip.
 */
function CollectionDetails({
  node,
  onClose,
}: Readonly<{ node: CollectionItemNode; onClose: () => void }>) {
  const history = useScopedHistory(node.id);
  return (
    <CollectionDetailsBody node={node} hero={HERO} history={history} onClose={onClose} />
  );
}

function ModalBody({ node, onClose }: Readonly<{ node: MediaNode; onClose: () => void }>) {
  const live = useLiveTrim(node.id);
  const history = useScopedHistory(node.id);
  const rename = useInlineRename(node.id, node.name, "item-details");
  // A still has no source window to map, so the trim half of this view is
  // video-only; everything else (name, duration, history, and whatever else
  // an item grows later) applies to both.
  const video = node.mediaKind === "video" ? node : null;
  const trimIn = live ? live.trimInSeconds : (video?.trimInSeconds ?? 0);
  const trimOut = live ? live.trimOutSeconds : (video?.trimOutSeconds ?? 0);
  const fullDuration = video ? video.fullDurationSeconds : mediaDurationSeconds(node);
  const showing = Math.max(0, fullDuration - trimIn - trimOut);
  const rawTime = video ? previewTime(video, trimIn, trimOut, live?.side ?? null) : 0;
  // Gated on `video`: an image has no source window and no element to seek, so
  // the settle loop had nothing to do but spin for as long as the modal stayed
  // open.
  const videoRef = useSeekedVideo(Math.round(rawTime * 25) / 25, video !== null);

  const [stripWidth, setStripWidth] = useState(0);
  const stripSlot = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    setStripWidth(element.getBoundingClientRect().width);
  }, []);

  // `aria-modal="true"` above is a promise about the rest of the page; this is
  // what keeps it. Focus moves in, Tab cycles here, the board goes inert, and
  // the card this was opened from gets focus back on close.
  const { dialogProps } = useDialogFocus<HTMLDivElement>();

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
      data-item-details={node.id}
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${node.name}`}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        // Scrim only: a press that starts on the panel must never close it,
        // including one that ends outside after a trim drag.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        {...dialogProps}
        className={`flex w-full max-w-3xl flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-2xl shadow-black/60 focus-visible:outline-none ${DETAILS_PANEL_HEIGHT_CLASS}`}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          {/* The clip's name, editable here (PL10-010) — the same hook the
              collection card, breadcrumb and sub-row rename through. Enter
              commits, Escape cancels, blur commits. For MEDIA the name is the
              stored `alt`, which the persistence bridge updates on this patch.

              Opens on a SINGLE click (PL14-010), adopting the breadcrumb
              crumb's treatment wholesale: a real button wearing `cursor-text`
              and a hover tint, labelled `Rename …`. A double click with no
              hover feedback is undiscoverable — nothing on screen said the
              title was a field.

              Why single click is available HERE and not on the cards: click
              already means select on a card, so rename has to be the double
              click there (and PL13-001 was rejected partly for adding a second
              affordance around that conflict). Neither the current crumb nor
              this title has a competing click meaning, so the cheaper gesture
              is free. The card and sub-row keep their double click.

              A <button> rather than the old <span> also puts rename in the tab
              order, which is how it becomes reachable without the F2 shortcut
              (still handled in capture above, and still the only route while
              the dialog's focus sits elsewhere). */}
          {rename.editing ? (
            <InlineNameEditor
              initialValue={node.name}
              onInput={rename.setDraft}
              onCommit={rename.commit}
              onCancel={rename.cancel}
              ariaLabel="Clip name"
              className="min-w-0 flex-1 rounded-sm bg-zinc-900 px-1 py-0.5 text-sm font-semibold text-zinc-100 outline-none ring-1 ring-blue-500/70"
            />
          ) : (
            <button
              type="button"
              onClick={rename.begin}
              aria-label={`Rename ${node.name}`}
              title={`Rename ${node.name}`}
              className={[
                "min-w-0 flex-1 cursor-text truncate rounded-md px-1.5 py-1 text-left",
                "text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-800/70",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70",
              ].join(" ")}
            >
              {node.name}
            </button>
          )}
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] tabular-nums text-zinc-400">
              {video ? `${formatSeconds(showing)} of ${formatSeconds(fullDuration)}` : formatSeconds(showing)}
            </span>
            <ItemDisableToggle nodeId={node.id as string} />
            {/* Scoped to this clip's own trims — see useScopedHistory. Each
                release is one commit, so these step through the adjustments
                one at a time. */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                data-item-details-undo
                disabled={!history.undoableHere}
                onClick={history.undo}
                aria-label="Undo the last change"
                title="Undo the last change to this item"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
              >
                <Undo2 aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                data-item-details-redo
                disabled={!history.redoableHere}
                onClick={history.redo}
                aria-label="Redo the last change"
                title="Redo the last change to this item"
                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:pointer-events-none disabled:opacity-30"
              >
                <Redo2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the details view"
              className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* The hero: this is what the card morphs INTO. */}
        <div
          data-item-details-frame
          style={{ viewTransitionName: HERO }}
          className={`relative overflow-hidden rounded-md bg-black ${DETAILS_HERO_FILL_CLASS}`}
        >
          {video ? (
            <video
              ref={videoRef}
              src={video.src}
              poster={video.posterSrcs?.[0]}
              muted
              playsInline
              preload="auto"
              className="h-full w-full bg-black object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={node.src}
              alt={node.name}
              className="h-full w-full bg-black object-contain"
            />
          )}
          {live !== null && (
            <span
              data-item-details-edge={live.side === "right" ? "right" : "left"}
              className={[
                "absolute inset-y-0 w-1.5 bg-blue-500",
                live.side === "right" ? "right-0" : "left-0",
              ].join(" ")}
            />
          )}
          {video && (
            <span className="absolute right-2 bottom-2 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-blue-300">
              {formatSeconds(rawTime)}
            </span>
          )}
        </div>

        {/* The whole source, with the showing window and its grips — the trim
            handles, at a width the board could never give them. */}
        {video ? (
          <>
            <div ref={stripSlot} className="w-full">
              {stripWidth > 0 ? (
                <TrimOverviewStrip
                  node={video}
                  width={stripWidth}
                  trimInSeconds={trimIn}
                  trimOutSeconds={trimOut}
                />
              ) : null}
            </div>

            {/* TYPED in/out (PL11-006). Dragging resolves to whatever a pixel
                is worth — ~0.11s here, and coarser on the board — so an exact
                edge was simply unreachable by pointer. These are the same
                `update-media` command the grips dispatch, so undo, the live
                channel and the write path all behave identically. */}
            <TrimNumbers
              node={video}
              trimIn={trimIn}
              trimOut={trimOut}
              disabled={live !== null}
            />
            <div className="text-right font-mono text-[11px] text-zinc-500">
              drag the amber edges to trim, the film to move the window
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between font-mono text-[11px] text-zinc-500">
            <span className="text-blue-300/90">still · {formatSeconds(showing)} on screen</span>
            <span>drag the card&apos;s edge on the strip to change how long it holds</span>
          </div>
        )}

        {/* Tags. Here rather than on the card because the card's content
            renders inside a <button>, where these remove buttons and the text
            field would be invalid HTML — the card shows them, this edits them.

            No undo: a tag change writes the detail side-table directly and
            emits no patch, so `useScopedHistory` above never sees it. See
            graph-tag-editor.tsx for why that is the deliberate trade. */}
        <div className="flex flex-col gap-1.5 border-t border-white/10 pt-3">
          <span className="font-mono text-[11px] tracking-[0.08em] text-zinc-500 uppercase">
            Tags
          </span>
          <TagEditor nodeId={node.id} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Opens when the toolbar's details toggle is on and a media item is selected.
 * The card grows into it and shrinks back out of it; closing goes through the
 * same transition in reverse, which is why the hero name is handed back to the
 * card INSIDE the closing callback rather than after it.
 */
export function GraphItemDetailsModal() {
  const { openId, setOpenId } = useItemDetails();
  // The item the TRIGGER named (PL11-002), not whatever happens to be
  // selected: the trigger lives on a card, and a card can be pressed without
  // being the selection. Any media item qualifies — a video gets the frame and
  // the source strip, a still gets its image and its duration (PL10-012).
  // The id currently ON SCREEN, which is deliberately not the same thing as
  // the id the context wants open — and that difference is the entire closing
  // animation (PL14-004).
  //
  // This used to be a boolean `mounted`, with the node read from `openId`
  // alone. Closing sets `openId` to null, so `node` went null on the very next
  // render and the guard below unmounted the modal THERE — one render before
  // the effect could start a transition. The transition then ran against a
  // page the modal had already left: it started, it resolved, the card took
  // the hero name, and every one of those was observable while the user saw a
  // hard cut, because the "before" frame no longer had a modal in it.
  //
  // Keeping the id here means the modal survives the close render and is still
  // on screen when the browser captures "before". The transition callback is
  // what clears it, which is exactly when it should go.
  const [mountedId, setMountedId] = useState<string | null>(null);
  const mounted = mountedId !== null;
  const node = useCollectionsSelector((s) => {
    // `openId` while opening and open; `mountedId` while closing, when the
    // context has already let go but the pixels are still here.
    const id = openId ?? mountedId;
    if (id === null) return null;
    return s.graph.nodesById.get(parseNodeId(id)) ?? null;
  });
  const openIdRef = useRef<string | null>(null);

  // Opening and closing are driven by the context flag so the toolbar button,
  // Escape, the close button and the scrim all go through one path.
  useEffect(() => {
    // A collection has no `src` and needs none — its hero is its contents.
    const wanted =
      openId !== null && node !== null && (node.kind === "collection" || !!node.src);
    if (wanted === mounted) return;

    if (wanted && node) {
      openIdRef.current = node.id;
      const card = cardElement(node.id);
      card?.style.setProperty("view-transition-name", HERO);
      void withViewTransition(() => {
        // Hand the name over: the card gives it up in the same frame the
        // modal takes it, so exactly one element ever carries it.
        card?.style.removeProperty("view-transition-name");
        setMountedId(node.id as string);
      });
      return;
    }

    const card = openIdRef.current ? cardElement(openIdRef.current) : null;
    void withViewTransition(() => {
      // Clearing this is what unmounts the modal, and it happens HERE — inside
      // the callback, after the browser has captured the frame the modal is
      // still in. That ordering is the animation.
      setMountedId(null);
      card?.style.setProperty("view-transition-name", HERO);
    }).then(() => {
      card?.style.removeProperty("view-transition-name");
      openIdRef.current = null;
    });
  }, [openId, node, mounted]);

  if (!mounted || node === null) return null;
  if (node.kind === "collection") {
    return <CollectionDetails node={node} onClose={() => setOpenId(null)} />;
  }
  if (!node.src) return null;
  return <ModalBody node={node} onClose={() => setOpenId(null)} />;
}

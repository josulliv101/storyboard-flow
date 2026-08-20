"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Redo2, Undo2, X } from "lucide-react";

import {
  TrimOverviewStrip,
  hasSourceWindow,
  isEditableKeyboardTarget,
  mediaDurationSeconds,
  parseNodeId,
  useCollectionsSelector,
  useCollectionsStore,
  useLiveTrim,
  type AudioMediaNode,
  type CollectionItemNode,
  type MediaNode,
  type VideoMediaNode,
} from "@storyboard/ui/dnd-collections";

import { useDialogFocus } from "@/hooks/use-dialog-focus";
import { DETAILS_HERO_FILL_CLASS, DETAILS_PANEL_HEIGHT_CLASS } from "./graph-view-config";
import { useSeekedVideo } from "@/hooks/use-seeked-video";
import { formatSeconds } from "@/lib/format-duration";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { useClipDetail } from "./graph-details-context";
import { LayerFramePicker } from "./graph-layer-frame-picker";
import { TagEditor } from "./graph-tag-editor";
import { CollectionDetailsBody } from "./graph-collection-details";
import { ItemDisableToggle } from "./graph-item-disable-toggle";
import { useItemDetails } from "./graph-item-details-context";
import { withViewTransition } from "@/lib/view-transition";
import { detailsNeighbours, flatOrderRootId } from "./graph-details-neighbours";

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

// `withViewTransition` moved to lib/view-transition.ts when the trash drawer
// became a second caller. It is the same function: the root flag it sets is
// what the e2e's `settleViewTransition` waits on, and two copies would be two
// chances to forget it.

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
}: Readonly<{
  /** Any WINDOWED node. The overview strip above this is video-only because it
   *  paints frames; these are numbers, and a source window is a source window
   *  whether or not it has a picture. */
  node: VideoMediaNode | AudioMediaNode;
  trimIn: number;
  trimOut: number;
  disabled: boolean;
}>) {
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
      update: { mediaKind: node.mediaKind, ...next },
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

/**
 * ONE panel — the whole details view for one clip.
 *
 * Rendered three times side by side (see `ModalBody`): the clip you opened in
 * the middle and its playback neighbours either side, each a complete copy of
 * this rather than a thumbnail of it. Everything per-clip lives here, which is
 * what lets the flanking copies be the same component instead of a second,
 * drifting rendition of the same chrome.
 */
function DetailsPanel({
  node,
  centre,
  onClose,
  onOpenNeighbour,
}: Readonly<{
  node: MediaNode;
  /**
   * Whether this is the panel the modal was OPENED on.
   *
   * It does NOT mean "the working one" — all three panels work, which is the
   * point of them being copies rather than previews. It marks the two things
   * that are singular no matter how many panels there are: the focus wiring,
   * and the `view-transition-name` the card morphs into. A neighbour carrying
   * either would steal the keyboard, or land the open animation on the wrong
   * picture.
   */
  centre: boolean;
  onClose: () => void;
  /** Re-centre on a flanking clip. Not `setOpenId` directly: the modal also
   *  tracks which id is MOUNTED, and letting those two drift is what hands the
   *  hero back to the wrong card when the modal finally closes. */
  onOpenNeighbour: (id: string) => void;
}>) {
  const live = useLiveTrim(node.id);
  // For the inset picker: the clip's shape decides the inset's height, and
  // therefore which preset a stored rectangle came from.
  const detail = useClipDetail(node.id as string);
  const history = useScopedHistory(node.id);
  const rename = useInlineRename(node.id, node.name, "item-details");
  // A still has no source window to map, so the trim half of this view belongs
  // to WINDOWED media — video and audio both. `video` stays a separate,
  // narrower question because the filmstrip and the frame readout need actual
  // frames; the numbers do not.
  const windowed = hasSourceWindow(node) ? node : null;
  const video = node.mediaKind === "video" ? node : null;
  const trimIn = live ? live.trimInSeconds : (windowed?.trimInSeconds ?? 0);
  const trimOut = live ? live.trimOutSeconds : (windowed?.trimOutSeconds ?? 0);
  const fullDuration = windowed ? windowed.fullDurationSeconds : mediaDurationSeconds(node);
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

  return (
      <div
        // FOCUS WIRING ON THE CENTRE ONLY. Every panel is fully live — the
        // grips trim, the title renames, the video seeks — but "which dialog
        // has the keyboard" is singular by definition, so the roving focus,
        // the Escape handling and the initial focus target stay with the clip
        // that was opened. The neighbours are working panels, not focus traps.
        {...(centre ? dialogProps : {})}
        data-item-details-panel={centre ? "centre" : "neighbour"}
        className={`flex w-full max-w-3xl shrink-0 flex-col gap-3 rounded-lg border border-zinc-700 bg-zinc-950 p-4 shadow-2xl shadow-black/60 focus-visible:outline-none ${DETAILS_PANEL_HEIGHT_CLASS}`}
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
          style={centre ? { viewTransitionName: HERO } : undefined}
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
        {windowed ? (
          <>
            {/* FRAMES, so video only — an audio clip has a source window but
                nothing to paint in it. Its numbers below are the same. */}
            {video && (
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
            )}

            {/* TYPED in/out (PL11-006). Dragging resolves to whatever a pixel
                is worth — ~0.11s here, and coarser on the board — so an exact
                edge was simply unreachable by pointer. These are the same
                `update-media` command the grips dispatch, so undo, the live
                channel and the write path all behave identically. */}
            <TrimNumbers
              node={windowed}
              trimIn={trimIn}
              trimOut={trimOut}
              disabled={live !== null}
            />
            {/* Audio moved into this WINDOWED branch when its trim shipped,
                which took away the "sound · …" line the still branch gave it —
                so a voiceover stopped saying it was one. It says so here, and
                still leads with its length, because "what is this and how long
                is it" is the question this row answers. */}
            <div className="flex items-center justify-between font-mono text-[11px] text-zinc-500">
              <span className="text-blue-300/90">
                {video ? "" : `sound · ${formatSeconds(showing)} long`}
              </span>
              <span>
                {video
                  ? "drag the amber edges to trim, the film to move the window"
                  : "drag the card's edges on the strip, or type an exact in and out"}
              </span>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between font-mono text-[11px] text-zinc-500">
            {/* This branch is everything that is NOT video, which is images
                AND audio — so it cannot say "still" for both. A voiceover is
                not a still, and calling it one is the kind of wrong label
                nobody reports and everybody notices. */}
            <span className="text-blue-300/90">
              {node.mediaKind === "audio"
                ? `sound · ${formatSeconds(showing)} long`
                : `still · ${formatSeconds(showing)} on screen`}
            </span>
            <span>drag the card&apos;s edge on the strip to change how long it holds</span>
          </div>
        )}

        {/* WHERE IT DRAWS, for a clip that is under the picture. Only shown
            when it is actually on a lane and actually has a picture: the
            control describes a rectangle inside the frame, and neither the
            picture itself nor a voiceover has one.

            The first FORM control for a placement field — lane and placed
            start are drag-only. It exists because the write path stamps a
            default corner when a clip lands on a lane, and a default nobody
            can move is worse than no default at all. Dispatches
            `set-node-placement`, so unlike the tag editor below it IS
            undoable. */}
        {(node.trackIndex ?? 0) > 0 && node.mediaKind !== "audio" && (
          <div className="flex flex-col gap-1.5 border-t border-white/10 pt-3">
            <LayerFramePicker node={node} aspect={detail?.aspect} disabled={live !== null} />
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
  );
}

/**
 * Opens when the toolbar's details toggle is on and a media item is selected.
 * The card grows into it and shrinks back out of it; closing goes through the
 * same transition in reverse, which is why the hero name is handed back to the
 * card INSIDE the closing callback rather than after it.
 */
/**
 * THE FILM STRIP: three whole panels side by side, not one panel with three
 * pictures in it.
 *
 * The clip you opened is centred and the clips that PLAY either side of it get
 * a complete copy of the same view — same header, same hero, same grips, same
 * tags — laid out left and right with a gap between, running off the edges of
 * the screen. Which is the shape of a strip: the frames do not shrink to fit,
 * the film simply continues past what you can see.
 *
 * THEY ALL WORK. A neighbour is not a preview of a panel, it IS a panel: its
 * grips trim, its title renames, its video seeks. That is why they are the same
 * component rather than a lighter twin — a second rendition of this chrome
 * would drift from it, and the first thing to drift is always the part nobody
 * looks at twice.
 *
 * ONE SCRIM, THREE PANELS. The dialog, the backdrop and the
 * click-outside-to-close belong to the view, not to each copy; three scrims
 * would mean three backdrops stacked and three things listening for the same
 * click.
 */
function DetailsFilmstripModal({
  node,
  onClose,
  onOpenNeighbour,
}: Readonly<{
  node: MediaNode;
  onClose: () => void;
  onOpenNeighbour: (id: string) => void;
}>) {
  const graph = useCollectionsSelector((state) => state.graph);
  const { previous, next } = useMemo(() => {
    const { previousId, nextId } = detailsNeighbours(
      graph,
      flatOrderRootId(graph),
      node.id as string,
    );
    const mediaAt = (id: string | null): MediaNode | null => {
      if (id === null) return null;
      const found = graph.nodesById.get(parseNodeId(id));
      return found && found.kind === "media" && found.src ? (found as MediaNode) : null;
    };
    return { previous: mediaAt(previousId), next: mediaAt(nextId) };
  }, [graph, node.id]);

  const panelFor = (neighbour: MediaNode | null) =>
    neighbour === null ? null : (
      <DetailsPanel
        key={neighbour.id as string}
        node={neighbour}
        centre={false}
        onClose={onClose}
        onOpenNeighbour={onOpenNeighbour}
      />
    );

  return createPortal(
    <div
      data-item-details={node.id}
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${node.name}`}
      // `justify-center` centres the MIDDLE panel rather than the row: three
      // panels overflow, so the centre lands in the middle and the other two
      // are clipped symmetrically. `overflow-hidden` is what makes that a crop
      // instead of a scrollbar.
      className="fixed inset-0 z-[80] flex items-center justify-center gap-4 overflow-hidden bg-black/80 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        // Scrim only: a press that starts on a panel must never close it,
        // including one that ends outside after a trim drag.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {panelFor(previous)}
      <DetailsPanel
        node={node}
        centre
        onClose={onClose}
        onOpenNeighbour={onOpenNeighbour}
      />
      {panelFor(next)}
    </div>,
    document.body,
  );
}

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
  return (
    <DetailsFilmstripModal
      node={node}
      onClose={() => setOpenId(null)}
      onOpenNeighbour={(id) => {
        // BOTH, in one go. `openId` is what the modal renders; `mountedId` is
        // what it hands the hero name back to when it closes. The open/close
        // effect only fires when those two disagree about whether anything is
        // open at all, so swapping between two clips never runs a transition —
        // it is a plain re-render, which is exactly the slide this wants. But
        // leaving `mountedId` on the clip you arrived from means the closing
        // animation morphs into THAT card rather than the one on screen.
        setMountedId(id);
        setOpenId(id);
      }}
    />
  );
}

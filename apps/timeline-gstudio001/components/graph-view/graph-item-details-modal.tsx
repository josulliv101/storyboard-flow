"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Redo2, Undo2, X } from "lucide-react";

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
import { useFrameCrossfade } from "@/hooks/use-frame-crossfade";
import { formatSeconds } from "@/lib/format-duration";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { useClipDetail } from "./graph-details-context";
import { LayerFramePicker } from "./graph-layer-frame-picker";
import { TagEditor } from "./graph-tag-editor";
import { CollectionDetailsBody } from "./graph-collection-details";
import { ItemDisableToggle } from "./graph-item-disable-toggle";
import { useItemDetails } from "./graph-item-details-context";
import { withViewTransition } from "@/lib/view-transition";
import { detailsWindow, flatOrderRootId } from "./graph-details-neighbours";
import { SeamBar, useSeamTransport } from "./graph-seam-bar";
import { buildSeamTimeline, seamAt, seamStripProgress, type SeamClip } from "./graph-seam-scrub";
import { swipeIntent, swipeOffset } from "./graph-strip-swipe";

/** How much of each neighbour the bar reaches into. Long enough to hear a cut
 *  land, short enough that the centre clip keeps most of the bar's scale. */
const SEAM_LEAD_SECONDS = 2;

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
 * How wide one panel is, and therefore how far the strip travels per click.
 *
 * A CSS VARIABLE rather than a measured pixel count, because the step and the
 * width have to be the same number and measuring invites them to disagree by a
 * subpixel that accumulates over a few clicks. The row's transform is written
 * in `calc()` against these, so the panel width IS the step by construction.
 */
const PANEL_GAP = "1rem";

/**
 * How many clips the strip shows at once, centre included.
 *
 * ODD ONLY, and not as a style choice: the strip exists to put ONE clip in the
 * middle with the same amount of timeline either side of it. An even count has
 * no middle, so the clip being worked on would sit off to one side and the two
 * seams around it would be at different distances from the eye.
 */
const VIEW_COUNTS = [3, 5, 9] as const;
type ViewCount = (typeof VIEW_COUNTS)[number];

/**
 * The last count chosen, kept at module scope.
 *
 * Deliberately NOT persisted to storage: it is a working posture for a
 * session, not a preference, and a board reopened tomorrow should start at the
 * close reading rather than at whatever the last question happened to need.
 */
let rememberedViewCount: ViewCount = 3;

/**
 * A panel's width for a given count, chosen so that exactly `count` panels are
 * ON SCREEN with the middle one centred.
 *
 * THE TWO OUTER PANELS ARE HALF VISIBLE, which is both what makes the
 * arithmetic close and what makes the count mean what it says: `count - 2`
 * panels sit fully in view, the two at the edges show half of themselves, and
 * the widths add up to exactly one viewport.
 *
 *   (count - 2) x W  +  2 x W/2  =  (count - 1) x W  =  viewport - padding - gaps
 *
 * The first attempt scaled the width BY the count — three-fifths for five, a
 * fifth for fifteen — which made the panels narrower without making more of
 * them fit, so five showed the same three it always had. Fitting N panels is a
 * different question from making N panels thinner, and only one of them is
 * what "show five" means.
 *
 * The 48rem cap survives so a very wide monitor does not hand the middle panel
 * half a metre of screen; below that the count drives the layout.
 *
 * The trade at the top end is worth stating: nine panels on a 1600px screen is
 * about 185px each — narrow, but still a picture you can read a cut from and
 * controls you can hit. Fifteen was tried first and came out at 95px, which is
 * a column rather than a panel; nine is where reach across the timeline and a
 * usable panel still overlap.
 */
function panelWidthFor(count: ViewCount): string {
  // 3rem is the modal's own padding (p-6 either side); the gaps are one rem
  // apiece, and there are `count - 1` of them between `count` panels.
  return `min(48rem, (100vw - 3rem - ${count - 1}rem) / ${count - 1})`;
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
  monitor,
  playhead,
  playing = false,
  live: onScreen = false,
  swipe,
  seamLabel = null,
  width,
  dimmed = false,
  restingFrame,
  onClose,
  onAdvance,
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
  /**
   * What the CENTRE panel's picture should be showing, when the seam clock is
   * driving it: a clip and a time inside it. Null means "show your own clip",
   * which is every panel that is not the centre and the centre itself before
   * anything has been scrubbed.
   *
   * THE CENTRE IS A MONITOR, not a window onto its own clip. Playing across a
   * cut means the frame changes clip halfway through, and it has to change in
   * ONE place or there is nothing to watch — an eye that has to move from panel
   * to panel at the moment of the cut is an eye that misses the cut.
   */
  monitor: Readonly<{ node: MediaNode; seconds: number }> | null;
  /**
   * How far through this clip's own trimmed range the playhead is, 0-1, or null
   * when the playhead is not inside this clip at all. Drawn as a line on the
   * trim strip below.
   */
  playhead: number | null;
  /**
   * Whether the transport is running. Only the monitoring panel is ever told
   * yes: two elements playing the same seconds is two soundtracks, and the
   * neighbours are showing stills of a moment, not playing one.
   */
  playing?: boolean;
  /**
   * Whether THIS clip is the one currently on screen — the clip the playhead
   * is inside, which during a run-up or a run-out is a neighbour rather than
   * the centre. Distinct from `playing`, which says who is making the sound.
   */
  live?: boolean;
  /**
   * Pointer handlers for dragging the whole strip, spread onto the PICTURE.
   *
   * The picture and nothing else: every other large surface in a panel is
   * already a gesture. The filmstrip drags the source window, the grips trim,
   * the bar scrubs, the title is a text field — a swipe layered over any of
   * them would be two meanings competing for one drag, and the loser would be
   * whichever the user actually meant. The picture is the one big area with
   * only a tap on it, which is why the tap is already "bring this one to the
   * middle"; the swipe is the same instruction, held.
   */
  swipe?: React.ComponentProps<"div">;
  /**
   * Which end of this clip is on show, labelled above the panel — set only on
   * the two flanking it.
   *
   * The centre gets none: it is not resting on an end, it is the clip being
   * worked on, and a label there would be answering a question nobody asked
   * about it. The neighbours are exactly one frame each, and WHICH frame is
   * the entire reason they are on screen.
   */
  seamLabel?: { text: string; side: "left" | "right" } | null;
  /** Set by the strip, which owns how many panels are on screen. */
  width: string;
  /**
   * Pull this panel's picture back, because the clock is running and it is not
   * the one being watched.
   *
   * Only ever set on the NEIGHBOURS. Once playback is engaged the middle
   * picture is the monitor — it is showing whatever is on screen at that
   * instant, including a neighbour's frames — so two bright pictures either
   * side of it are competing with the one thing the view is for. Dimming them
   * is not decoration: it is the difference between watching a cut and reading
   * three stills at once.
   */
  dimmed?: boolean;
  /**
   * Which end of this clip its picture rests on when nothing is playing.
   *
   * THE CLIP BEFORE THE CUT SHOWS ITS LAST FRAME, not its first. Those two
   * frames — the last of the outgoing clip and the first of the incoming one —
   * are the cut. A panel resting on its own first frame shows the moment its
   * shot BEGAN, which for the clip on the left is several seconds before
   * anything being judged here, and puts a picture next to the seam that has
   * nothing to do with it.
   *
   * The clip after the cut keeps its first frame for the same reason: that IS
   * its edge of the seam. So the two frames either side of the centre panel are
   * the two frames either side of a cut, which is the comparison the whole
   * layout exists to make.
   */
  restingFrame: "first" | "last";
  onClose: () => void;
  /** Pull the strip one position, so this clip becomes the centre. */
  onAdvance: (id: string) => void;
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
  // WHAT THIS PANEL IS PAINTING. Normally its own clip; while the seam clock
  // is running, the centre panel paints whatever that clock says is on screen,
  // which may belong to a neighbour.
  const shown = monitor ? monitor.node : node;
  const shownVideo = shown.mediaKind === "video" ? shown : null;
  const shownAudio = shown.mediaKind === "audio" ? shown : null;
  // Sound belongs to the panel that is MONITORING, and only while the clock
  // runs. A resting neighbour is a still frame; a paused monitor is too.
  const audible = playing;
  const rawTime = monitor
    ? // The clock's time is measured inside the clip's SHOWING range, and a
      // video element seeks in SOURCE time — so the trim-in has to be added
      // back or every frame is early by however much was trimmed off the head.
      (hasSourceWindow(shown) ? shown.trimInSeconds : 0) + monitor.seconds
    : video
      ? restingFrame === "last"
        ? // ONE FRAME BACK from the trim-out, not the trim-out itself: a video
          // element seeked exactly to its end has no frame to show and paints
          // black, which would read as a missing clip rather than as the last
          // thing before the cut.
          Math.max(trimIn, trimIn + showing - 1 / 25)
        : previewTime(video, trimIn, trimOut, live?.side ?? null)
      : 0;
  // Gated on `video`: an image has no source window and no element to seek, so
  // the settle loop had nothing to do but spin for as long as the modal stayed
  // open.
  const videoRef = useSeekedVideo(
    Math.round(rawTime * 25) / 25,
    shownVideo !== null || shownAudio !== null,
    audible,
  );
  // A panel crossing the centre swaps which end of its clip it rests on, and
  // the two frames are seconds of story apart — cut between them and the eye
  // takes it as a glitch rather than as the same shot from its other end.
  // Keyed on the resting end alone: every other seek here is a scrub or a
  // playhead, where a cut IS the answer and a fade would be a smear.
  const { videoRef: crossfadeVideoRef, canvasRef } = useFrameCrossfade(restingFrame);

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
        style={{ width }}
        data-item-details-live={onScreen ? "" : undefined}
        // WHICH CLIP IS ON SCREEN, marked on the whole panel. The monitor is
        // always the middle picture, so during a run-up the frames on show
        // belong to a clip whose own panel is off to one side — and nothing
        // said which. A ring in the playhead's own red ties the two together:
        // the line moving through a strip and the ring around that strip are
        // one statement about where playback is.
        //
        // Only ever drawn while the clock is engaged. A ring sitting on the
        // centre panel of a modal nobody has touched would read as a selection
        // rather than as a position.
        className={[
          "relative flex shrink-0 flex-col gap-3 rounded-lg bg-zinc-950 p-4 focus-visible:outline-none",
          "transition-[box-shadow,border-color] duration-150",
          // THE OPENED CLIP WEARS A WHITE BORDER, twice the weight of a
          // neighbour's. Two different questions get two different marks here
          // and they are often true at once: WHICH CLIP DID I OPEN is the
          // white border, and WHOSE FRAMES ARE ON SCREEN is the red ring
          // below. The centre is usually both, so they have to be legible
          // together rather than one overwriting the other — hence a border
          // for one and a ring for the other, the ring sitting outside the
          // border where it cannot hide it.
          //
          // Thicker on the border-box, so it eats padding rather than growing
          // the panel: the row's geometry is what the slide animates against,
          // and a centre panel two pixels wider than its neighbours would put
          // every landing off by one.
          centre ? "border-2 border-white/90" : "border border-zinc-700",
          // ONE shadow utility per state, both spelled out. Layering a glow on
          // top of `shadow-2xl` would mean two classes setting `box-shadow`,
          // and which one wins is a question about stylesheet order rather
          // than about the order they appear in this string — so the drop
          // shadow is written into both branches and the glow is simply a
          // second layer of the live one.
          onScreen
            ? "ring-2 ring-red-500/70 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6),0_0_0_1px_rgba(239,68,68,0.7),0_0_44px_10px_rgba(239,68,68,0.45)]"
            : "shadow-[0_25px_50px_-12px_rgba(0,0,0,0.6)]",
          DETAILS_PANEL_HEIGHT_CLASS,
        ].join(" ")}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {seamLabel === null ? null : (
          <span
            data-item-details-seam-label
            aria-hidden="true"
            // HUGGING THE SEAM. The clip before the cut carries its label on
            // its RIGHT and the clip after carries its on the LEFT, so both
            // sit against the join they describe rather than at the far
            // outside edges of the strip — where they would read as titles for
            // the panels instead of as facts about the cut between them.
            //
            // Above the card, not inside it: the panel's own top row is the
            // clip's name and its controls, and this is neither. Decorative
            // for AT — the centre panel's dialog label already says what is
            // open, and a neighbour resting on a frame is a visual aid.
            className={[
              "pointer-events-none absolute -top-6 font-mono text-[10px] tracking-wide text-zinc-500 uppercase",
              seamLabel.side === "right" ? "right-1" : "left-1",
            ].join(" ")}
          >
            {seamLabel.text}
          </span>
        )}
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

        {/* The hero: this is what the card morphs INTO — and, on a neighbour,
            the thing you click to pull the strip along by one.

            THE PICTURE IS THE TARGET, deliberately. Every panel is fully live
            now, so a click anywhere else has a job already: the grips trim, the
            title renames, the tag field types. The picture is the one large
            surface in a neighbour with nothing else to do, which is what makes
            it safe to spend on advancing.

            `HERO` stays on the opened panel only: it is the card's morph
            target, and the slide below is a plain transform rather than a view
            transition, so the two never contend for the same element. */}
        <div
          data-item-details-frame
          {...swipe}
          style={{
            ...(centre ? { viewTransitionName: HERO } : {}),
            // `pan-y`, not `none`: the browser keeps vertical panning (so a
            // page or panel that scrolls still can) while horizontal drags
            // reach us as pointer events instead of being eaten as a scroll.
            // Without this a swipe on a touchscreen is silently the browser's.
            touchAction: "pan-y",
          }}
          onClick={centre ? undefined : () => onAdvance(node.id as string)}
          className={[
            "relative overflow-hidden rounded-md bg-black",
            DETAILS_HERO_FILL_CLASS,
            centre ? "" : "cursor-pointer",
            // FADED, AND THE COLOUR GOES WITH IT. Opacity alone still leaves a
            // recognisable picture competing for the eye; draining the colour
            // as well puts the neighbours firmly in the past tense while the
            // monitor keeps its own. Both transition, so engaging the clock
            // reads as attention moving rather than as two panels blinking.
            "transition-[opacity,filter] duration-300 ease-out motion-reduce:transition-none",
            dimmed ? "opacity-25 grayscale" : "opacity-100 grayscale-0",
          ].join(" ")}
        >
          {shownVideo ? (
            <video
              // KEYED BY SOURCE. Swapping `src` on one element at a cut leaves
              // the outgoing frame on screen until the incoming file has
              // decoded — the cut would land late, and late is the one thing
              // this view exists to measure. A key gives each clip its own
              // element, so the change is a swap rather than a reload.
              key={shownVideo.src}
              ref={(element) => {
                videoRef(element);
                crossfadeVideoRef.current = element;
              }}
              src={shownVideo.src}
              poster={shownVideo.posterSrcs?.[0]}
              // UNMUTED WHILE PLAYING. Judging a cut is not only a picture
              // problem — a line landing across the join, or music that
              // stops dead on it, is the thing being looked for as often as
              // the frame is.
              muted={!audible}
              playsInline
              preload="auto"
              className="h-full w-full bg-black object-contain"
            />
          ) : shownAudio ? (
            // AUDIO HAS NO PICTURE, and pointing an <img> at a .wav paints a
            // broken-image icon — which is what this did, because the flat
            // order contains every media node and a bed is one of them. It
            // gets a card that says what it is, and an element that can
            // actually play it.
            <div className="flex h-full w-full items-center justify-center bg-black text-zinc-400">
              {/* NO LABEL. The panel's title is this clip's name, directly
                  above, and the row beneath already says "sound · 8.0s" — a
                  third copy in the middle of the card says nothing new and
                  makes the name ambiguous to anything looking for it. */}
              <AudioLines aria-hidden="true" className="h-8 w-8 text-blue-300/80" />
              <audio
                key={shownAudio.src}
                ref={videoRef}
                src={shownAudio.src}
                muted={!audible}
                preload="auto"
                className="sr-only"
              />
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={shown.src}
              alt={shown.name}
              // NOT DRAGGABLE, which is what made the swipe work on video
              // panels and not on stills. An `<img>` is draggable by DEFAULT
              // and a `<video>` is not, so on a still the browser took the
              // gesture as a native image drag the moment the pointer moved:
              // it swallowed the rest of the sequence, no pointermove ever
              // arrived, and the strip sat there. The gesture was never
              // reaching the code that decides whether it is a swipe.
              //
              // `select-none` for the same reason at the other end — a drag
              // across a picture that starts selecting whatever is behind it
              // reads as the page misbehaving even when the swipe does work.
              draggable={false}
              className="h-full w-full bg-black object-contain select-none"
            />
          )}
          {/* THE OUTGOING FRAME, held over the picture while the incoming one
              seeks, then faded out. Sized and fitted exactly like the video
              under it so the two are the same picture in the same place —
              anything else and the fade doubles as a nudge. Starts and ends at
              zero opacity: it is only ever visible for the length of a swap. */}
          {shownVideo && (
            <canvas
              ref={canvasRef}
              aria-hidden="true"
              style={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
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
                  <div className="relative">
                    <TrimOverviewStrip
                      node={video}
                      width={stripWidth}
                      trimInSeconds={trimIn}
                      trimOutSeconds={trimOut}
                    />
                    {/* WHERE PLAY IS, in this clip. Absent — not parked at an
                        edge — when the playhead is in another clip: a line at
                        0% reads as "playing here, from the very start", which
                        is a different and wrong claim from "not playing here".
                        Its position is measured against the whole trimmed
                        clip, so the run-up into the previous clip puts the
                        line near this strip's right-hand END. */}
                    {playhead !== null && (
                      <span
                        data-seam-playhead-line
                        aria-hidden="true"
                        style={{ left: `${playhead * 100}%` }}
                        className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-red-500"
                      />
                    )}
                  </div>
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

  // EVERY CLIP GETS A POSITION IN THE ROW. Only three can be seen, but the row
  // is one element translated by the subject's index — so advancing moves the
  // whole thing by one step and every panel travels the same distance because
  // they are all inside the thing that moved.
  const { ids, centre } = useMemo(
    () => detailsWindow(graph, flatOrderRootId(graph), node.id as string),
    [graph, node.id],
  );

  // OFFSET FROM THE ROW'S MIDDLE, because the scrim centres the row and not its
  // first panel. With every clip holding a position, the row's own middle is
  // clip (N-1)/2 — so a fifty-clip timeline would sit on clip twenty-five with
  // no transform at all. What has to be corrected is the distance from there to
  // the subject, and advancing changes it by exactly one step, which is the
  // single value the transition animates.
  // ── THE SEAM CLOCK ────────────────────────────────────────────────────────
  // One number for the whole view: where playback is, in bar seconds. The
  // monitor frame, the three playhead lines and the bar all read it, so they
  // cannot disagree about "now" — which is the whole point of there being one.
  // NULL UNTIL SOMETHING MOVES IT, and the distinction is not pedantic: zero is
  // a real position on this bar and it is the start of the RUN-UP, which means
  // the previous clip. Initialising to zero made a freshly opened modal monitor
  // its neighbour before anyone had touched anything — the middle picture
  // showing the wrong clip, or nothing at all while a source it had never
  // needed loaded. Null says "not scrubbed", which is a different state from
  // "scrubbed to the beginning" and the one an untouched view is in.
  const [barSeconds, setBarSeconds] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // HOW MANY CLIPS ARE ON SCREEN. Remembered for the session rather than the
  // page: it is a way of working — reading one cut closely, or scanning a
  // sequence — and having it snap back to three every time you open a clip
  // would make the wider views something you re-choose rather than something
  // you use.
  const [viewCount, setViewCount] = useState<ViewCount>(rememberedViewCount);

  const clipAt = useCallback(
    (index: number): MediaNode | null => {
      const id = ids[index];
      if (id === undefined) return null;
      const found = graph.nodesById.get(parseNodeId(id));
      return found && found.kind === "media" && (found as MediaNode).src
        ? (found as MediaNode)
        : null;
    },
    [ids, graph],
  );

  // A clip as the seam clock sees it: what PLAYS, and separately what the trim
  // strip DRAWS. `mediaDurationSeconds` is already the trimmed length, so the
  // bar only ever reaches trimmed material — but the strip renders the whole
  // source with that part marked on it, so the playhead needs the source
  // length and the trim-in as well to land inside the marked window.
  const seamClipOf = (media: MediaNode | null): SeamClip | null => {
    if (media === null) return null;
    const windowed = hasSourceWindow(media) ? media : null;
    return {
      id: media.id as string,
      showingSeconds: mediaDurationSeconds(media),
      trimInSeconds: windowed ? windowed.trimInSeconds : 0,
      fullSeconds: windowed ? windowed.fullDurationSeconds : mediaDurationSeconds(media),
    };
  };

  // WHAT IS ON SCREEN, AND HOW MUCH OF IT IS WHOLE.
  //
  // The two outermost panels are the half-visible ones, so they are the two
  // that get a lead rather than their full length; everything between them is
  // fully in view and therefore fully scrubbable. At three panels that is one
  // whole clip between two leads — exactly what this always did — and the same
  // rule gives seven at nine.
  const half = Math.floor(viewCount / 2);
  const wholeClips = useMemo(() => {
    const clips: MediaNode[] = [];
    for (let index = centre - half + 1; index <= centre + half - 1; index += 1) {
      const found = clipAt(index);
      if (found !== null) clips.push(found);
    }
    return clips;
  }, [clipAt, centre, half]);
  const edgeBefore = clipAt(centre - half);
  const edgeAfter = clipAt(centre + half);
  const centreClip = clipAt(centre);
  // Where the subject sits among the whole clips — the bar rests there.
  const subjectIndex = wholeClips.findIndex(
    (clip) => centreClip !== null && clip.id === centreClip.id,
  );

  const timeline = useMemo(
    () =>
      buildSeamTimeline(
        seamClipOf(edgeBefore),
        wholeClips.map((clip) => seamClipOf(clip)!).filter(Boolean),
        seamClipOf(edgeAfter),
        SEAM_LEAD_SECONDS,
        Math.max(0, subjectIndex),
      ),
    [edgeBefore, edgeAfter, wholeClips, subjectIndex],
  );

  // ADVANCING RESETS THE CLOCK TO THIS CLIP'S START, because the bar is rebuilt
  // around a different cut — the old seconds would name a moment in a run of
  // time that no longer exists.
  //
  // ADJUSTED DURING RENDER rather than in an effect, which is React's own
  // answer for "this state derives from a prop that changed". An effect would
  // paint one frame with the new bar and the old playhead first — a visible
  // flash of the wrong position at exactly the moment the strip moves — and
  // then re-render to correct it. Setting state during render of the SAME
  // component is not a side effect: React discards the in-progress render and
  // starts again before anything reaches the screen.
  const [clockFor, setClockFor] = useState(node.id as string);
  if (clockFor !== (node.id as string)) {
    setClockFor(node.id as string);
    setPlaying(false);
    setBarSeconds(null);
  }

  // Where the BAR draws its playhead when nothing has moved it: the cut at the
  // head of the centre clip, which is the moment this view is about.
  const shownSeconds = barSeconds ?? timeline.centreStart;
  const scrubbed = barSeconds !== null;

  useSeamTransport({
    playing,
    totalSeconds: timeline.totalSeconds,
    seconds: shownSeconds,
    onTick: setBarSeconds,
    onEnded: () => setPlaying(false),
  });

  // Where the clock says the picture is — only once the clock has been moved.
  // Until then every panel rests on its own frame, which is what makes opening
  // the view show the cut rather than a playback state nobody asked for.
  const position = scrubbed ? seamAt(timeline, shownSeconds) : null;
  // ANY clip the bar covers, not just the three it used to. With nine panels
  // the playhead can be inside a clip four along, and the monitor still has to
  // be able to paint it.
  const monitorNode =
    position === null
      ? null
      : [edgeBefore, ...wholeClips, edgeAfter].find(
          (candidate) => candidate !== null && (candidate.id as string) === position.clipId,
        ) ?? null;

  const panelWidth = panelWidthFor(viewCount);

  // ONE PANEL FURTHER THAN CAN BE SEEN, on each side.
  //
  // Mounting only what is visible would mean the arriving panel is CREATED at
  // the moment the strip starts moving — a video element and a trim strip being
  // built while the row animates, which lands as a blank frame sliding in and
  // filling itself. The spare pair keeps the next one either way already
  // rendered and waiting off screen, so a click moves a panel that already
  // exists and the only work is one new panel at the far edge, out of sight and
  // with a whole slide's worth of time to do it.
  //
  // It stops there rather than growing: beyond this the panels are neither seen
  // nor about to be, and a full panel is a video element, a trim strip and a
  // tag editor. Everything else in the row is an empty box of the right width,
  // which is all the row needs from it — the geometry that keeps the step
  // honest.
  const MOUNTED_RADIUS = Math.floor(viewCount / 2) + 1;

  const chooseViewCount = useCallback((next: ViewCount) => {
    rememberedViewCount = next;
    setViewCount(next);
  }, []);
  const offset = centre < 0 ? 0 : centre - (ids.length - 1) / 2;

  // SWIPING THE STRIP. The same instruction as clicking a neighbour, held:
  // drag the film and it follows the hand, let go past a threshold and it
  // lands on the next clip. Pointer events rather than touch events, so one
  // implementation serves a finger, a trackpad and a mouse — the gesture is
  // the same shape on all three and only ever felt on the first.
  const hasPrevious = centre > 0;
  const hasNext = centre >= 0 && centre < ids.length - 1;
  const [dragPx, setDragPx] = useState(0);
  // Not state: this changes on nearly every pointer move and only the ROW's
  // transform cares. A re-render per move to store a start coordinate would
  // re-render three live panels — video elements included — sixty times a
  // second for the duration of a swipe.
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    at: number;
    width: number;
    committed: boolean;
  } | null>(null);
  // Set once a drag has been recognised, and read by the click guard below.
  const swipedRef = useRef(false);

  const swipe = useMemo<React.ComponentProps<"div">>(
    () => ({
      onPointerDown: (event) => {
        if (!event.isPrimary || event.button !== 0) return;
        swipedRef.current = false;
        dragRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          at: performance.now(),
          // The picture's own width stands in for the panel's, so the
          // distance rule scales with the layout without measuring anything
          // else.
          width: event.currentTarget.getBoundingClientRect().width,
          committed: false,
        };
      },
      onPointerMove: (event) => {
        const drag = dragRef.current;
        if (drag === null || event.pointerId !== drag.pointerId) return;
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (!drag.committed) {
          // NOT A SWIPE UNTIL IT IS MOSTLY SIDEWAYS AND HAS TRAVELLED. Taking
          // the gesture on the first pixel would steal every tap that wobbles
          // and every vertical scroll that starts on a picture.
          if (Math.abs(dx) < 8 || Math.abs(dx) <= Math.abs(dy)) return;
          drag.committed = true;
          swipedRef.current = true;
          try {
            event.currentTarget.setPointerCapture(drag.pointerId);
          } catch {
            /* untrusted pointer — moves over the picture still arrive */
          }
        }
        setDragPx(swipeOffset(dx, hasPrevious, hasNext));
      },
      onPointerUp: (event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        setDragPx(0);
        if (drag === null || event.pointerId !== drag.pointerId || !drag.committed) return;
        const intent = swipeIntent({
          dx: event.clientX - drag.x,
          dy: event.clientY - drag.y,
          elapsedMs: performance.now() - drag.at,
          panelWidth: drag.width,
          hasPrevious,
          hasNext,
        });
        if (intent === "next") onOpenNeighbour(ids[centre + 1]!);
        else if (intent === "previous") onOpenNeighbour(ids[centre - 1]!);
      },
      onPointerCancel: () => {
        dragRef.current = null;
        setDragPx(0);
      },
      // A SWIPE MUST NOT ALSO COUNT AS A TAP. The picture's click brings a
      // neighbour to the middle, and a swipe that ended on a neighbour would
      // otherwise advance twice — once for the gesture, once for the click
      // the browser sends afterwards. Capture, so it is stopped before the
      // element's own handler sees it.
      onClickCapture: (event) => {
        if (!swipedRef.current) return;
        swipedRef.current = false;
        event.stopPropagation();
        event.preventDefault();
      },
    }),
    [centre, hasNext, hasPrevious, ids, onOpenNeighbour],
  );

  const rowTransform =
    `translateX(calc(-1 * ${offset} * (${panelWidth} + ${PANEL_GAP}) + ${dragPx}px))`;

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
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-hidden bg-black/80 p-6 backdrop-blur-sm"
      onPointerDown={(event) => {
        // Scrim only: a press that starts on a panel must never close it,
        // including one that ends outside after a trim drag.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {/* THE BAR, above everything and spanning it: the cut's clock. Outside
          the strip because it must not travel with it — the row slides, and a
          bar that slid with it would be measuring from a moving origin. */}
      {timeline.totalSeconds > 0 && (
        <div
          className="pointer-events-auto absolute inset-x-0 top-0 z-10 px-6 pt-4"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="mx-auto w-full max-w-5xl">
            <SeamBar
              timeline={timeline}
              seconds={shownSeconds}
              playing={playing}
              onScrub={(next) => {
                setPlaying(false);
                setBarSeconds(next);
              }}
              onTogglePlay={() => setPlaying((was) => !was)}
            />
          </div>
        </div>
      )}

      {/* HOW MANY CLIPS TO SHOW, bottom right and out of the way.
          Deliberately down here rather than up with the transport: that bar is
          about the cut you are looking at, and this is about how much of the
          timeline is on screen — a question you answer once and then work,
          not a control you reach for while judging a seam. */}
      <div
        data-details-view-count
        role="group"
        aria-label="Clips on screen"
        className="pointer-events-auto absolute right-6 bottom-6 z-10 flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-950/90 p-1 backdrop-blur-sm"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {VIEW_COUNTS.map((count) => (
          <button
            key={count}
            type="button"
            aria-pressed={count === viewCount}
            onClick={() => chooseViewCount(count)}
            title={`Show ${count} clips`}
            className={[
              "min-w-8 rounded px-2 py-1 font-mono text-[11px] tabular-nums transition-colors",
              count === viewCount
                ? "bg-zinc-100 text-zinc-900"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
            ].join(" ")}
          >
            {count}
          </button>
        ))}
      </div>

      {/* The STRIP: one row, translated. Centred by the scrim, then offset by
          the subject's index so the clip being worked on lands mid-screen. */}
      <div
        data-details-strip
        className={[
          "flex items-center",
          // NO TRANSITION WHILE A FINGER IS ON IT. A drag has to track the
          // hand exactly; easing it would put the film a fixed distance
          // behind wherever the pointer actually is, which reads as lag
          // rather than as smoothing. It comes back for the release, so
          // landing on the next clip is animated and letting go short of the
          // threshold springs back.
          dragPx === 0
            ? "transition-transform duration-300 ease-out motion-reduce:transition-none"
            : "",
        ].join(" ")}
        style={{
          gap: PANEL_GAP,
          transform: rowTransform,
        }}
      >
        {ids.map((id, index) => {
          const mounted = Math.abs(index - centre) <= MOUNTED_RADIUS;
          const panel = mounted ? graph.nodesById.get(parseNodeId(id)) : null;
          const media =
            panel && panel.kind === "media" && (panel as MediaNode).src
              ? (panel as MediaNode)
              : null;
          if (media === null) {
            // A placeholder holds the position — and only the position.
            return (
              <div key={id} aria-hidden="true" style={{ width: panelWidth }} className="shrink-0" />
            );
          }
          return (
            <DetailsPanel
              key={id}
              node={media}
              centre={index === centre}
              monitor={
                index === centre && monitorNode && position
                  ? { node: monitorNode, seconds: position.clipSeconds }
                  : null
              }
              restingFrame={index < centre ? "last" : "first"}
              // Only the monitor makes sound: it is the panel showing what the
              // clock says is on screen, so it is the only one whose audio
              // could be in sync with anything.
              playing={index === centre && playing}
              live={position?.clipId === id}
              swipe={swipe}
              width={panelWidth}
              // Engaged, and not the one being watched. Uses the same gate as
              // the playhead lines and the ring, so the whole view agrees on
              // when the clock is running.
              dimmed={scrubbed && index !== centre}
              seamLabel={
                index === centre - 1
                  ? { text: "Last frame", side: "right" }
                  : index === centre + 1
                    ? { text: "First frame", side: "left" }
                    : null
              }
              playhead={
                scrubbed ? seamStripProgress(timeline, seamClipOf(media)!, shownSeconds) : null
              }
              onClose={onClose}
              onAdvance={onOpenNeighbour}
            />
          );
        })}
      </div>
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

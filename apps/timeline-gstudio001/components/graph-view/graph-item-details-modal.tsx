"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AudioLines, Pause, Play, SkipBack, SkipForward, Redo2, Undo2, X } from "lucide-react";

import { createPortal } from "react-dom";

import { MediaPreviewSurface } from "./media-preview-surface";
import { useDetailsPreviewMode } from "./details-preview-mode";

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
import {
  DETAILS_HERO_FILL_CLASS,
  DETAILS_PANEL_HEIGHT_CLASS,
  DETAILS_ROW_FLOOR_CLASS,
} from "./graph-view-config";
import { useSeekedVideo } from "@/hooks/use-seeked-video";
import { cloudinaryScrubProxySrc } from "@/lib/cloudinary-scrub-proxy";
import { useFrameCrossfade } from "@/hooks/use-frame-crossfade";
import { formatSeconds } from "@/lib/format-duration";
import { InlineNameEditor, useInlineRename } from "./graph-inline-rename";
import { useClipDetail } from "./graph-details-context";
import { LayerFramePicker } from "./graph-layer-frame-picker";
import { TagEditor } from "./graph-tag-editor";
import { CollectionDetailsBody } from "./graph-collection-details";
import { ItemDisableToggle } from "./graph-item-disable-toggle";
import { useItemDetails } from "./graph-item-details-context";
import { DETAILS_STEP_MS, detailsStepTransition } from "./graph-details-motion";
import { SegmentedControl } from "./graph-details-segmented";
import { withViewTransition } from "@/lib/view-transition";
import { detailsWindow, flatOrderRootId } from "./graph-details-neighbours";
import { useSeamTransport } from "./graph-seam-bar";
import type { SeamBarClip } from "./graph-seam-bar-layout";
import { CLIP_DECK_STRIP_CELLS, ClipDeck } from "./playbar/clip-deck";
import { monitorPosterUrl, videoFrameUrls } from "@/lib/video-frame-url";

import { FilmStrip, type FilmStripSkimPreview } from "./playbar/film-strip";
import {
  usePublishTrimPreview,
  useTrimPreview,
  type TrimPreviewFrame,
} from "./graph-trim-preview";
import { type FilmStripShot } from "./playbar/film-strip-data";
import {
  buildSeamTimeline,
  seamAt,
  seamSecondsAt,
  type SeamPosition,
  seamSpanFor,
  seamStripProgress,
  type SeamClip,
} from "./graph-seam-scrub";
import { swipeIntent, swipeOffset } from "./graph-strip-swipe";
import { DetailsPanel } from "./graph-item-details-panel";
import { ItemDetailsHeader } from "./graph-item-details-header";
import {
  HERO,
  HERO_ATTRIBUTE,
  PANEL_GAP,
  heroElement,
  parkBoardScroll,
  restoreBoardScroll,
} from "./graph-item-details-shared";
import { useScopedHistory } from "./graph-item-details-history";
import { TrimNumbers } from "./graph-item-details-trim-fields";
import {
  VIEW_COUNTS,
  lastViewCount,
  DETAILS_BASIS_VAR,
  panelWidthsFor,
  rememberViewCount,
  type ViewCount,
} from "./graph-item-details-view-count";
import {
  PLAYBAR_THUMBNAIL_STYLES,
  PlaybarThumbnailsProvider,
  lastPlaybarThumbnails,
  rememberPlaybarThumbnails,
  type PlaybarThumbnails,
} from "./graph-playbar-thumbnails";
import {
  PREVIEW_ANCHORS,
  lastPreviewAnchor,
  rememberPreviewAnchor,
  type PreviewAnchor,
} from "./graph-seam-preview-anchor";
import {
  LANE_SIZES,
  laneHeightFor,
  lastLaneSize,
  rememberLaneSize,
  type LaneSize,
} from "./graph-seam-lane-size";
import {
  BAR_REACHES,
  barReachLabel,
  barReachWindow,
  lastBarReach,
  rememberBarReach,
  type BarReach,
} from "./graph-item-details-bar-reach";

/** The row's edges fade rather than cutting a card in half — see the note on
 *  the view's own element. */
/** Breathing room below the view, so the deck's cards do not sit on the edge. */
/**
 * How far either side of the subject a card gets a real strip of frames.
 *
 * Every cell is a Cloudinary frame grab — one request each — and the deck holds
 * every clip in the collection, so sampling all of them would be sixteen
 * requests times sixty-odd clips for a view that draws five cards. PL15-028 is
 * open on exactly that kind of spike. Cards outside this radius get the single
 * frame they had before; they are past the fade and nobody is reading them.
 */
const DECK_STRIP_RADIUS = 3;

const DETAILS_BOTTOM_GAP_PX = 12;
/**
 * A floor on the bound height, so a freak measurement cannot collapse the view
 * to nothing. Not a "give up" threshold: the view ALWAYS bounds itself to the
 * window, and when the window cannot hold everything the deck is what gets
 * cropped, with the scroll inside this view.
 *
 * Letting it fall back to normal flow was tried and is worse. With the preview
 * pane open the ancestors constrain the column anyway, so "flowing" produced a
 * view that scrolled internally AND had thrown its concessions away — a strip
 * back at its full 150 and cards at their 300 floor, which is the space being
 * spent in exactly the wrong order.
 */
const DETAILS_MIN_FIT_PX = 360;

/** The transport's skip buttons: quiet until reached for, and visibly dead at
 *  the ends of the sequence rather than silently doing nothing. */
const TRANSPORT_BUTTON_CLASS =
  "flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 transition-colors " +
  "hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-1 " +
  "focus-visible:ring-sky-400/60 disabled:pointer-events-none disabled:opacity-30";

/** Play is the one control here anyone reaches for without looking, so it is
 *  the only one that carries a filled surface. */
const TRANSPORT_PLAY_CLASS =
  "flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-zinc-100 " +
  "transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-1 " +
  "focus-visible:ring-sky-400/60 data-[playing]:bg-sky-500/20 data-[playing]:text-sky-300";

/* ── CONCEDE ONLY WHEN CONCEDING WINS ────────────────────────────────────
   Something has to give in a window that cannot hold everything, and the
   order is: the column's SPACING first, because it costs no content; then the
   STRIP, because a shot box still reads as a shot box shorter. The deck is
   told nothing — it fits its own cards to the height it ends up with.

   BUT ONLY IF THE SHORTFALL IS COVERABLE. These two together can find 70px.
   Past that the column cannot be made to fit however much is given up, and
   spending the strip's height on a view that still scrolls buys a shorter
   film and nothing else — the same trade the deck's cards were making when
   they shrank to their floor AND stayed cut off. Measured with the pane open
   at a 910-tall window, the shortfall is 159: far out of reach, so nothing
   concedes and the strip stays at its full 150.

   The shortfall is MEASURED off the live column rather than derived from a
   comfort constant. The old `889` was a number fitted to one layout, and the
   bar's rows have already changed twice under it. ────────────────────────── */
const STRIP_FULL_HEIGHT_PX = 150;
// 104 rather than 120 because 120 left a 1503x800 window 15px short — close
// enough that the last of it should come from the strip, which is next in the
// order anyway, rather than from shaving unrelated constants until it fits. A
// shot box is still legibly a shot box here; below about 100 it stops being.
const STRIP_FLOOR_HEIGHT_PX = 104;
/** The column's own spacing concedes before either component does — it is the
 *  only give that costs no content at all. `gap-6` restated here because it is
 *  now written from JS and two sources for one number is how they drift. */
const DETAILS_GAP_PX = 24;
const DETAILS_GAP_FLOOR_PX = 12;

const DECK_EDGE_FADE =
  "linear-gradient(90deg, transparent 0, #000 5%, #000 95%, transparent 100%)";

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

// `withViewTransition` moved to lib/view-transition.ts when the trash drawer
// became a second caller. It is the same function: the root flag it sets is
// what the e2e's `settleViewTransition` waits on, and two copies would be two
// chances to forget it.


/** The moving edge's time in SOURCE seconds, or the in-point at rest. */




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

/**
 * How many clips the strip shows at once, centre included.
 *
 * ODD ONLY, and not as a style choice: the strip exists to put ONE clip in the
 * middle with the same amount of timeline either side of it. An even count has
 * no middle, so the clip being worked on would sit off to one side and the two
 * seams around it would be at different distances from the eye.
 */
/**
 * How wide the monitor should be while someone is scrubbing.
 *
 * Enough to judge a cut on, which is the whole reason for dragging the bar,
 * and short of "fills the screen" — the neighbours either side are still the
 * context that makes the frame mean something.
 */
/** Beyond this a magnified panel is soft rather than large: everything in it
 *  is scaled type and scaled borders. */



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
  /**
   * COVER MODE: the view paints OVER the pane instead of replacing it
   * (PL16-005).
   *
   * MEASURED, never a constant. The overlay starts exactly where the sticky
   * header ends, and the header's height is the consumer's business —
   * `workbench-display-surface` says so itself and measures it for the same
   * reason. `[data-testid="workbench-header-region"]` is that element; the
   * split pane's own root gives the column's left edge and width, so the
   * overlay lands on the content area rather than on the window.
   *
   * `fixed` rather than `absolute`: the split pane is a grid of sticky rows,
   * and an absolutely-positioned child would scroll away with the board
   * underneath. What is wanted is the view sitting still over everything below
   * the trail — which is what the header itself already does, one band up.
   */
  const coverMode = useDetailsPreviewMode() === "cover";
  const [coverBox, setCoverBox] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  useLayoutEffect(() => {
    // NOTHING TO CLEAR on the way out: the mode is a URL parameter and does not
    // change within a visit, so `coverBox` is simply never set in the default
    // mode. Resetting it here would also be a synchronous setState in an
    // effect, which the lint rejects as a cascading render — correctly.
    if (!coverMode) return;
    const header = document.querySelector<HTMLElement>(
      '[data-testid="workbench-header-region"]',
    );
    const pane = document.querySelector<HTMLElement>('[data-testid="workbench-split-pane"]');
    if (pane === null) return;
    const measure = () => {
      const paneRect = pane.getBoundingClientRect();
      const top = header === null ? paneRect.top : header.getBoundingClientRect().bottom;
      // Written only when it actually moves: this runs from observers watching
      // the same elements it measures, and an unconditional setState is a loop.
      setCoverBox((current) =>
        current !== null &&
        Math.round(current.top) === Math.round(top) &&
        Math.round(current.left) === Math.round(paneRect.left) &&
        Math.round(current.width) === Math.round(paneRect.width)
          ? current
          : { top, left: paneRect.left, width: paneRect.width },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (header !== null) observer.observe(header);
    observer.observe(pane);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
    };
  }, [coverMode]);

  const graph = useCollectionsSelector((state) => state.graph);
  // The one mutation the deck makes — a trim — goes through the same command
  // path the trim fields used, so it is undoable like every other edit here.
  const store = useCollectionsStore();

  // EVERY CLIP GETS A POSITION IN THE ROW. Only three can be seen, but the row
  // is one element translated by the subject's index — so advancing moves the
  // whole thing by one step and every panel travels the same distance because
  // they are all inside the thing that moved.
  const { ids, centre } = useMemo(
    () => detailsWindow(graph, flatOrderRootId(graph), node.id as string),
    [graph, node.id],
  );

  // THE NAME OF THE PLACE, for the header's second line. The row walks one
  // flat order and that order belongs to a collection, so "Van Interior" is
  // the answer to "where am I" that the cropped row itself cannot give.
  // WHERE THIS CLIP LIVES, which is not the same question as how far the row
  // reaches. The row walks the whole project in playback order and crosses
  // collection edges on purpose, so "of 56" would be true and useless — it
  // tells you nothing about the sequence you are actually working on. The
  // clip's own collection and its place inside it is the orientation the
  // cropped row cannot give: this is the fifth of the thirteen shots in Van
  // Interior, whatever the row happens to be able to reach.
  const place = useMemo(() => {
    const subject = parseNodeId(node.id as string);
    const parentId = graph.parentById.get(subject) ?? null;
    if (parentId === null) return { name: null, index: 0, total: 0, clipIds: [] as string[] };
    const parent = graph.nodesById.get(parentId);
    const siblings = (graph.childrenById.get(parentId) ?? []).filter((id) => {
      const child = graph.nodesById.get(id);
      return child !== undefined && child.kind === "media";
    });
    return {
      name: parent?.name ?? null,
      index: siblings.indexOf(subject) + 1,
      total: siblings.length,
      clipIds: siblings.map((id) => id as string),
    };
  }, [graph, node.id]);

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
  // THE ONE SECOND THAT SURVIVES AN ADVANCE, and only the advance it caused.
  //
  // Letting go of the bar re-centres the row on whatever the playhead landed
  // on, and the frame you released on is the whole point of having gone there
  // — so it has to arrive with you rather than being reset to the new clip's
  // head. A ref rather than state because nothing renders from it: it is set
  // on the way out of one subject and read once on the way into the next, and
  // a re-render in between would be a render nobody needs.
  // CARRIED AS A POSITION, NOT A SECOND. The bar is a window with a reach
  // either side of the subject, so it is rebuilt around wherever you land and
  // the same frame of the same clip is a different number of seconds along on
  // the bar you left and the bar you arrive on. A raw second would survive the
  // journey and mean something else at the end of it.
  const carryClockRef = useRef<SeamPosition | null>(null);
  // WHERE AN EASING JUMP STARTED, while it is still easing. Null the rest of
  // the time, which is nearly all of the time.
  // A BAR LANDING IN FLIGHT: true while the panels either side are fading in.
  // Set in the handler rather than derived, because the difference between a
  // step and a landing is WHICH GESTURE ASKED, and nothing about the resulting
  // state remembers that.
  const [swapping, setSwapping] = useState(false);
  const swapRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  // THE HOVER CARD IS UP. The row goes back for it — see the strip's own
  // className. A separate flag from `scrubbing` because the two are different
  // moments: a scrub is a gesture with the pointer down and the card hidden,
  // this is a pointer resting on the bar with a picture open under it.
  const [previewing, setPreviewing] = useState(false);
  // HOW MANY CLIPS ARE ON SCREEN. Remembered for the session rather than the
  // page: it is a way of working — reading one cut closely, or scanning a
  // sequence — and having it snap back to three every time you open a clip
  // would make the wider views something you re-choose rather than something
  // you use.
  const [viewCount, setViewCount] = useState<ViewCount>(lastViewCount());
  // HOW FAR THE BAR REACHES, which is a different question from how many
  // panels are on screen: the row is what you are working on, the bar is how
  // much of the sequence you can get to without leaving it.
  const [reach, setReach] = useState<BarReach>(lastBarReach());
  // HOW TALL THE FILM IS DRAWN (PL15-022). Remembered for the session like the
  // reach and the view count, and for the same reason: a working posture, not
  // a preference.
  const [laneSize, setLaneSize] = useState<LaneSize>(lastLaneSize());
  // WHAT THE BOXES DRAW, kept beside the reach because it is the same kind of
  // question — how much this control shows you, and of what. Seeded from
  // module scope so it survives the modal being closed and reopened.
  const [frames, setFrames] = useState<PlaybarThumbnails>(lastPlaybarThumbnails());
  const chooseFrames = useCallback((next: PlaybarThumbnails) => {
    rememberPlaybarThumbnails(next);
    setFrames(next);
  }, []);
  // WHERE THE HOVER CARD SITS, kept beside the other bar settings because it
  // is the same kind of question — how this control behaves while you read it.
  const [previewAnchor, setPreviewAnchor] = useState<PreviewAnchor>(lastPreviewAnchor());
  const choosePreviewAnchor = useCallback((next: PreviewAnchor) => {
    rememberPreviewAnchor(next);
    setPreviewAnchor(next);
  }, []);

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
      // A video's poster, or the still itself. Audio has neither, and gets no
      // thumbnail rather than a broken one.
      posterSrc:
        media.mediaKind === "video"
          ? media.posterSrcs?.[0]
          : media.mediaKind === "audio"
            ? undefined
            : media.src,
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

  // THE PANEL THAT IS LEAVING STAYS A PANEL UNTIL IT HAS LEFT.
  //
  // Whether a panel draws its contents or renders as an empty box of the
  // right width was read straight off the CURRENT centre — so the moment a
  // step changed it, the far card fell outside the window and blanked. It
  // was still on screen for the whole 420ms slide, in full view, sliding out
  // as an empty rectangle: a black hole opening on one side of the row for
  // the entire transition, which is the most visible thing wrong with the
  // step and reads as a rendering fault rather than as motion.
  //
  // It is NOT a mounting problem — `MOUNTED_RADIUS` already keeps a spare
  // pair built either side, so the card exists throughout. It was only ever
  // being told it was off screen a third of a second too early.
  //
  // So the window is the UNION of where it was and where it is going, held
  // for as long as the slide takes. The card leaves with its picture on.
  const [leavingCentre, setLeavingCentre] = useState<number | null>(null);
  const centreWas = useRef(centre);
  // BEFORE PAINT, NOT AFTER. As `useEffect` this ran one frame too late: the
  // render that changed `centre` painted with no union yet, so the outgoing
  // card was briefly outside BOTH windows and blinked out for a single frame
  // before the union brought it back. On a slowed recording that is a card
  // vanishing between two frames — a hard blink, no fade — which is worse than
  // the bug the union was added to fix.
  useLayoutEffect(() => {
    if (centreWas.current === centre) return;
    setLeavingCentre(centreWas.current);
    centreWas.current = centre;
    // The slide's own clock, plus a frame — releasing on the same tick can
    // blank the card on its last painted frame, which is the bug in
    // miniature.
    const timer = setTimeout(() => setLeavingCentre(null), DETAILS_STEP_MS + 40);
    return () => clearTimeout(timer);
  }, [centre]);

  /** Off screen for BOTH the centre it left and the one it is arriving at. */
  const isSpare = useCallback(
    (index: number) =>
      Math.abs(index - centre) > half &&
      (leavingCentre === null || Math.abs(index - leavingCentre) > half),
    [centre, half, leavingCentre],
  );
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

  // ── THE CLOCK COVERS THE WHOLE COLLECTION ────────────────────────────────
  //
  // It used to cover the three clips on screen plus a two-second lead into
  // each neighbour, which made the bar's reach and the row's reach the same
  // thing. That is exactly what stopped you scrubbing to a shot you could see
  // coming: the boxes were drawn for the whole collection, but only the lit
  // ones meant anything, and a press on the rest had nowhere to go.
  //
  // NO LEADS ANY MORE, and they are not missing so much as subsumed. A lead
  // existed because the window's neighbours were only PARTLY on the bar — you
  // got the approach to the cut and no more. With every clip present in full
  // there is no partial neighbour to lead into; the run-up to any cut is just
  // the clip before it, which is now on the bar in its entirety.
  // THE SLICE THE BAR ACTUALLY COVERS. `ids` is the whole flat order and the
  // ROW still walks all of it; this is only how far the clock reaches, so the
  // two can disagree and the row can be scrolled past the end of the bar by
  // stepping. Everything the bar is built from comes through here, so the
  // track, the ruler, the strip and the minimap cannot end up describing
  // different stretches of time.
  const barWindow = useMemo(() => barReachWindow(ids, centre, reach), [ids, centre, reach]);

  // THE WHOLE SEQUENCE, not the reach window (PL15-030).
  //
  // This was `barWindow.ids` because the bar could only ever show a window, so
  // the clock only had to cover one. The ported strip pans across every clip,
  // and a clock that stopped at the window's end would disagree with the thing
  // drawing it — `TheBarTakesTheKeyboard` caught exactly that, pressing End and
  // landing at 126 on a strip whose last frame is at 144.
  const collectionSeamClips = useMemo(
    () =>
      ids
        .map((id) => {
          const found = graph.nodesById.get(parseNodeId(id));
          return found && found.kind === "media" ? seamClipOf(found as MediaNode) : null;
        })
        .filter((clip): clip is SeamClip => clip !== null),
    [graph, ids],
  );

  // WHERE THE BAR RESTS, as an index into what `buildSeamTimeline` will
  // actually lay out. It drops zero-length clips, so counting the subject's
  // place in the unfiltered list would put the rest position one clip out for
  // every fully-trimmed clip before it.
  const subjectSeamIndex = useMemo(() => {
    const playable = collectionSeamClips.filter((clip) => clip.showingSeconds > 0);
    return Math.max(0, playable.findIndex((clip) => clip.id === (node.id as string)));
  }, [collectionSeamClips, node.id]);

  const timeline = useMemo(
    () => buildSeamTimeline(null, collectionSeamClips, null, 0, subjectSeamIndex),
    [collectionSeamClips, subjectSeamIndex],
  );

  // ADVANCING RESETS THE CLOCK TO THIS CLIP'S START — unless the advance was
  // the clock's own doing, in which case it KEEPS its place. See
  // `carryClockRef` below: the seconds survive exactly one subject change, the
  // one they caused.
  //
  // Carrying them is only sound because every clip is on the bar in full and
  // the spans do not depend on the subject: `buildSeamTimeline` is handed the
  // whole collection with no leads, and the subject index moves `centreStart`
  // and nothing else. So a second on the old bar is the same second on the new
  // one. (It was NOT always so. The bar used to be a window with run-ups
  // around the subject, and then the old seconds really did name a moment in a
  // run of time that no longer existed — which is why this reset was
  // unconditional.)
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
    const carried = carryClockRef.current;
    carryClockRef.current = null;
    setBarSeconds(
      carried === null ? null : seamSecondsAt(timeline, carried.clipId, carried.clipSeconds),
    );
  }

  const stripRef = useRef<HTMLDivElement | null>(null);

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

  /**
   * THE SCRUB PREVIEW, AND WHO SHOWS IT.
   *
   * Moving the playhead used to change the clock and nothing you could see:
   * the old bar answered this with a hover card and the swap to the film strip
   * left the question unanswered (PL15-030).
   *
   * The rule is not new. `usePublishTrimPreview` publishes the frame into the
   * preview pane when the pane is OPEN and reports whether it took it; the
   * caller draws its own card only when it did not. Pane open: the big picture
   * changes, which is the whole reason it is open. Pane closed: a card above
   * the playhead. Exactly one of the two, which is what that seam exists for —
   * it was built for trim drags and this is the same question asked by a
   * different gesture.
   */
  /**
   * WHAT A TRIM IS, defined once for both surfaces that can make one.
   *
   * The deck's handles and the film's out handle report the same shape — a
   * window in SOURCE seconds — and go through the same command. Two copies of
   * this would be two chances to disagree about which end `trimOutSeconds`
   * counts from, and the store holds it as a TAIL length while both surfaces
   * think in out points.
   *
   * One dispatch per gesture, which is what makes a drag one undo entry.
   */
  /**
   * A frame from a clip's source, for the deck to show while a trim moves.
   *
   * QUANTISED TO A QUARTER SECOND, the same as the film's skim card and for
   * the same reason: the URL is a Cloudinary frame grab, so every distinct time
   * is a distinct fetch, and a handle dragged across a card would ask for
   * hundreds. Finer than the eye follows mid-drag, and coarse enough that
   * dragging back over the same stretch is answered from cache.
   *
   * Video only. A still is one image and audio has none; asking either for a
   * moment rewrites a good URL into one naming a time the file does not have.
   */
  const frameAt = useCallback(
    (clipId: string, sourceSeconds: number) => {
      const found = graph.nodesById.get(parseNodeId(clipId));
      const media = found && found.kind === "media" ? (found as MediaNode) : null;
      if (media === null || media.mediaKind !== "video") return undefined;
      return monitorPosterUrl(media.posterSrcs?.[0], Math.round(sourceSeconds * 4) / 4);
    },
    [graph],
  );

  const commitTrim = useCallback(
    (clipId: string, next: Readonly<{ in: number; out: number }>) => {
      const found = graph.nodesById.get(parseNodeId(clipId));
      const media = found && found.kind === "media" ? (found as MediaNode) : null;
      // ONLY A CLIP WITH A TIMELINE CAN BE TRIMMED. `update-media` accepts a
      // window for audio and video and for nothing else — a still has no
      // duration to cut into, which is the same reason the bar draws it as one
      // frame rather than a filmstrip, and why the strip gives it no handle.
      const kind = media?.mediaKind;
      if (media === null || (kind !== "audio" && kind !== "video")) return;
      const full = hasSourceWindow(media) ? media.fullDurationSeconds : mediaDurationSeconds(media);
      store.dispatch({
        type: "update-media",
        nodeId: media.id,
        update: {
          mediaKind: kind,
          trimInSeconds: Math.max(0, next.in),
          // BACK TO A TAIL LENGTH, which is how the store holds it.
          trimOutSeconds: Math.max(0, full - next.out),
        },
      });
    },
    [graph, store],
  );

  const [skimSeconds, setSkimSeconds] = useState<number | null>(null);
  // A TRIM IN PROGRESS NAMES ITS OWN FRAME, and takes precedence over the
  // scrub's. Both raise the same preview; they differ in how the frame is
  // found. A scrub knows a place on the sequence and reads across to a clip; a
  // trim knows the clip already and is asking for a source time the sequence
  // does not have a place for yet — the whole point of dragging the edge is
  // that the timing is about to change.
  const [trimSkim, setTrimSkim] = useState<Readonly<{
    clipId: string;
    sourceSeconds: number;
  }> | null>(null);

  const skimAt = skimSeconds === null ? null : seamAt(timeline, skimSeconds);
  const skimClipId = trimSkim?.clipId ?? skimAt?.clipId ?? null;
  const skimNode = (() => {
    if (skimClipId === null) return null;
    const found = graph.nodesById.get(parseNodeId(skimClipId));
    return found && found.kind === "media" ? (found as MediaNode) : null;
  })();
  const skimSourceTime =
    skimNode === null
      ? null
      : trimSkim !== null
        ? trimSkim.sourceSeconds
        : skimAt === null
          ? null
          : (hasSourceWindow(skimNode) ? skimNode.trimInSeconds : 0) + skimAt.clipSeconds;
  // NARROWED FIRST. `MediaNode` is a union and only the video member carries
  // frame grabs; reaching for them on the union is what `seamClipOf` above is
  // careful about too.
  const skimPosterBase =
    skimNode !== null && skimNode.mediaKind === "video" ? skimNode.posterSrcs?.[0] : undefined;
  const skimSrc = skimNode?.src;

  const skimFrame = useMemo<TrimPreviewFrame | null>(() => {
    if (skimSrc === undefined || skimSourceTime === null) return null;
    return skimPosterBase === undefined
      ? { src: skimSrc, sourceTime: skimSourceTime }
      : { src: skimSrc, poster: skimPosterBase, sourceTime: skimSourceTime };
  }, [skimSrc, skimPosterBase, skimSourceTime]);
  const skimTaken = usePublishTrimPreview(skimFrame);

  /**
   * THE DECK BECOMES THE PREVIEW WHILE THE PLAYHEAD IS HELD (PL16-001).
   *
   * Same source as the strip's skim card and the pane's frame — one scrub, three
   * possible places to show it — so the precedence has to be stated rather than
   * left to whoever renders last:
   *
   *   the PANE takes it when it is open (`skimTaken`), and nothing else shows;
   *   otherwise the DECK takes it, becoming the preview screen itself;
   *   the strip's floating card is what is left when neither did.
   *
   * IN PRACTICE THE FIRST BRANCH NO LONGER FIRES FROM IN HERE. PL16-003 stands
   * the pane down for the whole time this view is up, so `skimTaken` is false
   * throughout and the deck always wins. The branch is KEPT rather than
   * deleted: it is the rule, the pane standing down is a decision about layout
   * that could be revisited, and a precedence written down only in the places
   * that currently happen to reach it is one that breaks quietly when they
   * change.
   *
   * That order is the existing rule extended by one, not a new one: the strip's
   * `skimPreview` already stood down for the pane, and `skimPreview` below now
   * stands down for this as well. Precisely one of the three is ever up.
   *
   * PLAYING RAISES IT TOO, not just scrubbing. Pressing play is a request to
   * WATCH, and watching three cards at card size is the thing this view was
   * asked to stop doing — so the transport puts the same screen up that
   * dragging the playhead does. It comes down again on pause, which is why
   * this is derived from `playing` rather than latched by the button.
   */
  const deckPreviewing =
    !skimTaken && (playing || skimSeconds !== null || trimSkim !== null);
  /**
   * THE FRAME UNDER THE CLOCK, for the preview to follow while PLAYING.
   *
   * The skim derivation below cannot serve this: it is keyed on a pointer
   * dragging the playhead, and while playback runs there is no pointer. Same
   * arithmetic, different question — where is the clock, rather than where is
   * the finger.
   *
   * QUANTISED BEFORE IT IS A DEPENDENCY, not inside. `shownSeconds` changes
   * every frame, so keying the memo on it would rebuild a URL sixty times a
   * second and ask Cloudinary for most of them; keying on the quarter-second it
   * rounds to means four requests a second at most, and the second pass over a
   * stretch comes from cache. The same reasoning the strip's card carries.
   */
  const clockQuarter = playing ? Math.round(shownSeconds * 4) / 4 : null;
  const clockPoster = useMemo<string | undefined>(() => {
    if (clockQuarter === null) return undefined;
    const at = seamAt(timeline, clockQuarter);
    if (at === null) return undefined;
    const found = graph.nodesById.get(parseNodeId(at.clipId));
    const media = found && found.kind === "media" ? (found as MediaNode) : null;
    // Frame grabs are a video's business — see `deckClips`, which is careful
    // about the same thing for the same reason.
    if (media === null || media.mediaKind !== "video") return undefined;
    const base = media.posterSrcs?.[0];
    if (base === undefined) return undefined;
    const source = (hasSourceWindow(media) ? media.trimInSeconds : 0) + at.clipSeconds;
    return monitorPosterUrl(base, Math.round(source * 4) / 4);
  }, [clockQuarter, timeline, graph]);

  /**
   * THE CLIP UNDER THE PLAYHEAD, and where inside it (PL16-002).
   *
   * NOT QUANTISED, unlike the poster. A poster is a URL and every distinct time
   * is a distinct request, which is why that one rounds to a quarter second.
   * This is a file and a seek offset: the element decodes forward on its own
   * once it has started, so the only thing the exact number costs is one
   * accurate seek at the moment the clip changes.
   *
   * The seam is read at the CLOCK, not at the skim, so it is right during
   * playback and equally right when a scrub parks somewhere. `deckPreviewing`
   * decides whether any of it is on screen.
   */
  const previewAt = seamAt(timeline, shownSeconds);
  const previewNode = (() => {
    if (previewAt === null) return null;
    const found = graph.nodesById.get(parseNodeId(previewAt.clipId));
    return found && found.kind === "media" ? (found as MediaNode) : null;
  })();
  const deckPreviewVideoTime =
    previewAt === null || previewNode === null
      ? undefined
      : (hasSourceWindow(previewNode) ? previewNode.trimInSeconds : 0) + previewAt.clipSeconds;

  const deckPreviewPoster = useMemo<string | undefined>(() => {
    if (!deckPreviewing) return undefined;
    // A SCRUB OUTRANKS THE CLOCK. Dragging the playhead during playback is a
    // question about somewhere else, and the answer should be where the finger
    // is rather than where the clock has got to.
    if (skimNode === null || skimSourceTime === null) return clockPoster;
    // Audio has no picture to show, and a clip with no addressable poster base
    // can only offer its own source — the deck falls back to the card's frame
    // for both rather than going black.
    if (skimNode.mediaKind === "audio" || skimPosterBase === undefined) return clockPoster;
    // QUANTISED TO A QUARTER SECOND for the reason the strip's card is: every
    // distinct time is a distinct Cloudinary fetch, and a pointer sweeping the
    // bar would ask for hundreds. The pane's copy is not quantised because it
    // seeks an element it already holds; this one is a URL.
    return monitorPosterUrl(skimPosterBase, Math.round(skimSourceTime * 4) / 4);
  }, [deckPreviewing, skimNode, skimSourceTime, skimPosterBase, clockPoster]);

  const skimPreview = useMemo<FilmStripSkimPreview | null>(() => {
    if (skimTaken || deckPreviewing || skimNode === null || skimSourceTime === null) return null;
    // QUANTISED TO A QUARTER SECOND, because the URL is a Cloudinary frame grab
    // and every distinct time is a distinct fetch — a pointer sweeping the bar
    // would ask for hundreds. Finer than the eye tracks mid-sweep, and coarse
    // enough that a second pass over the same stretch comes from cache. The
    // pane's copy above is NOT quantised: it seeks an element it already holds.
    const poster =
      skimNode.mediaKind === "audio"
        ? undefined
        : skimPosterBase === undefined
          ? skimNode.src
          : monitorPosterUrl(skimPosterBase, Math.round(skimSourceTime * 4) / 4);
    const total = mediaDurationSeconds(skimNode);
    return {
      ...(poster === undefined ? {} : { posterSrc: poster }),
      name: skimNode.name,
      // HOW FAR INTO THE CLIP, which for a trim is the source time itself:
      // the window is being redrawn, so "into the clip" is what is being
      // chosen rather than something to measure against.
      meta: `${(trimSkim === null ? (skimAt?.clipSeconds ?? 0) : skimSourceTime).toFixed(2)}s / ${total.toFixed(2)}s`,
    };
  }, [skimTaken, deckPreviewing, skimNode, skimAt, skimSourceTime, skimPosterBase, trimSkim]);
  // ANY clip the bar covers, not just the three it used to. With nine panels
  // the playhead can be inside a clip four along, and the monitor still has to
  // be able to paint it.
  // WHATEVER THE PLAYHEAD IS ON, mounted or not.
  //
  // This used to search the panels on screen, which was the same window the
  // clock covered — so it could never be asked for anything else. Now the bar
  // reaches the whole collection, and scrubbing onto a shot that is four cards
  // away has to show you that shot: that is what "preview items that aren't
  // even displayed" means. The row does NOT follow; the monitor does the
  // travelling, which is the cheap half and the half you asked for.
  const monitorNode = (() => {
    if (position === null) return null;
    const found = graph.nodesById.get(parseNodeId(position.clipId));
    return found && found.kind === "media" ? (found as MediaNode) : null;
  })();

  // TWO WIDTHS NOW: the clip being worked on, and everything else. The row's
  // step is the NEIGHBOUR width — see `panelWidthsFor` for why the centre's
  // extra width cancels out of the centring arithmetic entirely.
  const panelWidths = panelWidthsFor(viewCount);
  const panelWidth = panelWidths.neighbour;

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

  /**
   * The clips actually ON SCREEN as panels — the two or three you are looking
   * at, not the spares built one either side of them.
   *
   * The bar draws these as pictures even with frames switched off. Grey boxes
   * are for reading RHYTHM — width is duration, and a run of even grey shows
   * where the cuts fall and where the pace changes, which pictures destroy
   * because the eye reads pictures whatever else is there. That argument is
   * about the RUN of the bar. It says nothing about the two or three clips
   * whose frames are already filling the screen below, and drawing those as
   * anonymous grey while their pictures sit underneath is the bar declining to
   * answer a question it is not being asked.
   *
   * `MOUNTED_RADIUS` is deliberately not reused: it is one wider, so the row
   * has a built panel to slide to, and those spares are never seen. Marking
   * them would put a picture on the bar for a clip that is not on the screen.
   */
  const panelClipIds = useMemo(() => {
    const radius = Math.floor(viewCount / 2);
    const onScreen = new Set<string>();
    for (let index = centre - radius; index <= centre + radius; index += 1) {
      const id = ids[index];
      if (id !== undefined) onScreen.add(id);
    }
    return onScreen;
  }, [centre, ids, viewCount]);

  // HOW A LANDING FROM THE BAR ARRIVES: IT DOES NOT TRAVEL.
  //
  // Stepping and letting go of the bar look like the same event and are not.
  // A step really does make the middle card a different clip, and the slide is
  // what says which way you went. Letting go of the bar does not: the middle
  // card has been the MONITOR for the whole scrub, so it is already showing
  // the clip you landed on, and scrolling the row to it animates a change that
  // has already happened — the one thing on screen that did not need to move
  // is the thing that moves.
  //
  // So the row cuts to its new offset, the middle card stays exactly where it
  // is with exactly the picture it had, and the panels either side fade in
  // with their new contents. What changes is what changes.
  const SWAP_MS = 300;

  const chooseReach = useCallback((next: BarReach) => {
    rememberBarReach(next);
    setReach(next);
  }, []);

  const chooseLaneSize = useCallback((next: LaneSize) => {
    rememberLaneSize(next);
    setLaneSize(next);
  }, []);

  const chooseViewCount = useCallback((next: ViewCount) => {
    rememberViewCount(next);
    setViewCount(next);
  }, []);
  // THE BAR'S OWN LAYOUT, over the WHOLE playback order — every clip the row
  // can reach, in the order it plays, collection boundaries included. The row
  // already walks straight through them; a bar that stopped at the current
  // collection could not show you what was coming next, which is most of what
  // a bar is for. Which collection a clip belongs to is said in COLOUR
  // instead (see `collectionTintOf`), so the grouping survives without the
  // scope shrinking to match it.
  // Durations come straight from the graph, so this costs a map lookup per
  // clip and no media at all — the boxes are geometry, not pictures.
  // WHAT COLOUR EACH CLIP'S BOX IS, derived from WHERE its collection sits.
  //
  // The first version gave every collection the next tint from a flat palette
  // and drew the ancestors as bars across the top of the box. Both halves were
  // wrong in the same way: a flat palette makes a nested collection look like
  // an unrelated one, and the bars were a second channel spent explaining what
  // the first channel had failed to say.
  //
  // Nesting is in the COLOUR now. A collection directly under the root takes a
  // hue far from its neighbours — those are the big divisions and they should
  // not be confusable. Every level below shifts a little from its parent and
  // lifts, so a collection inside an orange one is a near-orange: obviously
  // its own thing, obviously that thing's child. Depth reads as a family, and
  // the top level reads as a difference.
  const clipColourOf = useMemo(() => {
    const rootId = flatOrderRootId(graph);

    // Ordered so that CONSECUTIVE assignments are far apart, and so that no
    // two are closer than 45 degrees. Both matter: the first is what makes the
    // top-level divisions read as different at a glance, and the second is
    // what keeps two families from meeting in the middle once their children
    // have spread either side of them. An earlier set had 28 and 340 in it —
    // 48 degrees apart — and with children ranging 14 degrees each way the
    // orange family's reds and the pink family's reds became the same colour.
    const TOP_HUES = [30, 210, 120, 300, 165, 345, 75, 255];
    type Tone = { hue: number; saturation: number; lightness: number };
    const toneOf = new Map<string, Tone>();
    const childCount = new Map<string, number>();
    let topLevelSeen = 0;

    const toneFor = (collectionId: string, parentId: string | null): Tone => {
      const existing = toneOf.get(collectionId);
      if (existing !== undefined) return existing;
      const parentTone = parentId === null ? null : toneOf.get(parentId) ?? null;
      let tone: Tone;
      if (parentTone === null) {
        tone = {
          hue: TOP_HUES[topLevelSeen % TOP_HUES.length]!,
          saturation: 52,
          lightness: 34,
        };
        topLevelSeen += 1;
      } else {
        // Which child of its parent this is, so siblings separate a little
        // while staying inside the family.
        const key = parentId ?? "";
        const order = childCount.get(key) ?? 0;
        childCount.set(key, order + 1);
        // SIBLINGS BARELY MOVE THE HUE. The first version added 13 degrees
        // per sibling, which accumulated: eight collections under one parent
        // walked a hundred degrees of the wheel, so the last of them was a
        // different colour from its own parent rather than a shade of it —
        // exactly the relationship this is supposed to show. Centred and
        // cycled instead, so a run of children sits within a few degrees
        // either side of the family hue.
        //
        // DEPTH IS CARRIED BY LIGHTNESS, not hue, for the same reason: it can
        // go many levels without ever leaving the colour it started from.
        tone = {
          hue: parentTone.hue + ((order % 5) - 2) * 5,
          saturation: Math.max(24, parentTone.saturation - 7),
          lightness: Math.min(66, parentTone.lightness + 10),
        };
      }
      toneOf.set(collectionId, tone);
      return tone;
    };

    const colours = new Map<string, string>();
    for (const id of ids) {
      // The chain from just under the root down to the clip's own collection.
      const chain: string[] = [];
      let cursor: string | null =
        (graph.parentById.get(parseNodeId(id)) as string | null | undefined) ?? null;
      while (cursor !== null && cursor !== rootId) {
        chain.unshift(cursor);
        cursor = (graph.parentById.get(parseNodeId(cursor)) as string | null | undefined) ?? null;
      }
      // Walk DOWN it so each level's tone is derived from a parent that
      // already has one.
      let tone: Tone | null = null;
      chain.forEach((collectionId, depth) => {
        tone = toneFor(collectionId, depth === 0 ? null : chain[depth - 1]!);
      });
      const resolved: Tone = tone ?? { hue: 220, saturation: 8, lightness: 34 };
      colours.set(
        id,
        `hsl(${resolved.hue % 360} ${resolved.saturation}% ${resolved.lightness}%)`,
      );
    }
    return colours;
  }, [ids, graph]);

  // EVERY CLIP THE BAR CAN REACH, with the two things the bar cannot work out
  // for itself: what a clip is called, and which collection it belongs to.
  //
  // The names are for the hover preview — a box is otherwise anonymous, and
  // "which shot is that" is the question a bar of coloured rectangles is worst
  // at. The collection is what the dividers and the ruler's labels are drawn
  // from: the row walks the whole project in playback order and crosses
  // collection edges on purpose, so those edges are the only landmarks on it.
  //
  // The bar owns the SCALE now, so it also owns the layout — this hands it
  // clips, not pixels.
  const barClips = useMemo<readonly SeamBarClip[]>(() => {
    return barWindow.ids.map((id) => {
      const found = graph.nodesById.get(parseNodeId(id));
      const media = found && found.kind === "media" ? (found as MediaNode) : null;
      const parentId = graph.parentById.get(parseNodeId(id)) ?? null;
      const parent = parentId === null ? undefined : graph.nodesById.get(parentId);
      return {
        id,
        name: found?.name ?? id,
        showingSeconds: media === null ? 0 : mediaDurationSeconds(media),
        collectionId: parentId === null ? null : (parentId as string),
        collectionName: parent?.name ?? null,
        // SKIPPED AT PLAY TIME, said on the bar. The flag was on the node all
        // along and the bar had never been told, so the one control that shows
        // you the shape of playback was silent about a clip playback steps
        // over. It changes how the box is PAINTED and never how wide it is.
        ...(media?.disabled === true ? { disabled: true } : {}),
        ...(media === null ? {} : { posterSrc: seamClipOf(media)?.posterSrc }),
        // ONLY A VIDEO GETS THE FULL SET. A still's single image sampled at
        // ten intervals is ten copies of itself, which is a filmstrip saying
        // nothing happens — worse than the one frame it is made of. Leaving
        // these off is what makes the bar fall back to `cover` for it.
        ...(media !== null && media.mediaKind === "video" && media.posterSrcs !== undefined
          ? {
              posterSrcs: media.posterSrcs,
              trimInSeconds: seamClipOf(media)?.trimInSeconds ?? 0,
              // For handing a skimmed frame to the preview pane (PL15-030).
              // Carried on the same branch as the posters because it answers
              // the same question for the same clips: a still has no timeline
              // to skim along.
              ...(media.src === undefined ? {} : { src: media.src }),
            }
          : {}),
      };
    });
  }, [barWindow, graph]);

  /**
   * THE SAME CLIPS, SHAPED FOR THE PORTED STRIP (PL15-030).
   *
   * BUILT FROM EVERY CLIP, not from the reach window, and that is the point of
   * the swap rather than an oversight. The old bar paged a window because it
   * could not move — reach was how you saw more of the sequence. The new strip
   * PANS, with inertia, across the whole thing, so the window has nothing left
   * to do and its clock is the timeline's by construction.
   *
   * A POSTER IS A BACKGROUND, which is the seam that let this be swapped in
   * rather than rewritten: the strip asks for CSS backgrounds and does not care
   * whether they are the reference's gradients or our stills.
   */
  const stripShots = useMemo<readonly FilmStripShot[]>(() => {
    return ids.map((id) => {
      const found = graph.nodesById.get(parseNodeId(id));
      const media = found && found.kind === "media" ? (found as MediaNode) : null;
      const parentId = graph.parentById.get(parseNodeId(id)) ?? null;
      const parent = parentId === null ? undefined : graph.nodesById.get(parentId);
      // THROUGH THE SAME ACCESSOR THE BAR ALREADY USES, rather than reaching
      // into the node: it is the one place that knows a video's poster from a
      // still's own image, and that audio has neither and should get no
      // thumbnail rather than a broken one.
      const poster = seamClipOf(media)?.posterSrc;
      // TRIMMABLE ONLY WHERE A WINDOW MEANS ANYTHING. `update-media` accepts one
      // for audio and video and for nothing else, so a still is handed no source
      // length and the strip draws it no handle — the refusal is expressed once,
      // here, rather than as a control that turns out to be inert.
      const seam = seamClipOf(media);
      const windowed =
        media !== null && (media.mediaKind === "audio" || media.mediaKind === "video")
          ? {
              sourceSeconds: seam?.fullSeconds ?? mediaDurationSeconds(media),
              trimInSeconds: seam?.trimInSeconds ?? 0,
            }
          : {};
      // THE FRAME THE CLIP STARTS ON, which is the same picture the card's big
      // image shows — one shot, one representative frame, wherever you are
      // looking at it. It was the source's opening frame, so a clip trimmed
      // eight seconds in advertised itself with a moment it does not contain,
      // and trimming it changed nothing about how it looked.
      const grabs = media !== null && media.mediaKind === "video" ? media.posterSrcs : undefined;
      const at =
        grabs === undefined
          ? poster
          : (monitorPosterUrl(grabs[0], seam?.trimInSeconds ?? 0) ?? poster);
      return {
        id,
        ...windowed,
        label: found?.name ?? id,
        seconds: media === null ? 0 : mediaDurationSeconds(media),
        frames: at === undefined ? ["#0d0d10"] : [`center/cover no-repeat url("${at}")`],
        sectionName: parent?.name ?? null,
      };
    })
      // ZERO-LENGTH CLIPS COME OUT, because `buildSeamTimeline` drops them and
      // the two clocks have to agree exactly. A fully-trimmed clip drawn as a
      // box the timeline does not count would put every second after it in the
      // wrong place.
      .filter((shot) => shot.seconds > 0);
  }, [graph, ids]);

  /**
   * THE SAME CLIPS, SHAPED FOR THE PORTED DECK (PL15-030).
   *
   * `trimOut` is an ABSOLUTE point in the source, which is not how the store
   * holds it — `update-media` takes `trimOutSeconds` as a TAIL length, seconds
   * cut from the end. Converting here rather than in the deck keeps the deck
   * ignorant of our storage and keeps the conversion in one place, next to the
   * dispatch that undoes it.
   */
  const deckClips = useMemo(() => {
    return ids.flatMap((id, index) => {
      const found = graph.nodesById.get(parseNodeId(id));
      const media = found && found.kind === "media" ? (found as MediaNode) : null;
      if (media === null) return [];
      const seam = seamClipOf(media);
      const full = seam?.fullSeconds ?? mediaDurationSeconds(media);
      const trimIn = seam?.trimInSeconds ?? 0;
      const poster = seam?.posterSrc;
      // Frame grabs are a video's business; a still is one picture and audio is
      // none, and asking either for a moment rewrites a good URL into one that
      // names a time the file does not have.
      const grabs = media.mediaKind === "video" ? media.posterSrcs : undefined;
      const background = (url: string | undefined) =>
        url === undefined ? "#0d0d10" : `center/cover no-repeat url("${url}")`;

      // ACROSS THE SOURCE, because the strip these fill is a picture of the
      // source with the window drawn over it — so the cells outside the window
      // are the material being trimmed away, and they have to be the frames
      // that are actually there.
      const near = Math.abs(index - centre) <= DECK_STRIP_RADIUS;
      const cells =
        grabs === undefined || !near
          ? [background(poster)]
          : videoFrameUrls(grabs, CLIP_DECK_STRIP_CELLS, {
              trimInSeconds: 0,
              effectiveSeconds: full,
            }).map(background);

      return [
        {
          id,
          name: found?.name ?? id,
          source: full,
          trimIn,
          trimOut: trimIn + mediaDurationSeconds(media),
          frames: cells.length > 0 ? cells : [background(poster)],
          // THE FRAME THE CLIP ACTUALLY STARTS ON, not the source's first.
          poster: background(
            grabs === undefined ? poster : (monitorPosterUrl(grabs[0], trimIn) ?? poster),
          ),
          tags: [] as readonly string[],
        },
      ];
    });
  }, [graph, ids, centre]);

  // ONE WAY TO LAND, whichever gesture asked for it. A click on a box and a
  // released scrub differ only in how the clip was chosen; what happens next
  // — carry the clock, cut rather than travel, fade the panels either side —
  // is the same sentence and is written once.
  /**
   * THE CLIPS EITHER SIDE, for the transport's skip buttons.
   *
   * FROM `ids`, THE WHOLE FLAT ORDER, not from the deck's window: the deck
   * shows three or five, and "next clip" at the edge of that window still means
   * the next clip in the sequence rather than nothing. `null` only at the true
   * ends, which is what disables the buttons.
   */
  /**
   * A USER SCRUB STOPS PLAYBACK. PLAYBACK'S OWN TICKS MUST NOT (PL16-002).
   *
   * The strip owns the clock — it has run a rAF loop the whole time, advancing
   * on wall clock and stopping at the end — and every tick of it arrives here
   * through `onScrub`, because that is also how a drag reports. The handler
   * could not tell them apart and stopped playback on the first frame it was
   * given, so play toggled on and switched itself off before anything moved.
   * Reported as "nothing's really going on", which was exactly right.
   *
   * `onSkim` IS the difference: it fires only for a pointer holding the
   * playhead, and it is `null` the moment that ends. A ref rather than state
   * because `onScrub` reads it in the same tick `onSkim` writes it, and a state
   * update would not have landed yet.
   */
  const userScrubbingRef = useRef(false);

  const previousClipId = centre > 0 ? (ids[centre - 1] ?? null) : null;
  const nextClipId = centre < ids.length - 1 ? (ids[centre + 1] ?? null) : null;

  const landOn = useCallback(
    (clipId: string, at: SeamPosition | null) => {
      if (clipId === (node.id as string)) return;
      const to = ids.indexOf(clipId);
      const distance = to < 0 ? Number.POSITIVE_INFINITY : Math.abs(to - centre);
      // Only a position ON the clip being landed on is worth carrying. At a
      // seam the playhead and the clicked box can disagree by a frame, and
      // carrying the other clip's position would land you on the right card
      // showing the wrong one's time.
      carryClockRef.current = at !== null && at.clipId === clipId ? at : null;
      // A NEIGHBOUR IS STILL A STEP. Landing on the clip directly beside the
      // one you are on is the same single move the arrows and the swipe make,
      // and it keeps their slide — the fade is for arrivals that come from
      // somewhere the row was not showing.
      swapRef.current = distance > 1;
      setSwapping(distance > 1);
      onOpenNeighbour(clipId);
    },
    [centre, ids, node.id, onOpenNeighbour],
  );

  // THE ROW CUTS RATHER THAN SLIDES, for a bar landing only. Done to the node
  // because the frame this is trying to influence has already been decided by
  // the time any state update could land: a layout effect runs after the new
  // transform is in the DOM and before the browser paints it, which is the
  // only window where "do not travel" can still be said. The reflow read
  // between the two writes is load-bearing — without it they coalesce and the
  // transition never goes away.
  useLayoutEffect(() => {
    if (!swapRef.current) return;
    swapRef.current = false;
    const strip = stripRef.current;
    if (strip === null) return;
    strip.style.transition = "none";
    void strip.offsetWidth;
    const frame = requestAnimationFrame(() => {
      strip.style.transition = "";
    });
    return () => cancelAnimationFrame(frame);
  }, [centre]);

  // AND THE FADE ENDS. On a timer rather than on `animationend`, which fires
  // once per panel and would need counting, and does not fire at all for a
  // panel that unmounted mid-fade.
  useEffect(() => {
    if (!swapping) return;
    const timer = setTimeout(() => setSwapping(false), SWAP_MS + 40);
    return () => clearTimeout(timer);
  }, [SWAP_MS, swapping]);

  const offset = centre < 0 ? 0 : centre - (ids.length - 1) / 2;

  // SWIPING THE STRIP. The same instruction as clicking a neighbour, held:
  // drag the film and it follows the hand, let go past a threshold and it
  // lands on the next clip. Pointer events rather than touch events, so one
  // implementation serves a finger, a trackpad and a mouse — the gesture is
  // the same shape on all three and only ever felt on the first.
  const hasPrevious = centre > 0;
  const hasNext = centre >= 0 && centre < ids.length - 1;
  /**
   * THE DRAG OFFSET IS NOT REACT STATE (PL15-016), and the ref beside it
   * explains why it should never have been.
   *
   * That ref's own comment already said it: "this changes on nearly every
   * pointer move and only the ROW's transform cares. A re-render per move to
   * store a start coordinate would re-render three live panels — video
   * elements included — sixty times a second for the duration of a swipe."
   * Exactly right, and then the OFFSET was `useState` and did the very thing
   * one level up — `setDragPx` per move, read by `rowTransform`, which is
   * built in this component's render. So every pointer move re-rendered the
   * whole modal, which mounts up to `MOUNTED_RADIUS * 2 + 1` panels, each a
   * video element, a trim strip and a tag editor.
   *
   * A CSS VARIABLE, WRITTEN STRAIGHT TO THE ELEMENT. The transform reads
   * `var(--drag-px, 0px)`, and the move handler sets that property on the row
   * itself — so a pan touches one style property on one element and React is
   * not involved at all. A custom property also survives an unrelated
   * re-render: React only writes the style keys it manages, so a playhead tick
   * mid-swipe cannot clobber the offset the way rebuilding `transform` from
   * state would.
   *
   * `dragging` stays state because the ROW's transition is keyed to it, and
   * that flips exactly twice per gesture rather than sixty times a second.
   */
  const [dragging, setDragging] = useState(false);
  // Written to `stripRef` — the row element itself, which already has a ref
  // for the landing effect. A second ref on the same node would be two names
  // for one thing and an invitation to attach one of them and not the other.
  const setDragOffset = useCallback((px: number) => {
    stripRef.current?.style.setProperty("--drag-px", `${px}px`);
  }, []);
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
          // ONE render for the whole gesture: the row drops its transition
          // here and takes it back on release.
          setDragging(true);
          try {
            event.currentTarget.setPointerCapture(drag.pointerId);
          } catch {
            /* untrusted pointer — moves over the picture still arrive */
          }
        }
        setDragOffset(swipeOffset(dx, hasPrevious, hasNext));
      },
      onPointerUp: (event) => {
        const drag = dragRef.current;
        dragRef.current = null;
        setDragOffset(0);
        setDragging(false);
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
        setDragOffset(0);
        setDragging(false);
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
    [centre, hasNext, hasPrevious, ids, onOpenNeighbour, setDragOffset],
  );

  // WHERE THE PLAYHEAD IS, read across from the clock. The clock says "this
  // clip, this far in"; the strip says where that clip begins. Neither has to
  // know the other's coordinates, and there is still only one answer.
  const playheadAt = (() => {
    const at =
      position ??
      (centreClip === null ? null : { clipId: centreClip.id as string, clipSeconds: 0 });
    if (at === null) return null;
    return { clipId: at.clipId, secondsIntoClip: at.clipSeconds };
  })();

  // THE VIEW'S OWN WIDTH, PUBLISHED FOR THE PANEL ARITHMETIC.
  //
  // A ResizeObserver rather than a CSS unit, because the sizes it feeds are
  // applied both to panels and to things INSIDE panels, and every panel is a
  // container of its own — so `cqw` would silently mean two different boxes
  // depending on where it landed. A pixel length means one thing everywhere.
  //
  // It tracks the rail opening and closing, the window resizing, and the
  // preview pane taking height, with nothing to keep in sync.
  const viewRef = useRef<HTMLElement | null>(null);
  /** How much height the column has already given up, so the shortfall can be
   *  measured without clearing the concessions to find it. */
  const concededRef = useRef(0);
  const [fitting, setFitting] = useState(false);
  const { previewOpen } = useTrimPreview();
  useLayoutEffect(() => {
    const element = viewRef.current;
    if (!element) return;
    const publish = () => {
      element.style.setProperty(
        DETAILS_BASIS_VAR,
        `${Math.round(element.getBoundingClientRect().width)}px`,
      );

      // ── IN BOTH STATES, NOW ─────────────────────────────────────────────
      //
      // This used to return here with the pane down, on the reasoning that
      // nothing was competing for the height then: the view was ordinary
      // content, and the page scrolled if it ran past the fold. The trade was
      // stated as avoiding "a scrollbar nobody minded" — and the scrollbar is
      // minded, so the trade flips.
      //
      // It was never a big overflow, which is what made it worth fixing rather
      // than living with. Measured with the pane down at a 889px window: the
      // view starts 70px down (13 of `main` padding, the rest the graph's own
      // header) and stands 884 tall, so the document came to 954 — 65px over,
      // just enough to put the bottom of the cards under the fold and a
      // scrollbar down the side of an instrument meant to be read at a glance.
      //
      // Nothing above bounds it: `main` is `flex-1` inside a `min-h-screen`
      // shell, so the column simply grows. The ceiling below is the only thing
      // that subtracts what sits above the view, which is exactly what was
      // missing.
      //
      // THE COST IS REAL AND IS ACCEPTED: with the pane down the deck now
      // concedes rather than overflowing, so the cards are a little narrower
      // than the design's own size. The ladder concedes the minimum that fits,
      // and with the pane down there is far more room to play with, so it is a
      // nudge rather than the squeeze the contested case needs.
      // AND THE VIEW ENDS WHERE THE WINDOW DOES.
      //
      // Nothing above this bounded it: `main` is `flex-1` inside a `min-h-screen`
      // shell, so the column simply grew and the PAGE scrolled — measured, 982px
      // of document in a 910px window, with the bottom of the deck's cards below
      // the fold. An instrument you have to scroll to see the bottom of is not
      // one you can read at a glance, which is the point of this view.
      //
      // Bounded HERE rather than by giving the shell `h-screen`: the board and
      // the grid share that shell and both legitimately scroll the page.
      //
      // `top` is read in DOCUMENT space, because the fix removes the very page
      // scroll a viewport-relative reading would depend on — measure it in
      // viewport space and the answer changes as it works.
      const top = element.getBoundingClientRect().top + window.scrollY;
      const fit = Math.max(
        DETAILS_MIN_FIT_PX,
        Math.round(window.innerHeight - top - DETAILS_BOTTOM_GAP_PX),
      );

      // Written only when it changes: this runs from a ResizeObserver watching
      // the same element, and an unconditional write is a loop.
      if (element.style.height !== `${fit}px`) element.style.height = `${fit}px`;

      // ── THE CONCESSION LADDER, IF IT CAN REACH ───────────────────────
      //
      // EVERY INPUT HERE IS INDEPENDENT OF THE OUTPUT, and that is the whole
      // design of it. The first version measured `scrollHeight` — a RESULT of
      // the concessions — and fed it back in, so the view conceded, the deck
      // resized, the deck's observer refitted, the view's observer fired again,
      // and the two drove each other in a circle. That is what the nonstop
      // flickering of the deck was.
      //
      // These four cannot move in response to what is decided below: the
      // header's height, the bar's height with its film at full size, the
      // deck's own stated requirement, and the height on offer. So the answer
      // is the same every time it is asked, and asking again changes nothing.
      const headerHeight = (element.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0;
      const bar = element.querySelector<HTMLElement>(".playbar");
      const strip = element.querySelector<HTMLElement>(".strip");
      const deck = element.querySelector<HTMLElement>(".deck");
      const barAtFullFilm =
        bar === null
          ? 0
          : bar.offsetHeight + (STRIP_FULL_HEIGHT_PX - (strip?.offsetHeight ?? STRIP_FULL_HEIGHT_PX));
      const deckNeed =
        deck === null
          ? 0
          : Number.parseInt(getComputedStyle(deck).getPropertyValue("--deck-need"), 10) || 0;

      const needed = headerHeight + 2 * DETAILS_GAP_PX + barAtFullFilm + deckNeed;
      const room = 2 * (DETAILS_GAP_PX - DETAILS_GAP_FLOOR_PX) + (STRIP_FULL_HEIGHT_PX - STRIP_FLOOR_HEIGHT_PX);

      // OUT OF REACH: concede NOTHING. Spending the film's height on a column
      // that still will not fit buys a shorter strip and nothing else — the
      // same bad trade the cards were making when they shrank to their floor
      // and stayed cut off. The remainder scrolls instead.
      const owedTotal = needed <= fit ? 0 : needed - fit > room ? 0 : needed - fit;
      if (owedTotal !== concededRef.current) {
        concededRef.current = owedTotal;
        if (owedTotal === 0) {
          element.style.removeProperty("gap");
          element.style.removeProperty("--strip-h");
        } else {
          let owed = owedTotal;
          const take = (available: number) => {
            const taken = Math.min(owed, Math.max(0, available));
            owed -= taken;
            return taken;
          };
          // Two gaps in the column, so a pixel off the gap is two off the total.
          const fromGaps = take(2 * (DETAILS_GAP_PX - DETAILS_GAP_FLOOR_PX));
          element.style.gap = `${DETAILS_GAP_PX - fromGaps / 2}px`;
          const fromStrip = take(STRIP_FULL_HEIGHT_PX - STRIP_FLOOR_HEIGHT_PX);
          element.style.setProperty("--strip-h", `${STRIP_FULL_HEIGHT_PX - fromStrip}px`);
        }
      }

      // The deck only narrows its cards when the column is actually being made
      // to fit; otherwise it keeps the design's width and the view scrolls.
      setFitting(needed - fit <= room);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    // AND EVERY ANCESTOR, because what this must react to is the view being
    // PUSHED DOWN, and that changes nothing about the view's own size. Once the
    // height here is explicit the element stops resizing at all, so an observer
    // watching only itself goes deaf exactly when it matters: measured, opening
    // the preview pane moved the top to 413 while the height stayed 828, and
    // the deck sat 331px below the window with no callback fired.
    //
    // The whole chain rather than the parent, because the pane that grew is not
    // a sibling of this view — watching one level up was tried and stayed deaf.
    // Picking the "right" ancestor would be a guess about a layout above this
    // component's business, and a wrong guess fails silently.
    for (let up = element.parentElement; up !== null; up = up.parentElement) {
      observer.observe(up);
    }
    window.addEventListener("resize", publish);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", publish);
    };
  }, [previewOpen]);

  const rowTransform =
    `translateX(calc(-1 * ${offset} * (${panelWidth} + ${PANEL_GAP}) + var(--drag-px, 0px)))`;

  /**
   * COVER MODE PORTALS OUT, and no z-index could have replaced this.
   *
   * The board and this view live inside `[data-testid="workbench-lower-pane"]`,
   * which is `position: relative; z-index: 0; isolation: isolate` — a stacking
   * context of its own, at level ZERO. Everything inside it therefore paints at
   * zero relative to the preview region, which is a z-40 SIBLING of that
   * container. The first attempt asked for `z-index: 45` and got covered by the
   * pane anyway, which is the tell: a number inside an isolated context is not
   * competing with anything outside it.
   *
   * So the overlay leaves the context rather than trying to out-rank it from
   * inside. `createPortal` moves the DOM node only — React context still
   * resolves through the tree it was declared in, so every provider this view
   * reads (the store, the details context, the trim preview) is untouched.
   *
   * At the root it competes with the header's z-50 and the surface's z-40 on
   * equal terms, which is what makes 45 mean what it says: over the preview,
   * under the breadcrumb. The box is already in viewport coordinates — `fixed`,
   * measured off the header — so nothing about the positioning changes.
   *
   * The DEFAULT mode stays exactly where it was, in flow. This view is the
   * content area there (PL15-029) and a portal would undo that.
   */
  const view = (
    <section
      ref={viewRef}
      data-item-details={node.id}
      data-details-preview-mode={coverMode ? "cover" : "standdown"}
      aria-label={`Details for ${node.name}`}
      // A REGION IN THE CONTENT AREA, NOT A DIALOG OVER IT (PL15-029).
      //
      // This was `createPortal` onto `document.body`, `role="dialog"` and
      // `aria-modal="true"` over a scrim. It is a PLACE now: the board is
      // hidden and this stands in its stead, so there is nothing behind it to
      // be modal about. `aria-modal` on something that covers nothing is a lie
      // to a screen reader — the same defect `useDialogFocus` was written to
      // fix, arrived at from the other side.
      //
      // AND THE BAND ARITHMETIC GOES WITH IT, which is most of what this
      // element used to be. The scrim reserved its own top and bottom edges
      // with `pt-[14.75rem]` and `pb-[4.875rem]`, because the header and the
      // bar were absolutely positioned — so the row could be centred and
      // cropped without them affecting its width — and therefore took no
      // space. Every change to the bar had to be measured and then paid for
      // TWICE, because `items-center` shares padding added at the top with the
      // bottom, and the failure was always the same: `TheTwoBarsAreAdjacent`
      // reporting the gap to the centre card collapsing. In flow the header
      // and the bar occupy the space they occupy. There is no number to keep
      // in step, and nothing to measure when the bar next changes shape.
      //
      // `container-type: inline-size` is what `panelWidthsFor` sizes against.
      // The row stays content-width so it can centre by overflowing equally
      // both sides, which means it cannot be the basis for its own children —
      // see the note there.
      // `gap-6` IS THE CLEARANCE, and it is a gap rather than free space on
      // purpose. The row centres itself with `my-auto`, which only separates
      // anything when there IS free space — in a container that is exactly as
      // tall as its contents there is none, and the row butts straight up
      // against the bar. `TheTwoBarsAreAdjacent` caught precisely that, at 0
      // against its floor of 16. A flex gap applies either way, and the two
      // compose: the gap is the minimum, `my-auto` spends whatever is left
      // over.
      //
      // 12px, ASKED FOR. It was 24 — where the design this follows sits, about
      // 27 — and this column has exactly three children, so that gap was being
      // spent twice on the two places there was least to gain from it: above
      // the cards, and between the cards and the film. Half of it goes back to
      // the deck, which is the only child that can use height (`fit()` turns a
      // taller deck into a wider card).
      //
      // THIS IS THE ONLY SPACING THERE. `.deck`'s own `margin:20px 0 4px` in
      // `playbar-styles.ts` reads like it contributes and does not — `ClipDeck`
      // zeroes both margins inline on every render, in both the fitted and the
      // unfitted branch, so the flex gap is the whole story on both sides.
      //
      // The floor is `TheTwoBarsAreAdjacent`'s: the film and the cards may not
      // touch, asserted at more than 8px. 12 clears it with room, and it is a
      // gap rather than free space so it holds even when there is none to
      // spend.
      // THE ROW FADES AT ITS EDGES RATHER THAN BEING CUT (PL15-030).
      //
      // `overflow-clip` alone ends a card mid-picture at the boundary, which
      // reads as a rendering fault rather than as "there is more this way". The
      // reference masks its deck to transparent over the outer 5%, so the cards
      // either side leave the row instead of being sliced by it — and the crop
      // stops competing with the subject for the eye.
      //
      // On the VIEW, not the row: the row is transformed, and a mask on a
      // moving element travels with it, so the fade would slide off the edge it
      // is meant to be softening.
      style={{
        containerType: "inline-size",
        maskImage: DECK_EDGE_FADE,
        WebkitMaskImage: DECK_EDGE_FADE,
        // SCROLLS ONLY WHEN IT IS BOUNDED — AND IT IS ALWAYS BOUNDED NOW.
        //
        // `auto` makes this a scroll container, and a scroll container inside
        // ancestors that allow shrinking takes the scroll off the PAGE and puts
        // it in here — measured, 222px of internal scroll with the pane down
        // where the page had simply been longer. That was the argument for
        // `clip` with the pane down: the view grew instead, and the page
        // scrolled.
        //
        // The view no longer grows — the ceiling applies in both states — so
        // `clip` would now mean the bottom of the cards is CUT OFF rather than
        // reachable on a window too short for the ladder's floor. A scrollbar
        // that appears only when the view genuinely cannot fit is the right
        // failure; silently hiding a card is not.
        overflowY: "auto",
        // COVER MODE lifts the view out of the column and over the pane. z-45
        // is above the surface's z-40 and below the header's z-50, which states
        // the whole requirement as a single number: over the preview, under the
        // breadcrumb.
        //
        // Only once the box has been MEASURED — painting a full-width overlay
        // for the frame before the header has been read would flash the view
        // across the trail, which is the one thing this mode must not do.
        ...(coverMode && coverBox !== null
          ? {
              position: "fixed" as const,
              top: Math.round(coverBox.top) + "px",
              left: Math.round(coverBox.left) + "px",
              width: Math.round(coverBox.width) + "px",
              bottom: 0,
              height: "auto",
              zIndex: 45,
            }
          : {}),
      }}
      // `overflow-x: clip` still, for the row's scrim — but the Y axis is
      // `auto`: the height above is a CEILING, and on a window too short for
      // even the smallest deck the scroll belongs INSIDE this view rather than
      // on the page, where it would carry the header and the bar away with it.
      className={[
        "relative flex min-h-0 flex-1 flex-col gap-3 overflow-x-clip",
        // AN OPAQUE GROUND WHILE COVERING, and it is not decoration.
        //
        // In the default mode this view REPLACES the board, so it sits on the
        // page's own background and needs none of its own. Covering, it sits
        // over a live preview and the divider band — and with a transparent
        // ground both read straight through the cards, which is what "the
        // preview and divider are still viewable behind it" is.
        //
        // `zinc-950` is what the header region and the preview region are
        // already painted with, so the covered view matches the surface it is
        // standing in for rather than introducing a third shade.
        coverMode ? "bg-zinc-950" : "",
      ].join(" ")}
    >
      {/* THE BAR, above everything and spanning it: the cut's clock. Outside
          the strip because it must not travel with it — the row slides, and a
          bar that slid with it would be measuring from a moving origin. */}
      {/* THE TOP BLOCK: what this view is, then where playback is in it. One
          absolutely-positioned column so the header and the bar move together
          and the row below is free to be cropped by the scrim. */}
      <div
        // IN FLOW. It was `absolute inset-x-0 top-0` so the row could centre in
        // the scrim without the header taking any of it — which is what the
        // reserved top band was paying for. It takes its own height now, and
        // `pointer-events-none` goes with the absolute layer that needed it:
        // nothing here is covering the row any more.
        onPointerDown={(event) => event.stopPropagation()}
      >
        <ItemDetailsHeader
          title={node.name}
          collectionName={place.name}
          index={place.index}
          total={place.total}
          centreId={node.id as string}
          onClose={onClose}
        />
      </div>
      {/* THE DECK ABOVE, THE FILM BELOW.
          Swapped from the reference's order, which puts its strip under the
          player and the cards under that. Here the strip is the whole
          sequence and the deck is the clip being worked on, so the film reads
          as the ground the work sits on rather than a header above it — and
          the skim card, which hangs above the playhead, now floats over the
          cards instead of over the page furniture. */}
      {/* THE PORTED CLIP DECK, IN PLACE OF THE PANEL ROW (PL15-030).
          The reference's deck: same-width cards with the ones beside the
          subject scaled, dimmed and desaturated, swipeable with a fling.

          WHAT THIS COSTS, said plainly because it is not nothing. The panel it
          replaces carried an inline rename, the disable toggle, the layer-frame
          picker and the real tag editor; the reference's card has none of them,
          so they are not on screen here. The trim and the selection DO go
          through the same command path they always did — see `onTrim` below,
          which dispatches the same `update-media` the trim fields did. */}
      <ClipDeck
        standalone={false}
        previewing={deckPreviewing}
        previewPoster={deckPreviewPoster}
        previewSurface={
          deckPreviewing && previewNode !== null ? (
            <MediaPreviewSurface
              media={previewNode}
              sourceTime={deckPreviewVideoTime ?? null}
              playing={playing}
              // SOUND WHILE PLAYING, SILENT WHILE SCRUBBING (PL16-004).
              //
              // Judging a cut is not only a picture problem — a line landing
              // across the join, or music that stops dead on it, is what is
              // being listened for as often as the frame is looked at. But a
              // dragged playhead sweeping a sequence is not playback, and
              // unmuting it produces noise rather than information.
              //
              // Nothing new is built for this: the surface already takes
              // `audible`, and the element it puts up carries the clip's own
              // track. `useSeekedVideo` is what starts and stops it.
              audible={playing}
              scrubbing={skimSeconds !== null || trimSkim !== null}
              // COVER, because this fills a card's picture box rather than a
              // panel. The monitor's own use of the same component contains.
              fit="cover"
              className="h-full w-full"
            />
          ) : undefined
        }
        // TAKES WHAT THE BAR LEAVES — but only when the pane is up and the
        // height is actually contested. `min-h-0` because a flex item's default
        // `min-height: auto` refuses to shrink below its content, which is the
        // refusal that would otherwise put the cards below the fold.
        //
        // With the pane down this is deliberately NOT a flex item: left as one
        // it shrank instead of letting the column grow, so the page stopped
        // scrolling and the section clipped 222px of deck instead.
        className={fitting ? "min-h-0 flex-1" : undefined}
        fitToHeight={fitting}
        // THE `3 · 5` CONTROL, WIRED BACK UP. It sized the old panel row and
        // has had nothing to act on since the deck replaced it — a setting
        // still on screen, still remembered, and inert. Five ADDS a card each
        // side at the same pitch rather than fitting five into the width the
        // three had, so the clips being read do not shrink because a setting
        // asked for more of them.
        neighbours={half}
        frameAt={frameAt}
        // THE THUMBNAIL LANDS HERE. The board card carries this name until the
        // view mounts; the subject's picture takes it over, and the browser
        // morphs one into the other. Nothing had worn it since the deck
        // replaced the panel row — `DetailsPanel` still holds the only other
        // application and is no longer rendered — so the card was giving the
        // name up to nobody and the flight had no destination.
        heroName={HERO}
        clips={deckClips}
        activeId={node.id as string}
        onActivate={(clipId) => landOn(clipId, position)}
        onTrim={commitTrim}
      />

      {/* HOW MANY CLIPS TO SHOW, bottom right and out of the way.
          Deliberately down here rather than up with the transport: that bar is
          about the cut you are looking at, and this is about how much of the
          timeline is on screen — a question you answer once and then work,
          not a control you reach for while judging a seam. */}
      <div
        className="pointer-events-auto absolute right-6 bottom-6 z-10 transition-opacity duration-200"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {/* NO LABEL. Every other group in the view wears one, and this is the
            single exception: `3 · 5` sits alone in a corner with nothing to be
            confused with, and the words "clips on screen" are already in its
            aria-label and in every segment's title. */}
        <SegmentedControl
          ariaLabel="Clips on screen"
          groupAttribute="data-details-view-count"
          segments={VIEW_COUNTS.map((count) => ({
            value: count,
            label: count,
            title: "Show " + count + " clips",
            active: count === viewCount,
          }))}
          onSelect={chooseViewCount}
        />
      </div>

      {/* THE TRANSPORT: previous, play, next.
          UNDER THE DECK AND ABOVE THE STRIP, which is where it belongs on both
          counts — it acts on the cut the deck is showing, and the strip below
          is the thing it moves through. Centred, because it is the one control
          in this view that is about the whole sequence rather than about a
          corner of it.

          PLAY RAISES THE PREVIEW, and that is the point of it rather than a
          side effect: pressing play is a request to watch, so the deck becomes
          the screen exactly as it does under a scrub. Nothing here sets that —
          `deckPreviewing` derives it from `playing`, so pause puts the cards
          back without a second piece of state to keep in step. */}
      <div className="flex items-center justify-center gap-2" data-details-transport>
        <button
          type="button"
          data-details-transport-prev
          aria-label="Previous clip"
          title="Previous clip"
          disabled={previousClipId === null}
          onClick={() => {
            if (previousClipId !== null) landOn(previousClipId, null);
          }}
          className={TRANSPORT_BUTTON_CLASS}
        >
          <SkipBack aria-hidden="true" className="h-4 w-4" />
        </button>
        <button
          type="button"
          data-details-transport-play
          data-playing={playing ? "" : undefined}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          onClick={() => setPlaying((was) => !was)}
          className={TRANSPORT_PLAY_CLASS}
        >
          {playing ? (
            <Pause aria-hidden="true" className="h-5 w-5" />
          ) : (
            <Play aria-hidden="true" className="h-5 w-5" />
          )}
        </button>
        <button
          type="button"
          data-details-transport-next
          aria-label="Next clip"
          title="Next clip"
          disabled={nextClipId === null}
          onClick={() => {
            if (nextClipId !== null) landOn(nextClipId, null);
          }}
          className={TRANSPORT_BUTTON_CLASS}
        >
          <SkipForward aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>

      {/* The STRIP: one row, translated. Centred by the scrim, then offset by
          the subject's index so the clip being worked on lands mid-screen. */}
      {timeline.totalSeconds > 0 && (
        <div
          // IN FLOW, for the same reason the header above is — `top-16` was
          // the header's height restated as a constant, and that is exactly
          // the kind of number that goes stale silently.
          className="px-6 pt-4"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {/* THE SAME WIDTH AS THE ROW BELOW IT.

              This was capped at `7xl` on the reasoning that the bar is a
              map and gets more useful the more of the project it can show,
              so it should be WIDER than the panels — which was true while
              the panels were capped too.

              They are not any more, and the cap inverted the intent it was
              written for: measured at 1920 the cards ran 1872px and the bar
              1280, so the cards overhung the thing they belong to by 296px
              on each side. A ruler that does not reach as far as the row it
              measures reads as a floating island rather than as the top of
              one panel. Sharing the edge costs the bar nothing — it only
              ever gets wider. */}
          <div className="mx-auto w-full">
            <PlaybarThumbnailsProvider shown={frames.shown} style={frames.style}>
            {/* THE PORTED STRIP, IN PLACE OF THE WHOLE BAR (PL15-030).
                The reference's film strip replaces the ruler, the boxes, the
                playhead and the minimap — and the controls row goes with them,
                which was an explicit call rather than a casualty: the clock, the
                five transport buttons, the reach picker and the settings gear all
                lived inside `SeamStripBar`.

                REACH HAD NOTHING LEFT TO DO. It existed because the old bar could
                not move, so seeing more of the sequence meant paging a window.
                This strip PANS, with inertia, across every clip at once — so its
                clock is the timeline's by construction. */}
            <FilmStrip
              standalone={false}
              shots={stripShots}
              seconds={shownSeconds}
              playing={playing}
              selectedId={node.id as string}
              onScrub={(seconds) => {
                if (userScrubbingRef.current) setPlaying(false);
                setBarSeconds(Math.min(Math.max(seconds, 0), timeline.totalSeconds));
              }}
              onSkim={(seconds) => {
                userScrubbingRef.current = seconds !== null;
                setSkimSeconds(seconds);
              }}
              onTrimSkim={setTrimSkim}
              skimPreview={skimPreview}
              onTrim={commitTrim}
              onTogglePlay={() => setPlaying((was) => !was)}
              onSelect={(clipId) => landOn(clipId, position)}
            />
            </PlaybarThumbnailsProvider>
          </div>
        </div>
      )}
    </section>
  );

  // Portalled only while covering, and only once the box has been measured —
  // an unmeasured overlay at the root would paint full-bleed for a frame,
  // across the very trail this mode exists to keep visible.
  return coverMode && coverBox !== null ? createPortal(view, document.body) : view;
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
  const node = useCollectionsSelector((s) => {
    // `openId` while opening and open; `mountedId` while closing, when the
    // context has already let go but the pixels are still here.
    const id = openId ?? mountedId;
    if (id === null) return null;
    return s.graph.nodesById.get(parseNodeId(id)) ?? null;
  });
  // MOUNTED IN THE SAME COMMIT THE CONTEXT OPENS IN, not one effect later.
  //
  // `setOpenId` starts the opening flight, because by the time an effect here
  // could run the board is already hidden and there is nothing left to fly
  // FROM — measured, the card carried the hero name and had ZERO WIDTH, so no
  // `old` snapshot was taken at all and the "morph" was the destination fading
  // in on its own. The transition's callback flushes the context's state
  // synchronously, so this view has to appear in THAT render for the "after"
  // capture to contain it.
  //
  // `mountedId` still matters, but only on the way OUT: it is what keeps this
  // on screen for the render in which the context has already let go, which is
  // the entire closing animation.
  const wantedNow =
    openId !== null && node !== null && (node.kind === "collection" || !!node.src);
  const mounted = wantedNow || mountedId !== null;

  // Opening and closing are driven by the context flag so the toolbar button,
  // Escape and the close button go through one path — and they are now the
  // only two, the scrim having gone with PL15-029. ESCAPE'S OWNER IS THIS
  // VIEW while it is open: it is what fills the content area, so there is
  // nothing else in that space with a claim on the key.
  // WHAT IS ON SCREEN, recorded during the render that puts it there.
  //
  // Adjusted here rather than in an effect for the reason the context adjusts
  // `urlIdSeen` the same way: an effect that sets state is a second render, and
  // the lint rejects it outright. NOTHING opens from here any more — the
  // opening flight belongs to `setOpenId`, which is the only place the board is
  // still on screen to fly from. This is bookkeeping for the way out.
  if (wantedNow && node !== null && mountedId !== node.id) {
    setMountedId(node.id as string);
  }

  useEffect(() => {
    if (wantedNow || mountedId === null) return;
    // THE CARD IS LOOKED UP INSIDE THE CALLBACK, AND HAS TO BE.
    //
    // This read used to sit out here, and at this moment the board DOES NOT
    // EXIST: the details view is still the content area, so there is no card
    // to collapse back into and the lookup returned null every time. The
    // name was then handed to nothing, the browser had an old state and no new
    // one to morph toward, and closing was a fade — the exact mirror of the
    // opening bug, where the SOURCE had gone by capture time instead of the
    // destination never arriving.
    //
    // `setMountedId(null)` is what puts the board back, and `withViewTransition`
    // flushes it synchronously, so one line later the card is in the DOM. The
    // holder carries it out to the cleanup, which cannot re-query it — by then
    // it may have moved again.
    const holder: { card: HTMLElement | null } = { card: null };
    void withViewTransition(() => {
      // Clearing this is what unmounts the view, and it happens HERE — inside
      // the callback, after the browser has captured the frame the view is
      // still in. That ordering is the animation.
      setMountedId(null);
      // AND THE BOARD'S SCROLL IS RESTORED HERE, not in a layout effect one
      // render earlier (PL15-035).
      //
      // It used to run the moment `openId` went null, which is one render
      // BEFORE this callback — and in that render the details view is still in
      // normal flow. Dragging the page down 291px therefore dragged the view
      // 291px UP, to y=-242, above the viewport. `startViewTransition` captures
      // the old state at the next rendering opportunity rather than when it is
      // called, so THAT displaced position is what the browser captured, and a
      // morph whose old box is above the viewport is a picture flying in from
      // off screen.
      //
      // Restoring it HERE is the whole fix. The board is already back in flow
      // from the render the context triggered, so the page can hold the offset;
      // the old capture has already been taken, so moving the page now cannot
      // reach back and displace what the morph is flying FROM.
      restoreBoardScroll();
      holder.card = heroElement(mountedId);
      // AN ATTRIBUTE, for the same reason the opening flight uses one: React
      // is rendering this card now, and it rewrites the `style` attribute it
      // manages on any re-render that lands before the browser captures. It
      // does not touch an attribute it was never given. The name itself comes
      // from the `[data-details-hero]` rule in `globals.css`.
      holder.card?.setAttribute(HERO_ATTRIBUTE, "");
    }).then(() => {
      holder.card?.removeAttribute(HERO_ATTRIBUTE);
    });
  }, [mountedId, wantedNow]);

  // ESCAPE CLOSES — AND IT NEEDED AN OWNER TO.
  //
  // The comment above has claimed this for two revisions and nothing has
  // listened for the key since the port: the handler went with the scrim it
  // used to live on, and because the story that covers it also asserts the
  // scrim does NOT close, the failure read as "the scrim dismissed" rather
  // than "nothing closes at all".
  //
  // On the DOCUMENT, because the thing that must answer the key is the view
  // rather than whatever inside it happens to have focus — after a trim the
  // focus is on a handle, after a swipe it is nowhere. Fields are excluded:
  // Escape in a text field means "abandon this edit", and the field is
  // entitled to keep it.
  //
  // A LAYOUT EFFECT, so the view owns the key from the frame it appears in.
  // A passive effect runs after paint, and the view appears mid-transition —
  // the browser is holding a snapshot over the page for ~380ms, which is
  // exactly long enough for a hand (or a test) to reach Escape before the
  // listener is attached. Measured: the e2e case passed alone and failed under
  // a loaded six-worker run, which is the shape of a race rather than a bug in
  // what it asserts.
  useLayoutEffect(() => {
    if (!wantedNow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? "";
      if (target?.isContentEditable === true) return;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      event.preventDefault();
      setOpenId(null);
    };
    // ON THE CAPTURE PHASE, AND WITHOUT A `defaultPrevented` GUARD.
    //
    // Both were wrong, and together they made Escape work from one route and
    // not the other. Opening by CLICKING A CARD leaves focus on that card, and
    // a card is a dnd-kit draggable whose keyboard sensor takes Escape to mean
    // "cancel the drag" and calls `preventDefault` on it. Bubbling in behind
    // that, this handler saw a defaulted-prevented event and stood down — so
    // Escape closed the view when it had been opened through the helper (focus
    // elsewhere) and did nothing when opened by hand, which is every real use.
    //
    // Capturing is safe here rather than merely convenient: the board is GONE
    // while this view is up, so there is no drag in flight for the sensor's
    // reading of the key to be about.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [wantedNow, setOpenId]);

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

/**
 * THE BOARD, which steps aside while details are open (PL15-029).
 *
 * Details replace the content area rather than cover it, so something has to
 * decide which of the two is showing. This is that decision, and it lives in a
 * component rather than in `graph-board` because the board is what RENDERS
 * `ItemDetailsProvider` — a `useItemDetails()` call up there reads the closed
 * fallback outside its own provider, which fails silently as "details never
 * open" rather than as an error.
 *
 * HIDDEN, NOT UNMOUNTED, and that was an explicit choice. Unmounting is cheaper
 * while details are open and costs the board its scroll position, its selection
 * and any in-flight drag — all of which the person coming back expects to find
 * where they left it. Keeping it mounted pays for that with the whole board
 * sitting behind a view that covers it, which is the cost the grid
 * virtualization item is already about; that cost is bounded and known, and
 * losing someone's place is not.
 *
 * `display: none` as an inline style, deliberately, and not a `hidden` class:
 * this element also carries `flex`, and two utilities setting `display` in the
 * same layer are decided by stylesheet order rather than by the order they are
 * written here — which is a coin toss that would read as "sometimes the board
 * does not hide". An inline style has no such argument to lose. It also makes
 * the subtree non-focusable and non-interactive for free, so no `inert` is
 * needed alongside it.
 */
export function GraphBoardContent({ children }: Readonly<{ children: ReactNode }>) {
  const { openId } = useItemDetails();
  const open = openId !== null;

  // WHERE THE BOARD WAS, which `display: none` does not keep for it.
  //
  // MEASURED, because the opposite was assumed first: the board scrolls the
  // DOCUMENT rather than a container of its own, so hiding it collapses the
  // page from 1087px to 910 and the browser clamps the window scroll to 0.
  // Coming back put someone who had scrolled to 177 back at the top. Keeping
  // the board mounted preserves its selection and any in-flight drag, which is
  // why that was chosen — but the scroll position is the window's, not the
  // board's, and it was never covered by that choice.
  //
  // Recorded on scroll rather than at the moment of opening, because by the
  // time an effect can see `openId` change the board is already hidden and the
  // number is already 0. Passive, and only registered while the board is
  // actually showing: it stores one integer and is not listening at all for
  // the whole time details are up.
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) return;
    const onScroll = () => {
      parkBoardScroll(window.scrollY);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [open]);

  // THE RESTORE MOVED OUT OF HERE (PL15-035), and what is left is the case it
  // could not reach.
  //
  // It used to run on this commit, which is one render before the closing
  // transition — and at that point the details view is still in normal flow, so
  // scrolling the page down scrolled the view up out of the viewport and the
  // browser captured it there. `restoreParkedBoardScroll` is now called inside
  // the transition's callback, where the old capture is already taken.
  //
  // WHAT STAYS: closing without a transition to hang it on. The view's effect
  // only runs when it had actually mounted, so an `openId` that never produced
  // one — a node with no source, a deep link to something that has gone — hides
  // the board and then reveals it with nothing in between. Guarded on the view
  // being absent so it never races the path above.
  useLayoutEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (document.querySelector("[data-item-details]") !== null) return;
    restoreBoardScroll();
  }, [open]);

  return (
    <div
      className="flex flex-col gap-2"
      style={open ? { display: "none" } : undefined}
    >
      {children}
    </div>
  );
}

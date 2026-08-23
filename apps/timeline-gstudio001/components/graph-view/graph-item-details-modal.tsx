"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudioLines, Pause, Play, Redo2, Undo2, X } from "lucide-react";

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
import { detailsStepTransition } from "./graph-details-motion";
import { withViewTransition } from "@/lib/view-transition";
import { detailsWindow, flatOrderRootId } from "./graph-details-neighbours";
import { useSeamTransport } from "./graph-seam-bar";
import type { SeamBarClip } from "./graph-seam-bar-layout";
import { SeamStripBar } from "./graph-seam-strip-bar";
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
import { HERO, PANEL_GAP, cardElement } from "./graph-item-details-shared";
import { useScopedHistory } from "./graph-item-details-history";
import { TrimNumbers } from "./graph-item-details-trim-fields";
import {
  VIEW_COUNTS,
  lastViewCount,
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
  BAR_REACHES,
  barReachLabel,
  barReachWindow,
  lastBarReach,
  rememberBarReach,
  type BarReach,
} from "./graph-item-details-bar-reach";

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
  const graph = useCollectionsSelector((state) => state.graph);

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

  const collectionSeamClips = useMemo(
    () =>
      barWindow.ids
        .map((id) => {
          const found = graph.nodesById.get(parseNodeId(id));
          return found && found.kind === "media" ? seamClipOf(found as MediaNode) : null;
        })
        .filter((clip): clip is SeamClip => clip !== null),
    [barWindow, graph],
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
            }
          : {}),
      };
    });
  }, [barWindow, graph]);

  // ONE WAY TO LAND, whichever gesture asked for it. A click on a box and a
  // released scrub differ only in how the clip was chosen; what happens next
  // — carry the clock, cut rather than travel, fade the panels either side —
  // is the same sentence and is written once.
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
      // THE TOP BAND IS RESERVED, not shared. The header and the bar are
      // absolutely positioned so the row can be centred and cropped
      // symmetrically without them affecting its width — which also means
      // they take no space, and the row would centre straight up underneath
      // them. This padding is the band they occupy: header (61px) plus the
      // bar block at top-16 with its own pt-4 (152px to its underside), plus
      // clearance, plus the reach picker's own row (mt-2 and a ~18px button)
      // — which is why this is 14rem and not the 11rem it was before that
      // picker existed. It grew when the bar did, and it has to keep pace: the
      // symptom of it not doing so is the minimap resting on the top edge of
      // the middle card, which is a quiet eight pixels rather than an obvious
      // fault.
      //
      // MEASURED, each time the bar changes shape. The transport became an
      // ensemble with a 44px play button, which took the block from 116px to
      // 142px — it starts at `top-16` plus its own `pt-4`, so it now ends 222px
      // down and 13rem reserved only 208. Anything added to that block has to
      // be measured and this raised, or the row below rides up into it on a
      // short viewport.
      //
      // 14rem → 18.5rem, for the transport's 36px top margin dropping it clear
      // of the two bars above. This is exactly the failure the note above
      // predicts, and it was caught the way it was meant to be:
      // `TheTwoBarsAreAdjacent` measures the gap between this row and the
      // centre card, and it fell from 22px to 2 — the "quiet eight pixels"
      // arriving as a red test rather than as a screenshot nobody looked at
      // twice.
      //
      // AND THE COMPENSATION IS TWICE THE GROWTH, which is the part worth
      // writing down. This box is `items-center`, so padding added at the top
      // is shared with the bottom when the row is re-centred in what is left —
      // 20px of padding buys only 10px of downward movement. The first attempt
      // added 20 for 20 and recovered half the slack (2 → 12, still short of
      // the 16 floor).
      //
      // So the arithmetic is 224 + 2 × (whatever the block grew by): 20px of
      // transport margin took this to 16.5rem, 36px to 18.5rem (224 + 72 =
      // 296), and the film strip growing from 36px to 48px takes it to 20rem
      // (296 + 24 = 320). Anything that makes the bar taller moves this by
      // twice as much, in the same direction — and the failure is always the
      // same one, `TheTwoBarsAreAdjacent` reporting the gap to the centre card
      // collapsing below its floor.
      // `overflow-clip`, NOT `overflow-hidden`. Both crop, but `hidden` makes
      // this a SCROLL CONTAINER — and the row is thirteen thousand pixels
      // wide, so there is a great deal for it to scroll. Landing on a new clip
      // moves focus to that panel's menu button, the browser scrolls the
      // container to reveal it, and that scroll lands ON TOP of the transform
      // the row has already made: measured, 1981px of `scrollLeft` against a
      // row that had itself moved 1728px, which put the card just chosen
      // entirely off the left edge. `clip` crops without ever being
      // scrollable, so the transform stays the only thing that moves the row.
      className="fixed inset-0 z-[80] flex items-center justify-center overflow-clip bg-black/80 px-6 pt-[20rem] pb-6 backdrop-blur-sm"
      // THE SCRIM DOES NOT DISMISS. Deliberate: this view is worked in, not
      // glanced at — trimming, scrubbing and swiping all end with the pointer
      // somewhere unpredictable, and the panels are cropped by the scrim
      // rather than surrounded by it, so "outside" is a place the hand lands
      // by accident. Escape and the close button are the only two ways out,
      // and both are explicit. The stopPropagation guards below are older
      // than this and are left alone: they keep presses on the header and the
      // bar from reaching anything listening further up.
    >
      {/* THE BAR, above everything and spanning it: the cut's clock. Outside
          the strip because it must not travel with it — the row slides, and a
          bar that slid with it would be measuring from a moving origin. */}
      {/* THE TOP BLOCK: what this view is, then where playback is in it. One
          absolutely-positioned column so the header and the bar move together
          and the row below is free to be cropped by the scrim. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20"
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
      {timeline.totalSeconds > 0 && (
        <div
          className="pointer-events-auto absolute inset-x-0 top-16 z-20 px-6 pt-4"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {/* WIDER THAN THE ROW BELOW IT, deliberately. The panels are
              sized to be worked in and cap out; the bar is a map and gets
              more useful the more of the project it can show at a legible
              scale — at `5xl` a twenty-clip reach was boxes a few pixels
              wide. */}
          <div className="mx-auto w-full max-w-7xl">
            <PlaybarThumbnailsProvider shown={frames.shown} style={frames.style}>
            <SeamStripBar
              clips={barClips}
              panelClipIds={panelClipIds}
              // WHETHER THE BAR HAS ACTUALLY RUN OUT, which is a different
              // question from whether it has run out of boxes. At a reach of
              // ten the window is cropped at both ends nearly everywhere in a
              // long project, and the last box on screen is simply the last
              // one the reach allowed. These are true only when the window has
              // reached the real ends.
              // THE VIEW'S OWN SETTINGS, handed to the bar to place. They
              // used to be a row of their own beneath it; they are read
              // against the bar directly above them, so they belong in the
              // bar's own controls row alongside the transport and the clock.
              settingsLeft={
                <>
                <div
                  data-details-bar-frames
                  role="group"
                  aria-label="What the bar's boxes draw"
                  className="flex items-center gap-1"
                >
                  <span className="mr-1 font-mono text-[10px] text-zinc-500">frames</span>
                  {/* THREE BADGES, TWO SETTINGS. Whether the boxes draw frames
                      and which kind are separate answers, but as controls they
                      are one question — a picture of what the bar is made of —
                      and a row that reads OFF · COVER · STRIP says it in the
                      shape the reach beside it already uses.

                      OFF DOES NOT WIPE THE STYLE. It sets `shown` and leaves
                      `style` alone, so coming back lands on the kind you were
                      using: switching frames off and on stays a comparison you
                      can make twice rather than a choice you re-enter. That is
                      the whole reason the two are stored apart even though they
                      are pressed together. */}
                  {(["off", ...PLAYBAR_THUMBNAIL_STYLES] as const).map((option) => {
                    const active = option === "off" ? !frames.shown : frames.shown && frames.style === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          chooseFrames(
                            option === "off"
                              ? { ...frames, shown: false }
                              : { shown: true, style: option },
                          )
                        }
                        title={
                          option === "off"
                            ? "Plain boxes"
                            : option === "cover"
                              ? "One frame filling each box"
                              : "A strip of frames across each clip"
                        }
                        className={[
                          "min-w-7 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors",
                          active
                            ? "bg-zinc-100 text-zinc-900"
                            : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                        ].join(" ")}
                      >
                        {/* `STRIP`, not `FILMSTRIP`: these badges sit beside a
                            reach picker of two- and three-character tokens, and
                            one nine-character label would set the row's rhythm
                            for the sake of a word the title attribute already
                            says in full. */}
                        {option === "filmstrip" ? "STRIP" : option.toUpperCase()}
                      </button>
                    );
                  })}

                </div>

                {/* WHERE THE HOVER CARD SITS.
                    ITS OWN GROUP, next to `frames` rather than inside it. They
                    sit together because they are the same kind of question —
                    what this bar does while you read it — and because the card
                    only exists to show the frames the control beside it turned
                    on. But "what the boxes draw" and "where the preview sits"
                    are two settings, and folding the second into the first
                    group gave that group five buttons under an aria-label
                    describing three of them.

                    `PIN` parks it dead centre under the bar so the pointer
                    scrubs and the picture changes in place. That matters now
                    the card is big enough to judge a frame in: a large picture
                    sliding around under a moving pointer is the one
                    arrangement in which you cannot judge anything, because the
                    eye spends the sweep re-finding it. The cost is that a card
                    away from the box is less obviously ABOUT that box, which
                    is why this is a choice and not a change. */}
                <span aria-hidden="true" className="mx-1 h-3 w-px bg-white/10" />
                <div
                  data-details-bar-card
                  role="group"
                  aria-label="Where the hover preview sits"
                  className="flex items-center gap-1"
                >
                  <span className="mr-1 font-mono text-[10px] text-zinc-500">card</span>
                  {PREVIEW_ANCHORS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={option === previewAnchor}
                      onClick={() => choosePreviewAnchor(option)}
                      title={
                        option === "follow"
                          ? "The preview follows the pointer"
                          : "The preview stays under the middle of the bar"
                      }
                      className={[
                        "min-w-7 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors",
                        option === previewAnchor
                          ? "bg-zinc-100 text-zinc-900"
                          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                      ].join(" ")}
                    >
                      {option === "follow" ? "FOLLOW" : "PIN"}
                    </button>
                  ))}
                </div>
                </>
              }
              settingsRight={
              <div
                  data-details-bar-reach
                role="group"
                aria-label="Clips either side on the bar"
                className="flex items-center gap-1"
            >
                <span className="mr-1 font-mono text-[10px] text-zinc-500">reach</span>
                {BAR_REACHES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={option === reach}
                    onClick={() => chooseReach(option)}
                    title={
                      option === "all"
                        ? "Reach the whole sequence"
                        : `Reach ${option} clips either side`
                    }
                    className={[
                      "min-w-7 rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors",
                      option === reach
                        ? "bg-zinc-100 text-zinc-900"
                        : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                    ].join(" ")}
                  >
                    {barReachLabel(option)}
                  </button>
                ))}
            </div>
              }
              previewAnchor={previewAnchor}
              atStart={barWindow.ids[0] === ids[0]}
              atEnd={barWindow.ids[barWindow.ids.length - 1] === ids[ids.length - 1]}
              centreClipId={node.id as string}
              colourOf={clipColourOf}
              playheadAt={playheadAt}
              playing={playing}
              onTogglePlay={() => setPlaying((was) => !was)}
              // The same step the swipe and the neighbour-click make, so all
              // three land in one place and cannot drift apart.
              onStepBack={hasPrevious ? () => onOpenNeighbour(ids[centre - 1]!) : null}
              onStepForward={hasNext ? () => onOpenNeighbour(ids[centre + 1]!) : null}
              onPreviewingChange={setPreviewing}
              // The clock spans every clip, so a point on the rail IS a point
              // on the clock and needs no conversion.
              //
              // THE CARDS FOLLOW THE SCRUBBER WHEN IT IS LET GO — however it
              // was let go. A click and a two-pixel drag are the same gesture
              // as far as the hand is concerned, so they land the same way:
              // both re-centre the row, and both bring the frame with them.
              // Splitting them would mean a few pixels of travel decided
              // whether you kept your place in the shot.
              onCommitClip={(clipId) => landOn(clipId, position)}
              onScrubSeconds={(seconds) => {
                setPlaying(false);
                setBarSeconds(Math.min(Math.max(seconds, 0), timeline.totalSeconds));
              }}
            />
            </PlaybarThumbnailsProvider>
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
        className={[
          "pointer-events-auto absolute right-6 bottom-6 z-10 flex items-center gap-1",
          "rounded-lg border border-zinc-700 bg-zinc-950/90 p-1 backdrop-blur-sm",
          "transition-opacity duration-200",
        ].join(" ")}
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
        ref={stripRef}
        data-details-strip
        className={[
          "flex items-center",
          // NO TRANSITION WHILE A FINGER IS ON IT. A drag has to track the
          // hand exactly; easing it would put the film a fixed distance
          // behind wherever the pointer actually is, which reads as lag
          // rather than as smoothing. It comes back for the release, so
          // landing on the next clip is animated and letting go short of the
          // threshold springs back.
          //
          // A BAR LANDING has no transition at all, which the layout effect
          // above does to the node rather than from here.
          dragPx === 0
            ? "transition-[transform,opacity] motion-reduce:transition-none"
            : "",
          // BACK, WHILE THE PREVIEW IS UP.
          //
          // The hover card is now a picture big enough to judge a frame in,
          // and it is drawn OVER this row rather than in a gap above it. Three
          // bright panels behind it compete with the one thing being looked
          // at — and the card is answering a question about a clip that is
          // usually not one of the three, so the panels are not even context
          // for it.
          //
          // Pulled back rather than hidden: they are still where you are
          // working, and the point of the hover is to check something WITHOUT
          // leaving that. The row comes straight back when the pointer does.
          previewing ? "opacity-40" : "",
        ].join(" ")}
        style={{
          gap: PANEL_GAP,
          transform: rowTransform,
          // THE STEP'S OWN TIMING, shared with the panel widths and the film
          // strip — see . One press, one motion.
          transition: dragPx === 0 ? detailsStepTransition("transform, opacity") : undefined,
        }}
      >
        {ids.map((id, index) => {
          // Nothing travels across the row any more, so the resting window is
          // the whole window: a landing cuts, and the panels it cuts to are
          // the ones already inside it.
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
          // THIS CLIP'S OWN STRETCH OF THE BAR, which is what "play this one"
          // resolves to: `span.from` IS its first frame in clock time. Null for
          // the pair mounted just past the visible edge — they hold geometry so
          // the slide has something to move, and the clock has never heard of
          // them.
          //
          // For the two HALF-VISIBLE edge panels `from` is the head of their
          // lead-in rather than the head of the clip: the bar simply does not
          // contain the earlier part of them. Which is the honest answer —
          // playing from the start of the bar's copy of a clip is the most the
          // clock can offer, and it is also what the panel is showing.
          const span = seamSpanFor(timeline, id);
          const playingHere = playing && position?.clipId === id;
          return (
            <DetailsPanel
              key={id}
              node={media}
              centre={index === centre}
              swapping={swapping}
              clipLabel={`clip ${index + 1}`}
              playingHere={playingHere}
              onPlayFromStart={
                span === null
                  ? null
                  : () => {
                      // A second press on the one that is running is a pause,
                      // and it leaves the playhead where it stopped — the same
                      // contract as the bar's button, so the two controls never
                      // disagree about what pausing means.
                      if (playingHere) {
                        setPlaying(false);
                        return;
                      }
                      setBarSeconds(span.from);
                      setPlaying(true);
                    }
              }
              monitor={
                index === centre && monitorNode && position
                  ? { node: monitorNode, seconds: position.clipSeconds }
                  : // THE PANEL UNDER THE PLAYHEAD KEEPS ITSELF AT THE
                    // PLAYHEAD, even while it is a neighbour.
                    //
                    // This is what makes letting go seamless. Without it, a
                    // clip is resting on its own first frame right up until
                    // the moment it becomes the centre, and only then starts
                    // seeking — so the release reads as: the right frame (in
                    // the outgoing centre, which was monitoring it), a cut,
                    // the FIRST frame, and a skip back to the right one. The
                    // poster fix cannot help here, because this element
                    // already has a decoded frame; it is simply the wrong one.
                    //
                    // Seeking it early means the panel is already showing the
                    // landed frame before it is asked to be the subject, and
                    // the cut has nothing left to change.
                    //
                    // ONE EXTRA ELEMENT SEEKING, not nine: exactly one panel
                    // is under the playhead at a time, and it is the one whose
                    // frame is about to be wanted. The scrub proxy covers it
                    // for the same reason it covers the centre.
                    position !== null && position.clipId === id
                    ? { node: media, seconds: position.clipSeconds }
                    : null
              }
              // Only the monitor makes sound: it is the panel showing what the
              // clock says is on screen, so it is the only one whose audio
              // could be in sync with anything.
              playing={index === centre && playing}
              live={position?.clipId === id}
              swipe={swipe}
              // MOUNTED, BUT NOT ON SCREEN.
              //
              // The spare pair beyond the visible window exists so an arriving
              // panel is already built (see `MOUNTED_RADIUS`) — it was never
              // meant to be SEEN. It used to be off the edge by accident:
              // panels were wide enough that two of them overflowed the
              // viewport entirely. Now three fit it exactly, so the spares sit
              // in the scrim's own 24px padding and show as a sliver down each
              // side — which reads as a fourth and fifth card the count says
              // are not there.
              //
              // Hidden rather than unmounted, and hidden rather than
              // zero-width: the row's centring assumes every non-centre panel
              // is one neighbour wide, so collapsing these would shift every
              // panel between them and the middle.
              spare={Math.abs(index - centre) > half}
              width={index === centre ? panelWidths.centre : panelWidths.neighbour}
              // Engaged, and not the one being watched. Uses the same gate as
              // the playhead lines and the ring, so the whole view agrees on
              // when the clock is running.
              dimmed={scrubbed && index !== centre}
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

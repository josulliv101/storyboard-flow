"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { withViewTransition } from "@/lib/view-transition";
import { detailsWindow, flatOrderRootId } from "./graph-details-neighbours";
import { useSeamTransport } from "./graph-seam-bar";
import { SeamStripBar } from "./graph-seam-strip-bar";
import { buildSeamStrip, stripXFor } from "./graph-seam-strip";
import {
  buildSeamTimeline,
  seamAt,
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
  panelWidthFor,
  rememberViewCount,
  type ViewCount,
} from "./graph-item-details-view-count";

/**
 * How many pixels a second of clip is worth ON THE BAR.
 *
 * Fixed, which is the whole point: it is what makes a box the size of its
 * clip rather than a share of whatever else happens to be on screen, so the
 * same shot is the same width whether three cards are up or five. At 9px a
 * ten-second shot is 90px — long enough to aim a pointer at, short enough
 * that a minute and a half of material still reads as a shape.
 */
const BAR_PIXELS_PER_SECOND = 9;

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
  const [playing, setPlaying] = useState(false);
  // A DRAG IS IN PROGRESS ON THE BAR. Distinct from `scrubbed`, which stays
  // true once the clock has been touched: this is the gesture itself, and it
  // is what the monitor grows for.
  const [scrubbing, setScrubbing] = useState(false);
  // HOW MANY CLIPS ARE ON SCREEN. Remembered for the session rather than the
  // page: it is a way of working — reading one cut closely, or scanning a
  // sequence — and having it snap back to three every time you open a clip
  // would make the wider views something you re-choose rather than something
  // you use.
  const [viewCount, setViewCount] = useState<ViewCount>(lastViewCount());

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
  const collectionSeamClips = useMemo(
    () =>
      ids
        .map((id) => {
          const found = graph.nodesById.get(parseNodeId(id));
          return found && found.kind === "media" ? seamClipOf(found as MediaNode) : null;
        })
        .filter((clip): clip is SeamClip => clip !== null),
    [ids, graph],
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
  // THE COLLECTIONS A CLIP SITS INSIDE, outermost first, as tint indices.
  //
  // A CHAIN rather than one colour, because nesting is the thing being shown.
  // Take a collection tinted orange holding two clips, then a collection
  // tinted red holding two more, then two clips back in the first: the four
  // outer clips are orange and the inner two are red — but the inner two are
  // ALSO still inside the orange one, and a single colour cannot say that.
  // The bar draws the last entry as the box and the ones before it as thin
  // bars across the top, so a red box under an orange line reads as "red,
  // inside orange".
  //
  // THE ROOT IS EXCLUDED. Every clip in the view descends from it, so a stripe
  // for it would be on every box — a constant, which is not information.
  //
  // Indices are assigned by ORDER OF FIRST APPEARANCE, which walking the flat
  // order gives for free: a parent collection is always met before the
  // children nested in it, so outer collections take the earlier tints and two
  // adjacent collections never collide.
  const tintChainOf = useMemo(() => {
    const rootId = flatOrderRootId(graph);
    const indexByCollection = new Map<string, number>();
    const chains = new Map<string, readonly number[]>();
    for (const id of ids) {
      const ancestors: string[] = [];
      let cursor: string | null =
        (graph.parentById.get(parseNodeId(id)) as string | null | undefined) ?? null;
      while (cursor !== null && cursor !== rootId) {
        ancestors.unshift(cursor);
        cursor =
          (graph.parentById.get(parseNodeId(cursor)) as string | null | undefined) ?? null;
      }
      chains.set(
        id,
        ancestors.map((collectionId) => {
          let index = indexByCollection.get(collectionId);
          if (index === undefined) {
            index = indexByCollection.size;
            indexByCollection.set(collectionId, index);
          }
          return index;
        }),
      );
    }
    return chains;
  }, [ids, graph]);

  const strip = useMemo(() => {
    const clips = ids.map((id) => {
      const found = graph.nodesById.get(parseNodeId(id));
      const media = found && found.kind === "media" ? (found as MediaNode) : null;
      return {
        id,
        showingSeconds: media === null ? 0 : mediaDurationSeconds(media),
      };
    });
    return buildSeamStrip(clips, BAR_PIXELS_PER_SECOND);
  }, [ids, graph]);

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
  const playheadPx = (() => {
    const at = position ?? (centreClip === null ? null : { clipId: centreClip.id as string, clipSeconds: 0 });
    if (at === null) return null;
    return stripXFor(strip, at.clipId, at.clipSeconds);
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
          <div className="mx-auto w-full max-w-5xl">
            <SeamStripBar
              strip={strip}
              centreClipId={node.id as string}
              tintChainOf={tintChainOf}
              playheadPx={playheadPx}
              playing={playing}
              onTogglePlay={() => setPlaying((was) => !was)}
              // The same step the swipe and the neighbour-click make, so all
              // three land in one place and cannot drift apart.
              onStepBack={hasPrevious ? () => onOpenNeighbour(ids[centre - 1]!) : null}
              onStepForward={hasNext ? () => onOpenNeighbour(ids[centre + 1]!) : null}
              onScrubbingChange={setScrubbing}
              onScrubTo={(clipId, secondsIntoClip) => {
                // Back across the seam the other way: the bar reports a clip
                // and an offset into it, and the clock wants bar seconds. The
                // span carries `sourceOffset` because a run-up joins its clip
                // partway through, so the two only line up once it is taken
                // off.
                const span = seamSpanFor(timeline, clipId);
                if (span === null) return;
                const next = span.from + Math.max(0, secondsIntoClip - span.sourceOffset);
                setPlaying(false);
                setBarSeconds(Math.min(Math.max(next, span.from), span.to));
              }}
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
        className={[
          "pointer-events-auto absolute right-6 bottom-6 z-10 flex items-center gap-1",
          "rounded-lg border border-zinc-700 bg-zinc-950/90 p-1 backdrop-blur-sm",
          // Out of the way while the clock is being dragged: how many cards
          // are up is not a question anyone is asking mid-scrub.
          "transition-opacity duration-200",
          scrubbing ? "opacity-20" : "opacity-100",
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
              // Everything but the picture goes out while the clock is being
              // dragged — see `scrubFocus`.
              scrubFocus={scrubbing && index === centre}
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
                  : null
              }
              // EVERY panel rests on its own first frame, the one before the
              // centre included. It used to show that one's LAST frame, on the
              // reasoning that the clip before a cut is best represented by
              // what it hands over — which turned out to read as the wrong
              // picture: a card is the SHOT, and a shot is what it opens on.
              restingFrame="first"
              // Only the monitor makes sound: it is the panel showing what the
              // clock says is on screen, so it is the only one whose audio
              // could be in sync with anything.
              playing={index === centre && playing}
              live={position?.clipId === id}
              // Only the monitor grows, and only while the bar is being
              // dragged: the neighbours are context, and enlarging them would
              // be enlarging the thing you are trying to look past.
              magnified={index === centre && scrubbing}
              scrubbing={index === centre && scrubbing}
              swipe={swipe}
              width={panelWidth}
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

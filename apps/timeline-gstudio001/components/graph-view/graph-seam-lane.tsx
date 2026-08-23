"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";

import { BAR_NEUTRAL_COLOUR } from "@/lib/bar-collection-colours-flag";

import { collectionSeams, type SeamBarClip } from "./graph-seam-bar-layout";
import {
  usePlaybarThumbnails,
  type PlaybarThumbnailStyle,
} from "./graph-playbar-thumbnails";
import { videoFrameUrls } from "@/lib/video-frame-url";
import type { SeamStrip } from "./graph-seam-strip";
import type { PreviewAnchor } from "./graph-seam-preview-anchor";

/**
 * How long the strip takes to slide when the centred clip changes.
 *
 * Long enough to be read as one thing moving rather than as two different
 * pictures — the whole reason to animate this is that the bar re-centres on
 * somewhere else and a jump cannot be told apart from a redraw.
 */
const SEAM_SLIDE_MS = 520;

/** How wide the end-of-project stop is. Wider than the hairline between two
 *  boxes, so it is read as an edge rather than as another gap. */
const CAP_WIDTH_PX = 6;

/**
 * WHERE THE PROJECT ENDS, drawn just outside the first and last boxes.
 *
 * The bar is a window: at most reaches it shows a stretch with more either
 * side, and running out of boxes means only that you have reached the edge of
 * what is on screen. Once the window actually reaches the first or last clip
 * that stops being true, and there is no way to tell the two situations apart
 * from the boxes alone — a bar that has run out looks exactly like a bar that
 * has been cropped.
 *
 * SO IT IS DRAWN, AND ONLY THEN. A solid stop with the light falling away
 * from it: the bar reads left to right as film, so the end of the film is a
 * hard edge with nothing after it. Deliberately not another box — anything
 * box-shaped here would be counted as a clip.
 *
 * INSIDE THE STRIP, so it travels with the boxes rather than sitting at the
 * end of the track. The track's end is a fact about scrolling; this is a fact
 * about the project, and the two are not in the same place at most zooms.
 */
function SeamEndCap({ side, atPx }: Readonly<{ side: "start" | "end"; atPx: number }>) {
  return (
    <span
      data-seam-cap={side}
      aria-hidden="true"
      style={{
        // Just outside the box's own edge, using the same inset the gap
        // between two boxes is made of — so the stop sits at the distance the
        // eye already reads as "next thing along".
        left: side === "start" ? atPx - CAP_WIDTH_PX - BOX_INSET_PX : atPx + BOX_INSET_PX,
        width: CAP_WIDTH_PX,
      }}
      className={[
        "absolute inset-y-1 rounded-[2px]",
        // The gradient runs AWAY from the film: solid against the last frame,
        // gone by the outer edge. A flat bar would read as one more clip in a
        // colour nobody chose.
        side === "start"
          ? "bg-gradient-to-l from-zinc-300/85 to-zinc-300/0"
          : "bg-gradient-to-r from-zinc-300/85 to-zinc-300/0",
      ].join(" ")}
    />
  );
}


/** Roughly the bar's own height (`h-9`), so a cell reads as a square. */
const FILMSTRIP_CELL_PX = 36;
/** Past this the cells stretch rather than multiply — see `SegmentFrames`. */
const MAX_FILMSTRIP_CELLS = 12;

/**
 * WHAT FILLS ONE BOX when frames are switched on: a single frame, or a row of
 * them sampled across the clip.
 *
 * Its own component so the cell arithmetic is not inlined in the middle of the
 * strip's layout, and so React can skip a box whose inputs did not change —
 * the bar re-renders on every pointer move during a drag, and rebuilding a
 * dozen image lists per box per frame is exactly the cost this is not worth.
 */
function SegmentFrames({
  clipId,
  clip,
  posterSrc,
  widthPx,
  style,
}: Readonly<{
  clipId: string;
  clip: SeamBarClip | undefined;
  posterSrc: string | undefined;
  widthPx: number;
  style: PlaybarThumbnailStyle;
}>) {
  // HOW MANY CELLS FIT, at roughly one per bar-height so each reads as a
  // square. Capped, because a long clip at a high zoom is a box thousands of
  // pixels wide and one image per 36px of it is a hundred requests for a
  // single shot. Past the cap the cells stretch rather than multiply, which
  // is the honest trade: still evenly spaced across the clip, just wider than
  // they are tall.
  const cells = useMemo(() => {
    if (style !== "filmstrip" || clip?.posterSrcs === undefined) return null;
    const wanted = Math.min(
      MAX_FILMSTRIP_CELLS,
      Math.max(1, Math.round(widthPx / FILMSTRIP_CELL_PX)),
    );
    const urls = videoFrameUrls(clip.posterSrcs, wanted, {
      trimInSeconds: clip.trimInSeconds ?? 0,
      effectiveSeconds: clip.showingSeconds,
    });
    return urls.length === 0 ? null : urls;
  }, [clip, style, widthPx]);

  if (cells !== null) {
    return (
      <span
        data-seam-filmstrip={clipId}
        // EVERY FRAME IS FRAMED, not just every clip.
        //
        // The cells butted together, so a clip's strip read as one long
        // smeared picture and the only light lines on the bar were at the clip
        // boundaries. On a strip of film every frame has an edge — that
        // repeating light rhythm at a finer interval than the shots is most of
        // what makes the thing recognisable as film rather than as a row of
        // tiles.
        //
        // A GAP WITH THE LIGHT BEHIND IT, rather than a border on each cell: a
        // border would be inside the cell's own box and would eat into the
        // picture, and at these widths every pixel of picture counts. The gap
        // lets the strip's own colour through, which is the same trick the gap
        // between two clips already uses — one pixel here against five there,
        // so a frame edge never reads as a cut.
        className="absolute inset-0 flex gap-px"
        style={{ backgroundColor: FRAMED_CELL_EDGE }}
        aria-hidden="true"
      >
        {cells.map((url, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            // The URL is not unique — a clip short enough that two slots land
            // on the same frame gives the same string twice — so the index is
            // the only stable identity here.
            key={index}
            data-seam-thumbnail={clipId}
            src={url}
            alt=""
            aria-hidden="true"
            // `flex-1` rather than a fixed width, so the cells divide the box
            // exactly and there is never a grey tail at the end of a strip.
            className="h-full min-w-0 flex-1 object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ))}
      </span>
    );
  }

  if (posterSrc === undefined) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-seam-thumbnail={clipId}
      src={posterSrc}
      alt=""
      aria-hidden="true"
      // COVER, and no more. The box's width is its duration and its height is
      // the bar's, so the frame it holds is whatever shape that comes out as —
      // cropping to fill is the only fit that keeps every box the same height
      // and the run of them readable as a strip. A `contain` fit would
      // letterbox each clip differently and turn the bar into a row of
      // unrelated shapes.
      className="absolute inset-0 h-full w-full object-cover"
      // The bar can hold a hundred of these and none of them is the thing
      // being read on arrival.
      loading="lazy"
      decoding="async"
      draggable={false}
    />
  );
}


/**
 * The playhead's head, and its twitch when the scrub lands on a cut.
 *
 * DRIVEN FROM SCRIPT, NOT A KEYFRAME. A `@keyframes` would have to be
 * declared in a stylesheet, and this component is rendered into a portal from
 * two hosts with two different Tailwind entry points — the app's and
 * Storybook's — so a rule added to one of them is a rule the other silently
 * does not have. An animation the component brings with it cannot be missing
 * in one host and present in the other, and it is inspectable from a test
 * through `getAnimations()`.
 *
 * Skips its first run: mounting the playhead is not a snap.
 */
function SnapPulse({ snapKey }: Readonly<{ snapKey: number }>) {
  const ref = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (element === null || snapKey === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(2.1)" },
        { transform: "scale(1)" },
      ],
      { duration: 180, easing: "ease-out" },
    );
    return () => animation.cancel();
  }, [snapKey]);
  return (
    <span
      ref={ref}
      data-seam-playhead-head
      className="block h-1.5 w-1.5 rounded-full bg-red-500"
    />
  );
}

/**
 * How far each box is pulled in from its clip's true extent, per side.
 *
 * The gap between two boxes is therefore twice this. It is an inset rather
 * than a margin because the box's MIDDLE has to stay exactly on the clip's
 * middle — that is what the centring arithmetic aligns to the card below —
 * and trimming only the width would shift it by half the gap.
 */
const BOX_INSET_PX = 2.5;

/**
 * WHAT SEPARATES TWO BOXES ONCE THEY HOLD PICTURES.
 *
 * The gap between boxes is `BOX_INSET_PX` either side — five pixels of the
 * strip showing through. Against flat grey that is plenty. Between two frames
 * it disappears, and NO SINGLE COLOUR FIXES IT, which is the whole design
 * problem here: a dark gap is invisible between two dark frames, a pale one is
 * invisible between two bright frames, and footage supplies both within the
 * same cut. Picking either is picking which half of the timeline to fail on.
 *
 * SO THE GAP CARRIES BOTH TONES. The strip's own background is pale and each
 * box casts a dark ring into the gap either side of it, which makes every gap
 * read dark · pale · dark whatever is beside it:
 *
 *     two bright frames   white | DARK pale DARK | white   ← the rings show
 *     two dark frames     black | dark PALE dark | black   ← the core shows
 *     one of each         both, from opposite sides
 *
 *                         |<-1.5->|<-2->|<-1.5->|   of the 5px already there
 *
 * There is no arrangement of neighbours where neither tone has contrast,
 * which is what "works on both" has to mean. The alternative — a colour no
 * footage supplies, a saturated cyan or magenta — would also always show, and
 * would turn a bar you read for rhythm into a bar you read for stripes.
 *
 * THE THREE BANDS SHARE THE FIVE PIXELS THAT WERE ALREADY THERE: 1.5px of
 * dark, 2px of pale, 1.5px of dark. The first pass gave the pale core three of
 * the five and the dark barely registered against a bright frame — a white
 * band with a hairline either side reads as a white band. Roughly equal thirds
 * read as a rule.
 *
 * WIDENING THE GAP IS THE WRONG FIX, and not only because it was asked
 * against: a box's width IS its duration, so spending more of it on separation
 * makes short clips read shorter and changes what the bar is saying. None of
 * this costs layout — the gap is already there, the bands only divide it, and
 * a ring paints outside the box rather than over the picture.
 *
 * Only when frames are on. Over grey the whole treatment is decoration
 * answering a question nobody asked.
 *
 * ── AND IT IS A FILM STRIP, SO IT LOOKS LIKE ONE ────────────────────────
 *
 * THE STRIP IS THE PALE THING AND THE FRAMES SIT IN IT. That is what a strip
 * of film is: a light base with pictures printed on it and a margin of base
 * showing on every side of every frame. So the background here is near-white
 * and each box casts a thin DARK ring, which keeps the two-tone rule intact —
 *
 *     two bright frames   white │ DARK pale DARK │ white   ← the rings show
 *     two dark frames     black │ dark PALE dark │ black   ← the core shows
 *
 * — while making the bar read as film rather than as tiles in a chart.
 *
 * IT WAS INVERTED FOR A WHILE, near-black base with pale rings, on the
 * reasoning that either polarity satisfies the contrast rule so the choice was
 * free. The contrast rule was satisfied; the resemblance was not. A dark strip
 * with light lines in it looks like a chart with gridlines. Film is light with
 * dark frame lines, and the difference between those two is the whole point of
 * the treatment.
 *
 * THE VERTICAL INSET IS WHAT MAKES EITHER OF THEM VISIBLE, and its absence is
 * why this went unnoticed through several attempts — see `BOX_INSET_Y_PX`.
 * Without room above and below, the only base showing is a sliver between
 * clips, and no choice of colour reads as anything at all.
 */
const FRAMED_GAP_COLOUR = "rgba(238, 238, 241, 0.96)";
const FRAMED_BOX_EDGE = "0 0 0 1.5px rgba(0, 0, 0, 0.82)";
/**
 * The line between two FRAMES of the same clip.
 *
 * FAINT ON PURPOSE — 40% where the film base around a clip is opaque. That
 * difference IS the hierarchy, and it is the only thing keeping the treatment
 * honest: a frame edge is texture you read as film, a clip edge is a line you
 * read as a CUT. At full strength the two are indistinguishable, so every
 * sampled frame inside a long take looks like a shot boundary — which is
 * precisely the thing the bar exists to show you and would now be lying about.
 *
 * Only the interior lines. The clip's own edge stays solid, because that one
 * is answering the other question.
 */
const FRAMED_CELL_EDGE = "rgba(250, 250, 250, 0.4)";

/**
 * How far each box is pulled in from the TOP and BOTTOM of the lane once it
 * holds frames.
 *
 * Without it the film strip has no top or bottom edge, and that is a bug
 * rather than a nuance. A box is `inset-y-0` — exactly the lane's height — and
 * the lane is `overflow-hidden`, so a ring painted OUTSIDE the box has nowhere
 * to go vertically and is clipped away entirely. What survives is the left and
 * right of each ring, which reads as a row of thin separators rather than as
 * frames: every horizontal edge of the treatment was being thrown away.
 *
 * Giving the box a vertical inset puts the strip's own colour above and below
 * each frame as well as between them, which is what a strip of film actually
 * looks like — a frame has margin on all four sides, not two.
 *
 * ONLY WHEN FRAMES ARE ON. Over plain grey the boxes should still fill the
 * bar: there the height is not carrying anything and shortening it would just
 * make the bar quieter for no reason.
 */
const BOX_INSET_Y_PX = 3;

export type SeamHover = Readonly<{
  /** Absolute strip pixels. */
  x: number;
  name: string;
  meta: string;
  posterSrc?: string;
}>;

/**
 * THE FILMSTRIP ITSELF: every clip as a box, the cut lines between
 * collections, and the playhead.
 *
 * Presentational. Every gesture on it — scrub, zoom, pan, hover — is decided
 * by the bar that owns the strip's offset and scale, and arrives here as
 * handlers. That split is what lets this file be read as "what the bar looks
 * like" without also being the answer to "what happens when you drag it".
 *
 * THE OVERLAYS ARE PINNED, THE BOXES TRAVEL. Boxes, dividers, playhead and
 * ghost live inside the translated layer, so they share one coordinate space
 * and cannot drift apart at any pan or zoom. The chip and the preview are
 * outside it and positioned in viewport pixels, because a label that scrolled
 * off the side of the track with the thing it labels would be a label you
 * cannot read exactly when you need it.
 */
export function SeamLane({
  laneRef,
  strip,
  clips,
  colourOf,
  centreClipId,
  offset,
  playheadPx,
  snapKey,
  ghostX,
  hover,
  previewAnchor = "follow",
  chip,
  handlers,
  atStart,
  atEnd,
}: Readonly<{
  /** The element the bar attaches its non-passive wheel listener to. */
  laneRef: React.RefObject<HTMLDivElement | null>;
  strip: SeamStrip;
  clips: readonly SeamBarClip[];
  colourOf: ReadonlyMap<string, string>;
  centreClipId: string;
  offset: number;
  playheadPx: number | null;
  /** Bumped on every snap, so the playhead can acknowledge one. */
  snapKey: number;
  /** Where an un-pressed pointer is hovering, in strip pixels. */
  ghostX: number | null;
  hover: SeamHover | null;
  /** Whether the hover card follows the pointer or parks in the middle — see
   *  `graph-seam-preview-anchor`. */
  previewAnchor?: PreviewAnchor;
  /** The time under the playhead while it is being dragged. */
  chip: string | null;
  handlers: React.ComponentProps<"div">;
  /** Whether the bar's first clip is the project's first — see `SeamEndCap`.
   *  False when the reach has cropped the window short of it, because then
   *  there IS more to the left and saying otherwise would be a lie. */
  atStart: boolean;
  /** The same question at the other end. */
  atEnd: boolean;
}>) {
  // THE BOXES SLIDE INTO POSITION ON A MOVE, and jump for everything else.
  //
  // The strip's transform is driven by three different things and only one of
  // them wants easing. A drag has to track the hand exactly — the whole point
  // of the edge run is that the strip moves WITH the pointer — and a wheel
  // zoom or a pan is the same: they are the hand, and easing them reads as
  // lag. Changing which clip is centred is different. Nothing is under the
  // reader's finger, the strip re-centres on somewhere else entirely, and a
  // jump there is the one case where the eye cannot tell whether the bar
  // moved or was replaced.
  //
  // APPLIED TO THE NODE FOR A FIXED WINDOW rather than held as state: the
  // easing belongs to one arrival, and a `sliding` flag would have to be
  // cleared a render later — a cascading render to describe half a second of
  // styling. The pointer handler clears it early so a drag begun mid-slide is
  // still exact from its first frame.
  const thumbnails = usePlaybarThumbnails();
  // The clips by id, so a segment can reach its posters without a scan per box.
  const clipById = useMemo(() => new Map(clips.map((clip) => [clip.id, clip])), [clips]);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const centreWasRef = useRef(centreClipId);
  const offsetWasRef = useRef(offset);
  useLayoutEffect(() => {
    const node = stripRef.current;
    const moved = centreWasRef.current !== centreClipId;
    const previous = offsetWasRef.current;
    centreWasRef.current = centreClipId;
    offsetWasRef.current = offset;
    if (!moved || node === null || previous === offset) return;

    // PUT IT BACK, THEN LET IT GO. A transition cannot be added to a value
    // that has ALREADY changed: by the time a layout effect runs, React has
    // written the new transform, and switching easing on afterwards animates
    // nothing — the browser has one value and no previous one to interpolate
    // from. So the old position is restored with easing off, the reflow makes
    // that the state being transitioned FROM, and only then is the new one
    // asked for.
    node.style.transition = "none";
    node.style.transform = `translateX(${previous}px)`;
    void node.offsetWidth;
    node.style.transition = `transform ${SEAM_SLIDE_MS}ms ease-out`;
    node.style.transform = `translateX(${offset}px)`;

    // Only the easing is cleared at the end. The transform is left exactly
    // where it was put — it is the same value React renders, so the two agree
    // and there is no frame where the strip is briefly somewhere else.
    const done = setTimeout(() => {
      node.style.transition = "";
    }, SEAM_SLIDE_MS + 60);
    return () => clearTimeout(done);
  }, [centreClipId, offset]);

  const seams = collectionSeams(clips);
  const viewportX = (stripX: number) => stripX + offset;

  return (
    <div
      ref={laneRef}
      data-seam-boxes
      {...handlers}
      // A DRAG BEGUN MID-SLIDE IS EXACT FROM ITS FIRST FRAME. In CAPTURE, so
      // it runs before the bar's own pointer handler and cannot be replaced by
      // the spread above — leaving the easing on would put the strip a fixed
      // distance behind the hand for the rest of the slide's duration, which
      // is the lag the drag path is careful to avoid everywhere else.
      onPointerDownCapture={() => {
        if (stripRef.current !== null) stripRef.current.style.transition = "";
      }}
      // `touch-none`, because every gesture here is claimed: a drag scrubs and
      // a two-finger swipe pans. Left to the browser, the first would also
      // scroll the dialog behind the bar.
      //
      // NOT `overflow-hidden` ITSELF — the clip lives on the inner wrapper
      // below. The chip and the preview are children of this element and both
      // have to escape it: a time chip drawn INSIDE the boxes covers the frames
      // it is reporting on, which is the one thing you are looking at while you
      // drag.
      className="relative h-9 cursor-ew-resize touch-none select-none"
    >
      <div className="absolute inset-0 overflow-hidden">
        <div
          ref={stripRef}
          data-seam-strip
          className="absolute inset-y-0 left-0 will-change-transform"
          style={{
            transform: `translateX(${offset}px)`,
            width: strip.totalPx,
            // THE GAPS ARE THIS SHOWING THROUGH. The boxes are opaque and
            // absolutely positioned over it, so the only part of this that is
            // ever visible is the space between them — see `FRAMED_GAP_COLOUR`.
            ...(thumbnails.shown ? { backgroundColor: FRAMED_GAP_COLOUR } : {}),
          }}
        >
          {strip.segments.map((segment) => {
            if (segment.widthPx <= 0) return null;
            const isCentre = segment.clipId === centreClipId;
            const colour = colourOf.get(segment.clipId) ?? BAR_NEUTRAL_COLOUR;
            const skipped = clipById.get(segment.clipId)?.disabled === true;
            return (
              <span
                key={segment.clipId}
                data-seam-segment={segment.clipId}
                data-seam-segment-live={isCentre ? "" : undefined}
                data-seam-segment-skipped={skipped ? "" : undefined}
                aria-hidden="true"
                style={{
                  left: segment.leftPx + BOX_INSET_PX,
                  width: Math.max(2, segment.widthPx - BOX_INSET_PX * 2),
                  // THE COLOUR STAYS UNDER THE PICTURE. A frame that has not
                  // loaded yet, or a clip that has no poster at all, leaves
                  // the box exactly as it is without the setting — so turning
                  // thumbnails on can add pictures but can never subtract the
                  // bar.
                  backgroundColor: colour,
                  // See `FRAMED_BOX_EDGE`: the ring is the dark half of the
                  // gap, and the strip's own background is the pale half.
                  ...(thumbnails.shown ? { boxShadow: FRAMED_BOX_EDGE } : {}),
                  // ROOM FOR THE RING TO EXIST. See `BOX_INSET_Y_PX`: the lane
                  // clips, so without this the frame's top and bottom edges
                  // are painted straight off the element.
                  ...(thumbnails.shown
                    ? { top: BOX_INSET_Y_PX, bottom: BOX_INSET_Y_PX }
                    : { top: 0, bottom: 0 }),
                }}
                className="absolute flex items-center justify-center overflow-hidden rounded-[3px]"
              >
                {thumbnails.shown ? (
                  <SegmentFrames
                    clipId={segment.clipId}
                    clip={clipById.get(segment.clipId)}
                    posterSrc={segment.posterSrc}
                    widthPx={Math.max(2, segment.widthPx - BOX_INSET_PX * 2)}
                    style={thumbnails.style}
                  />
                ) : null}
                {/* SKIPPED AT PLAY TIME: struck through with hatching.
                    Diagonals rather than a wash, because a dimmed box is
                    indistinguishable from a dark frame and a box this bar is
                    already drawing pictures in has no spare brightness to
                    signal with. Hatching is the one treatment that survives
                    any content under it — it is a pattern, and footage is
                    not. It paints OVER the frames and inside the box, so it
                    costs no width: a disabled clip still occupies its full
                    duration, which is the truth about where the later cuts
                    fall. */}
                {skipped ? (
                  <span
                    data-seam-hatch
                    aria-hidden="true"
                    className="absolute inset-0 z-10 rounded-[3px]"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(45deg, rgba(9,9,11,0.72) 0px, rgba(9,9,11,0.72) 3px, rgba(228,228,231,0.55) 3px, rgba(228,228,231,0.55) 6px)",
                    }}
                  />
                ) : null}
              </span>
            );
          })}


          {/* AND SAID AGAIN ABOVE THE BOX, in red.
              The hatching says a clip is skipped once you are looking at it;
              this says it while you are scanning the bar for something else,
              which is when it matters — the whole failure mode of a disabled
              clip is not noticing one. Dotted, so it is never confused with
              the solid red ring below it, and clear of the boxes so it does
              not eat into a width that means duration. */}
          {strip.segments.map((segment) => {
            if (segment.widthPx <= 0) return null;
            if (clipById.get(segment.clipId)?.disabled !== true) return null;
            return (
              <span
                key={`skip-${segment.clipId}`}
                data-seam-skip-rule={segment.clipId}
                aria-hidden="true"
                className="pointer-events-none absolute border-t-2 border-dotted border-red-500/80"
                style={{
                  left: segment.leftPx + BOX_INSET_PX,
                  width: Math.max(2, segment.widthPx - BOX_INSET_PX * 2),
                  // INSIDE THE LANE. At -6 this sat above the lane's top edge,
                  // and the lane clips — so the one mark saying a clip gets
                  // skipped was painted off the element and never appeared at
                  // all. It lives in the margin above the frame now, which is
                  // the space the film-strip inset created.
                  top: 0,
                }}
              />
            );
          })}

          {atStart && <SeamEndCap side="start" atPx={0} />}
          {atEnd && <SeamEndCap side="end" atPx={strip.totalPx} />}

          {/* WHERE ONE COLLECTION ENDS AND THE NEXT BEGINS. A dashed hairline
            rather than a gap: a gap is what the bar already puts between
            every pair of boxes, so widening one would say "a slightly longer
            pause here" instead of "a different place". Skipped at index 0 —
            there is no seam before the first clip, only a beginning. */}
          {seams.map((index) => {
            const clip = clips[index];
            if (index === 0 || clip === undefined) return null;
            const segment = strip.segments.find(
              (candidate) => candidate.clipId === clip.id,
            );
            if (segment === undefined) return null;
            return (
              <span
                key={`seam-${clip.id}`}
                data-seam-divider={clip.collectionId ?? ""}
                aria-hidden="true"
                style={{ left: segment.leftPx - BOX_INSET_PX }}
                className="absolute inset-y-1 w-px border-l border-dashed border-white/30"
              />
            );
          })}

          {/* WHERE THE POINTER IS, before it has committed to anything. The
            playhead says where you ARE; this says where a press would put
            you, which is the question you are asking while you look. */}
          {ghostX !== null && (
            <span
              aria-hidden="true"
              data-seam-ghost
              style={{ transform: `translateX(${ghostX}px)` }}
              className="absolute inset-y-0 left-0 w-px bg-white/35"
            />
          )}

          {playheadPx !== null && (
            <span
              data-seam-playhead
              aria-hidden="true"
              style={{ transform: `translateX(${playheadPx}px)` }}
              // A HAIRLINE. One physical pixel wherever the display allows it:
              // the playhead's job is to name an instant, and a 2px line spans
              // two of them at this scale.
              className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-red-500"
            >
              {/* The head of the line, so the playhead reads as a position that
                was put there rather than a border between two boxes — and
                what ACKNOWLEDGES A SNAP. A snap moves the playhead by a few
                pixels at most and is otherwise invisible, so without this you
                cannot tell the bar helped from your hand being accurate. */}
              <span className="absolute -top-1 left-1/2 -translate-x-1/2">
                <SnapPulse snapKey={snapKey} />
              </span>
            </span>
          )}
        </div>
      </div>

      {/* THE CLIP THE CARDS ARE ON, POINTED AT FROM ABOVE.
          A red ring around its box did this for a while, and it was the wrong
          shape of answer twice over. A ring encloses an AREA, so at a wide
          reach — where a box is eight pixels across — the mark becomes most of
          the clip and stops reading as a mark at all. And red is the
          playhead's colour: two different "you are here" claims in one colour,
          one about time and one about which shot, is one too many.
          A triangle points at a PLACE. Its size has nothing to do with the
          clip's duration, so it reads identically at every zoom, and white
          against the dark band above the film base is the one thing up there.
          OUTSIDE THE CLIPPING WRAPPER, which is why this is a sibling of the
          boxes rather than a child: the strip is `overflow-hidden` and anything
          above the film base would be cut off. The chip and the hover preview
          escape the same way, and `viewportX` is how all three stay with the
          strip while living outside it. */}
      {(() => {
        const segment = strip.segments.find((found) => found.clipId === centreClipId);
        if (segment === undefined || segment.widthPx <= 0) return null;
        return (
          <span
            data-seam-active-mark={centreClipId}
            aria-hidden="true"
            style={{
              left: viewportX(segment.leftPx + segment.widthPx / 2),
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              borderTop: "6px solid rgba(250, 250, 250, 0.95)",
            }}
            className="pointer-events-none absolute -top-[9px] z-10 h-0 w-0 -translate-x-1/2"
          />
        );
      })()}

      {/* THE TIME, ON THE PLAYHEAD, while it is being dragged. ABOVE the
          boxes, not on them: it names the frame you are looking at, and a
          label laid over that frame answers the question by covering it. */}
      {chip !== null && playheadPx !== null && (
        <span
          data-seam-chip
          aria-hidden="true"
          style={{ left: viewportX(playheadPx) }}
          className="pointer-events-none absolute -top-[22px] z-10 -translate-x-1/2 rounded border border-zinc-700 bg-zinc-950/95 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-100 shadow-lg"
        >
          {chip}
        </span>
      )}

      {/* WHAT IS UNDER THE POINTER. A name and a frame, which together answer
          "is that the shot I am looking for" without moving the playhead to
          find out — the thing a bar of anonymous boxes cannot do. */}
      {hover !== null && (
        <span
          data-seam-preview
          aria-hidden="true"
          // PINNED, OR KEPT INSIDE THE TRACK.
          //
          // `pinned` parks it dead centre under the bar and leaves it there, so
          // the pointer scrubs and the picture changes in place. See
          // `graph-seam-preview-anchor` for why that is worth having: the card
          // is now big enough to judge a frame in, and a big thing sliding
          // around under a moving pointer is the one arrangement in which you
          // cannot.
          //
          // `follow` centres it on the box being described, which walks it off
          // the side as soon as that box is near either end — and the wider
          // this card got, the more of the bar had that problem. At 288px a
          // hover anywhere in the first or last 144 pixels was reading a card
          // with its edge cut off, which is worst exactly where the picture is
          // the whole point. `clamp` against percentages rather than a measured
          // width: the percentage resolves against this element's containing
          // block, which IS the track, so the bound follows a resize with no
          // observer and no re-render. 9rem is half the card.
          style={{
            left:
              previewAnchor === "pinned"
                ? "50%"
                : `clamp(12rem, ${viewportX(hover.x)}px, calc(100% - 12rem))`,
          }}
          // BELOW THE WHOLE BAR, not just below the boxes: at `top-9` it lay
          // across the ruler and the minimap, hiding the two things that say
          // where the box being previewed actually is.
          // STACKED, SO THE PICTURE CAN BE THE SIZE OF THE ANSWER.
          //
          // It was a 56x32 thumbnail beside two lines of text — barely larger
          // than the frame being pointed at, which made the preview a worse
          // copy of the thing that prompted it. The question a hover asks is
          // "which shot is that", and the only part of this card that answers
          // it is the picture; the name and the time are confirmation. So the
          // picture gets the full width of the card and the words go
          // underneath.
          //
          // AND IT STANDS OFF THE PAGE, because it now overlaps the panels
          // below rather than floating over a gap: a heavier border, a deeper
          // shadow and a near-opaque ground, so it reads as something in front
          // rather than something printed on what it covers.
          className="pointer-events-none absolute top-20 z-20 flex w-96 -translate-x-1/2 flex-col gap-1.5 rounded-lg border border-zinc-600 bg-zinc-950/98 p-2 shadow-2xl ring-1 ring-black/50"
        >
          {hover.posterSrc === undefined ? null : (
            // A bare <img>: the preview is a thumbnail of a source the app
            // already holds a URL for, and next/image would add a loader
            // round-trip on every hover for one picture.
            <img
              src={hover.posterSrc}
              alt=""
              // THE FRAME'S OWN SHAPE, whole.
              //
              // It was forced to 16:9 and cropped to fill, on the reasoning
              // that a card changing height as the pointer moved would be the
              // card itself flickering. That holds for a row of mixed shapes
              // and costs too much here: this project's shots are 896x384, so
              // 16:9 was cutting the sides off every one of them — the preview
              // was showing less of the frame than the box it came from. A
              // preview that crops is answering a question about composition
              // with a different composition.
              //
              // `h-auto` with no ratio, so the poster's intrinsic dimensions
              // decide: scope stays scope, 16:9 stays 16:9, and nothing is
              // trimmed. The card grows and shrinks with it, which is the
              // honest trade and much less distracting now `PIN` exists — a
              // stationary card resizing reads as the picture changing, where
              // a moving one resizing reads as a wobble.
              className="h-auto w-full rounded"
            />
          )}
          <span className="min-w-0">
            <span className="block truncate text-xs font-medium text-zinc-100">
              {hover.name}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[11px] tabular-nums text-zinc-400">
              {hover.meta}
            </span>
          </span>
        </span>
      )}
    </div>
  );
}

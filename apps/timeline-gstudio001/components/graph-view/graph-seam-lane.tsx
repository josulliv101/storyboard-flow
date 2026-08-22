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

/**
 * How long the strip takes to slide when the centred clip changes.
 *
 * Long enough to be read as one thing moving rather than as two different
 * pictures — the whole reason to animate this is that the bar re-centres on
 * somewhere else and a jump cannot be told apart from a redraw.
 */
const SEAM_SLIDE_MS = 520;

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
        className="absolute inset-0 flex"
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
  chip,
  handlers,
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
  /** The time under the playhead while it is being dragged. */
  chip: string | null;
  handlers: React.ComponentProps<"div">;
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
          style={{ transform: `translateX(${offset}px)`, width: strip.totalPx }}
        >
          {strip.segments.map((segment) => {
            if (segment.widthPx <= 0) return null;
            const isCentre = segment.clipId === centreClipId;
            const colour = colourOf.get(segment.clipId) ?? BAR_NEUTRAL_COLOUR;
            return (
              <span
                key={segment.clipId}
                data-seam-segment={segment.clipId}
                data-seam-segment-live={isCentre ? "" : undefined}
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
                }}
                className="absolute inset-y-0 flex items-center justify-center overflow-hidden rounded-[3px]"
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
                {isCentre && segment.widthPx >= 16 ? (
                  <span
                    data-seam-marker
                    // Above the frame once there is one, and darker for it: a
                    // 50% black dot reads on grey and disappears into a busy
                    // picture, which is the one box it has to be findable in.
                    className={
                      thumbnails.shown
                        ? "relative z-10 h-3 w-3 rounded-full bg-black/70 ring-1 ring-white/70"
                        : "h-3 w-3 rounded-full bg-black/50"
                    }
                  />
                ) : null}
              </span>
            );
          })}

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
          style={{ left: viewportX(hover.x) }}
          // BELOW THE WHOLE BAR, not just below the boxes: at `top-9` it lay
          // across the ruler and the minimap, hiding the two things that say
          // where the box being previewed actually is.
          className="pointer-events-none absolute top-20 z-20 flex max-w-64 -translate-x-1/2 items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950/95 p-1.5 shadow-xl"
        >
          {hover.posterSrc === undefined ? null : (
            // A bare <img>: the preview is a thumbnail of a source the app
            // already holds a URL for, and next/image would add a loader
            // round-trip on every hover for a 56px picture.
            <img
              src={hover.posterSrc}
              alt=""
              className="h-8 w-14 shrink-0 rounded-sm object-cover"
            />
          )}
          <span className="min-w-0">
            <span className="block truncate text-[11px] text-zinc-100">
              {hover.name}
            </span>
            <span className="mt-0.5 block truncate font-mono text-[10px] tabular-nums text-zinc-500">
              {hover.meta}
            </span>
          </span>
        </span>
      )}
    </div>
  );
}

"use client";

import { memo } from "react";

import {
  hasSourceWindow,
  mediaDurationSeconds,
  type CollectionTrimHandleContentProps,
  type CollectionTrimOverviewContentProps,
} from "@storyboard/ui/dnd-collections";

import { OVERVIEW_FRAME_SIZE, overviewFrameCount } from "@/lib/card-ghost-frames";
import { videoFrameUrls } from "@/lib/video-frame-url";

/**
 * The trim overview's background (the "sequence above" a selected video),
 * replacing the package default via the `OverviewContent` registry slot. The
 * default TILES the 1–2 stored posters by modulo — with one poster every
 * frame is the same still, which reads as broken (R7 #2). This samples each
 * slot at its own time across the FULL SOURCE through the same
 * `videoFrameUrls` seam the card filmstrip uses, so the two strips show the
 * same kind of sequence — including the last-slot end-frame pin (R7 #3).
 * The default's "full clip x.xs" readout is dropped on request (R7 #3); the
 * trim readouts around the window already carry the numbers.
 *
 * Memo comparator (mirrors the package default's): the contract carries live
 * trimIn/trimOut that change per pointer move during a drag, but this
 * renderer reads only `node` and `fullWidth` — shallow memo would reconcile
 * up to 40 <img> elements per move for nothing.
 */
export const GraphTrimOverviewContent = memo(
  function GraphTrimOverviewContent({ node, fullWidth }: CollectionTrimOverviewContentProps) {
    const posters = node.posterSrcs ?? [];
    // Enough square frames to cover the strip width (ceil so the row fills;
    // the container clips the overflow), capped so a long source stays
    // bounded.
    const frameCount = overviewFrameCount(fullWidth);
    // The overview shows the FULL source (the amber window marks the visible
    // part), so the sample range is [0, fullDurationSeconds] — not the
    // trimmed range the card uses.
    const frameSrcs = videoFrameUrls(posters, frameCount, {
      trimInSeconds: 0,
      effectiveSeconds: Math.max(0, node.fullDurationSeconds),
    });
    return (
      <div className="flex h-full w-full">
        {frameSrcs.length === 0 ? (
          <span className="flex h-full w-full items-center justify-center bg-muted text-[11px] text-muted-foreground select-none">
            No preview frames
          </span>
        ) : (
          frameSrcs.map((src, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={index}
              src={src}
              alt=""
              draggable={false}
              style={{ width: OVERVIEW_FRAME_SIZE }}
              className="h-full shrink-0 border-r border-black/60 object-cover last:border-r-0"
            />
          ))
        )}
      </div>
    );
  },
  (prev, next) =>
    prev.node === next.node &&
    prev.pixelsPerSecond === next.pixelsPerSecond &&
    prev.fullWidth === next.fullWidth,
);

/**
 * THE SMALLEST SHARE OF A CLIP THAT MAY BE HANDLE, and why it is a ratio.
 *
 * The hit zone is a fixed 8px, so what a handle costs depends entirely on the
 * clip under it: 2% of a 400px clip and 27% of a 30px one. The question is
 * never "is this clip short" but "how much of it would stop being clip", which
 * a `minWidth` cannot express — images carry one handle and video two, so the
 * same ratio has to yield two different pixel cutoffs.
 *
 * A quarter is the line: past it a clip still has three quarters of itself
 * left to look at, grab and drag.
 */
const MAX_HANDLE_SHARE = 0.25;
/** The hit zone's width, from `HIT_ZONE_CLASS` in the package (`w-2`). */
const HANDLE_PX = 8;

export const GraphTrimHandle = memo(function GraphTrimHandle({
  side,
  node,
  pixelsPerSecond,
}: CollectionTrimHandleContentProps) {
  // BOTH EDGES COUNT, even though this renders one of them. Anything with a
  // source window carries a left handle too, so its clip pays twice — and the
  // decision has to come out the same for both or a clip keeps one handle and
  // loses the other. `hasSourceWindow` rather than a `mediaKind` test for the
  // reason the package uses it: audio windows into a longer source as well.
  const sides = hasSourceWindow(node) ? 2 : 1;
  // The clip's rendered width: its effective timeline duration — an image's
  // own, or a windowed item's showing span — times the scale it is drawn at.
  const width = mediaDurationSeconds(node) * pixelsPerSecond;
  if (width <= 0 || (sides * HANDLE_PX) / width > MAX_HANDLE_SHARE) return null;

  return (
    <span
      className={[
        "flex h-full w-full items-center justify-center",
        // ON ALWAYS, not on approach. The first pass kept the handle quiet
        // until the pointer neared it, which read well on a desktop and did
        // not survive the question "what about iPad" — a hover reveal has no
        // trigger on a touch screen, so the affordance would simply never
        // arrive there. One always-visible treatment is the same on both, and
        // it means the edge advertises what it does before you go looking.
        //
        // SOLID, NOT A GRADIENT. It was `bg-gradient-to-l ... to-transparent`,
        // which faded the ink across the 8px and put its bright mass against
        // the outer edge — so the grip below, at a measured 50%, still read as
        // off-centre. The bar was never the problem; the field around it was.
        //
        // QUIET AT REST, and the armed state below is what pays for it. This
        // was a solid `white/85` — what an affordance looks like when it has
        // to announce itself unaided, on every clip, forever. It no longer
        // does: a press on the strip has to settle before it trims (the same
        // drag is how the strip pans), so the handle now has a MOMENT to speak
        // at, and at rest it can recede into the clip instead of sitting on
        // six edges shouting. GREY rather than a dimmer white because it has
        // to hold against a bright frame as well as a dark one, and because
        // grey is the one value here that is not already a state — blue is
        // selection everywhere on this board (the ring, the check, the count)
        // and amber reads as a third accent.
        "bg-zinc-400/45",
        // ARMED: the press settled, and the next pull edits rather than
        // scrolls. Those two outcomes are far enough apart that the handle has
        // to say which one it is holding — the one moment it goes full
        // strength. Colour only, no geometry: it must not move under the
        // finger already on it.
        "transition-colors group-data-[trim-armed=true]/trim:bg-white/95",
        side === "left" ? "rounded-l-md" : "rounded-r-md",
      ].join(" ")}
    >
      {/* The grip, centred in a now-uniform field. Taller on a coarse pointer
          for the same reason the target is wider there — and full-height and
          darker once armed, the one geometry change allowed here because it
          happens INSIDE the handle rather than to it. */}
      <span className="h-5 w-0.5 rounded-full bg-black/45 transition-[height,background-color] group-data-[trim-armed=true]/trim:h-full group-data-[trim-armed=true]/trim:bg-black/70 [@media(pointer:coarse)]:h-7" />
    </span>
  );
});

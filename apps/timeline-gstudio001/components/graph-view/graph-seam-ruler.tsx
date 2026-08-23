"use client";

import { BOX_INSET_PX, SEAM_RULER_HEIGHT_PX } from "./graph-seam-metrics";
import type { SeamTick } from "./graph-seam-bar-layout";

/**
 * How tall the ruler's own band is.
 *
 * Exported because the fades over the film strip are absolutely positioned
 * against the track, and the strip no longer starts at its top — they have to
 * begin exactly where the ruler stops or they cover the last row of labels.
 * Two places, one number.
 */
export { SEAM_RULER_HEIGHT_PX };

/**
 * ── THE CLIPS, DRAWN AGAIN IN THE SCALE ─────────────────────────────────────
 *
 * The ruler carried numbers and collection names and nothing about the film
 * under it, so reading "how long is that shot" meant finding a box's edges on
 * one row and reading a number off another. A block per clip, at the same
 * width and the same x, puts the two in one place: the run of blocks IS the
 * run of boxes, and the numbers land on it.
 *
 * FAINT ENOUGH TO BE A GROUND, and no fainter. This is a scale rather than a
 * second film strip, so the blocks make divisions findable and give the labels
 * something to sit against without competing with the film they describe.
 *
 * 7% was past the point of being either: against this ground it read as an
 * unevenness in the black rather than as a row of rectangles, so the thing it
 * was drawn to make legible could not itself be seen. 16% is a shape you can
 * find without hunting and still quiet enough that the eye goes to the film
 * first.
 */
const RULER_BLOCK_COLOUR = "rgba(250, 250, 250, 0.16)";

/**
 * The active clip's block, and the one thing in this band with a hue.
 *
 * Sky is what the app already says "live" in — the seek rail's played time,
 * the board's readout — so the active clip's block is that colour rather than
 * a new one to learn. Kept translucent for the same reason the others are
 * faint: it marks the stretch of scale belonging to the clip being worked on,
 * and a solid bar would be a second claim competing with the white triangle
 * and rule immediately below it.
 *
 * It is the only saturated thing up here, which is what makes it findable at a
 * glance on a bar of two dozen blocks.
 */
const RULER_BLOCK_ACTIVE_COLOUR = "rgba(56, 189, 248, 0.30)";

/**
 * The scale ABOVE the boxes: seconds, and where each collection starts.
 *
 * WHY A RULER AT ALL, when the boxes are already proportional. Because the
 * bar zooms. A box's width means "this long" only against a scale, and
 * without one a ten-second clip at 4px a second and a one-second clip at 40
 * are the same object on screen — the reader has no way to tell which of the
 * two bars in front of them they are looking at.
 *
 * The collection ticks are the other half, and the more important half. Time
 * is derivable; "Van Interior begins here" is not, and it is the only
 * landmark on a run of boxes that otherwise looks the same all the way along.
 * They are drawn in the ink the bar reserves for structure, and they are the
 * ones that win a collision — see `seamRulerTicks`.
 *
 * ── ABOVE THE FILM, NOT UNDER IT ────────────────────────────────────────────
 *
 * It sat underneath, which put the scale on the far side of the thing it
 * measures: the labels were separated from the boxes by the whole height of
 * the strip, and reading "is that box two seconds or twenty" meant crossing
 * the film to find out. A ruler belongs against what it measures, and the
 * order of the block reads top-down — scale, then film, then the map of where
 * the film is.
 *
 * So the tick MARKS moved with it. They hang from the bottom edge now, where
 * they meet the top of the strip, with the label above them; upside down they
 * would point away from the boxes and label the air.
 *
 * ── AND IT IS THE HOVER TARGET ──────────────────────────────────────────────
 *
 * Pointing at the ruler is what raises the preview card, rather than pointing
 * at the boxes. The film is the thing being READ — a card that appears over it
 * covers the frames it is reporting on, and the pointer that summoned it is
 * sitting on them too. The ruler is the margin beside the text: near enough to
 * mean the same place, and not made of anything you were looking at.
 *
 * The strip keeps every gesture that MOVES it — press to pan, drag to scrub,
 * click to choose a clip. Only the hover moved.
 */
export function SeamRuler({
  ticks,
  offset,
  segments = [],
  centreClipId = null,
  ghostX = null,
  handlers,
}: Readonly<{
  ticks: readonly SeamTick[];
  /**
   * The film's own layout, so the scale can draw a block per clip at exactly
   * the width and position of the box below it.
   *
   * The SAME numbers the lane lays its boxes out from, inset the same way —
   * a block that agreed about width but not about the gap would sit a couple
   * of pixels off every boundary, which at these sizes is the difference
   * between a scale and a smear.
   */
  segments?: readonly Readonly<{ clipId: string; leftPx: number; widthPx: number }>[];
  /** Which block wears the active treatment. Null draws none, which is what a
   *  ruler rendered without a film under it should do. */
  centreClipId?: string | null;
  /** The strip's own transform, so the ruler travels with the boxes. */
  offset: number;
  /**
   * Where the pointer is, in STRIP space, or null when it is not over the bar.
   *
   * The film already drew this line; the ruler did not, so pointing at the
   * scale gave no sign that the scale was the thing being pointed AT — the
   * only feedback was a card appearing somewhere else. Drawn here in the same
   * ink and at the same x, the two are one line running from under the
   * pointer down into the frames it is asking about.
   *
   * Strip space, so it sits inside the translated container below and needs no
   * arithmetic of its own: the same number the lane is given.
   */
  ghostX?: number | null;
  /**
   * The hover handlers, which live here now rather than on the lane.
   *
   * Optional so the ruler can still be rendered as a plain scale — a story or
   * a consumer that only wants the marks should not have to invent pointer
   * handlers to get them.
   */
  handlers?: Readonly<{
    onPointerMove?: (event: React.PointerEvent<HTMLDivElement>) => void;
    onPointerLeave?: (event: React.PointerEvent<HTMLDivElement>) => void;
  }>;
}>) {
  if (ticks.length === 0) return null;
  const interactive = handlers !== undefined;
  return (
    <div
      data-seam-ruler
      data-seam-ruler-interactive={interactive ? "" : undefined}
      // NOT `aria-hidden` any more when it is the hover target. It was hidden
      // as pure decoration beside a slider that carried the real value, and
      // that was right while nothing here could be pointed at. The track above
      // is still the `role="slider"` that reports the position — this only
      // reveals a preview — so it stays out of the accessibility tree as a
      // control, but hiding an element you can interact with is the one thing
      // `aria-hidden` must never do.
      aria-hidden={interactive ? undefined : "true"}
      style={{ height: SEAM_RULER_HEIGHT_PX }}
      className={[
        "relative overflow-hidden",
        // `pointer-events-none` ONLY while it is decoration. As the hover
        // target it has to receive the pointer — and `touch-none`, because the
        // strip below claims every gesture and a ruler that scrolled the
        // dialog on a touch drag would be the one part of the bar that did.
        interactive ? "touch-none" : "pointer-events-none",
      ].join(" ")}
      {...(handlers ?? {})}
    >
      <div
        className="absolute inset-y-0 left-0 w-full"
        style={{ transform: `translateX(${offset}px)` }}
      >
        {/* THE BLOCKS FIRST, so they are the GROUND the rest of the band sits
            on. A tick, its label and the pointer's line all have to stay
            readable over them, and the paint order is what guarantees that
            rather than a stack of z-indexes to keep in step. */}
        {segments.map((segment, index) => {
          if (segment.widthPx <= 0) return null;
          const isCentre = segment.clipId === centreClipId;
          // EVERY OTHER ONE, like the ruled lines on a ledger.
          //
          // A block on every clip made a continuous band broken only by the
          // gaps, and at a wide reach those gaps are a couple of pixels — so
          // the row read as one long rectangle with notches rather than as a
          // run of clips. Filling alternate clips gives each boundary a change
          // of TONE as well as a gap, which is the pair the eye actually
          // counts by.
          //
          // Parity comes from the clip's place in playback order, not from
          // anything about the view, so a block does not change tone when the
          // bar pans or the reach changes. It is a property of the film.
          const striped = index % 2 === 0;
          return (
            <span
              key={segment.clipId}
              data-seam-ruler-block={segment.clipId}
              data-seam-ruler-block-live={isCentre ? "" : undefined}
              data-seam-ruler-block-striped={striped && !isCentre ? "" : undefined}
              aria-hidden="true"
              style={{
                left: segment.leftPx + BOX_INSET_PX,
                width: Math.max(2, segment.widthPx - BOX_INSET_PX * 2),
                // THE ACTIVE CLIP IGNORES THE PATTERN. Its parity is an
                // accident of where it sits in the order, and a mark that
                // appeared for half the clips you could select would be worse
                // than no mark — the one thing this colour has to do is be
                // there whenever it is true.
                backgroundColor: isCentre
                  ? RULER_BLOCK_ACTIVE_COLOUR
                  : striped
                    ? RULER_BLOCK_COLOUR
                    : "transparent",
              }}
              // INSET FROM THE BOTTOM, not flush to it. The tick marks hang
              // from that edge and a block reaching it would have them ending
              // inside a filled rectangle rather than against the film — the
              // marks are what point at the boundary, and they need the gap to
              // point ACROSS.
              className="absolute top-0 bottom-1.5 rounded-[2px]"
            />
          );
        })}

        {/* UNDER THE POINTER, and the same hairline the film draws. Painted
            after the blocks so it reads over them — the line says where you
            are, and a ground that covered it would be answering a quieter
            question more loudly. */}
        {ghostX !== null && (
          <span
            aria-hidden="true"
            data-seam-ruler-ghost
            style={{ transform: `translateX(${ghostX}px)` }}
            className="absolute inset-y-0 left-0 w-px bg-white/35"
          />
        )}
        {ticks.map((tick) => (
          <span
            key={`${tick.kind}-${tick.x}-${tick.label}`}
            data-seam-tick={tick.kind}
            style={{ left: tick.x }}
            className="absolute inset-y-0"
          >
            {/* HANGING FROM THE BOTTOM, where the ruler meets the film. */}
            <span
              className={[
                "absolute bottom-0 left-0 w-px",
                tick.kind === "collection" ? "h-1.5 bg-white/45" : "h-1 bg-white/25",
              ].join(" ")}
            />
            {/* Left-ALIGNED to the tick rather than centred on it. A
                collection label names the thing that starts HERE, and a
                centred one hangs half of itself over the collection that just
                ended — which reads as belonging to the wrong side of the
                seam. */}
            <span
              className={[
                // CENTRED IN THE BAND, not hung from its top.
                //
                // At the top it sat against the edge with the whole rest of
                // the band empty beneath it, so the row read as text with a
                // margin under it rather than as a scale. Centred, the label
                // sits in the middle of the block it names and the tick mark
                // still has the bottom edge to itself — `-translate-y-1/2`
                // against `top-1/2` rather than a flex box, because the tick
                // container is a zero-width anchor at the boundary and has no
                // box to centre anything in.
                "absolute top-1/2 left-0 max-w-32 -translate-y-1/2 truncate text-[10px] leading-none whitespace-nowrap",
                // READABLE, which the time labels were not. They were
                // `text-zinc-600` at 9px — grey on near-black, at a size where
                // the strokes are a pixel wide, so the numbers were legible
                // only by being where numbers were expected. 10px and
                // `zinc-400` is still quiet enough to stay a scale rather than
                // a row of content, and can actually be read.
                //
                // The collection names keep their extra weight and letter
                // spacing: they are the landmark, and the numbers are the
                // grid they sit on.
                tick.kind === "collection"
                  ? "font-mono tracking-wider text-zinc-200"
                  : "font-mono tabular-nums text-zinc-400",
              ].join(" ")}
            >
              {tick.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

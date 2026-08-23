"use client";

import { Layers } from "lucide-react";

import {
  BOX_INSET_PX,
  SEAM_COLLECTION_BAND_PX,
  SEAM_RULER_HEIGHT_PX,
  SEAM_RULER_TOTAL_PX,
} from "./graph-seam-metrics";
import type { SeamTick } from "./graph-seam-bar-layout";

/**
 * How tall the ruler's own band is.
 *
 * Exported because the fades over the film strip are absolutely positioned
 * against the track, and the strip no longer starts at its top — they have to
 * begin exactly where the ruler stops or they cover the last row of labels.
 * Two places, one number.
 */
export { SEAM_RULER_HEIGHT_PX, SEAM_RULER_TOTAL_PX };

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
 * The same two tones, pointed at.
 *
 * A STEP IN THE SAME INK, not a new colour: the run is one tone and the active
 * clip is the only hue in the band, so a hover introducing a third treatment
 * would compete with the two that already mean something. Small steps — the
 * bar is a thing you sweep a pointer across on the way somewhere else, and a
 * hover that announces itself would flash all the way along.
 */
const RULER_BLOCK_HOVER_COLOUR = "rgba(250, 250, 250, 0.26)";
const RULER_BLOCK_ACTIVE_HOVER_COLOUR = "rgba(56, 189, 248, 0.42)";

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
  hoveredClipId = null,
  ghostX = null,
  playheadPx = null,
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
  /** The clip under the pointer, on either row — see the strip bar. */
  hoveredClipId?: string | null;
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
   * Where playback is, in STRIP space, or null when the clock is untouched.
   *
   * DRAWN HERE RATHER THAN ON THE FILM. A red hairline down the middle of the
   * boxes cut across whatever frame it landed on — the one thing on this bar
   * you are actually meant to be looking at — and at a wide reach it fell
   * inside a thumbnail rather than beside one. The playhead says WHERE, and
   * where belongs on the scale: the same row that carries the seconds it is
   * pointing at.
   */
  playheadPx?: number | null;
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
    /** Press to put the playhead here and open the clip it lands in. */
    onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
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
      style={{ height: SEAM_RULER_TOTAL_PX }}
      className={[
        "relative",
        // `pointer-events-none` ONLY while it is decoration. As the hover
        // target it has to receive the pointer — and `touch-none`, because the
        // strip below claims every gesture and a ruler that scrolled the
        // dialog on a touch drag would be the one part of the bar that did.
        //
        // `cursor-pointer`, NOT the film's `ew-resize`. That cursor promises a
        // drag, and the two rows offer different gestures: the film is grabbed
        // and pulled, while pressing the scale puts the playhead at the second
        // under the pointer. A pointer says "this position is a thing you can
        // choose", which is exactly what a press here does.
        interactive ? "cursor-pointer touch-none" : "pointer-events-none",
      ].join(" ")}
      {...(handlers ?? {})}
    >
      {/* ── THE NAMES, ON THEIR OWN LINE ABOVE THE SCALE ─────────────────
          Same x as ever — the same `offset` and the same tick position — so a
          name still starts exactly where its collection does. Only the height
          changed.

          ITS OWN CLIPPING BOX, so a long name running off the end of the bar
          is cut at the bar's edge rather than at the scale's. The two bands
          scroll as one and crop as one. */}
      <div
        data-seam-ruler-names
        className="absolute inset-x-0 top-0 overflow-hidden"
        style={{ height: SEAM_COLLECTION_BAND_PX }}
      >
        <div
          className="absolute inset-y-0 left-0 w-full"
          style={{ transform: `translateX(${offset}px)` }}
        >
          {ticks.map((tick) =>
            tick.kind !== "collection" ? null : (
              <span
                key={`name-${tick.x}-${tick.label}`}
                data-seam-tick-name={tick.kind}
                style={{ left: tick.x }}
                // Left-ALIGNED to the tick rather than centred on it. A
                // collection label names the thing that starts HERE, and a
                // centred one hangs half of itself over the collection that
                // just ended — which reads as belonging to the wrong side of
                // the seam.
                //
                // `inline-flex` so the glyph and the word are one line with a
                // baseline between them, rather than an icon floated beside a
                // block that truncates independently of it.
                className="absolute top-1/2 inline-flex max-w-32 -translate-y-1/2 items-center gap-1 font-mono text-[10px] leading-none tracking-wider whitespace-nowrap text-zinc-200"
              >
                {/* THE SAME SIGN A COLLECTION WEARS EVERYWHERE — the card's
                    mark, the sidebar shortcut's badge, the board's Collections
                    toggle. Three places already say "collection" with this
                    glyph, and a fourth spelling would be a fourth thing to
                    learn.

                    AT THE LETTERING'S OWN SIZE, 10px square. This is a caption
                    strip: an icon larger than the word beside it would make
                    the row a row of icons that happen to have names, which is
                    the opposite of what the band is for.

                    `shrink-0` so a long name truncates the WORD and never the
                    mark — the glyph is what says which KIND of thing this is,
                    and it is the half that still reads when the name has been
                    cut to three letters. */}
                <Layers
                  aria-hidden="true"
                  className="size-2.5 shrink-0 text-zinc-400"
                  strokeWidth={2.25}
                />
                <span className="truncate">{tick.label}</span>
              </span>
            ),
          )}
        </div>
      </div>

      <div
        data-seam-ruler-scale
        className="absolute inset-x-0 bottom-0 overflow-hidden"
        style={{ height: SEAM_RULER_HEIGHT_PX }}
      >
      <div
        className="absolute inset-y-0 left-0 w-full"
        style={{ transform: `translateX(${offset}px)` }}
      >
        {/* THE BLOCKS FIRST, so they are the GROUND the rest of the band sits
            on. A tick, its label and the pointer's line all have to stay
            readable over them, and the paint order is what guarantees that
            rather than a stack of z-indexes to keep in step. */}
        {segments.map((segment) => {
          if (segment.widthPx <= 0) return null;
          const isCentre = segment.clipId === centreClipId;
          const isHovered = segment.clipId === hoveredClipId;
          return (
            <span
              key={segment.clipId}
              data-seam-ruler-block={segment.clipId}
              data-seam-ruler-block-live={isCentre ? "" : undefined}
              data-seam-ruler-block-hovered={isHovered ? "" : undefined}
              aria-hidden="true"
              style={{
                left: segment.leftPx + BOX_INSET_PX,
                width: Math.max(2, segment.widthPx - BOX_INSET_PX * 2),
                // ONE TONE FOR THE RUN, and the active clip apart from it.
                //
                // Alternate fills were tried and dropped: they gave every
                // boundary a change of tone, but they also made the band a
                // pattern in its own right — a rhythm of light and dark that
                // is not the film's rhythm, competing with the one thing the
                // widths are actually saying. An even run is a ground, and a
                // ground is what a scale wants to be.
                // POINTED AT — from either row. The block lifts whether the
                // pointer is on the scale or on the box below it, because both
                // are the same question about the same clip.
                //
                // A STEP IN THE SAME INK rather than a new colour or an edge:
                // the run is one tone and the active clip is the only hue up
                // here, so a hover that introduced a third treatment would be
                // competing with the two that mean something. Brighter is the
                // one move left that says "this one" without saying anything
                // else.
                backgroundColor: isCentre
                  ? isHovered
                    ? RULER_BLOCK_ACTIVE_HOVER_COLOUR
                    : RULER_BLOCK_ACTIVE_COLOUR
                  : isHovered
                    ? RULER_BLOCK_HOVER_COLOUR
                    : RULER_BLOCK_COLOUR,
                // A STROKE ALONG THE TOP OF THE ACTIVE BLOCK, and only
                // there. The clip below it wears a white outline; this is
                // the same line, continued up into the scale, so the two
                // read as one column rather than as a tinted rectangle
                // that happens to sit above an outlined box. Inset rather
                // than a border because a border would change the block's
                // size and shift every tick beside it.
                boxShadow: isCentre
                  ? "inset 0 1px 0 0 rgba(255, 255, 255, 0.55)"
                  : undefined,
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

        {/* WHERE PLAYBACK IS. Last in the band so it paints over the blocks,
            the ticks and the ghost: everything else here describes the film,
            and this is the one mark that describes the CLOCK. */}
        {playheadPx !== null && (
          <span
            data-seam-playhead
            aria-hidden="true"
            style={{ transform: `translateX(${playheadPx}px)` }}
            // A HAIRLINE. One physical pixel wherever the display allows it:
            // the playhead's job is to name an instant, and a 2px line spans
            // two of them at this scale.
            className="absolute inset-y-0 left-0 z-10 w-px -translate-x-1/2 bg-red-500"
          >
            {/* The head of the line, so the playhead reads as a position that
                was put there rather than a border between two boxes. It used
                to pulse when a drag snapped to a cut; there is no drag on the
                playhead any more, so there is no snap to acknowledge.
                AT THE TOP OF THE BAND rather than above it: the line no longer
                runs through the film, so its head has the scale's own top edge
                to sit on and nothing to hang over. */}
            <span
              data-seam-playhead-head
              className="absolute top-0 left-1/2 block h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-red-500"
            />
          </span>
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
            {/* THE SECONDS, AND ONLY THE SECONDS. A collection's name is drawn
                in the band above — see there for why the two rows are
                separate. Rendering it here as well would be the same word
                twice at two heights. */}
            {tick.kind === "collection" ? null : (
              <span
                // CENTRED IN THE BAND, not hung from its top. At the top it sat
                // against the edge with the rest of the band empty beneath it,
                // so the row read as text with a margin under it rather than
                // as a scale. `-translate-y-1/2` against `top-1/2` rather than
                // a flex box, because the tick container is a zero-width
                // anchor at the boundary with no box to centre anything in.
                //
                // READABLE, which these were not. They were `text-zinc-600` at
                // 9px — grey on near-black at a size where the strokes are a
                // pixel wide, so the numbers were legible only by being where
                // numbers were expected.
                className="absolute top-1/2 left-0 max-w-32 -translate-y-1/2 truncate font-mono text-[10px] leading-none tabular-nums whitespace-nowrap text-zinc-400"
              >
                {tick.label}
              </span>
            )}
          </span>
        ))}
      </div>
      </div>
    </div>
  );
}

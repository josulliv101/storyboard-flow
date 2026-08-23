"use client";

import type { SeamTick } from "./graph-seam-bar-layout";

/**
 * How tall the ruler's own band is.
 *
 * Exported because the fades over the film strip are absolutely positioned
 * against the track, and the strip no longer starts at its top — they have to
 * begin exactly where the ruler stops or they cover the last row of labels.
 * Two places, one number.
 */
export const SEAM_RULER_HEIGHT_PX = 20;

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
  ghostX = null,
  handlers,
}: Readonly<{
  ticks: readonly SeamTick[];
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
        {/* UNDER THE POINTER, and the same hairline the film draws. First in
            the container so a tick mark and its label paint over it rather
            than under — the line says where you are, and the label is what it
            is pointing at. */}
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
                "absolute top-0 left-0 max-w-32 truncate text-[10px] leading-none whitespace-nowrap",
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

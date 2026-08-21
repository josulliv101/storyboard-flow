"use client";

import type { SeamTick } from "./graph-seam-bar-layout";

/**
 * The scale under the boxes: seconds, and where each collection starts.
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
 */
export function SeamRuler({
  ticks,
  offset,
}: Readonly<{
  ticks: readonly SeamTick[];
  /** The strip's own transform, so the ruler travels with the boxes. */
  offset: number;
}>) {
  if (ticks.length === 0) return null;
  return (
    <div
      data-seam-ruler
      aria-hidden="true"
      className="pointer-events-none relative h-4 overflow-hidden"
    >
      <div
        className="absolute inset-y-0 left-0 w-full"
        style={{ transform: `translateX(${offset}px)` }}
      >
        {ticks.map((tick) => (
          <span
            key={`${tick.kind}-${tick.x}-${tick.label}`}
            data-seam-tick={tick.kind}
            style={{ left: tick.x }}
            className="absolute top-0"
          >
            <span
              className={[
                "absolute top-0 left-0 w-px",
                tick.kind === "collection" ? "h-1.5 bg-white/45" : "h-1 bg-white/20",
              ].join(" ")}
            />
            {/* Left-ALIGNED to the tick rather than centred on it. A
                collection label names the thing that starts HERE, and a
                centred one hangs half of itself over the collection that just
                ended — which reads as belonging to the wrong side of the
                seam. */}
            <span
              className={[
                "absolute top-2 left-0 max-w-32 truncate font-mono text-[9px] leading-none whitespace-nowrap",
                tick.kind === "collection"
                  ? "tracking-wider text-zinc-300"
                  : "tabular-nums text-zinc-600",
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

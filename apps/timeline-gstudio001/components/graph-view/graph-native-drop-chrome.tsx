"use client";

import type { DragEvent } from "react";

import { acceptsDragTypes, type DropSummary } from "./graph-native-drop-model";

/**
 * What the two drop SURFACES paint in common — the zone's own affordance, the
 * status line, and the indicator bar.
 *
 * In `components/` rather than beside the pure model because these are class
 * names: Tailwind's content scan covers `app`, `components` and `packages/ui`,
 * and NOT `lib`. The DECISIONS behind them are in `graph-native-drop-model`,
 * where the app's vitest can reach them.
 */

export function acceptsNativeDrag(event: DragEvent<HTMLElement>): boolean {
  return acceptsDragTypes(event.dataTransfer.types);
}

/**
 * The drop-zone affordance: every eligible target outlines itself for the
 * duration of the drag, and the one under the pointer is filled in.
 *
 * NOTHING HERE MAY CHANGE THE BOX. Arming the affordance mid-drag must not
 * reflow the strips, or it would move the very gaps being aimed at — so the
 * edge is painted outside the box (an outline; a ring before it) and never as
 * a border.
 *
 * DASHED AND GREY (PL15-012). It was solid `sky-400` — a bright blue edge over
 * a blue wash, on every eligible surface, for the whole drag. Loud for
 * something that is only saying "you could let go here": the drag already has
 * one thing worth shouting, and it is the insertion bar below, which says
 * where the thing will actually LAND. Ambient state gives up the accent; the
 * precise signal keeps it.
 *
 * AN OUTLINE, NOT A RING, and that is forced rather than chosen. Tailwind's
 * `ring-*` is a box-shadow and a box-shadow cannot be dashed. `outline` can,
 * and shares the property that matters here: it is painted outside the box and
 * takes no part in layout, so the rule above still holds. A `border` would
 * not — it would add to the box and do exactly the reflow this must not do.
 *
 * The two states stay two states: the surface under the pointer has to be
 * plainly the one that will take the drop, so it goes brighter and doubles the
 * dash's weight rather than differing only in tint.
 */
export function dropZoneClassName(armed: boolean, hovered: boolean): string {
  if (!armed) return "relative rounded-lg";
  return [
    "relative rounded-lg outline-dashed transition-colors duration-150 motion-reduce:transition-none",
    hovered
      ? "bg-zinc-300/[0.07] outline-2 outline-zinc-300/70"
      : "bg-zinc-300/[0.02] outline-1 outline-zinc-400/35",
  ].join(" ");
}

/** The shared drop status line — a live region mounted at all times so its
 *  text is announced when it appears. Empty and invisible while idle. */
export function NativeDropStatus({ upload }: Readonly<{ upload: DropSummary | null }>) {
  return (
    <p
      data-native-drop-status
      role="status"
      aria-live="polite"
      className={[
        "pointer-events-none absolute bottom-1 left-1 z-20 rounded px-2 py-1 text-[11px]",
        upload === null
          ? "sr-only"
          : upload.tone === "progress"
            ? "bg-zinc-900/90 text-zinc-200"
            : "bg-red-950/90 text-red-200",
      ].join(" ")}
    >
      {upload?.message ?? ""}
    </p>
  );
}

/**
 * The indicator bar's shared look — colour, width, glow, tier.
 *
 * The POSITIONING is deliberately NOT shared, and this is the whole note. The
 * strip's bar spans the wrapper (`inset-y-1`) while the grid's is anchored to
 * the row it marks (`top-0` plus an explicit height), and `inset-y-1` and
 * `top-0` both set `top` — one element carrying both would be resolved by CSS
 * source order rather than by the order they are written, which is a coin toss
 * dressed up as a class list. Each surface states its own anchor.
 *
 * `left-0` is LOAD-BEARING in both: `absolute` with no horizontal offset
 * resolves to the element's STATIC position — and the bar is the wrapper's last
 * child, so that position sits after the content. The transform is measured
 * from the wrapper's ORIGIN, so without the anchor the line draws in the wrong
 * place entirely. z-30 clears the grid's own overlay tier as well as its cards.
 */
/* IT KEEPS THE ACCENT, and now it is the only thing in a drag that has one —
 * see `dropZoneClassName`. The zone says "this surface would take it"; this
 * says "it lands HERE", which is the answer actually being aimed at. */
export const DROP_INDICATOR_CLASS =
  "pointer-events-none absolute left-0 z-30 w-0.5 rounded bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.9)]";

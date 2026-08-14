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
 * duration of the drag, and the one under the pointer is filled in. Ring and
 * background only — nothing here may change the box, or arming the affordance
 * would reflow the strips mid-drag and move the very gaps being aimed at.
 */
export function dropZoneClassName(armed: boolean, hovered: boolean): string {
  if (!armed) return "relative rounded-lg";
  return [
    "relative rounded-lg ring-1 transition-colors duration-150 motion-reduce:transition-none",
    hovered ? "bg-sky-400/10 ring-2 ring-sky-400" : "bg-sky-400/[0.03] ring-sky-400/40",
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
export const DROP_INDICATOR_CLASS =
  "pointer-events-none absolute left-0 z-30 w-0.5 rounded bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.9)]";

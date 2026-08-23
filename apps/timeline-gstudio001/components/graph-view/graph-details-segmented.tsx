"use client";

import type { ReactNode } from "react";

import {
  HAIRLINE,
  RADIUS_INNER,
  RADIUS_WELL,
  SURFACE_WELL,
  TEXT_LABEL,
} from "./graph-details-design";

/** One choice in a group. */
export type Segment<T> = Readonly<{
  value: T;
  /** What the segment says. Short — these sit four to a row. */
  label: ReactNode;
  /** The long form, which is where the actual explanation lives. */
  title: string;
  /**
   * Whether this is the current choice — ASKED OF THE CALLER rather than
   * derived from a `value` prop, because not every group is a plain
   * one-of-N. The frames group is three buttons over two settings (whether
   * boxes draw frames, and which kind), so "is this the active one" is a
   * question only its owner can answer.
   */
  active: boolean;
}>;

/**
 * THE toggle. Not "a" toggle — the details view has exactly one, and every
 * choice in it is this: what the bar's boxes draw, where the hover card sits,
 * how far the bar reaches, how many clips are on screen.
 *
 * WHY ONE. There were four renditions of this control, differing in text size,
 * padding, whether the group sat in a tray, and how the active choice was
 * marked. Read individually each was fine; read together — and they are always
 * read together, since three of them share a row — the differences said there
 * was some distinction between them, and there is none. Collapsing them is
 * most of what stops the row looking accidental.
 *
 * THE ACTIVE SEGMENT IS RAISED, NOT INVERTED. It used to be a solid white chip
 * on black, which is the loudest mark the palette has, and it was being spent
 * four times over on settings you change once a session. White now belongs to
 * the play button alone. A segment lifts by one step of surface and one
 * hairline instead — enough to be unambiguous in a group of two to four, and
 * quiet enough that the pictures stay the bright things on screen.
 *
 * THE TRAY IS THE GROUP. Boxing the whole set (rather than only the active
 * member) is what makes four labels read as one control with one answer.
 * Without it a row of bare words has to be parsed before it can be used.
 */
export function SegmentedControl<T>({
  label,
  ariaLabel,
  segments,
  onSelect,
  groupAttribute,
}: Readonly<{
  /** The control's name, drawn outside the tray. Omitted where the segments
   *  name themselves — the view-count pager is `3 · 5`, and a "clips" label
   *  in front of it would be the third place on screen saying so. */
  label?: string;
  ariaLabel: string;
  segments: ReadonlyArray<Segment<T>>;
  onSelect: (value: T) => void;
  /** e.g. `data-details-bar-reach` — the handle tests and e2e reach for. */
  groupAttribute?: string;
}>) {
  return (
    <div className="flex items-center gap-1.5">
      {label === undefined ? null : <span className={TEXT_LABEL}>{label}</span>}
      <div
        {...(groupAttribute === undefined ? {} : { [groupAttribute]: "" })}
        role="group"
        aria-label={ariaLabel}
        className={[
          "inline-flex items-center gap-0.5 border p-0.5",
          RADIUS_WELL,
          HAIRLINE,
          SURFACE_WELL,
        ].join(" ")}
      >
        {segments.map((segment) => (
          <button
            key={String(segment.value)}
            type="button"
            aria-pressed={segment.active}
            onClick={() => onSelect(segment.value)}
            title={segment.title}
            className={[
              // `min-w-7` so a two-character segment and a five-character one
              // sit on the same rhythm — without it `5 · 10 · 20 · All` steps
              // unevenly and reads as four unrelated buttons.
              "min-w-7 px-2 py-[3px] text-center font-mono text-[11px] tabular-nums",
              "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/70",
              RADIUS_INNER,
              // MEASURED AGAINST THE TRAY IT SITS IN, not chosen in the
              // abstract. The tray is near-black, so a 10% white fill
              // lands at about #1b1b1d and the active segment reads as a
              // slightly different dark rather than as the chosen one. At
              // 14% with an 18% edge it separates cleanly and is still
              // nowhere near the play button's solid white.
              segment.active
                ? "bg-white/[0.14] text-zinc-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
                // IDLE IS STILL A LABEL YOU HAVE TO READ. zinc-500 on this
                // tray is legible in isolation and mush at a glance in a
                // row of four; a segment nobody can read is not a choice.
                : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100",
            ].join(" ")}
          >
            {segment.label}
          </button>
        ))}
      </div>
    </div>
  );
}

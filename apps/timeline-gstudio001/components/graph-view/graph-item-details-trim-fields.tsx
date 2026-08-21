"use client";

import { useEffect, useState } from "react";

import {
  mediaDurationSeconds,
  type AudioMediaNode,
  useCollectionsStore,
  useLiveTrim,
  type VideoMediaNode,
} from "@storyboard/ui/dnd-collections";

// The typed half of trimming: the same `update-media` the grips dispatch,
// reached with a keyboard instead of a pointer. Lifted out of the modal so
// the panel is layout and these are the input rules.

/** Two decimals, and never NaN — a half-typed field must not dispatch. */
function parseSeconds(raw: string): number | null {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Typed in/out points for a video (PL11-006).
 *
 * Each field commits on blur or Enter, as ONE `update-media` — the same
 * command the grips dispatch, so this is a second input method for one
 * behaviour rather than a second path into the model. Escape reverts the
 * field to the committed value.
 *
 * Clamping is deliberate rather than validating-and-refusing: an out point
 * before the in point (or past the source) is a typo, and snapping to the
 * nearest legal value is faster to correct than an error message. The 0.05s
 * floor keeps a clip from being trimmed to nothing by a stray keystroke.
 */
export function TrimNumbers({
  node,
  trimIn,
  trimOut,
  disabled,
}: Readonly<{
  /** Any WINDOWED node. The overview strip above this is video-only because it
   *  paints frames; these are numbers, and a source window is a source window
   *  whether or not it has a picture. */
  node: VideoMediaNode | AudioMediaNode;
  trimIn: number;
  trimOut: number;
  disabled: boolean;
}>) {
  const store = useCollectionsStore();
  const full = node.fullDurationSeconds;
  const inPoint = trimIn;
  const outPoint = full - trimOut;

  const commit = (side: "in" | "out", raw: string) => {
    const typed = parseSeconds(raw);
    if (typed === null) return;
    const next =
      side === "in"
        ? {
            trimInSeconds: Math.min(Math.max(0, typed), Math.max(0, outPoint - MIN_SHOWING_SECONDS)),
            trimOutSeconds: trimOut,
          }
        : {
            trimInSeconds: trimIn,
            trimOutSeconds: Math.min(
              Math.max(0, full - typed),
              Math.max(0, full - inPoint - MIN_SHOWING_SECONDS),
            ),
          };
    if (next.trimInSeconds === trimIn && next.trimOutSeconds === trimOut) return;
    store.dispatch({
      type: "update-media",
      nodeId: node.id,
      update: { mediaKind: node.mediaKind, ...next },
    });
  };

  return (
    <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-400">
      <SecondsField label="in" value={inPoint} disabled={disabled} onCommit={(raw) => commit("in", raw)} />
      <span aria-hidden="true" className="text-zinc-600">
        →
      </span>
      <SecondsField label="out" value={outPoint} disabled={disabled} onCommit={(raw) => commit("out", raw)} />
      {/* "of 12.00s" used to trail this row. The panel's own header already
          reads "4.00s of 12.00s", two inches above and in the same units, so
          it was the same fact twice on one panel — and N times over on a strip
          of them. The per-field "s" went for the same reason: the row is
          seconds from end to end and nothing in it could be anything else. */}
    </div>
  );
}

/** The smallest clip a typed edge may leave behind. */
const MIN_SHOWING_SECONDS = 0.05;

function SecondsField({
  label,
  value,
  disabled,
  onCommit,
}: Readonly<{
  label: string;
  value: number;
  disabled: boolean;
  onCommit: (raw: string) => void;
}>) {
  // Uncontrolled between commits, keyed by the committed value: a controlled
  // input would fight the caret while typing "1" on the way to "12.5", and
  // the key makes it re-seed whenever the value changes underneath (a grip
  // drag, an undo).
  return (
    <label className="flex items-center gap-1.5">
      <span className="text-zinc-500">{label}</span>
      <input
        key={value}
        type="text"
        inputMode="decimal"
        aria-label={`${label} point, seconds`}
        data-trim-field={label}
        defaultValue={value.toFixed(2)}
        disabled={disabled}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            onCommit((event.target as HTMLInputElement).value);
            (event.target as HTMLInputElement).blur();
          } else if (event.key === "Escape") {
            (event.target as HTMLInputElement).value = value.toFixed(2);
            (event.target as HTMLInputElement).blur();
          }
        }}
        onBlur={(event) => onCommit(event.target.value)}
        className="w-14 rounded-sm bg-zinc-900 px-1.5 py-0.5 text-right tabular-nums text-blue-300/90 outline-none ring-1 ring-zinc-700 focus:ring-blue-500/70 disabled:opacity-40"
      />

    </label>
  );
}

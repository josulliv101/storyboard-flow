"use client";

import {
  LAYER_FRAME_POSITIONS,
  LAYER_FRAME_SIZES,
  type LayerFramePosition,
  type LayerFrameSize,
} from "@storyboard/timeline-model/layer-frame";
import { useCollectionsStore, type CollectionItemNode } from "@storyboard/ui/dnd-collections";

import { layerFrameForChoice, presetForLayerFrame } from "@/lib/default-layer-frame";
import { cn } from "@/lib/utils";

// WHERE THE INSET SITS, without an MCP call.
//
// The first FORM control for a placement field — lane and placed start are
// drag-only. It exists because the write path stamps a default corner, and a
// default nobody can move is worse than no default: the clip appears in the
// bottom right and stays there.
//
// Presets rather than four numbers, and presets FIRST rather than a drag: the
// useful range is narrow, picking from it is faster than typing into it, and a
// preset stores exactly the rectangle a drag would — so dragging an inset on
// the preview later is additive rather than a second representation to keep in
// step.

const POSITION_LABELS: Readonly<Record<LayerFramePosition, string>> = {
  "top-left": "Top left",
  top: "Top",
  "top-right": "Top right",
  left: "Left",
  center: "Centre",
  right: "Right",
  "bottom-left": "Bottom left",
  bottom: "Bottom",
  "bottom-right": "Bottom right",
};

const SIZE_LABELS: Readonly<Record<LayerFrameSize, string>> = {
  small: "S",
  medium: "M",
  large: "L",
};

// LITERAL SKY, NOT `bg-primary`, and this is load-bearing rather than a style
// preference.
//
// The design tokens are declared only under `.graph-view-theme` (see
// app/globals.css, which says so and explains why: defining them globally would
// repaint the legacy views). This modal is PORTALED TO document.body, which is
// outside that element — so inside it `--gv-primary` does not resolve,
// `bg-primary/30` computes to `rgba(0,0,0,0)` and `border-primary` falls back
// to `currentColor`. Measured, not guessed: the first version of this picker
// marked its selection with a transparent fill and a white border, and looked
// almost identical to the unselected state.
//
// Everything else in this modal is already written in literal zinc/sky for the
// same reason, so this matches the neighbours as well as the app's active
// treatment (HEADER_TOGGLE_ACTIVE in graph-board.tsx).
const CELL_ACTIVE = "bg-sky-400/70 ring-1 ring-sky-300";
const CELL_IDLE = "bg-white/10 hover:bg-white/20";
const CHIP_ACTIVE = "border-sky-400/70 bg-sky-400/15 text-sky-200";
const CHIP_IDLE = "border-white/15 bg-white/5 text-zinc-400 hover:bg-white/10";

export function LayerFramePicker({
  node,
  aspect,
  disabled,
}: Readonly<{
  node: CollectionItemNode;
  /** The clip's shape, which decides the inset's height and therefore which
   *  preset a stored rectangle came from. */
  aspect: number | undefined;
  disabled: boolean;
}>) {
  const store = useCollectionsStore();
  const frame = node.layerFrame;
  const current = presetForLayerFrame(frame, aspect);
  // A rectangle no preset produces — a hand-written one, or one a future drag
  // made. Named rather than rounded to the nearest button.
  const isCustom = frame !== undefined && current === null;

  const set = (position: LayerFramePosition, size: LayerFrameSize) => {
    store.dispatch({
      type: "set-node-placement",
      nodeIds: [node.id],
      placement: { layerFrame: layerFrameForChoice(position, size, aspect) },
    });
  };

  // Clearing is a real choice, not a reset: it puts the clip back to
  // contributing SOUND ONLY, which is what a layer did before compositing and
  // what you want for a bed that happens to be a video file.
  const clear = () => {
    store.dispatch({
      type: "set-node-placement",
      nodeIds: [node.id],
      placement: { layerFrame: null },
    });
  };

  const size = current?.size ?? "medium";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-[0.08em] text-zinc-500 uppercase">
          Inset
        </span>
        <span className="font-mono text-[11px] text-zinc-500">
          {frame === undefined
            ? "no inset"
            : isCustom
              ? "custom"
              : `${POSITION_LABELS[current!.position].toLowerCase()} · ${Math.round(frame.width * 100)}%`}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* ONE BORDERED BOX, not nine floating chips — it has to read as the
            FRAME the inset sits inside, or "bottom right" is a word rather
            than a place. Proportioned 2.4:1 to match the render's own output
            shape, and the cells are hairline-separated rather than gapped so
            the box stays a box. */}
        <div
          role="group"
          aria-label="Inset position"
          className="grid aspect-[2.4] w-[120px] shrink-0 grid-cols-3 grid-rows-3 gap-px overflow-hidden rounded-[3px] border border-white/25 bg-white/25 p-px"
        >
          {LAYER_FRAME_POSITIONS.map((position) => {
            const active = current?.position === position;
            return (
              <button
                key={position}
                type="button"
                disabled={disabled}
                aria-label={POSITION_LABELS[position]}
                aria-pressed={active}
                data-layer-position={position}
                onClick={() => set(position, size)}
                title={POSITION_LABELS[position]}
                className={cn(
                  "transition-colors disabled:opacity-40",
                  active ? CELL_ACTIVE : CELL_IDLE,
                )}
              />
            );
          })}
        </div>

        <div className="flex flex-col items-start gap-1.5">
          <div className="flex gap-1" role="group" aria-label="Inset size">
            {LAYER_FRAME_SIZES.map((option) => {
              const active = current?.size === option;
              return (
                <button
                  key={option}
                  type="button"
                  disabled={disabled}
                  aria-label={`${option} inset`}
                  aria-pressed={active}
                  data-layer-size={option}
                  onClick={() => set(current?.position ?? "bottom-right", option)}
                  className={cn(
                    "h-6 w-7 rounded-sm border font-mono text-[10px] transition-colors disabled:opacity-40",
                    active ? CHIP_ACTIVE : CHIP_IDLE,
                  )}
                >
                  {SIZE_LABELS[option]}
                </button>
              );
            })}
          </div>
          {/* Quieter than the two groups above: it is the way OUT of the
              feature, not a fourth position. */}
          <button
            type="button"
            disabled={disabled || frame === undefined}
            data-layer-frame-clear
            onClick={clear}
            className="font-mono text-[10px] text-zinc-500 underline decoration-dotted underline-offset-2 transition-colors hover:text-zinc-300 disabled:no-underline disabled:opacity-40 disabled:hover:text-zinc-500"
          >
            sound only
          </button>
        </div>
      </div>
    </div>
  );
}

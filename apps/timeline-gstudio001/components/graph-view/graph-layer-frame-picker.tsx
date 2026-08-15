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

      <div className="flex items-start gap-3">
        {/* The 3x3 reads as the frame it describes, so the button's POSITION
            is the label — the accessible name carries the words. */}
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Inset position">
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
                className={cn(
                  "h-5 w-7 rounded-sm border transition-colors disabled:opacity-40",
                  active
                    ? "border-primary bg-primary/30"
                    : "border-white/15 bg-white/5 hover:bg-white/10",
                )}
              />
            );
          })}
        </div>

        <div className="flex flex-col gap-1">
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
                    "h-5 w-6 rounded-sm border font-mono text-[10px] transition-colors disabled:opacity-40",
                    active
                      ? "border-primary bg-primary/30 text-zinc-100"
                      : "border-white/15 bg-white/5 text-zinc-400 hover:bg-white/10",
                  )}
                >
                  {SIZE_LABELS[option]}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            disabled={disabled || frame === undefined}
            data-layer-frame-clear
            onClick={clear}
            className="rounded-sm border border-white/15 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            sound only
          </button>
        </div>
      </div>
    </div>
  );
}

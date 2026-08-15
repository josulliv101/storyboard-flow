"use client";

import { useSyncExternalStore } from "react";

import {
  DEFAULT_RENDER_FORMAT,
  RENDER_FORMAT_PRESETS,
  renderFormatPresetOf,
  type RenderFormat,
} from "@storyboard/timeline-model/render-format";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/core/dropdown-menu";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { cn } from "@/lib/utils";

// THE SHAPE THIS PROJECT EXPORTS AT.
//
// The first render SETTING in the app, and the first render UI of any kind —
// renders are still started from the MCP tools, and this board only reports
// on them. It is here rather than in a dialog for that reason: there is no
// render dialog to put it in, and the shape of the deliverable is a standing
// fact about the project rather than a per-render choice.
//
// Stored on the DOCUMENT (`TimelineDocument.renderFormat`), so a render an
// agent starts produces the same file as one started here, and the choice
// survives a reload.
//
// Literal zinc/sky rather than token classes, matching its neighbours in this
// header — and see the note in graph-layer-frame-picker.tsx for the way tokens
// fail silently in a portaled surface. This one is not portaled, but the menu
// CONTENT is.

const RATIO_TOLERANCE = 0.01;

/** "16:9" for anything close enough, otherwise the raw numbers. */
function describe(format: RenderFormat): string {
  const preset = renderFormatPresetOf(format);
  if (preset) return `${preset.ratio} · ${preset.label}`;
  const ratio = format.height > 0 ? format.width / format.height : 0;
  const named = RENDER_FORMAT_PRESETS.find(
    (candidate) =>
      Math.abs(candidate.format.width / candidate.format.height - ratio) < RATIO_TOLERANCE,
  );
  return named
    ? `${named.ratio} · ${format.width}×${format.height}`
    : `${format.width}×${format.height}`;
}

/**
 * The menu itself, with no idea where the format is stored.
 *
 * Split from the connected wrapper below so it can be driven by a story: the
 * gateway is a module singleton, and a component that reached for it directly
 * could only be exercised by seeding global state.
 */
export function RenderFormatMenu({
  format,
  onChange,
}: Readonly<{
  /** The project's stored format, or undefined when it has never chosen one. */
  format: RenderFormat | undefined;
  onChange: (next: RenderFormat | null) => void;
}>) {
  // No optimistic state: `setRenderFormat` updates the gateway's cache and
  // notifies synchronously, so this re-reads the new value on the same tick.
  // Only the network flush is debounced.
  const shown = format ?? DEFAULT_RENDER_FORMAT;
  const current = renderFormatPresetOf(shown);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-render-format={`${shown.width}x${shown.height}`}
        title={`Renders at ${shown.width}×${shown.height} at ${shown.fps}fps. Click to change.`}
        className={cn(
          "rounded-sm px-1.5 py-0.5 font-mono text-[11px] tabular-nums transition-colors",
          "text-zinc-500 hover:bg-white/5 hover:text-zinc-300",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sky-500/70",
        )}
      >
        {describe(shown)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {RENDER_FORMAT_PRESETS.map((preset) => {
          const active = current?.id === preset.id;
          return (
            <DropdownMenuItem
              key={preset.id}
              data-render-format-option={preset.id}
              onSelect={() => onChange(preset.format)}
              className={cn("gap-3 font-mono text-[11px]", active && "text-sky-300")}
            >
              <span className="w-10 shrink-0">{preset.ratio}</span>
              <span className="flex-1">{preset.label}</span>
              <span className="text-zinc-500">
                {preset.format.width}×{preset.format.height}
              </span>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Reads and writes the project's own format, so the board only has to place
 *  this — the same shape as `GraphSaveStatus` and `GraphRenderStatus` beside
 *  it, both of which own their own source. */
export function GraphRenderFormat({ timelineId }: Readonly<{ timelineId: string }>) {
  const documents = useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    graphDocumentsGateway.read,
    graphDocumentsGateway.read,
  );
  return (
    <RenderFormatMenu
      format={documents[timelineId]?.renderFormat}
      onChange={(next) => void graphDocumentsGateway.setRenderFormat(timelineId, next)}
    />
  );
}

"use client";

import { useSyncExternalStore } from "react";

import {
  DEFAULT_RENDER_FORMAT,
  RENDER_FORMAT_PRESETS,
  renderFormatPresetOf,
  type RenderFormat,
} from "@storyboard/timeline-model/render-format";

import {
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioBadge,
  DropdownMenuRadioGroup,
} from "@/components/core/dropdown-menu";
import { graphDocumentsGateway } from "@/lib/graph-documents-gateway";
import { cn } from "@/lib/utils";

// THE SHAPE THIS PROJECT EXPORTS AT.
//
// The first render SETTING in the app, and the first render UI of any kind —
// renders are still started from the MCP tools, and this board only reports
// on them.
//
// Stored on the DOCUMENT (`TimelineDocument.renderFormat`), so a render an
// agent starts produces the same file as one started here, and the choice
// survives a reload.
//
// IT LIVES IN THE BOARD'S SETTINGS MENU, and it is NOT a menu itself.
//
// It used to be a dropdown of its own, sitting in the header beside the
// breadcrumbs and reading "16:9 · 720p" — a standing fact about the project,
// permanently on screen, competing with the controls you actually use while
// working. Inside the settings menu it is a setting among settings.
//
// A menu inside a menu is what it must not become: the presets are four short
// tokens, so they show as BADGES in one wrapping row, exactly like the
// thumbnail-size group above them. Every option is visible the moment the
// menu opens, and choosing one is a single click rather than a hover, a
// submenu, and a second aim.
//
// Literal zinc/blue rather than token classes, matching its neighbours in this
// menu — see the note in graph-layer-frame-picker.tsx for the way tokens fail
// silently in a portaled surface, which this one is.

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
 * The option group, with no idea where the format is stored.
 *
 * Split from the connected wrapper below so it can be driven by a story: the
 * gateway is a module singleton, and a component that reached for it directly
 * could only be exercised by seeding global state.
 *
 * Returns a menu GROUP, not a menu. It is rendered inside the board's settings
 * menu and owns no popover of its own.
 */
export function RenderFormatOptions({
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
    <DropdownMenuGroup data-render-format={`${shown.width}x${shown.height}`}>
      <DropdownMenuLabel className="px-0.5 pb-2 pt-0.5">
        Render format
        {/* THE PIXELS, always — a badge row can only say which PRESET is on,
            and a project may hold a size no preset matches (the render tool
            takes any width/height). Without this, a custom format showed as
            no badge selected and no number anywhere, which reads as the
            setting being broken rather than as "none of these four". */}
        {/* `normal-case` because the label above is uppercased and a readout is
            not a label: inherited, "720p" rendered as "720P", which is not a
            resolution anyone writes. The margin is a real gap rather than a
            space character — an uppercased heading butted against mono digits
            reads as one word. */}
        <span className="ml-2 font-mono text-[10px] font-normal normal-case tabular-nums text-zinc-500">
          {describe(shown)}
        </span>
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        className="flex flex-wrap gap-1 pt-0.5"
        value={current?.id ?? ""}
        onValueChange={(value) => {
          const preset = RENDER_FORMAT_PRESETS.find((candidate) => candidate.id === value);
          if (preset) onChange(preset.format);
        }}
      >
        {RENDER_FORMAT_PRESETS.map((preset) => (
          <DropdownMenuRadioBadge
            key={preset.id}
            value={preset.id}
            data-render-format-option={preset.id}
            // The RATIO is the thing being chosen; the label ("720p") only
            // distinguishes the two 16:9 sizes. Both fit a badge, so neither
            // has to hide in a tooltip.
            title={`${preset.ratio} — ${preset.format.width}×${preset.format.height} at ${preset.format.fps}fps`}
            className={cn("min-w-[3.5rem] flex-none")}
          >
            {preset.label}
          </DropdownMenuRadioBadge>
        ))}
      </DropdownMenuRadioGroup>
    </DropdownMenuGroup>
  );
}

/** Reads and writes the project's own format, so the settings menu only has to
 *  place this — the same shape as `GraphSaveStatus` and `GraphRenderStatus`,
 *  both of which own their own source. */
export function GraphRenderFormat({ timelineId }: Readonly<{ timelineId: string }>) {
  const documents = useSyncExternalStore(
    graphDocumentsGateway.subscribe,
    graphDocumentsGateway.read,
    graphDocumentsGateway.readServerSnapshot,
  );
  return (
    <RenderFormatOptions
      format={documents[timelineId]?.renderFormat}
      onChange={(next) => void graphDocumentsGateway.setRenderFormat(timelineId, next)}
    />
  );
}

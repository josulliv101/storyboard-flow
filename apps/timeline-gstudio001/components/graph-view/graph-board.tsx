"use client";

import { Eye } from "lucide-react";

import {
  TrashTarget,
  UndoRedoControls,
  VirtualGrid,
  VirtualStrip,
  parseNodeId,
} from "@storyboard/ui/dnd-collections";

import { Button } from "@/components/core/button";

import { NativeDropStrip, SidebarToolInsertBridge } from "./graph-native-drop";
import { OpenKeyBoundary } from "./graph-navigation";
import { SyncPanel, type SyncEntry } from "./graph-persistence";
import {
  GraphGridPlayhead,
  GraphGridScrubSurface,
  GraphPlayhead,
  PlayheadScrubBand,
  PreviewShell,
  type PreviewTimeChannel,
} from "./graph-preview";
import { SubTimelines } from "./graph-sub-timelines";
import {
  GRID_CELL_WIDTH,
  GRID_GAP,
  ITEM_SIZE_HEIGHTS,
  ITEM_SIZES,
  TIMELINE_PPS,
  type FocusSurface,
  type ItemSize,
} from "./graph-view-config";

export type { FocusSurface, ItemSize };

/** One page-wide control: every strip row and grid cell on the page — the
 *  focused surface AND every sub-graph row — reads the same step. */
function SizeSelect({
  size,
  onChange,
}: Readonly<{
  size: ItemSize;
  onChange: (size: ItemSize) => void;
}>) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-zinc-500">
      <span className="sr-only">Item size</span>
      <select
        aria-label="Item size"
        value={size}
        onChange={(event) => onChange(event.target.value as ItemSize)}
        className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs uppercase text-zinc-300 outline-none transition-colors hover:border-zinc-700 focus-visible:border-amber-400"
      >
        {ITEM_SIZES.map((option) => (
          <option key={option} value={option}>
            {option.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}

function SurfaceToggle({
  surface,
  onChange,
}: Readonly<{
  surface: FocusSurface;
  onChange: (surface: FocusSurface) => void;
}>) {
  return (
    <div
      role="group"
      aria-label="Timeline layout"
      className="flex items-center rounded-md border border-zinc-800 p-0.5"
    >
      {(["strip", "grid"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={surface === option}
          onClick={() => onChange(option)}
          className={[
            "rounded px-2 py-1 text-xs capitalize transition-colors",
            surface === option
              ? "bg-zinc-800 text-zinc-100"
              : "text-zinc-500 hover:text-zinc-200",
          ].join(" ")}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function GraphBoard({
  focusedId,
  surface,
  onSurfaceChange,
  itemSize,
  onItemSizeChange,
  previewOn,
  onTogglePreview,
  timeChannel,
  trashRootId,
  syncEntries,
}: Readonly<{
  focusedId: string;
  surface: FocusSurface;
  onSurfaceChange: (surface: FocusSurface) => void;
  itemSize: ItemSize;
  onItemSizeChange: (size: ItemSize) => void;
  previewOn: boolean;
  onTogglePreview: () => void;
  timeChannel: PreviewTimeChannel;
  trashRootId: string | null;
  syncEntries: readonly SyncEntry[];
}>) {
  const heights = ITEM_SIZE_HEIGHTS[itemSize];

  return (
    <OpenKeyBoundary>
      <PreviewShell enabled={previewOn} focusedId={focusedId} channel={timeChannel}>
        {/* Outside the surface branch on purpose: the sidebar's tool buttons
            must insert in grid mode too, where no NativeDropStrip exists. */}
        <SidebarToolInsertBridge collectionId={focusedId} />
        <div className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              Click a clip to select it (amber edges trim while selected) · click (or O on) a
              dashed clip to focus it · Ctrl+click multi-selects · press-and-hold to drag
              (cross-timeline included) · undo survives drill-in.
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-pressed={previewOn}
                aria-label={previewOn ? "Hide preview" : "Show preview"}
                title={previewOn ? "Hide preview" : "Show preview"}
                onClick={onTogglePreview}
                className={[
                  "h-8 w-8",
                  previewOn ? "bg-zinc-800 text-zinc-100" : "text-zinc-500",
                ].join(" ")}
              >
                <Eye aria-hidden="true" className="h-4 w-4" />
              </Button>
              <SizeSelect size={itemSize} onChange={onItemSizeChange} />
              <SurfaceToggle surface={surface} onChange={onSurfaceChange} />
              <UndoRedoControls />
            </div>
          </div>

          {surface === "strip" ? (
            <NativeDropStrip collectionId={focusedId}>
              <VirtualStrip
                collectionId={parseNodeId(focusedId)}
                pixelsPerSecond={TIMELINE_PPS}
                itemHeight={heights.strip}
                itemDragActivation="hold"
                overlay={
                  previewOn ? (
                    <GraphPlayhead focusedId={focusedId} channel={timeChannel} />
                  ) : undefined
                }
                className="bg-black/25"
              />
              {previewOn && (
                <PlayheadScrubBand focusedId={focusedId} channel={timeChannel} />
              )}
            </NativeDropStrip>
          ) : (
            <div className="relative">
              <VirtualGrid
                collectionId={parseNodeId(focusedId)}
                cellWidth={GRID_CELL_WIDTH}
                cellHeight={heights.gridCell}
                gap={GRID_GAP}
                height={420}
                overlay={
                  previewOn ? (
                    <GraphGridPlayhead
                      focusedId={focusedId}
                      channel={timeChannel}
                      cellHeight={heights.gridCell}
                    />
                  ) : undefined
                }
                className="bg-black/25"
              />
              {previewOn && (
                <GraphGridScrubSurface
                  focusedId={focusedId}
                  channel={timeChannel}
                  cellHeight={heights.gridCell}
                />
              )}
            </div>
          )}

          <SubTimelines focusedId={focusedId} surface={surface} itemSize={itemSize} />

          {trashRootId !== null && (
            <div className="flex items-end justify-end">
              <div className="shrink-0">
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">
                  Trash
                </h3>
                <TrashTarget trashId={parseNodeId(trashRootId)} />
              </div>
            </div>
          )}

          <SyncPanel entries={syncEntries} />
        </div>
      </PreviewShell>
    </OpenKeyBoundary>
  );
}

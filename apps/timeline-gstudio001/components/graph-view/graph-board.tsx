"use client";

import { EllipsisVertical, TvMinimal } from "lucide-react";

import {
  TrashTarget,
  UndoRedoControls,
  VirtualGrid,
  VirtualStrip,
  parseNodeId,
} from "@storyboard/ui/dnd-collections";

import { Button } from "@/components/core/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/core/dropdown-menu";
import { Slider } from "@/components/core/slider";

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
  MAX_TIMELINE_PPS,
  MIN_TIMELINE_PPS,
  type FocusSurface,
  type ItemSize,
} from "./graph-view-config";

export type { FocusSurface, ItemSize };

/**
 * The board's overflow menu. Deliberately a LIST OF LABELLED SECTIONS rather
 * than a size picker that happens to live in a popover: unrelated controls
 * land here next, so the size radio group is one section among future ones
 * and the menu itself knows nothing about sizing.
 */
function BoardMenu({
  itemSize,
  onItemSizeChange,
}: Readonly<{
  itemSize: ItemSize;
  onItemSizeChange: (size: ItemSize) => void;
}>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Board options"
          title="Board options"
          className="h-8 w-8 text-zinc-500 hover:text-zinc-200"
        >
          <EllipsisVertical aria-hidden="true" className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Thumbnail size</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={itemSize}
          onValueChange={(value) => onItemSizeChange(value as ItemSize)}
        >
          {ITEM_SIZES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {option.toUpperCase()}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Horizontal zoom. Lives in the header rather than the overflow menu because
 * it is an exploration tool, not a setting — you reach for it WHILE reading
 * the strip, to pull a sub-second clip open or squeeze a minute-long one into
 * view. Burying it behind a menu would cost a click per adjustment.
 */
function ScaleSlider({
  pixelsPerSecond,
  onChange,
}: Readonly<{
  pixelsPerSecond: number;
  onChange: (pixelsPerSecond: number) => void;
}>) {
  return (
    <div className="flex w-28 shrink-0 items-center gap-2" title="Timeline scale">
      <Slider
        aria-label="Timeline scale"
        min={MIN_TIMELINE_PPS}
        max={MAX_TIMELINE_PPS}
        step={1}
        value={[pixelsPerSecond]}
        onValueChange={([next]) => onChange(next)}
      />
    </div>
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
  breadcrumb,
  surface,
  onSurfaceChange,
  itemSize,
  onItemSizeChange,
  pixelsPerSecond,
  onPixelsPerSecondChange,
  previewOn,
  onTogglePreview,
  timeChannel,
  trashRootId,
  syncEntries,
}: Readonly<{
  focusedId: string;
  /** Slot, not routing props: the board renders where you are without
   *  knowing how a route is shaped. */
  breadcrumb: React.ReactNode;
  surface: FocusSurface;
  onSurfaceChange: (surface: FocusSurface) => void;
  itemSize: ItemSize;
  onItemSizeChange: (size: ItemSize) => void;
  pixelsPerSecond: number;
  onPixelsPerSecondChange: (pixelsPerSecond: number) => void;
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
            {breadcrumb}
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
                <TvMinimal aria-hidden="true" className="h-4 w-4" />
              </Button>
              <ScaleSlider
                pixelsPerSecond={pixelsPerSecond}
                onChange={onPixelsPerSecondChange}
              />
              <SurfaceToggle surface={surface} onChange={onSurfaceChange} />
              <UndoRedoControls />
              <BoardMenu itemSize={itemSize} onItemSizeChange={onItemSizeChange} />
            </div>
          </div>

          {surface === "strip" ? (
            <NativeDropStrip collectionId={focusedId}>
              <VirtualStrip
                collectionId={parseNodeId(focusedId)}
                pixelsPerSecond={pixelsPerSecond}
                itemHeight={heights.strip}
                itemDragActivation="hold"
                overlay={
                  previewOn ? (
                    <GraphPlayhead
                      focusedId={focusedId}
                      channel={timeChannel}
                      pixelsPerSecond={pixelsPerSecond}
                    />
                  ) : undefined
                }
                className="bg-black/25"
              />
              {previewOn && (
                <PlayheadScrubBand
                  focusedId={focusedId}
                  channel={timeChannel}
                  pixelsPerSecond={pixelsPerSecond}
                />
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

          <SubTimelines
            focusedId={focusedId}
            surface={surface}
            itemSize={itemSize}
            pixelsPerSecond={pixelsPerSecond}
          />

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

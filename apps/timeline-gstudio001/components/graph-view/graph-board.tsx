"use client";

import { EllipsisVertical, FolderTree, TvMinimal } from "lucide-react";

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

import { NativeDropGrid, NativeDropStrip, SidebarToolInsertBridge } from "./graph-native-drop";
import { OpenKeyBoundary } from "./graph-navigation";
import { SyncPanel, type SyncEntry } from "./graph-persistence";
import {
  GraphGridPlayhead,
  GraphGridScrubSurface,
  GraphPlayhead,
  PlayheadScrubBand,
  PreviewShell,
  collectionCardWidth,
  type PreviewTimeChannel,
} from "./graph-preview";
import { SubTimelines } from "./graph-sub-timelines";
import {
  GRID_GAP,
  GRID_UNCAPPED_HEIGHT,
  ITEM_SIZE_DIMENSIONS,
  ITEM_SIZES,
  MAX_TIMELINE_PPS,
  MIN_TIMELINE_PPS,
  isItemSize,
  stepDownItemSize,
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
          onValueChange={(value) => {
            if (isItemSize(value)) onItemSizeChange(value);
          }}
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
    <div className="flex w-36 shrink-0 items-center gap-2" title="Timeline scale">
      <Slider
        aria-label="Timeline scale"
        min={MIN_TIMELINE_PPS}
        max={MAX_TIMELINE_PPS}
        step={1}
        value={[pixelsPerSecond]}
        onValueChange={([next]) => onChange(next)}
      />
      <span
        aria-hidden="true"
        className="w-11 shrink-0 font-mono text-[10px] tabular-nums text-zinc-500"
      >
        {`${Math.round(pixelsPerSecond)} px/s`}
      </span>
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
  childrenShown,
  onToggleChildren,
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
  childrenShown: boolean;
  onToggleChildren: () => void;
  timeChannel: PreviewTimeChannel;
  trashRootId: string | null;
  syncEntries: readonly SyncEntry[];
}>) {
  const dims = ITEM_SIZE_DIMENSIONS[itemSize];

  return (
    <OpenKeyBoundary trashId={trashRootId}>
      <PreviewShell enabled={previewOn} focusedId={focusedId} channel={timeChannel}>
        {/* Outside the surface branch on purpose: the sidebar's tool buttons
            must insert in grid mode too, where no NativeDropStrip exists. */}
        <SidebarToolInsertBridge collectionId={focusedId} />
        <div className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          {/* Pinned so the controls stay reachable while scrolling the
              surfaces. It sticks just BELOW the sticky preview via the offset
              the split pane publishes (0 when the preview is closed). The
              opaque background is load-bearing twice over: it reads as a
              toolbar, and it OCCLUDES the strip/grid scrolling underneath —
              which is what stops a playhead marker from bleeding up into the
              preview. The negative margins let that background span the card's
              full width past its p-4 padding. */}
          <div
            className="sticky z-20 -mx-4 -mt-4 flex items-center justify-between gap-3 rounded-t-xl border-b border-zinc-800/70 bg-zinc-950/95 px-4 py-3 backdrop-blur-sm"
            style={{ top: "var(--workbench-preview-offset, 0px)" }}
          >
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
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-pressed={childrenShown}
                aria-label={childrenShown ? "Hide children timelines" : "Show children timelines"}
                title={childrenShown ? "Hide children timelines" : "Show children timelines"}
                onClick={onToggleChildren}
                className={[
                  "h-8 w-8",
                  childrenShown ? "bg-zinc-800 text-zinc-100" : "text-zinc-500",
                ].join(" ")}
              >
                <FolderTree aria-hidden="true" className="h-4 w-4" />
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
                itemWidth={collectionCardWidth(pixelsPerSecond)}
                itemHeight={dims.strip}
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
            // NativeDropGrid wraps the scrub surface too, so a native drag over
            // the (preview-only) scrub overlay still bubbles to the drop target.
            <NativeDropGrid collectionId={focusedId}>
              <div className="relative">
                <VirtualGrid
                  collectionId={parseNodeId(focusedId)}
                  cellWidth={dims.gridWidth}
                  cellHeight={dims.gridHeight}
                  gap={GRID_GAP}
                  height={GRID_UNCAPPED_HEIGHT}
                  overlay={
                    previewOn ? (
                      <GraphGridPlayhead
                        focusedId={focusedId}
                        channel={timeChannel}
                        cellHeight={dims.gridHeight}
                        pixelsPerSecond={pixelsPerSecond}
                      />
                    ) : undefined
                  }
                  className="bg-black/25"
                />
                {previewOn && (
                  <GraphGridScrubSurface
                    focusedId={focusedId}
                    channel={timeChannel}
                    cellHeight={dims.gridHeight}
                    pixelsPerSecond={pixelsPerSecond}
                  />
                )}
              </div>
            </NativeDropGrid>
          )}

          {/* Children render one size step below the focused timeline (flat —
              every descendant is this one size, see stepDownItemSize). The
              FolderTree toggle unmounts them entirely rather than hiding with
              CSS, so their strips/grids and sub-row playheads leave the DOM. */}
          {childrenShown && (
            <SubTimelines
              focusedId={focusedId}
              surface={surface}
              itemSize={stepDownItemSize(itemSize)}
              pixelsPerSecond={pixelsPerSecond}
              previewOn={previewOn}
              timeChannel={timeChannel}
            />
          )}

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

"use client";

import { useContext } from "react";
import { EllipsisVertical, FolderTree, Redo2, Ruler, TvMinimal, Undo2 } from "lucide-react";

import {
  CollectionsContainerContext,
  VirtualGrid,
  VirtualStrip,
  parseNodeId,
  useCollectionsSelector,
  useCollectionsStore,
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
import { SidebarGraphTrashPortal } from "./graph-sidebar-trash";
import { OpenKeyBoundary } from "./graph-navigation";
import { SyncPanel, type SyncEntry } from "./graph-persistence";
import {
  GraphGridPlayhead,
  GraphGridScrubSurface,
  GraphPlayhead,
  GraphRuler,
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

/**
 * Undo/redo as ICON buttons, matching the toolbar's other ghost icon controls
 * (preview, children) rather than the package's generic text-label
 * `UndoRedoControls`. App-local on purpose: the icon styling is this toolbar's
 * design, so it stays out of the framework-agnostic package — but the store
 * wiring (and best-effort announce) is exactly the package control's.
 */
function GraphUndoRedo() {
  const store = useCollectionsStore();
  const canUndo = useCollectionsSelector((s) => s.canUndo);
  const canRedo = useCollectionsSelector((s) => s.canRedo);
  const announce = useContext(CollectionsContainerContext)?.announce;

  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!canUndo}
        aria-label="Undo"
        title="Undo"
        onClick={() => {
          if (store.undo()) announce?.("Change undone.");
        }}
        className="h-8 w-8 text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
      >
        <Undo2 aria-hidden="true" className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={!canRedo}
        aria-label="Redo"
        title="Redo"
        onClick={() => {
          if (store.redo()) announce?.("Change redone.");
        }}
        className="h-8 w-8 text-zinc-400 hover:text-zinc-100 disabled:opacity-40"
      >
        <Redo2 aria-hidden="true" className="h-4 w-4" />
      </Button>
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
  rulerOn,
  onToggleRuler,
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
  rulerOn: boolean;
  onToggleRuler: () => void;
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
              breadcrumb row. z-40 to sit ABOVE the strip's z-30 playhead
              overlay (z-20 was below it, so the marker bled through the
              header); it matches the sticky preview's z-40. The negative
              margins let that background span the card's full width past its
              p-4 padding. */}
          <div
            className="sticky z-40 -mx-4 -mt-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-t-xl border-b border-zinc-800/70 bg-zinc-950/95 px-4 py-3 backdrop-blur-sm"
            style={{ top: "var(--workbench-preview-offset, 0px)" }}
          >
            {breadcrumb}
            {/* flex-wrap + wrap-capable controls so a narrow viewport folds the
                toolbar onto a second line instead of pushing controls (the
                Strip/Grid toggle especially) off-screen. No effect when it
                fits. */}
            <div className="flex flex-wrap items-center justify-end gap-2">
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
              {/* Ruler is a strip-only axis (grid has no single time axis), so
                  the toggle drops out in grid mode like the scale slider. */}
              {surface === "strip" ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-pressed={rulerOn}
                  aria-label={rulerOn ? "Hide time ruler" : "Show time ruler"}
                  title={rulerOn ? "Hide time ruler" : "Show time ruler"}
                  onClick={onToggleRuler}
                  className={[
                    "h-8 w-8",
                    rulerOn ? "bg-zinc-800 text-zinc-100" : "text-zinc-500",
                  ].join(" ")}
                >
                  <Ruler aria-hidden="true" className="h-4 w-4" />
                </Button>
              ) : null}
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
              {/* px/s is a strip-only axis: grid cells are sized by thumbnail
                  size, and the grid playhead ignores clip width, so the slider
                  is a no-op in grid mode. Hidden there (state is preserved, so
                  returning to strip restores the last zoom). */}
              {surface === "strip" ? (
                <ScaleSlider
                  pixelsPerSecond={pixelsPerSecond}
                  onChange={onPixelsPerSecondChange}
                />
              ) : null}
              <SurfaceToggle surface={surface} onChange={onSurfaceChange} />
              <GraphUndoRedo />
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
                  previewOn || rulerOn ? (
                    <>
                      {rulerOn ? (
                        <GraphRuler focusedId={focusedId} pixelsPerSecond={pixelsPerSecond} />
                      ) : null}
                      {previewOn ? (
                        <GraphPlayhead
                          focusedId={focusedId}
                          channel={timeChannel}
                          pixelsPerSecond={pixelsPerSecond}
                        />
                      ) : null}
                    </>
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
                  // Mirror the strip: a quick tap is a CLICK (so the in-card
                  // drill button works) and a press-and-hold starts the reorder
                  // drag. "body" (the default) drags instantly, which ate the
                  // drill click and made drags ambiguous.
                  itemDragActivation="hold"
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
              rulerOn={rulerOn}
              timeChannel={timeChannel}
            />
          )}

          {/* Trash is now the sidebar tool palette, which morphs into a drop
              target while a card is being dragged (R5 #1) — the old fixed
              bottom-right panel is gone (R5 #5). This portals into the sidebar
              from inside the provider, so its droppable joins the DndContext. */}
          <SidebarGraphTrashPortal trashId={trashRootId} />

          <SyncPanel entries={syncEntries} />
        </div>
      </PreviewShell>
    </OpenKeyBoundary>
  );
}

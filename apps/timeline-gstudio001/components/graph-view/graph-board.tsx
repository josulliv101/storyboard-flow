"use client";

import {
  TrashTarget,
  UndoRedoControls,
  VirtualGrid,
  VirtualStrip,
  parseNodeId,
} from "@storyboard/ui/dnd-collections";

import { Button } from "@/components/core/button";

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
  GRID_CELL_HEIGHT,
  GRID_CELL_WIDTH,
  GRID_GAP,
  TIMELINE_PPS,
} from "./graph-view-config";

export type FocusSurface = "strip" | "grid";

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
      aria-label="Focused timeline layout"
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
  previewOn,
  onTogglePreview,
  assetsOpen,
  onToggleAssets,
  timeChannel,
  trashRootId,
  syncEntries,
}: Readonly<{
  focusedId: string;
  surface: FocusSurface;
  onSurfaceChange: (surface: FocusSurface) => void;
  previewOn: boolean;
  onTogglePreview: () => void;
  assetsOpen: boolean;
  onToggleAssets: () => void;
  timeChannel: PreviewTimeChannel;
  trashRootId: string | null;
  syncEntries: readonly SyncEntry[];
}>) {
  return (
    <OpenKeyBoundary>
      <PreviewShell enabled={previewOn} focusedId={focusedId} channel={timeChannel}>
        <div className="flex flex-col gap-5 rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-500">
              Press-and-hold to drag (cross-timeline included) · amber edges trim · double-click
              (or O) a dashed clip to focus it · undo survives drill-in.
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={previewOn}
                onClick={onTogglePreview}
              >
                Preview
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={assetsOpen}
                onClick={onToggleAssets}
              >
                Assets
              </Button>
              <SurfaceToggle surface={surface} onChange={onSurfaceChange} />
              <UndoRedoControls />
            </div>
          </div>

          {surface === "strip" ? (
            <div className="relative">
              <VirtualStrip
                collectionId={parseNodeId(focusedId)}
                pixelsPerSecond={TIMELINE_PPS}
                itemHeight={88}
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
            </div>
          ) : (
            <div className="relative">
              <VirtualGrid
                collectionId={parseNodeId(focusedId)}
                cellWidth={GRID_CELL_WIDTH}
                cellHeight={GRID_CELL_HEIGHT}
                gap={GRID_GAP}
                height={420}
                overlay={
                  previewOn ? (
                    <GraphGridPlayhead focusedId={focusedId} channel={timeChannel} />
                  ) : undefined
                }
                className="bg-black/25"
              />
              {previewOn && (
                <GraphGridScrubSurface focusedId={focusedId} channel={timeChannel} />
              )}
            </div>
          )}

          <SubTimelines focusedId={focusedId} />

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

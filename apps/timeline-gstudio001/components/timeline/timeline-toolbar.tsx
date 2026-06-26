import { cn } from "@/lib/utils";

import { ITEM_HEIGHTS, type ItemSize } from "./constants";
import { GripVertical } from "lucide-react";

type TimelineToolbarProps = {
  gridMode: boolean;
  itemSize: ItemSize;
  manualOverhangScroll: boolean;
  showPassiveFilmstrips: boolean;
  title?: string;
  onGridModeChange: (enabled: boolean) => void;
  onItemSizeChange: (size: ItemSize) => void;
  onManualOverhangScrollChange: (enabled: boolean) => void;
  onPassiveFilmstripsChange: (enabled: boolean) => void;
  onThumbnailModeChange: (enabled: boolean) => void;
  onZoomChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  renderedCount: number;
  thumbnailMode: boolean;
  totalCount: number;
  zoomLevel: number;
  timelineId?: string;
};

function ToggleSwitch({
  checked,
  id,
  label,
  onChange,
  title,
}: {
  checked: boolean;
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
  title?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={id}
        className="cursor-pointer select-none text-[10px] font-semibold uppercase text-zinc-400"
        title={title}
      >
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        title={title}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 transition-colors duration-200",
          checked
            ? "border-amber-400 bg-amber-400/30"
            : "border-zinc-600 bg-zinc-800",
        )}
      >
        <span
          className={cn(
            "pointer-events-none block h-3 w-3 rounded-full shadow-sm transition-transform duration-200",
            checked
              ? "translate-x-[18px] bg-amber-400"
              : "translate-x-[2px] bg-zinc-400",
          )}
        />
      </button>
    </div>
  );
}

export function TimelineToolbar({
  gridMode,
  itemSize,
  manualOverhangScroll,
  showPassiveFilmstrips,
  title = "Timeline",
  onGridModeChange,
  onItemSizeChange,
  onManualOverhangScrollChange,
  onPassiveFilmstripsChange,
  onThumbnailModeChange,
  onZoomChange,
  renderedCount,
  thumbnailMode,
  totalCount,
  zoomLevel,
  timelineId,
}: TimelineToolbarProps) {
  const pinScrollTitle = manualOverhangScroll
    ? "Pin scroll is ON — selecting the first video clip keeps the viewport in place. Scroll left manually to reveal the filmstrip overhang."
    : "Pin scroll is OFF — selecting the first video clip auto-scrolls to reveal the filmstrip overhang.";

  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {timelineId && (
          <div
            draggable={false}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const target = e.currentTarget;
              target.setPointerCapture(e.pointerId);

              window.dispatchEvent(
                new CustomEvent("gstudio-timeline-drag", {
                  detail: {
                    timelineId,
                    clientX: e.clientX,
                    clientY: e.clientY,
                    isDropping: false,
                    type: "start"
                  }
                })
              );

              const onPointerMove = (moveEv: PointerEvent) => {
                window.dispatchEvent(
                  new CustomEvent("gstudio-timeline-drag", {
                    detail: {
                      timelineId,
                      clientX: moveEv.clientX,
                      clientY: moveEv.clientY,
                      isDropping: false,
                      type: "move"
                    }
                  })
                );
              };

              const onPointerUp = (upEv: PointerEvent) => {
                try {
                  target.releasePointerCapture(upEv.pointerId);
                } catch {}
                window.removeEventListener("pointermove", onPointerMove);
                window.removeEventListener("pointerup", onPointerUp);

                window.dispatchEvent(
                  new CustomEvent("gstudio-timeline-drag", {
                    detail: {
                      timelineId,
                      clientX: upEv.clientX,
                      clientY: upEv.clientY,
                      isDropping: true,
                      type: "drop"
                    }
                  })
                );
              };

              window.addEventListener("pointermove", onPointerMove);
              window.addEventListener("pointerup", onPointerUp);
            }}
            className="cursor-grab active:cursor-grabbing p-1 hover:bg-zinc-800 rounded transition-colors shrink-0 flex items-center justify-center text-zinc-500 hover:text-zinc-300"
            title="Drag to reorder timeline"
          >
            <GripVertical className="h-4 w-4 pointer-events-none" />
          </div>
        )}
        <h3 className="min-w-0 truncate text-sm font-semibold text-zinc-200">
          {title}
        </h3>
      </div>
      <div className="flex items-center gap-4">
        <ToggleSwitch
          id="thumbnail-mode"
          label="Thumbnail Mode"
          checked={thumbnailMode}
          onChange={onThumbnailModeChange}
        />
        {thumbnailMode && (
          <ToggleSwitch
            id="grid-mode"
            label="Grid Mode"
            checked={gridMode}
            onChange={onGridModeChange}
          />
        )}
        <ToggleSwitch
          id="passive-filmstrips"
          label="Filmstrips"
          checked={showPassiveFilmstrips}
          onChange={onPassiveFilmstripsChange}
          title="Show read-only filmstrips for inactive video clips"
        />
        <div className="flex items-center gap-2">
          <label
            htmlFor="size-select"
            className="text-[10px] font-semibold uppercase text-zinc-400"
          >
            Size
          </label>
          <select
            id="size-select"
            value={itemSize}
            onChange={(event) => onItemSizeChange(event.target.value as ItemSize)}
            className="h-6 rounded border border-zinc-700 bg-zinc-800 px-2 text-xs font-medium text-zinc-200 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            {Object.keys(ITEM_HEIGHTS).map((size) => (
              <option key={size} value={size}>
                {size.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="zoom-slider"
            className="text-[10px] font-semibold uppercase text-zinc-400"
          >
            Zoom
          </label>
          <input
            id="zoom-slider"
            type="range"
            min="20"
            max="300"
            step="1"
            value={zoomLevel}
            onChange={onZoomChange}
            className="w-24 accent-amber-400"
          />
        </div>
        <ToggleSwitch
          id="pin-scroll-toggle"
          label="Pin scroll"
          checked={manualOverhangScroll}
          onChange={onManualOverhangScrollChange}
          title={pinScrollTitle}
        />
        <span className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-400">
          <span data-testid="timeline-rendered-count">
            {renderedCount}/{totalCount} rendered
          </span>
        </span>
      </div>
    </div>
  );
}

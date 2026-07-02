import { useState, useEffect, type ReactNode } from "react";
import { cn } from "../lib/utils";

import { ITEM_HEIGHTS, type ItemSize } from "./constants";
import { ChevronDown, ChevronRight } from "lucide-react";

type TimelineToolbarProps = {
  gridMode: boolean;
  itemSize: ItemSize;
  showPlayBarArea: boolean;
  showPassiveFilmstrips: boolean;
  title?: string;
  onGridModeChange: (enabled: boolean) => void;
  onItemSizeChange: (size: ItemSize) => void;
  onPlayBarAreaChange: (enabled: boolean) => void;
  onPassiveFilmstripsChange: (enabled: boolean) => void;
  onZoomChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  thumbnailMode: boolean;
  zoomLevel: number;
  timelineId?: string;
  hierarchyMode?: boolean;
  onHierarchyModeChange?: (enabled: boolean) => void;
  hasChildCollections?: boolean;
  childCollectionsExpanded?: boolean;
  onToggleChildCollections?: () => void;
  onTitleChange?: (newTitle: string) => void;
  titleMeta?: ReactNode;
  toolbarActions?: ReactNode;
};

export function ToggleSwitch({
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
  showPlayBarArea,
  showPassiveFilmstrips,
  title = "Timeline",
  onGridModeChange,
  onItemSizeChange,
  onPlayBarAreaChange,
  onPassiveFilmstripsChange,
  onZoomChange,
  thumbnailMode,
  zoomLevel,
  hierarchyMode = false,
  onHierarchyModeChange,
  hasChildCollections = false,
  childCollectionsExpanded = false,
  onToggleChildCollections,
  onTitleChange,
  titleMeta,
  toolbarActions,
}: TimelineToolbarProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(title || "");

  useEffect(() => {
    setEditValue(title || "");
  }, [title]);



  return (
    <div className="flex w-full min-w-0 items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        {hierarchyMode && hasChildCollections && onToggleChildCollections && (
          <button
            type="button"
            onClick={onToggleChildCollections}
            className="p-1 hover:bg-zinc-800 rounded transition-colors text-zinc-400 hover:text-zinc-200 shrink-0 flex items-center justify-center"
            title={childCollectionsExpanded ? "Collapse nested collections" : "Expand nested collections"}
          >
            {childCollectionsExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </button>
        )}
        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => {
              setIsEditing(false);
              if (editValue && editValue.trim() && editValue.trim() !== title) {
                onTitleChange?.(editValue.trim());
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setIsEditing(false);
                if (editValue && editValue.trim() && editValue.trim() !== title) {
                  onTitleChange?.(editValue.trim());
                }
              } else if (e.key === "Escape") {
                setIsEditing(false);
                setEditValue(title || "");
              }
            }}
            autoFocus
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-xs font-semibold text-zinc-100 outline-none focus:border-amber-500 max-w-[200px]"
          />
        ) : (
          <h3
            onClick={() => {
              if (onTitleChange) {
                setIsEditing(true);
                setEditValue(title || "");
              }
            }}
            className={cn(
              "min-w-0 truncate text-sm font-semibold text-zinc-200",
              onTitleChange && "cursor-pointer hover:text-zinc-100 hover:bg-zinc-800/40 px-1 rounded transition-colors"
            )}
            title={onTitleChange ? "Click to rename collection" : undefined}
          >
            {title}
          </h3>
        )}
        {titleMeta ? (
          <div className="min-w-0 shrink text-xs text-zinc-500">
            {titleMeta}
          </div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        {thumbnailMode && (
          <ToggleSwitch
            id="grid-mode"
            label="Grid Mode"
            checked={gridMode}
            onChange={onGridModeChange}
          />
        )}

        <ToggleSwitch
          id="playbar-area"
          label="Play bar"
          checked={showPlayBarArea}
          onChange={onPlayBarAreaChange}
          title="Show the scrub/play bar above timeline items"
        />
        {showPlayBarArea && (
          <ToggleSwitch
            id="passive-filmstrips"
            label="Filmstrips"
            checked={showPassiveFilmstrips}
            onChange={onPassiveFilmstripsChange}
            title="Show read-only filmstrips for inactive video clips"
          />
        )}
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
        {!thumbnailMode && (
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
        )}
        {toolbarActions ? (
          <div className="flex items-center gap-2">
            {toolbarActions}
          </div>
        ) : null}

      </div>
    </div>
  );
}

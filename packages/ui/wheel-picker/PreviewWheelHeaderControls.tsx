import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Switch } from '../core/switch';
import { cn } from '../lib/utils';
import type { SceneLaunchMediaItem } from './SceneLaunchPreviewWheelV3';

export interface PreviewWheelHeaderControlsProps {
  items: SceneLaunchMediaItem[];
  rowTitle?: string;
  isFirstGridRow?: boolean;
  canNavigateBack?: boolean;
  onNavigateBack?: () => void;
  parentCollectionName?: string;
  parentCollectionThumbnailUrl?: string;
  breadcrumbs?: { id: string; name: string }[];
  onBreadcrumbClick?: (index: number) => void;
  currentCollectionName?: string;
  onBreakoutCollectionsChange?: (enabled: boolean) => void;
  breakoutCollectionsEnabled?: boolean;
  onBreakoutNestingDepthChange?: (depth: number) => void;
  breakoutNestingDepth?: number;
  onTimelineWrappedChange?: (wrapped: boolean) => void;
  timelineWrapped?: boolean;
}

export function PreviewWheelHeaderControls({
  items,
  rowTitle,
  isFirstGridRow = false,
  canNavigateBack = false,
  onNavigateBack,
  parentCollectionName,
  parentCollectionThumbnailUrl,
  breadcrumbs,
  onBreadcrumbClick,
  currentCollectionName,
  onBreakoutCollectionsChange,
  breakoutCollectionsEnabled = false,
  onBreakoutNestingDepthChange,
  breakoutNestingDepth = 1,
  onTimelineWrappedChange,
  timelineWrapped = false,
}: PreviewWheelHeaderControlsProps) {
  return (
    <div className="z-30 flex w-full shrink-0 items-center border-b border-zinc-800/60 bg-[#0c0c0e] px-4 py-2 shadow-md">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {onNavigateBack && !isFirstGridRow && (
          <button
            type="button"
            title={canNavigateBack ? (parentCollectionName ? `Back to ${parentCollectionName}` : 'Back to parent collection') : 'No parent collection'}
            aria-label={canNavigateBack ? (parentCollectionName ? `Back to ${parentCollectionName}` : 'Back to parent collection') : 'No parent collection'}
            disabled={!canNavigateBack}
            onClick={(event) => {
              event.stopPropagation();
              onNavigateBack();
            }}
            className="group relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-800 text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {canNavigateBack && parentCollectionThumbnailUrl ? (
              <>
                <img
                  src={parentCollectionThumbnailUrl}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover opacity-60 transition-opacity duration-200 group-hover:opacity-80"
                />
                <div className="absolute inset-0 bg-black/40 transition-colors duration-200 group-hover:bg-black/25" />
                <ArrowLeft className="relative z-10 h-4 w-4 text-white drop-shadow-[0_1.5px_2px_rgba(0,0,0,0.85)] transition-transform duration-200 group-hover:-translate-x-0.5" />
              </>
            ) : (
              <ArrowLeft className="h-4 w-4" />
            )}
          </button>
        )}
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-xs font-bold text-zinc-400 select-none">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.id}>
                  {idx > 0 && <span className="text-zinc-600 text-[10px] select-none font-mono">/</span>}
                  {isLast ? (
                    <span className="text-zinc-100 font-black truncate max-w-[150px]">
                      {crumb.name}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onBreadcrumbClick?.(idx)}
                      className="hover:text-zinc-200 transition-colors truncate max-w-[120px] font-black"
                    >
                      {crumb.name}
                    </button>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-col">
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">
              {rowTitle || 'Current Collection'}
            </span>
            <span className="text-xs font-black text-zinc-200">
              {currentCollectionName || 'Workspace'}
              {items && ` (${items.length})`}
            </span>
          </div>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-4 pl-4 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
        {onBreakoutCollectionsChange && (
          <div className="flex items-center gap-2">
            <span>Break out by collection</span>
            <Switch
              size="sm"
              checked={breakoutCollectionsEnabled}
              onCheckedChange={onBreakoutCollectionsChange}
              aria-label="Break out by collection"
            />
          </div>
        )}
        {breakoutCollectionsEnabled && onBreakoutNestingDepthChange && (
          <div className="flex items-center gap-1.5 border border-zinc-800 bg-zinc-900/60 rounded px-1.5 py-0.5 text-[9px] text-zinc-300">
            <span>Depth:</span>
            <select
              value={breakoutNestingDepth}
              onChange={(e) => onBreakoutNestingDepthChange(Number(e.target.value))}
              className="bg-transparent border-none text-zinc-100 font-bold focus:outline-none cursor-pointer"
            >
              <option value="1" className="bg-zinc-950 text-zinc-200">1 Level</option>
              <option value="2" className="bg-zinc-950 text-zinc-200">2 Levels</option>
              <option value="3" className="bg-zinc-950 text-zinc-200">3 Levels</option>
            </select>
          </div>
        )}
        {onTimelineWrappedChange && (
          <div className="flex items-center gap-2">
            <span>Wrap timeline</span>
            <Switch
              size="sm"
              checked={timelineWrapped}
              onCheckedChange={onTimelineWrappedChange}
              aria-label="Wrap timeline"
            />
          </div>
        )}
      </div>
    </div>
  );
}

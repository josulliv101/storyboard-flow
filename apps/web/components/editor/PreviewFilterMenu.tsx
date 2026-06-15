'use client';

import { Activity, Filter, MessageSquare, Monitor, Star, Tags, Type } from 'lucide-react';
import { buttonVariants, DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from '@storyboard/ui';
import { cn } from '@/lib/utils';

const NOTE_TAG_FILTER_NONE = '__NO_NOTE_TAGS_VISIBLE__';

export type PreviewGraphLayer = {
  id: string;
  label: string;
  parentName?: string;
  isVisible: boolean;
};

type PreviewFilterMenuProps = {
  noteTagFilter: string[];
  showStarredNoteOverlaysOnly: boolean;
  showDialogPreviewUi: boolean;
  setShowDialogPreviewUi: (show: boolean) => void;
  showSceneTitleUi: boolean;
  setShowSceneTitleUi: (show: boolean) => void;
  previewMediaLayout: 'inset' | 'full';
  setPreviewMediaLayout: (layout: 'inset' | 'full') => void;
  compactNoteOverlays: boolean;
  setCompactNoteOverlays: (compact: boolean) => void;
  setShowStarredNoteOverlaysOnly: (show: boolean) => void;
  graphLayers: PreviewGraphLayer[];
  visibleGraphLayerCount: number;
  toggleTrackDisable: (trackId: string) => void;
  noteTags: string[];
  activeFilterCount: number;
  setNoteTagFilter: (tags: string[]) => void;
  enabledNoteTagSet: Set<string>;
  noteTagCounts: Map<string, { label: string; count: number }>;
  toggleNoteTag: (tag: string) => void;
  filterSummaryLabel: string;
  selectedFilterLabels: string[];
};

function ToggleKnob({ active, tone = 'indigo' }: { active: boolean; tone?: 'indigo' | 'amber' }) {
  const activeClasses = tone === 'amber'
    ? 'border-amber-300/60 bg-amber-300/25'
    : 'border-indigo-400/60 bg-indigo-400/25';
  const knobClasses = tone === 'amber' ? 'bg-amber-100' : 'bg-indigo-200';

  return (
    <span
      className={cn(
        'relative h-4 w-7 shrink-0 rounded-full border transition-colors',
        active ? activeClasses : 'border-zinc-700 bg-zinc-900'
      )}
      aria-hidden="true"
    >
      <span
        className={cn(
          'absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-transform',
          active ? `translate-x-3.5 ${knobClasses}` : 'translate-x-0.5 bg-zinc-600'
        )}
      />
    </span>
  );
}

export function PreviewFilterMenu({
  noteTagFilter,
  showStarredNoteOverlaysOnly,
  showDialogPreviewUi,
  setShowDialogPreviewUi,
  showSceneTitleUi,
  setShowSceneTitleUi,
  previewMediaLayout,
  setPreviewMediaLayout,
  compactNoteOverlays,
  setCompactNoteOverlays,
  setShowStarredNoteOverlaysOnly,
  graphLayers,
  visibleGraphLayerCount,
  toggleTrackDisable,
  noteTags,
  activeFilterCount,
  setNoteTagFilter,
  enabledNoteTagSet,
  noteTagCounts,
  toggleNoteTag,
  filterSummaryLabel,
  selectedFilterLabels,
}: PreviewFilterMenuProps) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon' }),
            'relative text-zinc-500 hover:text-zinc-300',
            (noteTagFilter.length > 0 || showStarredNoteOverlaysOnly) && 'text-indigo-300 hover:text-indigo-200'
          )}
          aria-label="Filter notes"
        >
          <Filter className="h-4 w-4" />
          {(noteTagFilter.length > 0 || showStarredNoteOverlaysOnly) && (
            <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-indigo-400" />
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="max-h-80 w-64 overflow-y-auto border-zinc-800 bg-[#111114] p-2 text-zinc-300 z-50">
          <div className="mb-2 flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-950/70 p-2">
            <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Preview UI</div>
            <button
              type="button"
              aria-pressed={showDialogPreviewUi}
              className={cn(
                'flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors',
                showDialogPreviewUi
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-100'
                  : 'border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200'
              )}
              onClick={() => setShowDialogPreviewUi(!showDialogPreviewUi)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-[10px] font-bold uppercase tracking-wider">Dialog UI</span>
              </span>
              <ToggleKnob active={showDialogPreviewUi} />
            </button>
            <button
              type="button"
              aria-pressed={showSceneTitleUi}
              className={cn(
                'flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors',
                showSceneTitleUi
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-100'
                  : 'border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200'
              )}
              onClick={() => setShowSceneTitleUi(!showSceneTitleUi)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Type className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-[10px] font-bold uppercase tracking-wider">Scene Info</span>
              </span>
              <ToggleKnob active={showSceneTitleUi} />
            </button>
            <button
              type="button"
              aria-pressed={previewMediaLayout === 'full'}
              className={cn(
                'flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors',
                previewMediaLayout === 'full'
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-100'
                  : 'border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200'
              )}
              onClick={() => setPreviewMediaLayout(previewMediaLayout === 'full' ? 'inset' : 'full')}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Monitor className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-[10px] font-bold uppercase tracking-wider">
                  {previewMediaLayout === 'full' ? 'Full Video' : 'Inset Video'}
                </span>
              </span>
              <ToggleKnob active={previewMediaLayout === 'full'} />
            </button>
            <button
              type="button"
              aria-pressed={compactNoteOverlays}
              className={cn(
                'flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors',
                compactNoteOverlays
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-100'
                  : 'border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200'
              )}
              onClick={() => setCompactNoteOverlays(!compactNoteOverlays)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Tags className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate text-[10px] font-bold uppercase tracking-wider">Note Tags</span>
              </span>
              <ToggleKnob active={compactNoteOverlays} />
            </button>
            <button
              type="button"
              aria-pressed={showStarredNoteOverlaysOnly}
              className={cn(
                'flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors',
                showStarredNoteOverlaysOnly
                  ? 'border-amber-400/50 bg-amber-400/10 text-amber-100'
                  : 'border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200'
              )}
              onClick={() => setShowStarredNoteOverlaysOnly(!showStarredNoteOverlaysOnly)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Star className={cn('h-3.5 w-3.5 shrink-0', showStarredNoteOverlaysOnly && 'fill-amber-300 text-amber-300')} />
                <span className="truncate text-[10px] font-bold uppercase tracking-wider">Starred Notes Only</span>
              </span>
              <ToggleKnob active={showStarredNoteOverlaysOnly} tone="amber" />
            </button>
          </div>
          <DropdownMenuSeparator className="mb-2 bg-zinc-800" />
          <div className="mb-2 flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-950/70 p-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Graph Layers</div>
              <div className="mt-0.5 text-[9px] font-mono uppercase tracking-widest text-zinc-600">
                {graphLayers.length === 0 ? 'No graphs' : `${visibleGraphLayerCount}/${graphLayers.length} visible`}
              </div>
            </div>
            {graphLayers.length === 0 ? (
              <div className="rounded border border-zinc-800 bg-zinc-950/80 px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
                No graph layers yet
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {graphLayers.map(layer => (
                  <button
                    key={layer.id}
                    type="button"
                    aria-pressed={layer.isVisible}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors',
                      layer.isVisible
                        ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-100'
                        : 'border-zinc-800 bg-zinc-950/80 text-zinc-500 hover:border-zinc-700 hover:text-zinc-200'
                    )}
                    onClick={() => toggleTrackDisable(layer.id)}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Activity className="h-3.5 w-3.5 shrink-0" />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-[10px] font-bold uppercase tracking-wider">{layer.label}</span>
                        {layer.parentName && (
                          <span className="truncate text-[9px] font-mono uppercase tracking-widest text-zinc-600">{layer.parentName}</span>
                        )}
                      </span>
                    </span>
                    <ToggleKnob active={layer.isVisible} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <DropdownMenuSeparator className="mb-2 bg-zinc-800" />
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Note Tags</div>
              <div className="mt-0.5 text-[9px] font-mono uppercase tracking-widest text-zinc-600">
                {noteTags.length === 0 ? 'No tags' : `${activeFilterCount}/${noteTags.length} visible`}
              </div>
            </div>
            {noteTags.length > 0 && (
              <div className="flex shrink-0 items-center gap-1.5">
                <button
                  type="button"
                  className="rounded border border-zinc-800 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                  onClick={() => setNoteTagFilter([])}
                >
                  Show All
                </button>
                <button
                  type="button"
                  className="rounded border border-zinc-800 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 hover:border-zinc-700 hover:text-zinc-200"
                  onClick={() => setNoteTagFilter([NOTE_TAG_FILTER_NONE])}
                >
                  Hide All
                </button>
              </div>
            )}
          </div>
          {noteTags.length === 0 ? (
            <div className="rounded border border-zinc-800 bg-zinc-950/80 px-3 py-4 text-center text-[10px] font-semibold uppercase tracking-widest text-zinc-600">
              No note tags yet
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {noteTags.map(tag => {
                const isEnabled = enabledNoteTagSet.has(tag.toLowerCase());
                const noteCount = noteTagCounts.get(tag.toLowerCase())?.count || 0;
                return (
                  <button
                    key={tag}
                    type="button"
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors',
                      isEnabled
                        ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-200'
                        : 'border-zinc-800 bg-zinc-950/80 text-zinc-600 hover:border-zinc-700 hover:text-zinc-300'
                    )}
                    onClick={() => toggleNoteTag(tag)}
                  >
                    <span>{tag}</span>
                    <span className={cn(
                      'ml-0.5 rounded px-1 font-mono text-[9px] leading-none',
                      isEnabled ? 'bg-indigo-300/15 text-indigo-100' : 'bg-white/[0.04] text-zinc-500'
                    )}>
                      {noteCount}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {filterSummaryLabel && (
        <div
          className="max-w-44 truncate rounded border border-zinc-800 bg-zinc-950/80 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500"
          title={selectedFilterLabels.join(', ')}
        >
          {filterSummaryLabel}
        </div>
      )}
    </>
  );
}

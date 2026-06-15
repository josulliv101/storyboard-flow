'use client';

import { Clapperboard, Columns4, Eye, EyeOff, FileVideo, Grid2X2, PanelsTopLeft, Settings, Trash2 } from 'lucide-react';
import { Button } from '@storyboard/ui';
import { cn } from '@/lib/utils';
import type { TimelineTrack } from '@/lib/timeline-context';

type SettingsSidePanelProps = {
  previewSceneMode: 'active' | 'all';
  setPreviewSceneMode: (mode: 'active' | 'all') => void;
  previewGroupLayout: 'row' | 'grid';
  setPreviewGroupLayout: (layout: 'row' | 'grid') => void;
  previewMediaLayout: 'inset' | 'full';
  setPreviewMediaLayout: (layout: 'inset' | 'full') => void;
  analyticsOverlayStyle: 'compact' | 'analysis';
  setAnalyticsOverlayStyle: (style: 'compact' | 'analysis') => void;
  showNoteOverlayIcons: boolean;
  setShowNoteOverlayIcons: (show: boolean) => void;
  tracks: TimelineTrack[];
  updateTrack: (id: string, updates: Partial<TimelineTrack>) => void;
  deleteTrack: (id: string) => void;
};

const optionButtonClass = "h-8 border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200";
const activeOptionClass = "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/15 hover:text-indigo-200";

export function SettingsSidePanel({
  previewSceneMode,
  setPreviewSceneMode,
  previewGroupLayout,
  setPreviewGroupLayout,
  previewMediaLayout,
  setPreviewMediaLayout,
  analyticsOverlayStyle,
  setAnalyticsOverlayStyle,
  showNoteOverlayIcons,
  setShowNoteOverlayIcons,
  tracks,
  updateTrack,
  deleteTrack,
}: SettingsSidePanelProps) {
  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex flex-col items-center justify-center text-center gap-2 mb-4 opacity-80 pt-4">
        <Settings className="w-8 h-8 text-zinc-600" />
        <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Project Settings</h4>
      </div>

      <div className="space-y-4">
        <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">Preview Layout</h5>
        <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="mb-4">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-300">Scene Scope</div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(optionButtonClass, previewSceneMode === 'active' && activeOptionClass)}
                onClick={() => setPreviewSceneMode('active')}
              >
                <Clapperboard data-icon="inline-start" />
                Active
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(optionButtonClass, previewSceneMode === 'all' && activeOptionClass)}
                onClick={() => setPreviewSceneMode('all')}
              >
                <Grid2X2 data-icon="inline-start" />
                All Scenes
              </Button>
            </div>
          </div>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">Group Arrangement</div>
              <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                Row mode stays side by side on huge screens and falls back to grid on smaller viewports.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(optionButtonClass, previewGroupLayout === 'row' && activeOptionClass)}
              onClick={() => setPreviewGroupLayout('row')}
            >
              <Columns4 data-icon="inline-start" />
              Row
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(optionButtonClass, previewGroupLayout === 'grid' && activeOptionClass)}
              onClick={() => setPreviewGroupLayout('grid')}
            >
              <Grid2X2 data-icon="inline-start" />
              Grid
            </Button>
          </div>
          <div className="mt-4 border-t border-zinc-800 pt-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-300">Video Size</div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(optionButtonClass, previewMediaLayout === 'inset' && activeOptionClass)}
                onClick={() => setPreviewMediaLayout('inset')}
              >
                <PanelsTopLeft data-icon="inline-start" />
                76.19%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className={cn(optionButtonClass, previewMediaLayout === 'full' && activeOptionClass)}
                onClick={() => setPreviewMediaLayout('full')}
              >
                <FileVideo data-icon="inline-start" />
                Full
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">Analytics Overlay</h5>
        <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(optionButtonClass, analyticsOverlayStyle === 'compact' && activeOptionClass)}
              onClick={() => setAnalyticsOverlayStyle('compact')}
            >
              <Grid2X2 data-icon="inline-start" />
              Compact
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(optionButtonClass, analyticsOverlayStyle === 'analysis' && activeOptionClass)}
              onClick={() => setAnalyticsOverlayStyle('analysis')}
            >
              <PanelsTopLeft data-icon="inline-start" />
              Analysis
            </Button>
          </div>
          <div className="mt-3 border-t border-zinc-800 pt-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">Note Icons</div>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                  Show linked graph badges beside preview notes.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(
                "h-8 w-full border-zinc-800 bg-zinc-950/80 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                showNoteOverlayIcons && activeOptionClass
              )}
              onClick={() => setShowNoteOverlayIcons(!showNoteOverlayIcons)}
            >
              {showNoteOverlayIcons ? <Eye data-icon="inline-start" /> : <EyeOff data-icon="inline-start" />}
              {showNoteOverlayIcons ? 'Shown' : 'Hidden'}
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h5 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">Manage Tracks & Groups</h5>
        <div className="space-y-2">
          {tracks.filter(t => !t.parentId).map(parent => (
            <div key={parent.id} className="space-y-1">
              <div className="flex items-center justify-between gap-2 bg-zinc-900/80 px-3 py-2 rounded border border-zinc-800">
                <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">{parent.name}</span>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className={cn(
                      "h-7 border-zinc-800 bg-zinc-950/80 px-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200",
                      parent.showDialogGridItem && activeOptionClass
                    )}
                    onClick={() => updateTrack(parent.id, { showDialogGridItem: !parent.showDialogGridItem })}
                  >
                    Dialog Grid: {parent.showDialogGridItem ? 'On' : 'Off'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-6 h-6 text-zinc-500 hover:text-red-400 hover:bg-red-400/10"
                    onClick={() => deleteTrack(parent.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
              {tracks.filter(t => t.parentId === parent.id).map(child => (
                <div key={child.id} className="flex items-center justify-between bg-[#18181b] px-3 py-1.5 rounded border border-zinc-800/50 ml-4">
                  <span className="text-xs text-zinc-400">{child.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-6 h-6 text-zinc-600 hover:text-red-400 hover:bg-red-400/10"
                    onClick={() => deleteTrack(child.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

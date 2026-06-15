'use client';

import React from 'react';
import { ArrowLeft, HelpCircle, MoreVertical, Pencil, Plus, Ratio, Search, Settings } from 'lucide-react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@storyboard/ui';
import { cn } from '@/lib/utils';
import type { ClipType, TimelineAspectRatio } from '@/lib/timeline-context';
import type { SidebarTab } from './EditorSidebarRail';

type SceneLaunchHeaderProps = {
  activeSceneLaunchBeatId: string | null;
  setSceneLaunchBeatPath: React.Dispatch<React.SetStateAction<string[]>>;
  onNavigateHome: () => void;
  moveSceneLaunchItemToParent: (dragKey: string) => void;
  headerName: string;
  isEditingHeaderName: boolean;
  setIsEditingHeaderName: React.Dispatch<React.SetStateAction<boolean>>;
  editingHeaderNameValue: string;
  setEditingHeaderNameValue: React.Dispatch<React.SetStateAction<string>>;
  saveHeaderName: () => void;
  sceneLaunchSearch: string;
  setSceneLaunchSearch: React.Dispatch<React.SetStateAction<string>>;
  handleAddClipClick: (type: ClipType) => void;
  aspectRatio: TimelineAspectRatio;
  setAspectRatio: (ratio: TimelineAspectRatio) => void;
  setActiveTab: React.Dispatch<React.SetStateAction<SidebarTab>>;
  openSceneLibrary: () => void;
};

export function SceneLaunchHeader({
  activeSceneLaunchBeatId,
  setSceneLaunchBeatPath,
  onNavigateHome,
  moveSceneLaunchItemToParent,
  headerName,
  isEditingHeaderName,
  setIsEditingHeaderName,
  editingHeaderNameValue,
  setEditingHeaderNameValue,
  saveHeaderName,
  sceneLaunchSearch,
  setSceneLaunchSearch,
  handleAddClipClick,
  aspectRatio,
  setAspectRatio,
  setActiveTab,
  openSceneLibrary,
}: SceneLaunchHeaderProps) {
  const isHeaderEditable = activeSceneLaunchBeatId !== 'trash';

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-4 px-5">
      <div className="flex min-w-0 items-center gap-4">
        <button
          type="button"
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-full text-zinc-300 transition-all duration-200',
            activeSceneLaunchBeatId
              ? 'hover:bg-white/5 hover:text-white'
              : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
          )}
          aria-label="Back home"
          onClick={() => {
            if (activeSceneLaunchBeatId) {
              setSceneLaunchBeatPath(previous => previous.slice(0, -1));
              return;
            }
            onNavigateHome();
          }}
          onDragOver={(event) => {
            if (!activeSceneLaunchBeatId) return;
            event.preventDefault();
            event.currentTarget.classList.add('bg-zinc-800', 'text-white', 'border', 'border-zinc-700');
          }}
          onDragLeave={(event) => {
            event.currentTarget.classList.remove('bg-zinc-800', 'text-white', 'border', 'border-zinc-700');
          }}
          onDrop={(event) => {
            if (!activeSceneLaunchBeatId) return;
            event.preventDefault();
            event.currentTarget.classList.remove('bg-zinc-800', 'text-white', 'border', 'border-zinc-700');
            const dragKey = event.dataTransfer.getData('text/plain');
            if (dragKey) {
              moveSceneLaunchItemToParent(dragKey);
            }
          }}
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0">
          {isEditingHeaderName && isHeaderEditable ? (
            <input
              type="text"
              value={editingHeaderNameValue}
              onChange={(event) => setEditingHeaderNameValue(event.target.value)}
              onBlur={saveHeaderName}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveHeaderName();
                if (event.key === 'Escape') setIsEditingHeaderName(false);
              }}
              autoFocus
              className="bg-transparent text-sm font-semibold text-zinc-100 border-b border-zinc-700 outline-none focus:border-indigo-500 py-0.5 px-0 w-auto min-w-[150px]"
            />
          ) : (
            <div
              className={cn(
                'flex items-center gap-1.5 truncate text-sm font-semibold text-zinc-100 select-none',
                isHeaderEditable && 'cursor-pointer hover:text-white group'
              )}
              onClick={() => {
                if (isHeaderEditable) {
                  setEditingHeaderNameValue(headerName);
                  setIsEditingHeaderName(true);
                }
              }}
            >
              <span className="truncate">{headerName}</span>
              {isHeaderEditable && (
                <Pencil className="h-3 w-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              )}
            </div>
          )}
          <div className="mt-0.5 text-[10px] font-medium text-zinc-600">
            {new Date().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </div>
        </div>
      </div>

      <div className="hidden h-11 w-full max-w-xl items-center gap-3 rounded-full bg-zinc-900 px-5 text-zinc-500 ring-1 ring-white/10 md:flex">
        <Search className="h-4.5 w-4.5 shrink-0" />
        <input
          value={sceneLaunchSearch}
          onChange={(event) => setSceneLaunchSearch(event.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
          placeholder="Search scenes"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-zinc-300 hover:bg-white/5 hover:text-white"
          onClick={() => handleAddClipClick('video')}
          title="Add video scene media"
          aria-label="Add video scene media"
        >
          <Plus className="h-5 w-5" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="h-9 w-9 flex items-center justify-center rounded-full text-zinc-300 hover:bg-white/5 hover:text-white transition-colors outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
            title={`Change aspect ratio (currently ${aspectRatio})`}
            aria-label="Change aspect ratio"
          >
            <Ratio className="h-5 w-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36 bg-[#111114] border-zinc-800 text-zinc-300 z-50">
            <div className="px-2 py-1 text-[9px] uppercase tracking-widest text-zinc-500 font-bold select-none cursor-default">Aspect Ratio</div>
            {(['16:9', '21:9', '1:1', '9:16'] as const).map((ratio) => (
              <DropdownMenuItem
                key={ratio}
                onClick={() => setAspectRatio(ratio)}
                className="justify-between font-mono text-xs focus:bg-zinc-800 focus:text-white cursor-pointer"
              >
                {ratio}
                {aspectRatio === ratio && <span className="text-indigo-300">•</span>}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-zinc-300 hover:bg-white/5 hover:text-white"
          onClick={() => setActiveTab('settings')}
          title="Project settings"
          aria-label="Project settings"
        >
          <Settings className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-zinc-300 hover:bg-white/5 hover:text-white"
          onClick={openSceneLibrary}
          title="Scene help and library"
          aria-label="Scene help and library"
        >
          <HelpCircle className="h-5 w-5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-9 w-9 rounded-full text-zinc-300 hover:bg-white/5 hover:text-white"
          title="More"
          aria-label="More"
        >
          <MoreVertical className="h-5 w-5" />
        </Button>
      </div>
    </header>
  );
}

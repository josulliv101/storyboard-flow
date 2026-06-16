'use client';

import React from 'react';
import { Clapperboard, FolderTree, Grid2X2, Settings, Sparkles, Trash2, Users } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { SidebarTab } from './EditorSidebarRail';

type SceneLaunchSidebarProps = {
  activeTab: SidebarTab;
  activeSceneLaunchBeatId: string | null;
  setActiveTab: React.Dispatch<React.SetStateAction<SidebarTab>>;
  setSceneLaunchBeatPath: React.Dispatch<React.SetStateAction<string[]>>;
  openSceneLibrary: () => void;
  moveItemToTrash: (dragKey: string) => void;
  isDraggingItem: boolean;
  onDropItem: (dragKey: string) => void;
};

export function SceneLaunchSidebar({
  activeTab,
  activeSceneLaunchBeatId,
  setActiveTab,
  setSceneLaunchBeatPath,
  openSceneLibrary,
  moveItemToTrash,
  isDraggingItem,
  onDropItem,
}: SceneLaunchSidebarProps) {
  const [isDragOverDirectory, setIsDragOverDirectory] = React.useState(false);

  return (
    <aside className="flex w-14 shrink-0 flex-col items-center border-r border-white/10 py-4">
      <button
        type="button"
        className="relative group flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-white"
        aria-label="Scenes"
        onClick={() => setActiveTab('scenes')}
      >
        <Grid2X2 className="h-4.5 w-4.5" />
        <span className="absolute left-full ml-3 px-2 py-1 bg-zinc-950/90 border border-zinc-800/80 text-zinc-300 text-[11px] rounded-md opacity-0 translate-x-0 pointer-events-none group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-200 whitespace-nowrap z-50 shadow-lg font-medium before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:right-full before:border-4 before:border-transparent before:border-r-zinc-950/90">
          Scenes
        </span>
      </button>
      <button
        type="button"
        className="relative group mt-5 flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        aria-label="Characters"
        onClick={() => setActiveTab('characters')}
      >
        <Users className="h-4.5 w-4.5" />
        <span className="absolute left-full ml-3 px-2 py-1 bg-zinc-950/90 border border-zinc-800/80 text-zinc-300 text-[11px] rounded-md opacity-0 translate-x-0 pointer-events-none group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-200 whitespace-nowrap z-50 shadow-lg font-medium before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:right-full before:border-4 before:border-transparent before:border-r-zinc-950/90">
          Characters
        </span>
      </button>
      <button
        type="button"
        className="relative group mt-2 flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        aria-label="Saved scenes"
        onClick={openSceneLibrary}
      >
        <Clapperboard className="h-4.5 w-4.5" />
        <span className="absolute left-full ml-3 px-2 py-1 bg-zinc-950/90 border border-zinc-800/80 text-zinc-300 text-[11px] rounded-md opacity-0 translate-x-0 pointer-events-none group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-200 whitespace-nowrap z-50 shadow-lg font-medium before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:right-full before:border-4 before:border-transparent before:border-r-zinc-950/90">
          Saved Scenes
        </span>
      </button>
      <button
        type="button"
        className={cn(
          'relative group mt-2 flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200',
          activeSceneLaunchBeatId === 'trash'
            ? 'bg-zinc-800 text-white shadow-md'
            : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
        )}
        aria-label="Trash"
        onClick={() => setSceneLaunchBeatPath(['trash'])}
        onDragOver={(event) => {
          event.preventDefault();
          event.currentTarget.classList.add('bg-red-950/40', 'text-red-400', 'border', 'border-red-900/50');
        }}
        onDragLeave={(event) => {
          event.currentTarget.classList.remove('bg-red-950/40', 'text-red-400', 'border', 'border-red-900/50');
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.currentTarget.classList.remove('bg-red-950/40', 'text-red-400', 'border', 'border-red-900/50');
          const dragKey = event.dataTransfer.getData('text/plain');
          if (dragKey) {
            moveItemToTrash(dragKey);
          }
        }}
      >
        <Trash2 className="h-4.5 w-4.5" />
        <span className="absolute left-full ml-3 px-2 py-1 bg-zinc-950/90 border border-zinc-800/80 text-zinc-300 text-[11px] rounded-md opacity-0 translate-x-0 pointer-events-none group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-200 whitespace-nowrap z-50 shadow-lg font-medium before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:right-full before:border-4 before:border-transparent before:border-r-zinc-950/90">
          Trash Folder
        </span>
      </button>
      <button
        type="button"
        onClick={() => setActiveTab(activeTab === 'directory' ? null : 'directory')}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        onDragEnter={(event) => {
          event.preventDefault();
          setIsDragOverDirectory(true);
        }}
        onDragLeave={() => {
          setIsDragOverDirectory(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragOverDirectory(false);
          const dragKey = event.dataTransfer.getData('text/plain');
          if (dragKey) {
            onDropItem(dragKey);
          }
        }}
        className={cn(
          "mt-2 flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 relative group",
          activeTab === 'directory'
            ? "bg-zinc-800 text-white shadow-md"
            : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200",
          isDraggingItem && "animate-pulse scale-110 ring-2 ring-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.7)] border-indigo-400/40 text-indigo-300 bg-indigo-500/20",
          isDragOverDirectory && "bg-emerald-500/10 text-emerald-400 ring-2 ring-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.6)] !animate-none"
        )}
        aria-label="Directory"
      >
        <FolderTree className={cn("h-4.5 w-4.5", isDragOverDirectory && "animate-bounce")} />
        <span
          className={cn(
            "absolute left-full ml-3 px-2.5 py-1 text-[11px] rounded-md transition-all duration-200 whitespace-nowrap z-50 shadow-lg font-medium",
            isDraggingItem
              ? "opacity-100 translate-x-1 bg-indigo-950/95 border border-indigo-500/60 text-indigo-300 shadow-[0_0_12px_rgba(99,102,241,0.5)] before:border-r-indigo-950/95"
              : "opacity-0 translate-x-0 pointer-events-none group-hover:opacity-100 group-hover:translate-x-1 bg-zinc-950/90 border border-zinc-800/80 text-zinc-300 before:border-r-zinc-950/90",
            "before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:right-full before:border-4 before:border-transparent"
          )}
        >
          {isDraggingItem ? "Drop here to move" : "Project Directory"}
        </span>
      </button>
      <div className="my-5 h-px w-8 bg-white/10" />
      <button
        type="button"
        className="relative group flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        aria-label="AI scene helper"
        onClick={() => setActiveTab('analyze')}
      >
        <Sparkles className="h-4.5 w-4.5" />
        <span className="absolute left-full ml-3 px-2 py-1 bg-zinc-950/90 border border-zinc-800/80 text-zinc-300 text-[11px] rounded-md opacity-0 translate-x-0 pointer-events-none group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-200 whitespace-nowrap z-50 shadow-lg font-medium before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:right-full before:border-4 before:border-transparent before:border-r-zinc-950/90">
          AI Video Analysis
        </span>
      </button>
      <div className="flex-1" />
      <button
        type="button"
        className="relative group flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        aria-label="Settings"
        onClick={() => setActiveTab('settings')}
      >
        <Settings className="h-4.5 w-4.5" />
        <span className="absolute left-full ml-3 px-2 py-1 bg-zinc-950/90 border border-zinc-800/80 text-zinc-300 text-[11px] rounded-md opacity-0 translate-x-0 pointer-events-none group-hover:opacity-100 group-hover:translate-x-1 transition-all duration-200 whitespace-nowrap z-50 shadow-lg font-medium before:content-[''] before:absolute before:top-1/2 before:-translate-y-1/2 before:right-full before:border-4 before:border-transparent before:border-r-zinc-950/90">
          Settings
        </span>
      </button>
    </aside>
  );
}

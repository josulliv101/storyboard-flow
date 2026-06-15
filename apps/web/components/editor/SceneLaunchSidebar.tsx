'use client';

import type React from 'react';
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
};

export function SceneLaunchSidebar({
  activeTab,
  activeSceneLaunchBeatId,
  setActiveTab,
  setSceneLaunchBeatPath,
  openSceneLibrary,
  moveItemToTrash,
}: SceneLaunchSidebarProps) {
  return (
    <aside className="flex w-14 shrink-0 flex-col items-center border-r border-white/10 py-4">
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-800 text-white"
        aria-label="Scenes"
        onClick={() => setActiveTab('scenes')}
      >
        <Grid2X2 className="h-4.5 w-4.5" />
      </button>
      <button
        type="button"
        className="mt-5 flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        aria-label="Characters"
        onClick={() => setActiveTab('characters')}
      >
        <Users className="h-4.5 w-4.5" />
      </button>
      <button
        type="button"
        className="mt-2 flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        aria-label="Saved scenes"
        onClick={openSceneLibrary}
      >
        <Clapperboard className="h-4.5 w-4.5" />
      </button>
      <button
        type="button"
        className={cn(
          'mt-2 flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200',
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
      </button>
      <button
        type="button"
        className="mt-2 flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        aria-label="Directory"
        onClick={() => setActiveTab(activeTab === 'directory' ? null : 'directory')}
      >
        <FolderTree className="h-4.5 w-4.5" />
      </button>
      <div className="my-5 h-px w-8 bg-white/10" />
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        aria-label="AI scene helper"
        onClick={() => setActiveTab('analyze')}
      >
        <Sparkles className="h-4.5 w-4.5" />
      </button>
      <div className="flex-1" />
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
        aria-label="Settings"
        onClick={() => setActiveTab('settings')}
      >
        <Settings className="h-4.5 w-4.5" />
      </button>
    </aside>
  );
}

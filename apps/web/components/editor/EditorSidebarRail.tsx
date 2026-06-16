'use client';

import React from 'react';
import { Button } from '@storyboard/ui';
import { Clapperboard, FolderTree, MapPin, Settings, Sparkles, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SidebarTab = 'scenes' | 'characters' | 'locations' | 'settings' | 'analyze' | 'directory' | null;

type EditorSidebarRailProps = {
  activeTab: SidebarTab;
  setActiveTab: React.Dispatch<React.SetStateAction<SidebarTab>>;
  isDraggingItem: boolean;
  onDropItem: (dragKey: string) => void;
};

const sidebarItems: Array<{
  id: Exclude<SidebarTab, null>;
  icon: React.ComponentType<{ className?: string }>;
  title?: string;
}> = [
  { id: 'scenes', icon: Clapperboard },
  { id: 'characters', icon: Users },
  { id: 'locations', icon: MapPin },
  { id: 'analyze', icon: Sparkles, title: 'AI Video Analysis' },
  { id: 'directory', icon: FolderTree, title: 'Project Directory' },
];

export function EditorSidebarRail({
  activeTab,
  setActiveTab,
  isDraggingItem,
  onDropItem,
}: EditorSidebarRailProps) {
  const [isDragOverDirectory, setIsDragOverDirectory] = React.useState(false);

  const renderButton = ({ id, icon: Icon, title }: (typeof sidebarItems)[number]) => {
    const isDirectory = id === 'directory';
    const isGlowActive = isDirectory && isDraggingItem;
    const isHoverActive = isDirectory && isDragOverDirectory;

    return (
      <Button
        key={id}
        variant="ghost"
        size="icon"
        onClick={() => setActiveTab(activeTab === id ? null : id)}
        onDragOver={isDirectory ? (e) => {
          e.preventDefault();
        } : undefined}
        onDragEnter={isDirectory ? (e) => {
          e.preventDefault();
          setIsDragOverDirectory(true);
        } : undefined}
        onDragLeave={isDirectory ? () => {
          setIsDragOverDirectory(false);
        } : undefined}
        onDrop={isDirectory ? (e) => {
          e.preventDefault();
          setIsDragOverDirectory(false);
          const dragKey = e.dataTransfer.getData('text/plain');
          if (dragKey) {
            onDropItem(dragKey);
          }
        } : undefined}
        className={cn(
          "h-8 w-8 transition-all relative",
          activeTab === id ? "text-indigo-400 bg-indigo-500/10" : "text-zinc-600 hover:text-zinc-300",
          isGlowActive && "animate-pulse ring-2 ring-indigo-500/50 shadow-[0_0_10px_rgba(99,102,241,0.5)] border-indigo-400/30 text-indigo-400",
          isHoverActive && "bg-emerald-500/10 text-emerald-400 ring-2 ring-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.6)] !animate-none"
        )}
        title={title}
      >
        <Icon className={cn("h-4.5 w-4.5", isHoverActive && "animate-bounce")} />
      </Button>
    );
  };

  return (
    <aside className="w-12 border-r border-zinc-800 bg-[#111114] flex flex-col items-center py-4 gap-4 shrink-0 z-10">
      {sidebarItems.map(renderButton)}
      <div className="flex-1" />
      {renderButton({ id: 'settings', icon: Settings })}
    </aside>
  );
}

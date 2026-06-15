'use client';

import React from 'react';
import { Button } from '@storyboard/ui';
import { Clapperboard, FolderTree, MapPin, Settings, Sparkles, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SidebarTab = 'scenes' | 'characters' | 'locations' | 'settings' | 'analyze' | 'directory' | null;

type EditorSidebarRailProps = {
  activeTab: SidebarTab;
  setActiveTab: React.Dispatch<React.SetStateAction<SidebarTab>>;
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

export function EditorSidebarRail({ activeTab, setActiveTab }: EditorSidebarRailProps) {
  const renderButton = ({ id, icon: Icon, title }: (typeof sidebarItems)[number]) => (
    <Button
      key={id}
      variant="ghost"
      size="icon"
      onClick={() => setActiveTab(activeTab === id ? null : id)}
      className={cn(
        "h-8 w-8 transition-all",
        activeTab === id ? "text-indigo-400 bg-indigo-500/10" : "text-zinc-600 hover:text-zinc-300"
      )}
      title={title}
    >
      <Icon className="h-4.5 w-4.5" />
    </Button>
  );

  return (
    <aside className="w-12 border-r border-zinc-800 bg-[#111114] flex flex-col items-center py-4 gap-4 shrink-0 z-10">
      {sidebarItems.map(renderButton)}
      <div className="flex-1" />
      {renderButton({ id: 'settings', icon: Settings })}
    </aside>
  );
}

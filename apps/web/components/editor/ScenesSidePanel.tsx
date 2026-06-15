'use client';

import { Eye, EyeOff, GripVertical, Plus, Trash2 } from 'lucide-react';
import { Reorder } from 'motion/react';
import { Button } from '@storyboard/ui';
import { cn } from '@/lib/utils';
import type { Scene } from '@/lib/timeline-context';

type ScenesSidePanelProps = {
  scenes: Scene[];
  panelActiveScene?: Scene;
  activeSceneId: string;
  previewSceneIds: string[];
  addScene: (name: string) => void;
  updateScene: (id: string, updates: Partial<Scene>) => void;
  reorderScenes: (scenes: Scene[]) => void;
  setActiveScene: (id: string) => void;
  deleteScene: (id: string) => void;
  togglePreviewScene: (id: string) => void;
};

export function ScenesSidePanel({
  scenes,
  panelActiveScene,
  activeSceneId,
  previewSceneIds,
  addScene,
  updateScene,
  reorderScenes,
  setActiveScene,
  deleteScene,
  togglePreviewScene,
}: ScenesSidePanelProps) {
  return (
    <div className="p-4 flex flex-col gap-4">
      <Button
        onClick={() => addScene(`Scene ${scenes.length + 1}`)}
        className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold uppercase tracking-widest h-9"
      >
        <Plus className="w-3.5 h-3.5 mr-2" />
        Add New Scene
      </Button>

      {panelActiveScene && (
        <div className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3">
          <label htmlFor="active-scene-title" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Preview Title
          </label>
          <input
            id="active-scene-title"
            type="text"
            maxLength={120}
            value={panelActiveScene.name}
            onChange={(event) => updateScene(panelActiveScene.id, { name: event.target.value })}
            className="mt-2 h-8 w-full rounded border border-zinc-800 bg-zinc-950 px-2 text-sm text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-400"
            placeholder="Scene title"
          />
          <label htmlFor="active-scene-description" className="mt-3 block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Short Description
          </label>
          <textarea
            id="active-scene-description"
            rows={3}
            maxLength={180}
            value={panelActiveScene.description || ''}
            onChange={(event) => updateScene(panelActiveScene.id, { description: event.target.value })}
            className="mt-2 w-full resize-none rounded border border-zinc-800 bg-zinc-950 px-2 py-2 text-sm leading-snug text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-400"
            placeholder="Optional top-left preview copy"
          />
        </div>
      )}

      <Reorder.Group axis="y" values={scenes} onReorder={reorderScenes} className="space-y-2">
        {scenes.map((scene) => {
          const includedPreviewSceneIds = previewSceneIds.length > 0 ? previewSceneIds : scenes.map(item => item.id);
          const isPreviewIncluded = includedPreviewSceneIds.includes(scene.id);
          const canTogglePreviewScene = isPreviewIncluded ? includedPreviewSceneIds.length > 1 : true;

          return (
            <Reorder.Item
              key={scene.id}
              value={scene}
              className={cn(
                "group p-3 rounded-md border flex items-center gap-3 cursor-pointer transition-all",
                activeSceneId === scene.id
                  ? "bg-indigo-500/10 border-indigo-500/50"
                  : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700"
              )}
              onClick={() => setActiveScene(scene.id)}
            >
              <GripVertical className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-400 cursor-grab active:cursor-grabbing" />
              <button
                type="button"
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded border transition-colors",
                  isPreviewIncluded
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
                    : "border-zinc-800 bg-zinc-950 text-zinc-600 hover:text-zinc-300",
                  !canTogglePreviewScene && "cursor-not-allowed opacity-50"
                )}
                aria-label={isPreviewIncluded ? `Hide ${scene.name} from preview` : `Show ${scene.name} in preview`}
                disabled={!canTogglePreviewScene}
                onClick={(e) => {
                  e.stopPropagation();
                  togglePreviewScene(scene.id);
                }}
              >
                {isPreviewIncluded ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-bold text-zinc-200 truncate">{scene.name}</div>
                <div className="text-[9px] text-zinc-500 uppercase tracking-wider font-mono">
                  {scene.clips.length} Clips - {isPreviewIncluded ? 'Preview On' : 'Preview Off'}
                </div>
              </div>
              {scenes.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteScene(scene.id);
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
    </div>
  );
}

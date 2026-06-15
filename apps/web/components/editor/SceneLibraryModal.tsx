'use client';

import { Cloud, Download, Loader2, RefreshCw, Trash2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@storyboard/ui';
import { cn } from '@/lib/utils';
import { SavedSceneThumbnail } from './SavedSceneThumbnail';
import type { SavedSceneSummary } from './saved-scene-utils';

type SceneLibraryUser = {
  id: string;
  username: string;
  role: 'viewer' | 'editor' | 'admin';
};

type SceneLibraryModalProps = {
  savedScenes: SavedSceneSummary[];
  savedScenesLoadError: string | null;
  isLoadingSavedScenes: boolean;
  loadingSavedSceneId: string | null;
  deletingSavedSceneId: string | null;
  currentUser: SceneLibraryUser | null;
  onClose: () => void;
  onRefresh: () => void;
  onLoadSavedScene: (scene: SavedSceneSummary) => void;
  onConfirmDelete: (scene: SavedSceneSummary) => void;
};

export function SceneLibraryModal({
  savedScenes,
  savedScenesLoadError,
  isLoadingSavedScenes,
  loadingSavedSceneId,
  deletingSavedSceneId,
  currentUser,
  onClose,
  onRefresh,
  onLoadSavedScene,
  onConfirmDelete,
}: SceneLibraryModalProps) {
  return (
    <motion.div
      key="scene-library"
      className="fixed inset-0 z-[330] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={onClose}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-scenes-title"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        className="flex max-h-[min(760px,calc(100vh-2rem))] w-full max-w-4xl flex-col rounded-lg border border-zinc-800 bg-[#111114] shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4">
          <div>
            <h2 id="cloud-scenes-title" className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-200">
              <Cloud className="h-4 w-4 text-indigo-300" />
              Scene Library
            </h2>
            <p className="mt-1 text-[10px] text-zinc-500">Load a saved scene snapshot into the current project.</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-zinc-500 hover:text-white"
            onClick={onClose}
            aria-label="Close saved scenes"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Available Scenes</h3>
              <p className="mt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-700">
                {savedScenesLoadError ? 'Unable to load' : `${savedScenes.length} ${savedScenes.length === 1 ? 'scene' : 'scenes'}`}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-200"
              onClick={onRefresh}
              disabled={isLoadingSavedScenes}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isLoadingSavedScenes && 'animate-spin')} />
              Refresh
            </Button>
          </div>
          <div className="min-h-0 overflow-y-auto pr-1">
            {isLoadingSavedScenes && savedScenes.length === 0 ? (
              <div className="flex items-center justify-center gap-2 rounded-md border border-zinc-800 py-8 text-xs text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading saved scenes...
              </div>
            ) : savedScenesLoadError ? (
              <div className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-6 text-center">
                <div className="text-xs font-semibold text-red-200">{savedScenesLoadError}</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4 border-red-500/30 bg-red-500/10 text-xs text-red-100 hover:bg-red-500/20"
                  onClick={onRefresh}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try Again
                </Button>
              </div>
            ) : savedScenes.length === 0 ? (
              <div className="rounded-md border border-dashed border-zinc-800 py-8 text-center text-xs text-zinc-500">
                No cloud scenes saved yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {savedScenes.map(scene => (
                  <article
                    key={scene.id}
                    className="group overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950/80 shadow-xl shadow-black/25 transition-colors hover:border-indigo-500/40"
                  >
                    <SavedSceneThumbnail scene={scene} />
                    <div className="space-y-3 p-3">
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="truncate text-sm font-semibold text-zinc-100">{scene.name}</h4>
                          {scene.isPublished && (
                            <span className="px-1.5 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                              Public
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-[10px] font-mono uppercase tracking-widest text-zinc-600">
                          {new Date(scene.updatedAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex gap-2 select-none">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="flex-1 border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-100"
                          onClick={() => onLoadSavedScene(scene)}
                          disabled={loadingSavedSceneId !== null || deletingSavedSceneId !== null}
                        >
                          {loadingSavedSceneId === scene.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          Load Scene
                        </Button>
                        {currentUser && currentUser.role !== 'viewer' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-400/10 shrink-0 border border-zinc-900"
                            onClick={() => onConfirmDelete(scene)}
                            disabled={loadingSavedSceneId !== null || deletingSavedSceneId !== null}
                            title="Delete Saved Scene"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.section>
    </motion.div>
  );
}

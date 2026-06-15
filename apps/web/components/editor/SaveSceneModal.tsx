'use client';

import React from 'react';
import { Camera, Clapperboard, Cloud, Loader2, X } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@storyboard/ui';

type SaveSceneModalProps = {
  activeSceneThumbnailPreviewUrl?: string;
  savedSceneName: string;
  setSavedSceneName: (name: string) => void;
  isSavingScene: boolean;
  sceneSaveStatus: string | null;
  isPlaying: boolean;
  isCapturingSceneThumbnail: boolean;
  hasActiveVideoClipAtCurrentFrame: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  onCaptureCurrentFrameThumbnail: () => void;
};

export function SaveSceneModal({
  activeSceneThumbnailPreviewUrl,
  savedSceneName,
  setSavedSceneName,
  isSavingScene,
  sceneSaveStatus,
  isPlaying,
  isCapturingSceneThumbnail,
  hasActiveVideoClipAtCurrentFrame,
  onClose,
  onSubmit,
  onCaptureCurrentFrameThumbnail,
}: SaveSceneModalProps) {
  return (
    <motion.div
      key="save-scene"
      className="fixed inset-0 z-[330] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onPointerDown={onClose}
    >
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-scene-title"
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        className="flex w-full max-w-lg flex-col rounded-lg border border-zinc-800 bg-[#111114] shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-800 p-4">
          <div>
            <h2 id="save-scene-title" className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-200">
              <Cloud className="h-4 w-4 text-indigo-300" />
              Save Scene
            </h2>
            <p className="mt-1 text-[10px] text-zinc-500">Save the active scene snapshot to the cloud library.</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-zinc-500 hover:text-white"
            onClick={onClose}
            aria-label="Close save scene"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form className="space-y-3 p-4" onSubmit={onSubmit}>
          <div className="grid gap-3 rounded-md border border-zinc-800 bg-zinc-950/60 p-3 sm:grid-cols-[8rem_1fr]">
            <div className="relative aspect-video overflow-hidden rounded border border-zinc-800 bg-black">
              {activeSceneThumbnailPreviewUrl ? (
                <img src={activeSceneThumbnailPreviewUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.18),rgba(9,9,11,0.95)_55%)]">
                  <Clapperboard className="h-7 w-7 text-zinc-700" />
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-col justify-center gap-2">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Scene Thumbnail</div>
                <p className="mt-1 text-[10px] leading-relaxed text-zinc-600">
                  Pause on a video frame, then capture it as the static library thumbnail.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit border-zinc-700 bg-zinc-900 text-[10px] font-bold uppercase tracking-widest text-zinc-300 hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-100"
                onClick={onCaptureCurrentFrameThumbnail}
                disabled={isPlaying || isCapturingSceneThumbnail || !hasActiveVideoClipAtCurrentFrame}
                title={
                  isPlaying
                    ? 'Pause playback before capturing a thumbnail.'
                    : !hasActiveVideoClipAtCurrentFrame
                      ? 'Move the playhead over a video clip to capture a thumbnail.'
                      : 'Use the current paused frame as the thumbnail.'
                }
              >
                {isCapturingSceneThumbnail ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                Capture Current Frame
              </Button>
            </div>
          </div>
          <label htmlFor="saved-scene-name" className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            Active Scene Name
          </label>
          <div className="flex gap-2">
            <input
              id="saved-scene-name"
              name="sceneName"
              type="text"
              required
              maxLength={120}
              value={savedSceneName}
              onChange={(event) => setSavedSceneName(event.target.value)}
              className="h-9 min-w-0 flex-1 rounded-md border border-zinc-800 bg-zinc-950 px-3 text-base text-zinc-200 outline-none transition-colors placeholder:text-zinc-600 focus:border-indigo-400 sm:text-sm"
              placeholder="Scene name"
            />
            <Button
              type="submit"
              className="h-9 bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-500"
              disabled={isSavingScene}
            >
              {isSavingScene ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
              Save
            </Button>
          </div>
          <p className="text-[10px] leading-relaxed text-zinc-500">
            Scene structure, analysis, and local videos are uploaded for access on other computers.
          </p>
          {sceneSaveStatus && (
            <p className="text-[10px] font-mono text-indigo-300" aria-live="polite">{sceneSaveStatus}</p>
          )}
        </form>
      </motion.section>
    </motion.div>
  );
}

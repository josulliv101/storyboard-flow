'use client';

import { Clapperboard } from 'lucide-react';

import type { SavedSceneSummary } from './saved-scene-utils';

export function SavedSceneThumbnail({ scene }: { scene: SavedSceneSummary }) {
  return (
    <div className="relative aspect-video overflow-hidden rounded border border-zinc-800 bg-black shadow-inner">
      {scene.thumbnailUrl ? (
        <img
          src={scene.thumbnailUrl}
          className="h-full w-full object-cover"
          alt={`${scene.name} thumbnail`}
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.18),rgba(9,9,11,0.95)_55%)]">
          <Clapperboard className="h-8 w-8 text-zinc-700" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between px-2 py-1 opacity-60">
        {Array.from({ length: 7 }).map((_, index) => (
          <span key={index} className="h-1.5 w-2 rounded-[1px] bg-black/70 ring-1 ring-white/10" />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent px-3 pb-2 pt-8">
        <div className="truncate text-[10px] font-black uppercase tracking-widest text-white">{scene.name}</div>
      </div>
    </div>
  );
}

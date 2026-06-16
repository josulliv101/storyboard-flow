'use client';

import React from 'react';
import { ChevronRight, FileImage as FileImageIcon, FileVideo2, Folder, FolderOpen, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type SceneLaunchMediaItem = {
  id: string;
  name: string;
  type: 'image' | 'video';
  previewUrl: string;
  durationSeconds?: number;
  trimStartSeconds?: number;
  mediaDurationSeconds?: number;
  fileSize?: number;
  clipId?: string;
};

type SceneLaunchGridItem = {
  id: string;
  type: 'media' | 'collection';
};

type SceneLaunchBeat = {
  id: string;
  name: string;
  items: SceneLaunchMediaItem[];
  childIds: string[];
  gridOrder: SceneLaunchGridItem[];
};

type DirectorySidePanelProps = {
  directoryExpandedIds: Set<string>;
  setDirectoryExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  sceneLaunchBeats: SceneLaunchBeat[];
  sceneLaunchGridOrder: SceneLaunchGridItem[];
  sceneLaunchMediaItems: SceneLaunchMediaItem[];
  setSceneLaunchBeatPath: React.Dispatch<React.SetStateAction<string[]>>;
  openBeatDetail: (beatId: string) => void;
  pendingMoveItem: { type: 'media' | 'collection'; id: string } | null;
  setPendingMoveItem: React.Dispatch<React.SetStateAction<{ type: 'media' | 'collection'; id: string } | null>>;
  onSelectMoveTarget: (targetBeatId: string) => void;
  onCancelMove?: () => void;
};

export function DirectorySidePanel({
  directoryExpandedIds,
  setDirectoryExpandedIds,
  sceneLaunchBeats,
  sceneLaunchGridOrder,
  sceneLaunchMediaItems,
  setSceneLaunchBeatPath,
  openBeatDetail,
  pendingMoveItem,
  setPendingMoveItem,
  onSelectMoveTarget,
  onCancelMove,
}: DirectorySidePanelProps) {
  const toggleExpanded = (id: string) => {
    setDirectoryExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderMediaItem = (media: SceneLaunchMediaItem, paddingLeft: string) => (
    <div
      key={media.id}
      className="flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-zinc-800/40 cursor-default"
      style={{ paddingLeft }}
    >
      <span className="w-3 shrink-0" />
      {media.type === 'video' ? (
        <FileVideo2 className="h-3.5 w-3.5 shrink-0 text-sky-500/70" />
      ) : (
        <FileImageIcon className="h-3.5 w-3.5 shrink-0 text-emerald-500/70" />
      )}
      <span className="truncate text-[11px] text-zinc-500">
        {media.name}
      </span>
    </div>
  );

  const renderTreeCollection = (beat: SceneLaunchBeat, depth: number): React.ReactNode => {
    const isExpanded = directoryExpandedIds.has(beat.id);
    const childItems = beat.gridOrder;
    const hasChildren = childItems.length > 0;

    return (
      <div key={beat.id}>
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/60 group/treeitem"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => {
            if (pendingMoveItem) {
              onSelectMoveTarget(beat.id);
            } else {
              if (hasChildren) toggleExpanded(beat.id);
              openBeatDetail(beat.id);
            }
          }}
        >
          {hasChildren ? (
            <ChevronRight
              className={cn(
                "h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-150",
                isExpanded && "rotate-90"
              )}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(beat.id);
              }}
            />
          ) : (
            <span className="w-3 shrink-0" />
          )}
          {beat.id === 'trash' ? (
            <Trash2 className="h-3.5 w-3.5 shrink-0 text-red-500/70" />
          ) : isExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500/80" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500/60" />
          )}
          <span className="truncate text-[12px] font-medium text-zinc-300 group-hover/treeitem:text-zinc-100">
            {beat.name}
          </span>
          <span className="ml-auto text-[10px] font-mono text-zinc-600 tabular-nums shrink-0">
            {childItems.length}
          </span>
        </button>
        {isExpanded && (
          <div>
            {childItems.map(gi => {
              if (gi.type === 'collection') {
                const childBeat = sceneLaunchBeats.find(b => b.id === gi.id);
                if (childBeat) return renderTreeCollection(childBeat, depth + 1);
                return null;
              }
              if (pendingMoveItem) return null; // Filter/hide media in Move mode!
              const media = beat.items.find(m => m.id === gi.id);
              if (!media) return null;
              return renderMediaItem(media, `${(depth + 1) * 14 + 8}px`);
            })}
          </div>
        )}
      </div>
    );
  };

  const pendingMoveItemName = React.useMemo(() => {
    if (!pendingMoveItem) return '';
    const { type, id } = pendingMoveItem;
    if (type === 'collection') {
      return sceneLaunchBeats.find(b => b.id === id)?.name || '';
    } else {
      const rootItem = sceneLaunchMediaItems.find(item => item.id === id);
      if (rootItem) return rootItem.name;
      return sceneLaunchBeats.flatMap(beat => beat.items).find(item => item.id === id)?.name || '';
    }
  }, [pendingMoveItem, sceneLaunchBeats, sceneLaunchMediaItems]);

  const rootIsExpanded = directoryExpandedIds.has('__root__');

  return (
    <div className="p-3">
      {pendingMoveItem && (
        <div className="mb-3 rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-2.5 flex flex-col gap-1.5 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Move Selection Mode</span>
            <button
              type="button"
              onClick={onCancelMove || (() => setPendingMoveItem(null))}
              className="text-[10px] font-bold text-zinc-500 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-zinc-300 leading-normal">
            Moving <span className="font-semibold text-white">{pendingMoveItemName || 'item'}</span>
          </p>
          <p className="text-[9px] text-zinc-500 italic leading-tight">
            Click on a folder or "Scene Board" to move it, or press ESC to cancel.
          </p>
        </div>
      )}
      <div className="select-none">
        <button
          type="button"
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-zinc-800/60 mb-0.5"
          onClick={() => {
            if (pendingMoveItem) {
              onSelectMoveTarget('__root__');
            } else {
              toggleExpanded('__root__');
              setSceneLaunchBeatPath([]);
            }
          }}
        >
          <ChevronRight
            className={cn(
              "h-3 w-3 shrink-0 text-zinc-600 transition-transform duration-150",
              rootIsExpanded && "rotate-90"
            )}
          />
          {rootIsExpanded ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
          ) : (
            <Folder className="h-3.5 w-3.5 shrink-0 text-indigo-400/70" />
          )}
          <span className="text-[12px] font-bold text-zinc-200">Scene Board</span>
          <span className="ml-auto text-[10px] font-mono text-zinc-600 tabular-nums shrink-0">
            {sceneLaunchGridOrder.length}
          </span>
        </button>

        {rootIsExpanded && (
          <div>
            {sceneLaunchGridOrder.filter(g => g.id !== 'trash').map(gi => {
              if (gi.type === 'collection') {
                const beat = sceneLaunchBeats.find(b => b.id === gi.id);
                if (beat) return renderTreeCollection(beat, 1);
                return null;
              }
              if (pendingMoveItem) return null; // Filter/hide media in Move mode!
              const media = sceneLaunchMediaItems.find(m => m.id === gi.id);
              if (!media) return null;
              return renderMediaItem(media, '22px');
            })}

            {(() => {
              const trashBeat = sceneLaunchBeats.find(b => b.id === 'trash');
              if (!trashBeat || (trashBeat.items.length === 0 && trashBeat.gridOrder.length === 0)) return null;
              return renderTreeCollection(trashBeat, 1);
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

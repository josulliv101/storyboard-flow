'use client';

import React from 'react';
import { Button } from '@storyboard/ui';
import { Grid2X2, Plus, Trash2 } from 'lucide-react';
import { SceneLaunchMediaTile } from './SceneLaunchMediaTile';
import { SceneLaunchCollectionTile } from './SceneLaunchCollectionTile';
import type { SceneLaunchBeat, SceneLaunchMediaItem } from './useSceneLaunchBoard';

interface SceneLaunchGridProps {
  activeSceneLaunchBeatId: string | null;
  activeSceneLaunchBeat: SceneLaunchBeat | null;
  sceneLaunchGridItems: Array<
    | { id: string; type: 'media'; item: SceneLaunchMediaItem }
    | { id: string; type: 'collection'; collection: SceneLaunchBeat }
  >;
  isTimelinePlaying: boolean;
  activeItemKey: string | null;
  trimmingItemId: string | null;
  setTrimmingItemId: (id: string | null) => void;
  collectionScrubbingId: string | null;
  setCollectionScrubbingId: (id: string | null) => void;
  sceneLaunchPreviewHover: { collectionId: string; startedAt: number } | null;
  setSceneLaunchPreviewHover: (hover: { collectionId: string; startedAt: number } | null) => void;
  sceneLaunchManuallyPaused: string | null;
  setSceneLaunchManuallyPaused: (paused: string | null) => void;
  sceneLaunchPreviewPausedOffset: number;
  setSceneLaunchPreviewPausedOffset: React.Dispatch<React.SetStateAction<number>>;
  openBeatDetail: (id: string) => void;
  changeCollectionPreviewItem: (beat: SceneLaunchBeat, direction: 'next' | 'prev') => void;
  getGridItemTimelineState: (itemId: string, itemType: 'media' | 'collection') => { status: 'past' | 'active' | 'future' | 'idle'; elapsed: number; duration: number };
  getSceneLaunchCollectionPreview: (collection: SceneLaunchBeat) => {
    item: SceneLaunchMediaItem;
    elapsedSeconds: number;
    durationSeconds: number;
    isPlaying: boolean;
    totalElapsedSeconds: number;
    totalDurationSeconds: number;
    itemStartOffset: number;
  } | null;
  getRecursiveCollectionDuration: (collection: SceneLaunchBeat) => number;
  getRecursiveMediaItems: (collection: SceneLaunchBeat) => SceneLaunchMediaItem[];
  getSceneLaunchCollectionTileStyle: () => React.CSSProperties;
  getSceneLaunchMediaPreviewStyle: () => React.CSSProperties;
  getSceneLaunchMediaTileStyle: (item: SceneLaunchMediaItem) => React.CSSProperties;
  gridDragOverInfo: { targetKey: string; position: 'before' | 'after' | 'inside' } | null;
  handleGridDragOver: (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => void;
  handleGridDragLeave: () => void;
  handleGridDrop: (e: React.DragEvent<HTMLElement>, targetKey: string, isCollection: boolean) => void;
  syncTimelinePlayheadToCollectionPreview: (beatId: string, elapsedSeconds: number) => void;
  updateSceneLaunchMediaOriginalDuration: (mediaId: string, duration: number) => void;
  updateSceneLaunchMediaDuration: (mediaId: string, duration: number) => void;
  updateSceneLaunchMediaTrim: (mediaId: string, trimStart: number, duration: number) => void;
  handleItemContextMenu: (event: React.MouseEvent, dragKey: string) => void;
  emptyTrash: () => void;
  createSceneLaunchBeat: () => void;
  handleAddClipClick: (type: 'video' | 'image' | 'dialog' | 'note') => void;
  handleBeatDrop: (event: React.DragEvent<HTMLDivElement>, beatId: string) => void;
}

export function SceneLaunchGrid({
  activeSceneLaunchBeatId,
  activeSceneLaunchBeat,
  sceneLaunchGridItems,
  isTimelinePlaying,
  activeItemKey,
  trimmingItemId,
  setTrimmingItemId,
  collectionScrubbingId,
  setCollectionScrubbingId,
  sceneLaunchPreviewHover,
  setSceneLaunchPreviewHover,
  sceneLaunchManuallyPaused,
  setSceneLaunchManuallyPaused,
  sceneLaunchPreviewPausedOffset,
  setSceneLaunchPreviewPausedOffset,
  openBeatDetail,
  changeCollectionPreviewItem,
  getGridItemTimelineState,
  getSceneLaunchCollectionPreview,
  getRecursiveCollectionDuration,
  getRecursiveMediaItems,
  getSceneLaunchCollectionTileStyle,
  getSceneLaunchMediaPreviewStyle,
  getSceneLaunchMediaTileStyle,
  gridDragOverInfo,
  handleGridDragOver,
  handleGridDragLeave,
  handleGridDrop,
  syncTimelinePlayheadToCollectionPreview,
  updateSceneLaunchMediaOriginalDuration,
  updateSceneLaunchMediaDuration,
  updateSceneLaunchMediaTrim,
  handleItemContextMenu,
  emptyTrash,
  createSceneLaunchBeat,
  handleAddClipClick,
  handleBeatDrop,
}: SceneLaunchGridProps) {

  return (
    <section className="mx-auto mt-6 w-full max-w-6xl shrink-0">
      {activeSceneLaunchBeat ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-zinc-200">
                {activeSceneLaunchBeatId === 'trash' ? 'Trash Folder' : activeSceneLaunchBeat.name}
              </h2>
              <p className="mt-1 text-[11px] text-zinc-700">
                {activeSceneLaunchBeatId === 'trash'
                  ? 'Items moved here can be restored or permanently deleted'
                  : `${activeSceneLaunchBeat.gridOrder.length} ${activeSceneLaunchBeat.gridOrder.length === 1 ? 'item' : 'items'} in this collection`
                }
              </p>
            </div>
            <div className="flex items-center gap-2">
              {activeSceneLaunchBeatId === 'trash' ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-red-950 bg-red-950/10 text-xs text-red-450 hover:bg-red-950 hover:text-white transition-colors"
                  onClick={emptyTrash}
                  disabled={activeSceneLaunchBeat.gridOrder.length === 0}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Empty Trash
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white"
                  onClick={createSceneLaunchBeat}
                >
                  <Grid2X2 className="h-3.5 w-3.5" />
                  Add Collection
                </Button>
              )}
            </div>
          </div>

          <div
            className="rounded-lg border border-zinc-900 bg-zinc-950/30 p-3"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleBeatDrop(event, activeSceneLaunchBeat.id)}
          >
            {sceneLaunchGridItems.length > 0 ? (
              <div className="flex flex-wrap items-start gap-3">
                {sceneLaunchGridItems.map((gridItem) => {
                  const dragKey = `${gridItem.type}:${gridItem.id}`;

                  if (gridItem.type === 'media') {
                    return (
                      <SceneLaunchMediaTile
                        key={dragKey}
                        item={gridItem.item}
                        dragKey={dragKey}
                        isTimelinePlaying={isTimelinePlaying}
                        activeItemKey={activeItemKey}
                        trimmingItemId={trimmingItemId}
                        setTrimmingItemId={setTrimmingItemId}
                        getGridItemTimelineState={getGridItemTimelineState}
                        updateSceneLaunchMediaOriginalDuration={updateSceneLaunchMediaOriginalDuration}
                        updateSceneLaunchMediaDuration={updateSceneLaunchMediaDuration}
                        updateSceneLaunchMediaTrim={updateSceneLaunchMediaTrim}
                        handleItemContextMenu={handleItemContextMenu}
                        getSceneLaunchMediaTileStyle={getSceneLaunchMediaTileStyle}
                        getSceneLaunchMediaPreviewStyle={getSceneLaunchMediaPreviewStyle}
                        gridDragOverInfo={gridDragOverInfo}
                        handleGridDragOver={handleGridDragOver}
                        handleGridDragLeave={handleGridDragLeave}
                        handleGridDrop={handleGridDrop}
                      />
                    );
                  }

                  return (
                    <SceneLaunchCollectionTile
                      key={dragKey}
                      beat={gridItem.collection}
                      dragKey={dragKey}
                      isTimelinePlaying={isTimelinePlaying}
                      activeItemKey={activeItemKey}
                      collectionScrubbingId={collectionScrubbingId}
                      setCollectionScrubbingId={setCollectionScrubbingId}
                      sceneLaunchPreviewHover={sceneLaunchPreviewHover}
                      setSceneLaunchPreviewHover={setSceneLaunchPreviewHover}
                      sceneLaunchManuallyPaused={sceneLaunchManuallyPaused}
                      setSceneLaunchManuallyPaused={setSceneLaunchManuallyPaused}
                      sceneLaunchPreviewPausedOffset={sceneLaunchPreviewPausedOffset}
                      setSceneLaunchPreviewPausedOffset={setSceneLaunchPreviewPausedOffset}
                      openBeatDetail={openBeatDetail}
                      changeCollectionPreviewItem={changeCollectionPreviewItem}
                      getGridItemTimelineState={getGridItemTimelineState}
                      getSceneLaunchCollectionPreview={getSceneLaunchCollectionPreview}
                      getRecursiveCollectionDuration={getRecursiveCollectionDuration}
                      getRecursiveMediaItems={getRecursiveMediaItems}
                      getSceneLaunchCollectionTileStyle={getSceneLaunchCollectionTileStyle}
                      getSceneLaunchMediaPreviewStyle={getSceneLaunchMediaPreviewStyle}
                      gridDragOverInfo={gridDragOverInfo}
                      handleGridDragOver={handleGridDragOver}
                      handleGridDragLeave={handleGridDragLeave}
                      handleGridDrop={handleGridDrop}
                      syncTimelinePlayheadToCollectionPreview={syncTimelinePlayheadToCollectionPreview}
                      handleItemContextMenu={handleItemContextMenu}
                    />
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-64 w-full flex-col items-center justify-center rounded-md border border-dashed border-zinc-900 text-center text-zinc-650 transition-colors">
                {activeSceneLaunchBeatId === 'trash' ? (
                  <>
                    <Trash2 className="h-7 w-7 text-zinc-700" />
                    <span className="mt-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">Trash is empty</span>
                    <span className="mt-2 max-w-xs text-[11px] leading-5 text-zinc-700">Drag items to the Trash icon in the sidebar or right-click to delete them.</span>
                  </>
                ) : (
                  <>
                    <Grid2X2 className="h-7 w-7 text-zinc-700" />
                    <span className="mt-3 text-xs font-semibold uppercase tracking-widest text-zinc-500">Collection is empty</span>
                    <span className="mt-2 max-w-xs text-[11px] leading-5 text-zinc-700">Drag and drop media here or add a child collection to begin.</span>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Scene board</h2>
              <p className="mt-1 text-[11px] text-zinc-700">Media items and collections share one rearrangeable grid.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white"
                onClick={() => handleAddClipClick('image')}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Media
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 border-zinc-800 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-900 hover:text-white"
                onClick={createSceneLaunchBeat}
              >
                <Grid2X2 className="h-3.5 w-3.5" />
                Add Collection
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-start gap-3">
            {sceneLaunchGridItems.map((gridItem) => {
              const dragKey = `${gridItem.type}:${gridItem.id}`;

              if (gridItem.type === 'media') {
                return (
                  <SceneLaunchMediaTile
                    key={dragKey}
                    item={gridItem.item}
                    dragKey={dragKey}
                    isTimelinePlaying={isTimelinePlaying}
                    activeItemKey={activeItemKey}
                    trimmingItemId={trimmingItemId}
                    setTrimmingItemId={setTrimmingItemId}
                    getGridItemTimelineState={getGridItemTimelineState}
                    updateSceneLaunchMediaOriginalDuration={updateSceneLaunchMediaOriginalDuration}
                    updateSceneLaunchMediaDuration={updateSceneLaunchMediaDuration}
                    updateSceneLaunchMediaTrim={updateSceneLaunchMediaTrim}
                    handleItemContextMenu={handleItemContextMenu}
                    getSceneLaunchMediaTileStyle={getSceneLaunchMediaTileStyle}
                    getSceneLaunchMediaPreviewStyle={getSceneLaunchMediaPreviewStyle}
                    gridDragOverInfo={gridDragOverInfo}
                    handleGridDragOver={handleGridDragOver}
                    handleGridDragLeave={handleGridDragLeave}
                    handleGridDrop={handleGridDrop}
                  />
                );
              }

              return (
                <SceneLaunchCollectionTile
                  key={dragKey}
                  beat={gridItem.collection}
                  dragKey={dragKey}
                  isTimelinePlaying={isTimelinePlaying}
                  activeItemKey={activeItemKey}
                  collectionScrubbingId={collectionScrubbingId}
                  setCollectionScrubbingId={setCollectionScrubbingId}
                  sceneLaunchPreviewHover={sceneLaunchPreviewHover}
                  setSceneLaunchPreviewHover={setSceneLaunchPreviewHover}
                  sceneLaunchManuallyPaused={sceneLaunchManuallyPaused}
                  setSceneLaunchManuallyPaused={setSceneLaunchManuallyPaused}
                  sceneLaunchPreviewPausedOffset={sceneLaunchPreviewPausedOffset}
                  setSceneLaunchPreviewPausedOffset={setSceneLaunchPreviewPausedOffset}
                  openBeatDetail={openBeatDetail}
                  changeCollectionPreviewItem={changeCollectionPreviewItem}
                  getGridItemTimelineState={getGridItemTimelineState}
                  getSceneLaunchCollectionPreview={getSceneLaunchCollectionPreview}
                  getRecursiveCollectionDuration={getRecursiveCollectionDuration}
                  getRecursiveMediaItems={getRecursiveMediaItems}
                  getSceneLaunchCollectionTileStyle={getSceneLaunchCollectionTileStyle}
                  getSceneLaunchMediaPreviewStyle={getSceneLaunchMediaPreviewStyle}
                  gridDragOverInfo={gridDragOverInfo}
                  handleGridDragOver={handleGridDragOver}
                  handleGridDragLeave={handleGridDragLeave}
                  handleGridDrop={handleGridDrop}
                  syncTimelinePlayheadToCollectionPreview={syncTimelinePlayheadToCollectionPreview}
                  handleItemContextMenu={handleItemContextMenu}
                />
              );
            })}

            <button
              type="button"
              style={getSceneLaunchCollectionTileStyle()}
              className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-900 bg-zinc-950/40 text-zinc-650 transition-colors hover:border-zinc-700 hover:bg-zinc-950 hover:text-zinc-300 h-36 sm:h-40 lg:h-44"
              onClick={createSceneLaunchBeat}
            >
              <Plus className="h-6 w-6" />
              <span className="mt-2 text-[10px] font-semibold uppercase tracking-widest">Add collection</span>
            </button>
          </div>
        </>
      )}
    </section>
  );
}

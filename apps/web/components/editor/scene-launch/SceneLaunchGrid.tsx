'use client';

import React from 'react';
import { Button } from '@storyboard/ui';
import { Grid2X2, Plus, Trash2 } from 'lucide-react';
import { SceneLaunchMediaTile } from './SceneLaunchMediaTile';
import { SceneLaunchCollectionTile } from './SceneLaunchCollectionTile';
import type { SceneLaunchBeat, SceneLaunchMediaItem } from './useSceneLaunchBoard';
import type { TimelineAspectRatio } from '@/lib/timeline-context';

interface SceneLaunchGridProps {
  activeSceneLaunchBeatId: string | null;
  activeSceneLaunchBeat: SceneLaunchBeat | null;
  sceneLaunchGridItems: Array<
    | { id: string; type: 'media'; item: SceneLaunchMediaItem }
    | { id: string; type: 'collection'; collection: SceneLaunchBeat }
  >;
  isTimelinePlaying: boolean;
  activeItemKey: string | null;
  hoveredItemKey: string | null;
  setHoveredItemKey: React.Dispatch<React.SetStateAction<string | null>>;
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
  handleBoardContextMenu: (event: React.MouseEvent<HTMLElement>, insertionIndex: number) => void;
  onPreviewMedia: (item: SceneLaunchMediaItem) => void;
  emptyTrash: () => void;
  createSceneLaunchBeat: () => void;
  handleBeatDrop: (event: React.DragEvent<HTMLDivElement>, beatId: string) => void;
  aspectRatio: TimelineAspectRatio;
}

export function SceneLaunchGrid({
  activeSceneLaunchBeatId,
  activeSceneLaunchBeat,
  sceneLaunchGridItems,
  isTimelinePlaying,
  activeItemKey,
  hoveredItemKey,
  setHoveredItemKey,
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
  handleBoardContextMenu,
  onPreviewMedia,
  emptyTrash,
  createSceneLaunchBeat,
  handleBeatDrop,
  aspectRatio,
}: SceneLaunchGridProps) {

  const getAspectRatioValue = (ratio: string): number => {
    const [w, h] = ratio.split(':').map(Number);
    return w / h;
  };
  const ratioValue = getAspectRatioValue(aspectRatio);
  const calculatedWidth = 10 * ratioValue;
  const finalWidth = Math.max(7.5, calculatedWidth);
  const getGridInsertionIndex = (
    event: React.MouseEvent<HTMLElement>,
    container: HTMLElement,
  ) => {
    const itemElements = Array.from(container.querySelectorAll<HTMLElement>(':scope > [data-scene-grid-item="true"]'));
    if (itemElements.length === 0) return 0;

    const entries = itemElements
      .map((element, index) => ({ element, index, rect: element.getBoundingClientRect() }))
      .sort((a, b) => (Math.abs(a.rect.top - b.rect.top) > 8 ? a.rect.top - b.rect.top : a.rect.left - b.rect.left));
    const rows: Array<typeof entries> = [];

    for (const entry of entries) {
      const row = rows.find(items => Math.abs(items[0].rect.top - entry.rect.top) <= 8);
      if (row) {
        row.push(entry);
      } else {
        rows.push([entry]);
      }
    }

    const y = event.clientY;
    const x = event.clientX;
    const targetRow = rows.find(row => {
      const top = Math.min(...row.map(item => item.rect.top));
      const bottom = Math.max(...row.map(item => item.rect.bottom));
      return y <= bottom || y < top;
    }) ?? rows[rows.length - 1];

    for (const entry of targetRow) {
      if (x < entry.rect.left + entry.rect.width / 2) {
        return entry.index;
      }
    }

    return targetRow[targetRow.length - 1].index + 1;
  };

  const handleGridBackgroundContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (activeSceneLaunchBeatId === 'trash') return;
    if ((event.target as HTMLElement).closest('[data-scene-grid-item="true"]')) return;

    event.preventDefault();
    event.stopPropagation();
    const gridContainer = event.currentTarget.matches('[data-scene-grid-container="true"]')
      ? event.currentTarget
      : event.currentTarget.querySelector<HTMLElement>('[data-scene-grid-container="true"]') ?? event.currentTarget;
    handleBoardContextMenu(event, getGridInsertionIndex(event, gridContainer));
  };

  return (
    <section className="mt-6 w-full shrink-0">
      {activeSceneLaunchBeat ? (
        <>
          {activeSceneLaunchBeatId === 'trash' && (
            <div className="mb-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-zinc-200">Trash Folder</h2>
                <p className="mt-1 text-[11px] text-zinc-700">
                  Items moved here can be restored or permanently deleted
                </p>
              </div>
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
            </div>
          )}

          <div
            className="rounded-lg border border-zinc-900 bg-zinc-950/30 p-3"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleBeatDrop(event, activeSceneLaunchBeat.id)}
            onContextMenu={handleGridBackgroundContextMenu}
          >
            {sceneLaunchGridItems.length > 0 ? (
              <div
                data-scene-grid-container="true"
                className="grid gap-3"
                style={{
                  gridTemplateColumns: `repeat(auto-fill, minmax(${finalWidth}rem, 1fr))`,
                }}
                onContextMenu={handleGridBackgroundContextMenu}
              >
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
                        hoveredItemKey={hoveredItemKey}
                        setHoveredItemKey={setHoveredItemKey}
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
                        onPreviewMedia={onPreviewMedia}
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
                      hoveredItemKey={hoveredItemKey}
                      setHoveredItemKey={setHoveredItemKey}
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
          <div
            data-scene-grid-container="true"
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(${finalWidth}rem, 1fr))`,
            }}
            onContextMenu={handleGridBackgroundContextMenu}
          >
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
                    hoveredItemKey={hoveredItemKey}
                    setHoveredItemKey={setHoveredItemKey}
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
                    onPreviewMedia={onPreviewMedia}
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
                  hoveredItemKey={hoveredItemKey}
                  setHoveredItemKey={setHoveredItemKey}
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

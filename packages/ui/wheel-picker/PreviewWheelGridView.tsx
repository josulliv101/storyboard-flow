import React from 'react';
import { cn } from '../lib/utils';
import { SceneLaunchPreviewWheelV3 } from './SceneLaunchPreviewWheelV3';
import type { 
  SceneLaunchMediaItem, 
  SceneLaunchPreviewWheelV3Effect, 
  PreviewWheelUtilityAction 
} from './SceneLaunchPreviewWheelV3';

export interface WrappedRowInfo {
  items: SceneLaunchMediaItem[];
  parentChunkIndex: number;
  subRowIndex: number;
  isIndented: boolean;
  nestingLevel: number;
  rowTitle?: string;
  rowIconUrl?: string;
  rowIsCollection?: boolean;
}

export interface PreviewWheelGridViewProps {
  wrappedRows: WrappedRowInfo[];
  hidePreview: boolean;
  customChunks?: SceneLaunchMediaItem[][];
  itemSequences?: Record<string, SceneLaunchMediaItem[]>;
  itemSequenceThumbnails?: Record<string, Record<string, SceneLaunchMediaItem>>;
  onCollectionOpen?: (collectionId: string) => void;
  allCollections?: any[];
  getRecursiveMediaItems?: (collection: any) => SceneLaunchMediaItem[];
  collectionMultiCircleEnabled?: boolean;
  breakoutSelectedMediaIds?: string[];
  selectedMediaId: string;
  effect: SceneLaunchPreviewWheelV3Effect;
  thumbnailSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  durationScale: number;
  selectedItemDurationSeconds?: number;
  selectedItemTrimStartSeconds?: number;
  onSelectedItemDurationChange?: (dur: number, start: number) => void;
  onSelectedItemDurationChangeEnd?: (dur: number, start: number) => void;
  onCenteredMediaChange: (id: string) => void;
  renderSelectedItemOverlay?: (item: SceneLaunchMediaItem) => React.ReactNode;
  renderGalleryTrimOverlay?: (item: SceneLaunchMediaItem) => React.ReactNode;
  isPreviewPlaying?: boolean;
  loopPreviewPlayback?: boolean;
  onPreviewPlaybackComplete?: () => void;
  onPlaybackMediaChange?: (id: string) => void;
  onItemsReorder?: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
  collectionItemIds?: string[];
  onItemMoveIntoCollection?: (draggedId: string, targetCollectionId: string) => void;
  disabledItemIds?: string[];
  onUtilityDrop?: (action: PreviewWheelUtilityAction, draggedId: string) => void;
  selectReorderedItem?: boolean;
  onTogglePlayback?: () => void;
  onToggleLoop?: () => void;
  showUniformRuler?: boolean;
  showRuler?: boolean;
  slideOnClick?: boolean;
  itemsPerRow: number;
  showPlayhead?: boolean;
  visibleGridPlayheadRow: number;
  activePlayingMediaId: string | null;
  activePlayingElapsedSeconds: number;
  onScrubUpdate?: (
    mediaId: string | null,
    sourceTimeSeconds: number | null,
    timelineTimeSeconds: number | null
  ) => void;
  handleGridScrubUpdate: (
    chunkIndex: number, 
    mediaId: string | null, 
    sourceTimeSeconds: number | null, 
    timelineTimeSeconds: number | null
  ) => void;
}

export function PreviewWheelGridView({
  wrappedRows,
  hidePreview,
  customChunks,
  itemSequences,
  itemSequenceThumbnails,
  onCollectionOpen,
  allCollections,
  getRecursiveMediaItems,
  collectionMultiCircleEnabled,
  breakoutSelectedMediaIds,
  selectedMediaId,
  effect,
  thumbnailSize,
  durationScale,
  selectedItemDurationSeconds,
  selectedItemTrimStartSeconds,
  onSelectedItemDurationChange,
  onSelectedItemDurationChangeEnd,
  onCenteredMediaChange,
  renderSelectedItemOverlay,
  renderGalleryTrimOverlay,
  isPreviewPlaying,
  loopPreviewPlayback,
  onPreviewPlaybackComplete,
  onPlaybackMediaChange,
  onItemsReorder,
  collectionItemIds,
  onItemMoveIntoCollection,
  disabledItemIds,
  onUtilityDrop,
  selectReorderedItem,
  onTogglePlayback,
  onToggleLoop,
  showUniformRuler,
  showRuler,
  slideOnClick,
  itemsPerRow,
  showPlayhead,
  visibleGridPlayheadRow,
  activePlayingMediaId,
  activePlayingElapsedSeconds,
  onScrubUpdate,
  handleGridScrubUpdate,
}: PreviewWheelGridViewProps) {
  return (
    <div className={cn(
      "flex shrink-0 flex-col overflow-visible px-0 bg-zinc-950/40",
      !hidePreview && "border-t border-zinc-900",
      customChunks ? "py-4" : "py-3"
    )}>
      {wrappedRows.map((rowInfo, chunkIndex) => {
        const prevRow = wrappedRows[chunkIndex - 1];
        const nextRow = wrappedRows[chunkIndex + 1];
        const prevRowPreviewItem = prevRow ? prevRow.items[prevRow.items.length - 1] : undefined;
        const nextRowPreviewItem = nextRow ? nextRow.items[0] : undefined;

        return (
          <div
            key={`chunk-wrapper-${chunkIndex}`}
            className={cn(
              "relative overflow-visible w-full",
              customChunks
                ? rowInfo.subRowIndex > 0
                  ? "mt-0"
                  : chunkIndex > 0
                    ? "mt-10"
                    : "mt-0"
                : chunkIndex > 0
                  ? "mt-6"
                  : "mt-0"
            )}
          >
            <SceneLaunchPreviewWheelV3
              key={`chunk-${chunkIndex}`}
              items={rowInfo.items}
              prevRowPreviewItem={prevRowPreviewItem}
              nextRowPreviewItem={nextRowPreviewItem}
              itemSequences={itemSequences}
              itemSequenceThumbnails={itemSequenceThumbnails}
              onCollectionOpen={onCollectionOpen}
              allCollections={allCollections}
              getRecursiveMediaItems={getRecursiveMediaItems}
              collectionMultiCircleEnabled={collectionMultiCircleEnabled}
              selectedMediaId={breakoutSelectedMediaIds?.[rowInfo.parentChunkIndex] ?? selectedMediaId}
              effect={effect}
              thumbnailSize={thumbnailSize}
              sizing="uniform"
              durationScale={durationScale}
              selectedItemDurationSeconds={selectedItemDurationSeconds}
              selectedItemTrimStartSeconds={selectedItemTrimStartSeconds}
              onSelectedItemDurationChange={onSelectedItemDurationChange}
              onSelectedItemDurationChangeEnd={onSelectedItemDurationChangeEnd}
              onCenteredMediaChange={onCenteredMediaChange}
              renderSelectedItemOverlay={renderSelectedItemOverlay}
              renderGalleryTrimOverlay={renderGalleryTrimOverlay}
              isPreviewPlaying={false}
              playheadIsPlaying={isPreviewPlaying}
              loopPreviewPlayback={loopPreviewPlayback}
              onPreviewPlaybackComplete={onPreviewPlaybackComplete}
              onPlaybackMediaChange={onPlaybackMediaChange}
              onItemsReorder={onItemsReorder}
              collectionItemIds={collectionItemIds}
              onItemMoveIntoCollection={onItemMoveIntoCollection}
              disabledItemIds={disabledItemIds}
              onUtilityDrop={onUtilityDrop}
              selectReorderedItem={selectReorderedItem}
              onTogglePlayback={onTogglePlayback}
              onToggleLoop={onToggleLoop}
              showUniformRuler={showUniformRuler}
              showRuler={showRuler}
              slideOnClick={slideOnClick}
              rowTitle={rowInfo.rowTitle}
              rowIconUrl={rowInfo.rowIconUrl}
              rowIsCollection={rowInfo.rowIsCollection}
              gridView={false}
              gridColumnCount={itemsPerRow}
              isIndented={rowInfo.isIndented}
              nestingLevel={rowInfo.nestingLevel}
              gridNestingLevels={wrappedRows.map(r => r.nestingLevel)}
              rowIndex={chunkIndex}
              subRowIndex={rowInfo.subRowIndex}
              isLastGridRow={chunkIndex === wrappedRows.length - 1}
              showPlayhead={showPlayhead && visibleGridPlayheadRow === chunkIndex}
              hidePreview={true}
              hideTrack={false}
              activePlayingMediaId={activePlayingMediaId}
              activePlayingElapsedSeconds={activePlayingElapsedSeconds}
              onScrubUpdate={onScrubUpdate
                ? (mediaId: string | null, sourceTimeSeconds: number | null, timelineTimeSeconds?: number | null) => {
                    handleGridScrubUpdate(chunkIndex, mediaId, sourceTimeSeconds, timelineTimeSeconds ?? null);
                  }
                : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

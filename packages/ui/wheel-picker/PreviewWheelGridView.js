import { jsx as _jsx } from "react/jsx-runtime";
import { cn } from '../lib/utils';
import { SceneLaunchPreviewWheelV3 } from './SceneLaunchPreviewWheelV3';
export function PreviewWheelGridView({ wrappedRows, hidePreview, customChunks, itemSequences, itemSequenceThumbnails, onCollectionOpen, allCollections, getRecursiveMediaItems, collectionMultiCircleEnabled, breakoutSelectedMediaIds, selectedMediaId, effect, thumbnailSize, durationScale, selectedItemDurationSeconds, selectedItemTrimStartSeconds, onSelectedItemDurationChange, onSelectedItemDurationChangeEnd, onCenteredMediaChange, renderSelectedItemOverlay, renderGalleryTrimOverlay, isPreviewPlaying, loopPreviewPlayback, onPreviewPlaybackComplete, onPlaybackMediaChange, onItemsReorder, collectionItemIds, onItemMoveIntoCollection, disabledItemIds, onUtilityDrop, selectReorderedItem, onTogglePlayback, onToggleLoop, showUniformRuler, showRuler, slideOnClick, itemsPerRow, showPlayhead, visibleGridPlayheadRow, activePlayingMediaId, activePlayingElapsedSeconds, onScrubUpdate, handleGridScrubUpdate, }) {
    return (_jsx("div", { className: cn("flex shrink-0 flex-col overflow-visible px-0 bg-zinc-950/40", !hidePreview && "border-t border-zinc-900", customChunks ? "py-4" : "py-3"), children: wrappedRows.map((rowInfo, chunkIndex) => {
            var _a;
            const prevRow = wrappedRows[chunkIndex - 1];
            const nextRow = wrappedRows[chunkIndex + 1];
            const prevRowPreviewItem = prevRow ? prevRow.items[prevRow.items.length - 1] : undefined;
            const nextRowPreviewItem = nextRow ? nextRow.items[0] : undefined;
            return (_jsx("div", { className: cn("relative overflow-visible w-full", customChunks
                    ? rowInfo.subRowIndex > 0
                        ? "mt-0"
                        : chunkIndex > 0
                            ? "mt-10"
                            : "mt-0"
                    : chunkIndex > 0
                        ? "mt-6"
                        : "mt-0"), children: _jsx(SceneLaunchPreviewWheelV3, { items: rowInfo.items, prevRowPreviewItem: prevRowPreviewItem, nextRowPreviewItem: nextRowPreviewItem, itemSequences: itemSequences, itemSequenceThumbnails: itemSequenceThumbnails, onCollectionOpen: onCollectionOpen, allCollections: allCollections, getRecursiveMediaItems: getRecursiveMediaItems, collectionMultiCircleEnabled: collectionMultiCircleEnabled, selectedMediaId: (_a = breakoutSelectedMediaIds === null || breakoutSelectedMediaIds === void 0 ? void 0 : breakoutSelectedMediaIds[rowInfo.parentChunkIndex]) !== null && _a !== void 0 ? _a : selectedMediaId, effect: effect, thumbnailSize: thumbnailSize, sizing: "uniform", durationScale: durationScale, selectedItemDurationSeconds: selectedItemDurationSeconds, selectedItemTrimStartSeconds: selectedItemTrimStartSeconds, onSelectedItemDurationChange: onSelectedItemDurationChange, onSelectedItemDurationChangeEnd: onSelectedItemDurationChangeEnd, onCenteredMediaChange: onCenteredMediaChange, renderSelectedItemOverlay: renderSelectedItemOverlay, renderGalleryTrimOverlay: renderGalleryTrimOverlay, isPreviewPlaying: false, playheadIsPlaying: isPreviewPlaying, loopPreviewPlayback: loopPreviewPlayback, onPreviewPlaybackComplete: onPreviewPlaybackComplete, onPlaybackMediaChange: onPlaybackMediaChange, onItemsReorder: onItemsReorder, collectionItemIds: collectionItemIds, onItemMoveIntoCollection: onItemMoveIntoCollection, disabledItemIds: disabledItemIds, onUtilityDrop: onUtilityDrop, selectReorderedItem: selectReorderedItem, onTogglePlayback: onTogglePlayback, onToggleLoop: onToggleLoop, showUniformRuler: showUniformRuler, showRuler: showRuler, slideOnClick: slideOnClick, rowTitle: rowInfo.rowTitle, rowIconUrl: rowInfo.rowIconUrl, rowIsCollection: rowInfo.rowIsCollection, gridView: false, gridColumnCount: itemsPerRow, isIndented: rowInfo.isIndented, nestingLevel: rowInfo.nestingLevel, gridNestingLevels: wrappedRows.map(r => r.nestingLevel), rowIndex: chunkIndex, subRowIndex: rowInfo.subRowIndex, isLastGridRow: chunkIndex === wrappedRows.length - 1, showPlayhead: showPlayhead && visibleGridPlayheadRow === chunkIndex, hidePreview: true, hideTrack: false, activePlayingMediaId: activePlayingMediaId, activePlayingElapsedSeconds: activePlayingElapsedSeconds, onScrubUpdate: onScrubUpdate
                        ? (mediaId, sourceTimeSeconds, timelineTimeSeconds) => {
                            handleGridScrubUpdate(chunkIndex, mediaId, sourceTimeSeconds, timelineTimeSeconds !== null && timelineTimeSeconds !== void 0 ? timelineTimeSeconds : null);
                        }
                        : undefined }, `chunk-${chunkIndex}`) }, `chunk-wrapper-${chunkIndex}`));
        }) }));
}

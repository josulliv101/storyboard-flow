import React from 'react';
import { type SceneLaunchMediaItem, type SceneLaunchPreviewWheelV3Effect, type SceneLaunchPreviewWheelV3Sizing } from './SceneLaunchPreviewWheelV3';

const clamp = (value: number, min: number, max: number) => (
  Math.max(min, Math.min(max, value))
);

export interface UsePreviewWheelLayoutProps {
  items: SceneLaunchMediaItem[];
  disabledItemIds: string[];
  itemSequences?: Record<string, SceneLaunchMediaItem[]>;
  selectedMediaId: string;
  selectedItemDurationSeconds?: number;
  selectedItemTrimStartSeconds?: number;
  sizing: SceneLaunchPreviewWheelV3Sizing;
  durationScale: number;
  effect: SceneLaunchPreviewWheelV3Effect;
  hidePreview: boolean;
  gridItemGap: number;
  galleryItemHeight: number;
  viewportSize: { width: number; height: number };
  gridView: boolean;
  customChunks?: SceneLaunchMediaItem[][];
  breakoutTitles?: string[];
  breakoutIsCollection?: boolean[];
  breakoutRepresentativeUrls?: (string | null)[];
  breakoutCollectionsEnabled?: boolean;
  breakoutNestingLevels?: number[];
  activePlayingMediaId: string | null;
  externalScrubMediaId: string | null;
  activeGridPlayheadRow: number | null;
  isPreviewPlaying: boolean;
  timelineWrapped: boolean;
  allCollections?: any[];
  getRecursiveMediaItems?: (collection: any) => any[];
  thumbnailSize: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showRuler: boolean;
  subRowIndex: number;
  reorderPreviewOrder: string[] | null;
  reorderPreview: any | null;
  offset: number;
  playheadOffsetFromCenter: number;
  centerX: number;
  nestingLevel: number;
  gridNestingLevels: number[];
  rowIndex: number;
  gridDisplayPanelHeight: number;
  gridColumnCount?: number;
}

export function usePreviewWheelLayout({
  items,
  disabledItemIds,
  itemSequences,
  selectedMediaId,
  selectedItemDurationSeconds,
  selectedItemTrimStartSeconds,
  sizing,
  durationScale,
  effect,
  hidePreview,
  gridItemGap,
  galleryItemHeight,
  viewportSize,
  gridView,
  customChunks,
  breakoutTitles,
  breakoutIsCollection,
  breakoutRepresentativeUrls,
  breakoutCollectionsEnabled,
  breakoutNestingLevels,
  activePlayingMediaId,
  externalScrubMediaId,
  activeGridPlayheadRow,
  isPreviewPlaying,
  timelineWrapped,
  allCollections,
  getRecursiveMediaItems,
  thumbnailSize,
  showRuler,
  subRowIndex,
  reorderPreviewOrder,
  reorderPreview,
  playheadOffsetFromCenter,
  centerX,
  nestingLevel,
  gridNestingLevels,
  rowIndex,
  gridDisplayPanelHeight,
  gridColumnCount,
}: UsePreviewWheelLayoutProps) {
  const isGallery = effect === 'gallery';

  const sizeFactor = thumbnailSize === 'xs' ? 0.3
    : thumbnailSize === 'sm' ? 0.65
    : thumbnailSize === 'lg' ? 1.35
    : thumbnailSize === 'xl' ? 1.7
    : 1.0;

  const minGridDisplayPanelHeight = 180;
  const maxGridDisplayPanelHeight = Math.max(
    minGridDisplayPanelHeight,
    viewportSize.height - 190,
  );
  const boundedGridDisplayPanelHeight = clamp(
    gridDisplayPanelHeight,
    minGridDisplayPanelHeight,
    maxGridDisplayPanelHeight,
  );

  const countForResponsive = gridColumnCount ?? (gridView ? items.length : undefined);
  const responsiveGridItemWidth = hidePreview && countForResponsive
    ? Math.max(1, (viewportSize.width - 16 - gridItemGap * (countForResponsive - 1)) / countForResponsive)
    : null;

  const itemHeight = React.useMemo(() => {
    return responsiveGridItemWidth !== null
      ? responsiveGridItemWidth * 9 / 16
      : isGallery
        ? galleryItemHeight
        : Math.round(clamp(
            sizing === 'uniform'
              ? Math.min(viewportSize.height - 64, viewportSize.width * 0.72 * 9 / 16)
              : viewportSize.height - 64,
            220,
            620,
          ) * sizeFactor);
  }, [responsiveGridItemWidth, isGallery, galleryItemHeight, sizing, viewportSize, sizeFactor]);

  const rowHeight = hidePreview
    ? showRuler
      ? (subRowIndex > 0 ? itemHeight + 8 : itemHeight + 40)
      : itemHeight
    : isGallery
      ? itemHeight + 66
      : itemHeight + 36;

  const galleryPreviewHeight = Math.max(0, Math.min(
    gridView ? Math.max(96, boundedGridDisplayPanelHeight - 70) : 360,
    viewportSize.width * 9 / 16,
    gridView
      ? Math.max(96, boundedGridDisplayPanelHeight - 70)
      : viewportSize.height - rowHeight - 72,
  ));
  const galleryPreviewWidth = galleryPreviewHeight * 16 / 9;

  const itemCenterY = hidePreview
    ? showRuler
      ? (subRowIndex > 0 ? itemHeight / 2 + 8 : itemHeight / 2 + 32)
      : itemHeight / 2
    : isGallery
      ? rowHeight - 12 - itemHeight / 2
      : Math.max(
          itemHeight / 2 + 32,
          viewportSize.height - itemHeight / 2 - 24,
        );

  const rulerTop = hidePreview
    ? showRuler && subRowIndex === 0 ? 4 : 0
    : isGallery
      ? 22
      : Math.max(2, itemCenterY - itemHeight / 2 - 28);

  const itemTop = itemCenterY - itemHeight / 2;

  const uniformItemWidth = hidePreview
    ? responsiveGridItemWidth ?? Math.round(itemHeight * 16 / 9)
    : sizing === 'uniform'
      ? Math.round(itemHeight * 16 / 9)
      : Math.round(clamp(
          itemHeight * 1.6,
          320,
          Math.min(760, viewportSize.width * 0.72),
        ));

  const getMediaDuration = React.useCallback((item: SceneLaunchMediaItem) => Math.max(
    0.5,
    item.durationSeconds ?? 3,
  ), []);

  const itemDurations = React.useMemo(() => items.map(item => {
    if (disabledItemIds.includes(item.id)) return 0;
    const sequence = itemSequences?.[item.id];
    if (sequence?.length) {
      return sequence.reduce((total, media) => (
        total + (disabledItemIds.includes(media.id) ? 0 : getMediaDuration(media))
      ), 0);
    }
    return Math.max(
      0.5,
      item.id === selectedMediaId && selectedItemDurationSeconds !== undefined
        ? selectedItemDurationSeconds
        : item.durationSeconds ?? 3,
    );
  }), [disabledItemIds, getMediaDuration, itemSequences, items, selectedItemDurationSeconds, selectedMediaId]);

  const DURATION_REFERENCE_SECONDS = 3;
  const durationPixelsPerSecond = uniformItemWidth / DURATION_REFERENCE_SECONDS * durationScale;

  const itemWidths = React.useMemo(() => {
    if (sizing === 'uniform') {
      return items.map(() => uniformItemWidth);
    }

    return itemDurations.map(duration => duration * durationPixelsPerSecond);
  }, [durationPixelsPerSecond, itemDurations, items, sizing, uniformItemWidth]);

  const isGaplessGallery = effect === 'gallery' && sizing === 'duration';

  const itemGap = hidePreview
    ? gridItemGap
    : isGaplessGallery
    ? 0
    : 24 * (sizing === 'duration' ? durationScale : 1); // ITEM_GAP is 24

  const itemStartTimes = React.useMemo(() => itemDurations.map((_, index) => (
    itemDurations.slice(0, index).reduce((sum, duration) => sum + duration, 0)
  )), [itemDurations]);

  const totalDurationSeconds = itemDurations.reduce((sum, duration) => sum + duration, 0);

  const rulerTickStep = React.useMemo(() => {
    const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    return candidates.find(step => (
      step * durationPixelsPerSecond >= 52 && totalDurationSeconds / step <= 300
    )) ?? candidates[candidates.length - 1];
  }, [durationPixelsPerSecond, totalDurationSeconds]);

  const itemCenterPositions = React.useMemo(() => {
    const positions: number[] = [];
    let center = 0;
    itemWidths.forEach((width, index) => {
      if (index > 0) {
        center += itemWidths[index - 1] / 2 + itemGap + width / 2;
      }
      positions.push(center);
    });
    return positions;
  }, [itemGap, itemWidths]);

  const reorderItemCenterPositions = React.useMemo(() => {
    if (!reorderPreviewOrder) return null;

    const positions = new Map<string, number>();
    let center = 0;
    reorderPreviewOrder.forEach((mediaId, orderIndex) => {
      const itemIndex = items.findIndex(item => item.id === mediaId);
      const width = itemWidths[itemIndex] ?? uniformItemWidth;
      if (orderIndex > 0) {
        const previousId = reorderPreviewOrder[orderIndex - 1];
        const previousIndex = items.findIndex(item => item.id === previousId);
        const previousWidth = itemWidths[previousIndex] ?? uniformItemWidth;
        center += previousWidth / 2 + itemGap + width / 2;
      }
      positions.set(mediaId, center);
    });
    return positions;
  }, [itemGap, itemWidths, items, reorderPreviewOrder, uniformItemWidth]);

  const itemStartPixels = React.useMemo(() => {
    const firstItemHalfWidth = (itemWidths[0] ?? 0) / 2;
    return itemWidths.map((width, index) => (
      (itemCenterPositions[index] ?? 0) + firstItemHalfWidth - width / 2
    ));
  }, [itemCenterPositions, itemWidths]);

  const selectedIndex = React.useMemo(() => (
    items.findIndex(item => item.id === selectedMediaId)
  ), [items, selectedMediaId]);

  const gridItemWidth = Math.round(galleryItemHeight * 16 / 9);
  const gridColStride = gridItemWidth + gridItemGap;
  const colStride = uniformItemWidth + itemGap;

  const itemsPerRow = React.useMemo(() => {
    return Math.max(1, Math.floor((viewportSize.width - 16 + gridItemGap) / gridColStride));
  }, [viewportSize.width, gridColStride]);

  const childGridItemWidth = React.useMemo(() => {
    const responsiveWidth = itemsPerRow
      ? Math.max(1, (viewportSize.width - 16 - gridItemGap * (itemsPerRow - 1)) / itemsPerRow)
      : Math.round(galleryItemHeight * 16 / 9);
    return responsiveWidth;
  }, [itemsPerRow, viewportSize.width, gridItemGap, galleryItemHeight]);

  const wrappedRows = React.useMemo(() => {
    if (!gridView) return [];

    const result: {
      items: SceneLaunchMediaItem[];
      parentChunkIndex: number;
      subRowIndex: number;
      isIndented: boolean;
      nestingLevel: number;
      rowTitle?: string;
      rowIconUrl?: string;
      rowIsCollection?: boolean;
    }[] = [];

    if (customChunks) {
      customChunks.forEach((originalChunk, parentIndex) => {
        const title = breakoutTitles?.[parentIndex];
        const isCollection = breakoutIsCollection?.[parentIndex];
        const repUrl = breakoutRepresentativeUrls?.[parentIndex];
        const nestingLevel = breakoutNestingLevels?.[parentIndex] ?? (parentIndex > 0 ? 1 : 0);
        const isIndented = nestingLevel > 0;

        if (timelineWrapped) {
          let subRowIdx = 0;
          const itemsPerRowForLevel = Math.max(1, itemsPerRow - nestingLevel);
          for (let i = 0; i < originalChunk.length; i += itemsPerRowForLevel) {
            const subItems = originalChunk.slice(i, i + itemsPerRowForLevel);
            result.push({
              items: subItems,
              parentChunkIndex: parentIndex,
              subRowIndex: subRowIdx,
              isIndented,
              nestingLevel,
              rowTitle: subRowIdx === 0 ? title : undefined,
              rowIconUrl: (subRowIdx === 0 ? repUrl : undefined) || undefined,
              rowIsCollection: isCollection,
            });
            subRowIdx++;
          }
        } else {
          result.push({
            items: originalChunk,
            parentChunkIndex: parentIndex,
            subRowIndex: 0,
            isIndented,
            nestingLevel,
            rowTitle: title,
            rowIconUrl: repUrl || undefined,
            rowIsCollection: isCollection,
          });
        }
      });
    } else {
      if (timelineWrapped) {
        let subRowIdx = 0;
        for (let i = 0; i < items.length; i += itemsPerRow) {
          const subItems = items.slice(i, i + itemsPerRow);
          result.push({
            items: subItems,
            parentChunkIndex: 0,
            subRowIndex: subRowIdx,
            isIndented: false,
            nestingLevel: 0,
            rowTitle: undefined,
            rowIconUrl: undefined,
            rowIsCollection: false,
          });
          subRowIdx++;
        }
      } else {
        result.push({
          items: items,
          parentChunkIndex: 0,
          subRowIndex: 0,
          isIndented: false,
          nestingLevel: 0,
          rowTitle: undefined,
          rowIconUrl: undefined,
          rowIsCollection: false,
        });
      }
    }

    return result;
  }, [
    customChunks,
    items,
    itemsPerRow,
    gridView,
    timelineWrapped,
    breakoutTitles,
    breakoutIsCollection,
    breakoutRepresentativeUrls,
    breakoutCollectionsEnabled,
    breakoutNestingLevels,
  ]);

  const getGridRowForMedia = React.useCallback((mediaId: string | null | undefined) => {
    if (!mediaId) return -1;
    return wrappedRows.findIndex(row =>
      row.items.some(item => (
        item.id === mediaId ||
        itemSequences?.[item.id]?.some(sequenceItem => sequenceItem.id === mediaId) ||
        (item.id.startsWith('collection-placeholder:') && (() => {
          const collectionId = item.id.slice('collection-placeholder:'.length);
          const col = allCollections?.find(b => b.id === collectionId);
          return col && getRecursiveMediaItems ? getRecursiveMediaItems(col).some(m => m.id === mediaId) : false;
        })())
      ))
    );
  }, [wrappedRows, itemSequences, allCollections, getRecursiveMediaItems]);

  const playbackGridRow = getGridRowForMedia(activePlayingMediaId);
  const externalScrubGridRow = getGridRowForMedia(externalScrubMediaId);
  const selectedGridRow = getGridRowForMedia(selectedMediaId);
  const visibleGridPlayheadRow = isPreviewPlaying && playbackGridRow >= 0
    ? playbackGridRow
    : externalScrubGridRow >= 0
      ? externalScrubGridRow
      : activeGridPlayheadRow ?? Math.max(0, selectedGridRow);

  const selectedItemType = items[selectedIndex]?.type;
  const itemStride = uniformItemWidth + itemGap;
  const finalIndex = items.length - 1;
  const finalCenterOffset = -(itemCenterPositions[finalIndex] ?? 0);
  const stripEndPixel = (itemStartPixels[finalIndex] ?? 0) + (itemWidths[finalIndex] ?? 0);
  const timelineOriginOffset = (itemWidths[0] ?? 0) / 2;
  const selectedScrubOriginOffset = selectedIndex >= 0
    ? (itemStartPixels[selectedIndex] ?? 0) - (itemCenterPositions[selectedIndex] ?? 0)
    : 0;
  const verticalLineX = childGridItemWidth / 2 + 8;
  const indentOffset = nestingLevel > 0 ? (nestingLevel * (childGridItemWidth + gridItemGap) + 8) : 8;

  const maxOffset = hidePreview
    ? indentOffset - centerX + (uniformItemWidth / 2) - playheadOffsetFromCenter
    : (sizing === 'duration')
      ? timelineOriginOffset
      : (sizing === 'uniform')
        ? Math.max(
            centerX - ((itemWidths[0] ?? uniformItemWidth) / 2),
            centerX - ((itemWidths[0] ?? uniformItemWidth) / 2) - playheadOffsetFromCenter
          ) + 120
        : isGallery
          ? timelineOriginOffset
          : Math.max(0, selectedScrubOriginOffset);

  const minOffset = hidePreview
    ? Math.min(maxOffset, viewportSize.width - stripEndPixel - 8 - centerX + (uniformItemWidth / 2) - playheadOffsetFromCenter)
    : (sizing === 'duration')
      ? timelineOriginOffset - stripEndPixel
      : (sizing === 'uniform')
        ? Math.min(
            -centerX - ((itemCenterPositions[finalIndex] ?? 0) - (itemWidths[finalIndex] ?? uniformItemWidth) / 2),
            -itemCenterPositions[finalIndex] - playheadOffsetFromCenter
          ) + 120 - stripEndPixel
        : isGallery
          ? timelineOriginOffset - stripEndPixel
          : Math.min(maxOffset, viewportSize.width - stripEndPixel - 8 - centerX + (uniformItemWidth / 2) - playheadOffsetFromCenter);


  const resolveItemSnapshot = React.useCallback((
    item: SceneLaunchMediaItem,
    elapsedSeconds: number,
  ) => {
    const sequence = itemSequences?.[item.id]?.filter(media => !disabledItemIds.includes(media.id));
    if (!sequence?.length) {
      return {
        media: item,
        sourceTimeSeconds: item.type === 'video'
          ? Math.max(0, item.trimStartSeconds ?? 0) + elapsedSeconds
          : 0,
      };
    }

    let remaining = Math.max(0, elapsedSeconds);
    for (const media of sequence) {
      const duration = getMediaDuration(media);
      if (remaining < duration) {
        return {
          media,
          sourceTimeSeconds: media.type === 'video'
            ? Math.max(0, media.trimStartSeconds ?? 0) + remaining
            : 0,
        };
      }
      remaining -= duration;
    }

    const media = sequence[sequence.length - 1];
    const duration = getMediaDuration(media);
    return {
      media,
      sourceTimeSeconds: media.type === 'video'
        ? Math.max(0, media.trimStartSeconds ?? 0) + Math.max(0, duration - 0.001)
        : 0,
    };
  }, [disabledItemIds, getMediaDuration, itemSequences]);

  const getCollectionDirectCount = React.useCallback((itemId: string): number => {
    let collectionId = '';
    if (itemId.startsWith('collection-placeholder:')) {
      collectionId = itemId.substring('collection-placeholder:'.length);
    } else if (allCollections?.some(b => b.id === itemId)) {
      collectionId = itemId;
    }

    if (collectionId) {
      const collection = allCollections?.find(b => b.id === collectionId);
      if (collection) {
        return collection.gridOrder?.length ?? 0;
      }
    }
    return itemSequences?.[itemId]?.length ?? 0;
  }, [allCollections, itemSequences]);

  const getCollectionMediaItems = React.useCallback((collectionId: string) => {
    let realCollectionId = '';
    if (collectionId.startsWith('collection-placeholder:')) {
      realCollectionId = collectionId.substring('collection-placeholder:'.length);
    } else if (allCollections?.some(b => b.id === collectionId)) {
      realCollectionId = collectionId;
    }

    if (realCollectionId) {
      if (allCollections && getRecursiveMediaItems) {
        const collection = allCollections.find(b => b.id === realCollectionId);
        if (collection) {
          return getRecursiveMediaItems(collection);
        }
      }
    }

    return itemSequences?.[collectionId] ?? [];
  }, [allCollections, getRecursiveMediaItems, itemSequences]);

  return {
    isGallery,
    sizeFactor,
    itemHeight,
    rowHeight,
    itemCenterY,
    rulerTop,
    itemTop,
    uniformItemWidth,
    itemDurations,
    itemWidths,
    isGaplessGallery,
    itemGap,
    itemStartTimes,
    totalDurationSeconds,
    rulerTickStep,
    itemCenterPositions,
    reorderItemCenterPositions,
    itemStartPixels,
    selectedIndex,
    gridItemWidth,
    gridColStride,
    colStride,
    itemsPerRow,
    childGridItemWidth,
    wrappedRows,
    getGridRowForMedia,
    playbackGridRow,
    externalScrubGridRow,
    selectedGridRow,
    visibleGridPlayheadRow,
    selectedItemType,
    itemStride,
    finalIndex,
    finalCenterOffset,
    stripEndPixel,
    timelineOriginOffset,
    selectedScrubOriginOffset,
    verticalLineX,
    indentOffset,
    maxOffset,
    minOffset,
    resolveItemSnapshot,
    getCollectionDirectCount,
    getCollectionMediaItems,
    minGridDisplayPanelHeight,
    maxGridDisplayPanelHeight,
    boundedGridDisplayPanelHeight,
    galleryPreviewHeight,
    galleryPreviewWidth,
  };
}

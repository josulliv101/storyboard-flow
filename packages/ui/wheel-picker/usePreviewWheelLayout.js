import React from 'react';
const clamp = (value, min, max) => (Math.max(min, Math.min(max, value)));
export function usePreviewWheelLayout({ items, disabledItemIds, itemSequences, selectedMediaId, selectedItemDurationSeconds, selectedItemTrimStartSeconds, sizing, durationScale, effect, hidePreview, gridItemGap, galleryItemHeight, viewportSize, gridView, customChunks, breakoutTitles, breakoutIsCollection, breakoutRepresentativeUrls, breakoutCollectionsEnabled, breakoutNestingLevels, activePlayingMediaId, externalScrubMediaId, activeGridPlayheadRow, isPreviewPlaying, timelineWrapped, allCollections, getRecursiveMediaItems, thumbnailSize, showRuler, subRowIndex, reorderPreviewOrder, reorderPreview, playheadOffsetFromCenter, centerX, nestingLevel, gridNestingLevels, rowIndex, gridDisplayPanelHeight, gridColumnCount, }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const isGallery = effect === 'gallery';
    const sizeFactor = thumbnailSize === 'xs' ? 0.3
        : thumbnailSize === 'sm' ? 0.65
            : thumbnailSize === 'lg' ? 1.35
                : thumbnailSize === 'xl' ? 1.7
                    : 1.0;
    const minGridDisplayPanelHeight = 180;
    const maxGridDisplayPanelHeight = Math.max(minGridDisplayPanelHeight, viewportSize.height - 190);
    const boundedGridDisplayPanelHeight = clamp(gridDisplayPanelHeight, minGridDisplayPanelHeight, maxGridDisplayPanelHeight);
    const countForResponsive = gridColumnCount !== null && gridColumnCount !== void 0 ? gridColumnCount : (gridView ? items.length : undefined);
    const responsiveGridItemWidth = hidePreview && countForResponsive
        ? Math.max(1, (viewportSize.width - 16 - gridItemGap * (countForResponsive - 1)) / countForResponsive)
        : null;
    const itemHeight = React.useMemo(() => {
        return responsiveGridItemWidth !== null
            ? responsiveGridItemWidth * 9 / 16
            : isGallery
                ? galleryItemHeight
                : Math.round(clamp(sizing === 'uniform'
                    ? Math.min(viewportSize.height - 64, viewportSize.width * 0.72 * 9 / 16)
                    : viewportSize.height - 64, 220, 620) * sizeFactor);
    }, [responsiveGridItemWidth, isGallery, galleryItemHeight, sizing, viewportSize, sizeFactor]);
    const rowHeight = hidePreview
        ? showRuler
            ? (subRowIndex > 0 ? itemHeight + 8 : itemHeight + 40)
            : itemHeight
        : isGallery
            ? itemHeight + 66
            : itemHeight + 36;
    const galleryPreviewHeight = Math.max(0, Math.min(gridView ? Math.max(96, boundedGridDisplayPanelHeight - 70) : 360, viewportSize.width * 9 / 16, gridView
        ? Math.max(96, boundedGridDisplayPanelHeight - 70)
        : viewportSize.height - rowHeight - 72));
    const galleryPreviewWidth = galleryPreviewHeight * 16 / 9;
    const itemCenterY = hidePreview
        ? showRuler
            ? (subRowIndex > 0 ? itemHeight / 2 + 8 : itemHeight / 2 + 32)
            : itemHeight / 2
        : isGallery
            ? rowHeight - 12 - itemHeight / 2
            : Math.max(itemHeight / 2 + 32, viewportSize.height - itemHeight / 2 - 24);
    const rulerTop = hidePreview
        ? showRuler && subRowIndex === 0 ? 4 : 0
        : isGallery
            ? 22
            : Math.max(2, itemCenterY - itemHeight / 2 - 28);
    const itemTop = itemCenterY - itemHeight / 2;
    const uniformItemWidth = hidePreview
        ? responsiveGridItemWidth !== null && responsiveGridItemWidth !== void 0 ? responsiveGridItemWidth : Math.round(itemHeight * 16 / 9)
        : sizing === 'uniform'
            ? Math.round(itemHeight * 16 / 9)
            : Math.round(clamp(itemHeight * 1.6, 320, Math.min(760, viewportSize.width * 0.72)));
    const getMediaDuration = React.useCallback((item) => {
        var _a;
        return Math.max(0.5, (_a = item.durationSeconds) !== null && _a !== void 0 ? _a : 3);
    }, []);
    const itemDurations = React.useMemo(() => items.map(item => {
        var _a;
        if (disabledItemIds.includes(item.id))
            return 0;
        const sequence = itemSequences === null || itemSequences === void 0 ? void 0 : itemSequences[item.id];
        if (sequence === null || sequence === void 0 ? void 0 : sequence.length) {
            return sequence.reduce((total, media) => (total + (disabledItemIds.includes(media.id) ? 0 : getMediaDuration(media))), 0);
        }
        return Math.max(0.5, item.id === selectedMediaId && selectedItemDurationSeconds !== undefined
            ? selectedItemDurationSeconds
            : (_a = item.durationSeconds) !== null && _a !== void 0 ? _a : 3);
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
    const itemStartTimes = React.useMemo(() => itemDurations.map((_, index) => (itemDurations.slice(0, index).reduce((sum, duration) => sum + duration, 0))), [itemDurations]);
    const totalDurationSeconds = itemDurations.reduce((sum, duration) => sum + duration, 0);
    const rulerTickStep = React.useMemo(() => {
        var _a;
        const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
        return (_a = candidates.find(step => (step * durationPixelsPerSecond >= 52 && totalDurationSeconds / step <= 300))) !== null && _a !== void 0 ? _a : candidates[candidates.length - 1];
    }, [durationPixelsPerSecond, totalDurationSeconds]);
    const itemCenterPositions = React.useMemo(() => {
        const positions = [];
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
        if (!reorderPreviewOrder)
            return null;
        const positions = new Map();
        let center = 0;
        reorderPreviewOrder.forEach((mediaId, orderIndex) => {
            var _a, _b;
            const itemIndex = items.findIndex(item => item.id === mediaId);
            const width = (_a = itemWidths[itemIndex]) !== null && _a !== void 0 ? _a : uniformItemWidth;
            if (orderIndex > 0) {
                const previousId = reorderPreviewOrder[orderIndex - 1];
                const previousIndex = items.findIndex(item => item.id === previousId);
                const previousWidth = (_b = itemWidths[previousIndex]) !== null && _b !== void 0 ? _b : uniformItemWidth;
                center += previousWidth / 2 + itemGap + width / 2;
            }
            positions.set(mediaId, center);
        });
        return positions;
    }, [itemGap, itemWidths, items, reorderPreviewOrder, uniformItemWidth]);
    const itemStartPixels = React.useMemo(() => {
        var _a;
        const firstItemHalfWidth = ((_a = itemWidths[0]) !== null && _a !== void 0 ? _a : 0) / 2;
        return itemWidths.map((width, index) => {
            var _a;
            return (((_a = itemCenterPositions[index]) !== null && _a !== void 0 ? _a : 0) + firstItemHalfWidth - width / 2);
        });
    }, [itemCenterPositions, itemWidths]);
    const selectedIndex = React.useMemo(() => (items.findIndex(item => item.id === selectedMediaId)), [items, selectedMediaId]);
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
        if (!gridView)
            return [];
        const result = [];
        if (customChunks) {
            customChunks.forEach((originalChunk, parentIndex) => {
                var _a;
                const title = breakoutTitles === null || breakoutTitles === void 0 ? void 0 : breakoutTitles[parentIndex];
                const isCollection = breakoutIsCollection === null || breakoutIsCollection === void 0 ? void 0 : breakoutIsCollection[parentIndex];
                const repUrl = breakoutRepresentativeUrls === null || breakoutRepresentativeUrls === void 0 ? void 0 : breakoutRepresentativeUrls[parentIndex];
                const nestingLevel = (_a = breakoutNestingLevels === null || breakoutNestingLevels === void 0 ? void 0 : breakoutNestingLevels[parentIndex]) !== null && _a !== void 0 ? _a : (parentIndex > 0 ? 1 : 0);
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
                }
                else {
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
        }
        else {
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
            }
            else {
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
    const getGridRowForMedia = React.useCallback((mediaId) => {
        if (!mediaId)
            return -1;
        return wrappedRows.findIndex(row => row.items.some(item => {
            var _a;
            return (item.id === mediaId ||
                ((_a = itemSequences === null || itemSequences === void 0 ? void 0 : itemSequences[item.id]) === null || _a === void 0 ? void 0 : _a.some(sequenceItem => sequenceItem.id === mediaId)) ||
                (item.id.startsWith('collection-placeholder:') && (() => {
                    const collectionId = item.id.slice('collection-placeholder:'.length);
                    const col = allCollections === null || allCollections === void 0 ? void 0 : allCollections.find(b => b.id === collectionId);
                    return col && getRecursiveMediaItems ? getRecursiveMediaItems(col).some(m => m.id === mediaId) : false;
                })()));
        }));
    }, [wrappedRows, itemSequences, allCollections, getRecursiveMediaItems]);
    const playbackGridRow = getGridRowForMedia(activePlayingMediaId);
    const externalScrubGridRow = getGridRowForMedia(externalScrubMediaId);
    const selectedGridRow = getGridRowForMedia(selectedMediaId);
    const visibleGridPlayheadRow = isPreviewPlaying && playbackGridRow >= 0
        ? playbackGridRow
        : externalScrubGridRow >= 0
            ? externalScrubGridRow
            : activeGridPlayheadRow !== null && activeGridPlayheadRow !== void 0 ? activeGridPlayheadRow : Math.max(0, selectedGridRow);
    const selectedItemType = (_a = items[selectedIndex]) === null || _a === void 0 ? void 0 : _a.type;
    const itemStride = uniformItemWidth + itemGap;
    const finalIndex = items.length - 1;
    const finalCenterOffset = -((_b = itemCenterPositions[finalIndex]) !== null && _b !== void 0 ? _b : 0);
    const stripEndPixel = ((_c = itemStartPixels[finalIndex]) !== null && _c !== void 0 ? _c : 0) + ((_d = itemWidths[finalIndex]) !== null && _d !== void 0 ? _d : 0);
    const timelineOriginOffset = ((_e = itemWidths[0]) !== null && _e !== void 0 ? _e : 0) / 2;
    const selectedScrubOriginOffset = selectedIndex >= 0
        ? ((_f = itemStartPixels[selectedIndex]) !== null && _f !== void 0 ? _f : 0) - ((_g = itemCenterPositions[selectedIndex]) !== null && _g !== void 0 ? _g : 0)
        : 0;
    const verticalLineX = childGridItemWidth / 2 + 8;
    const indentOffset = nestingLevel > 0 ? (nestingLevel * (childGridItemWidth + gridItemGap) + 8) : 8;
    const maxOffset = hidePreview
        ? indentOffset - centerX + (uniformItemWidth / 2) - playheadOffsetFromCenter
        : (sizing === 'duration')
            ? timelineOriginOffset
            : (sizing === 'uniform')
                ? Math.max(centerX - (((_h = itemWidths[0]) !== null && _h !== void 0 ? _h : uniformItemWidth) / 2), centerX - (((_j = itemWidths[0]) !== null && _j !== void 0 ? _j : uniformItemWidth) / 2) - playheadOffsetFromCenter) + 120
                : isGallery
                    ? timelineOriginOffset
                    : Math.max(0, selectedScrubOriginOffset);
    const minOffset = hidePreview
        ? Math.min(maxOffset, viewportSize.width - stripEndPixel - 8 - centerX + (uniformItemWidth / 2) - playheadOffsetFromCenter)
        : (sizing === 'duration')
            ? timelineOriginOffset - stripEndPixel
            : (sizing === 'uniform')
                ? Math.min(-centerX - (((_k = itemCenterPositions[finalIndex]) !== null && _k !== void 0 ? _k : 0) - ((_l = itemWidths[finalIndex]) !== null && _l !== void 0 ? _l : uniformItemWidth) / 2), -itemCenterPositions[finalIndex] - playheadOffsetFromCenter) + 120 - stripEndPixel
                : isGallery
                    ? timelineOriginOffset - stripEndPixel
                    : Math.min(maxOffset, viewportSize.width - stripEndPixel - 8 - centerX + (uniformItemWidth / 2) - playheadOffsetFromCenter);
    const resolveItemSnapshot = React.useCallback((item, elapsedSeconds) => {
        var _a, _b, _c, _d;
        const sequence = (_a = itemSequences === null || itemSequences === void 0 ? void 0 : itemSequences[item.id]) === null || _a === void 0 ? void 0 : _a.filter(media => !disabledItemIds.includes(media.id));
        if (!(sequence === null || sequence === void 0 ? void 0 : sequence.length)) {
            return {
                media: item,
                sourceTimeSeconds: item.type === 'video'
                    ? Math.max(0, (_b = item.trimStartSeconds) !== null && _b !== void 0 ? _b : 0) + elapsedSeconds
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
                        ? Math.max(0, (_c = media.trimStartSeconds) !== null && _c !== void 0 ? _c : 0) + remaining
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
                ? Math.max(0, (_d = media.trimStartSeconds) !== null && _d !== void 0 ? _d : 0) + Math.max(0, duration - 0.001)
                : 0,
        };
    }, [disabledItemIds, getMediaDuration, itemSequences]);
    const getCollectionDirectCount = React.useCallback((itemId) => {
        var _a, _b, _c, _d;
        let collectionId = '';
        if (itemId.startsWith('collection-placeholder:')) {
            collectionId = itemId.substring('collection-placeholder:'.length);
        }
        else if (allCollections === null || allCollections === void 0 ? void 0 : allCollections.some(b => b.id === itemId)) {
            collectionId = itemId;
        }
        if (collectionId) {
            const collection = allCollections === null || allCollections === void 0 ? void 0 : allCollections.find(b => b.id === collectionId);
            if (collection) {
                return (_b = (_a = collection.gridOrder) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0;
            }
        }
        return (_d = (_c = itemSequences === null || itemSequences === void 0 ? void 0 : itemSequences[itemId]) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0;
    }, [allCollections, itemSequences]);
    const getCollectionMediaItems = React.useCallback((collectionId) => {
        var _a;
        let realCollectionId = '';
        if (collectionId.startsWith('collection-placeholder:')) {
            realCollectionId = collectionId.substring('collection-placeholder:'.length);
        }
        else if (allCollections === null || allCollections === void 0 ? void 0 : allCollections.some(b => b.id === collectionId)) {
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
        return (_a = itemSequences === null || itemSequences === void 0 ? void 0 : itemSequences[collectionId]) !== null && _a !== void 0 ? _a : [];
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

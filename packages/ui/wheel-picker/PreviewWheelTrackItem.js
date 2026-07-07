import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from 'react';
import { usePreviewWheelSettings } from './SceneLaunchPreviewWheelV3';
import { TimelineRuler } from './TimelineRuler';
import { PreviewWheelMediaTile } from './PreviewWheelMediaTile';
const degreesToRadians = (value) => (value * Math.PI) / 180;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function PreviewWheelTrackItem({ item, index, items, layout, playback, dragDrop, actions, }) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    // Consume configurations from settings Context
    const { sizing, effect, thumbnailSize, disabledItemIds, collectionItemIds, collectionMultiCircleEnabled, isGaplessGallery, showRuler, showUniformRuler, rulerTickStep, rulerTop, hidePreview, selectedMediaId, itemSequenceThumbnails, } = usePreviewWheelSettings();
    // Destructure layout metrics
    const { uniformItemWidth, itemGap, itemStride, itemHeight, itemCenterY, viewportSize, itemWidths, itemCenterPositions, itemStartTimes, itemDurations, itemStartPixels, reorderItemCenterPositions, timelineOriginOffset, finalIndex, stripEndPixel, centeredIndex, } = layout;
    // Destructure playback parameters
    const { activePlayingMediaId, activePlayingElapsedSeconds, playbackSnapshotTime, scrubSnapshot, effectiveScrubSnapshot, renderedPlayheadX, playheadX, playbackTimeRef, skipNextSelectedAlignmentRef, setTrimOverlayMediaId, isPreviewPlaying, } = playback;
    // Destructure drag drop variables
    const { isDragging, isSnapping, isWheelMoving, dragRef, clickGuardRef, reorderPreview, collectionDropTargetId, snapCompletionRef, offset, offsetRef, } = dragDrop;
    // Destructure actions callbacks
    const { snapToIndex, setDirectPreviewMediaId, updateFastNavigation, setGridPlayheadRatio, onCenteredMediaChange, onCollectionOpen, getCollectionMediaItems, getCollectionDirectCount, renderSelectedItemOverlay, onSelectedItemDurationChange, beginDurationResize, handleDurationResizeKey, slideOnClick, selectItemsWhilePreviewHidden, syncPreviewToPlayhead, } = actions;
    const thumbnailItem = scrubSnapshot
        ? (_b = (_a = itemSequenceThumbnails === null || itemSequenceThumbnails === void 0 ? void 0 : itemSequenceThumbnails[item.id]) === null || _a === void 0 ? void 0 : _a[scrubSnapshot.media.id]) !== null && _b !== void 0 ? _b : item
        : item;
    const itemWidth = (_c = itemWidths[index]) !== null && _c !== void 0 ? _c : uniformItemWidth;
    const itemCenterOffset = ((_e = (_d = reorderItemCenterPositions === null || reorderItemCenterPositions === void 0 ? void 0 : reorderItemCenterPositions.get(item.id)) !== null && _d !== void 0 ? _d : itemCenterPositions[index]) !== null && _e !== void 0 ? _e : 0) + offset;
    const offsetFromCenter = itemCenterOffset / itemStride;
    const absOffsetFromCenter = Math.abs(offsetFromCenter);
    const distance = Math.min(4, absOffsetFromCenter);
    const isActive = item.id === selectedMediaId;
    const itemDuration = (_f = itemDurations[index]) !== null && _f !== void 0 ? _f : 0.5;
    const itemStartTime = (_g = itemStartTimes[index]) !== null && _g !== void 0 ? _g : 0;
    const itemEndTime = itemStartTime + itemDuration;
    const progressTimelineTime = (_h = scrubSnapshot === null || scrubSnapshot === void 0 ? void 0 : scrubSnapshot.timelineTimeSeconds) !== null && _h !== void 0 ? _h : 0;
    const isCurrentPlaying = activePlayingMediaId !== null && item.id === activePlayingMediaId;
    const itemElapsedSeconds = isCurrentPlaying
        ? activePlayingElapsedSeconds
        : clamp(progressTimelineTime - itemStartTime, 0, itemDuration);
    const itemProgress = itemDuration > 0
        ? clamp(itemElapsedSeconds / itemDuration, 0, 1)
        : 0;
    const isItemProgressPlaying = isCurrentPlaying
        ? isPreviewPlaying
        : isPreviewPlaying &&
            itemDuration > 0 &&
            progressTimelineTime >= itemStartTime &&
            progressTimelineTime < itemEndTime;
    let x = itemCenterOffset + layout.centerX; // centerX is inside layout
    let z = 0;
    let rotateY = 0;
    let translateY = 0;
    let scale = 1 - distance * 0.035;
    let opacity = Math.max(0.32, 1 - distance * 0.14);
    let brightness = Math.max(0.68, 1 - distance * 0.07);
    let shouldRender = absOffsetFromCenter < 4.2;
    if (effect === 'cylinder') {
        const angle = clamp(offsetFromCenter * 54 / 2, -54, 54);
        const angleRadians = degreesToRadians(angle);
        const radius = itemStride * 3.05;
        x = Math.sin(angleRadians) * radius + layout.centerX;
        z = (Math.cos(angleRadians) - 1) * radius * 0.72;
        rotateY = -angle;
        translateY = distance * 4;
        scale = 1 - distance * 0.04;
        opacity = Math.max(0.2, 1 - distance * 0.18);
        brightness = Math.max(0.62, 1 - distance * 0.08);
        shouldRender = absOffsetFromCenter < 3.35;
    }
    else if (effect === 'cylinder2') {
        const angle = clamp(offsetFromCenter * 20, -54, 54);
        const angleRadians = degreesToRadians(angle);
        const radius = itemStride * 2.9;
        const centeredItemWidth = (_j = itemWidths[centeredIndex]) !== null && _j !== void 0 ? _j : uniformItemWidth;
        const minimumCenterSpacing = (itemWidth + centeredItemWidth) / 2 + itemGap;
        x = Math.sin(angleRadians) * radius;
        if (absOffsetFromCenter >= 0.5) {
            x =
                Math.sign(offsetFromCenter) *
                    Math.max(Math.abs(x), minimumCenterSpacing +
                        Math.max(0, absOffsetFromCenter - 1) * itemWidth * 0.74);
        }
        x += layout.centerX;
        z = (Math.cos(angleRadians) - 1) * radius * 0.36;
        rotateY = -angle * 0.18;
        translateY = 0;
        scale = 1 - distance * 0.065;
        opacity = Math.max(0.16, 1 - distance * 0.22);
        brightness = Math.max(0.54, 1 - distance * 0.1);
        shouldRender = absOffsetFromCenter < 3.7;
    }
    else if (effect === 'coverflow') {
        x = itemCenterOffset * 0.82 + layout.centerX;
        z = -distance * 74;
        rotateY = clamp(offsetFromCenter * -36, -58, 58);
        translateY = distance * 5;
        scale = 1 - distance * 0.055;
        opacity = Math.max(0.3, 1 - distance * 0.15);
        brightness = Math.max(0.66, 1 - distance * 0.075);
    }
    else if (effect === 'gallery') {
        scale = 1;
        translateY = 0;
    }
    else if (effect === 'stack') {
        x = itemCenterOffset * 0.58 + layout.centerX;
        z = -distance * 96;
        rotateY = clamp(offsetFromCenter * -10, -20, 20);
        translateY = distance * 7;
        scale = 1 - distance * 0.08;
        opacity = Math.max(0.24, 1 - distance * 0.2);
        brightness = Math.max(0.58, 1 - distance * 0.1);
        shouldRender = absOffsetFromCenter < 4.8;
    }
    if (sizing === 'uniform') {
        opacity = 1;
        brightness = 1;
    }
    if (sizing === 'uniform' || effect === 'gallery') {
        shouldRender = true;
    }
    return (_jsxs(React.Fragment, { children: [showRuler && (sizing === 'duration' || (sizing === 'uniform' && showUniformRuler)) && (_jsx(TimelineRuler, { itemWidth: itemWidth, itemStartTime: itemStartTime, itemDuration: itemDuration, itemEndTime: itemEndTime, rulerTickStep: rulerTickStep, rulerTop: rulerTop, opacity: opacity, effect: effect, x: x, z: z, rotateY: rotateY, scale: scale, distance: distance, isLastItem: index === items.length - 1 })), _jsx(PreviewWheelMediaTile, { item: item, index: index, thumbnailItem: thumbnailItem, isActive: isActive, disabled: disabledItemIds.includes(item.id), isCollection: collectionItemIds.includes(item.id), collectionMultiCircleEnabled: collectionMultiCircleEnabled, collectionMediaItems: getCollectionMediaItems(item.id), collectionDirectCount: getCollectionDirectCount(item.id), itemSequenceThumbnails: itemSequenceThumbnails, thumbnailSize: thumbnailSize, reorderPreviewActive: (reorderPreview === null || reorderPreview === void 0 ? void 0 : reorderPreview.mediaId) === item.id, brightness: brightness, opacity: opacity, x: x, translateY: translateY, z: z, rotateY: rotateY, scale: scale, shouldRender: shouldRender, itemProgress: itemProgress, isItemProgressPlaying: isItemProgressPlaying, progressTimelineTime: progressTimelineTime, layout: layout, playback: playback, dragDrop: dragDrop, actions: actions, onTransitionEnd: (event) => {
                    const completion = snapCompletionRef.current;
                    if (event.target === event.currentTarget &&
                        event.propertyName === 'transform' &&
                        (completion === null || completion === void 0 ? void 0 : completion.mediaId) === item.id) {
                        completion.finish();
                    }
                } })] }));
}

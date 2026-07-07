"use client";
import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Clapperboard, Folder, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { PreviewWheelPlayer } from './PreviewWheelPlayer';
import { PreviewWheelPlayhead } from './PreviewWheelPlayhead';
import { PreviewWheelReorderPortal } from './PreviewWheelReorderPortal';
import { PreviewWheelGridView } from './PreviewWheelGridView';
import { PreviewWheelNestingGuides } from './PreviewWheelNestingGuides';
import { usePreviewWheelLayout } from './usePreviewWheelLayout';
import { usePreviewWheelPlayback } from './usePreviewWheelPlayback';
import { usePreviewWheelDragDrop } from './usePreviewWheelDragDrop';
import { PreviewWheelTrackItem } from './PreviewWheelTrackItem';
import { PreviewWheelAdjacentPreviewItem } from './PreviewWheelAdjacentPreviewItem';
import { PreviewWheelHeaderControls } from './PreviewWheelHeaderControls';
export const VIDEO_PLACEHOLDER = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'><rect width='100%' height='100%' fill='%2309090b'/><g fill='%2327272a'><path d='M150 120h60a8 8 0 0 1 8 8v44a8 8 0 0 1-8 8h-60a8 8 0 0 1-8-8v-44a8 8 0 0 1 8-8z'/><path d='M226 130l24-15v50l-24-15z'/></g></svg>";
const ITEM_GAP = 24;
const DRAG_SELECT_THRESHOLD = 5;
const REORDER_LIFT_THRESHOLD = 24;
const DROP_SETTLE_DURATION_MS = 180;
const REORDER_LIFT_HOLD_MS = 200;
const REORDER_SHRINK_DURATION_MS = 180;
const PREPARED_PREVIEW_HANDOFF_MS = 900;
const REORDER_EDGE_ZONE_MAX_PX = 140;
const REORDER_AUTO_PAN_MAX_PX_PER_FRAME = 16;
const MOMENTUM_MIN_VELOCITY = 0.035;
const MOMENTUM_FRICTION_PER_FRAME = 0.945;
const SNAP_DURATION_MS = 420;
const FAST_NAVIGATION_ENTER_VELOCITY = 0.9;
const FAST_NAVIGATION_EXIT_VELOCITY = 0.45;
const FAST_NAVIGATION_IDLE_RESET_MS = 120;
const MAX_WHEEL_ANGLE = 54;
const DURATION_REFERENCE_SECONDS = 3;
const MAX_IMAGE_DURATION_SECONDS = 60 * 60;
const GALLERY_ITEM_HEIGHT = 120;
export const PreviewWheelSettingsContext = React.createContext(null);
export const usePreviewWheelSettings = () => {
    const context = React.useContext(PreviewWheelSettingsContext);
    if (!context) {
        throw new Error('usePreviewWheelSettings must be used within a PreviewWheelSettingsProvider');
    }
    return context;
};
const clamp = (value, min, max) => (Math.max(min, Math.min(max, value)));
const getNearestIndexForOffset = (offset, centerPositions) => {
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    centerPositions.forEach((position, index) => {
        const distance = Math.abs(position + offset);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestIndex = index;
        }
    });
    return nearestIndex;
};
const degreesToRadians = (value) => (value * Math.PI / 180);
const formatRulerSeconds = (seconds) => (`${Number(seconds.toFixed(1))}s`);
const formatPlaybackTime = (seconds) => {
    const totalTenths = Math.round(Math.max(0, seconds) * 10);
    const minutes = Math.floor(totalTenths / 600);
    const remainingSeconds = (totalTenths % 600) / 10;
    return `${String(minutes).padStart(2, '0')}:${remainingSeconds.toFixed(1).padStart(4, '0')}`;
};
const formatPlaybackTimestamp = (currentSeconds, totalSeconds) => (`${formatPlaybackTime(currentSeconds)} / ${formatPlaybackTime(totalSeconds)}`);
export function SceneLaunchPreviewWheelV3({ items, itemSequences, itemSequenceThumbnails, onCollectionOpen, canNavigateBack = false, onNavigateBack, parentCollectionThumbnailUrl, parentCollectionName, breadcrumbs, onBreadcrumbClick, selectedMediaId, effect, sizing, durationScale, selectedItemDurationSeconds, selectedItemTrimStartSeconds, onSelectedItemDurationChange, onSelectedItemDurationChangeEnd, onCenteredMediaChange, renderSelectedItemOverlay, renderGalleryTrimOverlay, customChunks, breakoutTitles, breakoutIsCollection, breakoutRepresentativeUrls, currentCollectionName, breakoutCollectionsEnabled = false, breakoutSelectedMediaIds, allCollections, getRecursiveMediaItems, onBreakoutCollectionsChange, timelineWrapped = false, onTimelineWrappedChange, prevRowPreviewItem, nextRowPreviewItem, subRowIndex = 0, breakoutNestingLevels, breakoutNestingDepth = 1, onBreakoutNestingDepthChange, nestingLevel = 0, gridNestingLevels = [], rowIndex = 0, minimized = false, rowTitle, rowIsCollection, isFirstGridRow = false, isIndented = false, isLastGridRow = false, isPreviewPlaying = false, loopPreviewPlayback = false, onPreviewPlaybackComplete, onPlaybackMediaChange, onItemsReorder, collectionItemIds = [], onItemMoveIntoCollection, disabledItemIds = [], onUtilityDrop, selectReorderedItem = true, onTogglePlayback, onToggleLoop, showUniformRuler = true, showRuler = true, slideOnClick = true, gridView = false, gridColumnCount, showPlayhead = true, playheadIsPlaying, hidePreview = false, hideTrack = false, freeDrag = false, selectItemsWhilePreviewHidden = false, showSelectedTrimOverlay = false, syncPreviewToPlayhead = false, activePlayingMediaId = null, activePlayingElapsedSeconds = 0, onPlaybackTimeUpdate, externalScrubMediaId = null, externalScrubSourceTime = null, externalScrubTimelineTime = null, onScrubUpdate, thumbnailSize = 'md', collectionMultiCircleEnabled = false, }) {
    var _a, _b, _c, _d, _e;
    const shouldShowPlayhead = showPlayhead && !minimized;
    const containerResizeObserverRef = React.useRef(null);
    const viewportResizeObserverRef = React.useRef(null);
    const viewportRef = React.useRef(null);
    const freeDragInitializedRef = React.useRef(false);
    const [viewportSize, setViewportSize] = React.useState({ width: 960, height: 520 });
    const containerRefCallback = React.useCallback((node) => {
        if (containerResizeObserverRef.current) {
            containerResizeObserverRef.current.disconnect();
            containerResizeObserverRef.current = null;
        }
        if (node) {
            const updateSize = () => {
                const bounds = node.getBoundingClientRect();
                setViewportSize(prev => {
                    const nextWidth = node.clientWidth || bounds.width || prev.width;
                    const nextHeight = bounds.height || 520;
                    if (prev.width === nextWidth && prev.height === nextHeight)
                        return prev;
                    return { width: nextWidth, height: nextHeight };
                });
            };
            updateSize();
            if (typeof ResizeObserver !== 'undefined') {
                const observer = new ResizeObserver(updateSize);
                observer.observe(node);
                containerResizeObserverRef.current = observer;
            }
        }
    }, []);
    const viewportRefCallback = React.useCallback((node) => {
        viewportRef.current = node;
        if (viewportResizeObserverRef.current) {
            viewportResizeObserverRef.current.disconnect();
            viewportResizeObserverRef.current = null;
        }
        if (node) {
            const updateSize = () => {
                const bounds = node.getBoundingClientRect();
                setViewportSize(prev => {
                    const nextWidth = node.clientWidth || bounds.width || 960;
                    if (prev.width === nextWidth)
                        return prev;
                    return Object.assign(Object.assign({}, prev), { width: nextWidth });
                });
            };
            updateSize();
            if (typeof ResizeObserver !== 'undefined') {
                const observer = new ResizeObserver(updateSize);
                observer.observe(node);
                viewportResizeObserverRef.current = observer;
            }
        }
    }, []);
    const galleryPreviewRef = React.useRef(null);
    const trimOverlayRef = React.useRef(null);
    const reorderGhostRef = React.useRef(null);
    const reorderGhostContentRef = React.useRef(null);
    const playbackTimeRef = React.useRef(0);
    const wasPreviewPlayingRef = React.useRef(false);
    const playbackSelectedMediaIdRef = React.useRef(selectedMediaId);
    const playbackResolvedMediaKeyRef = React.useRef(null);
    const offsetRef = React.useRef(0);
    const preparedPreviewMediaIdRef = React.useRef(null);
    const preparedPreviewHandoffTimeoutRef = React.useRef(null);
    const activeGridScrubRowRef = React.useRef(null);
    const prominentTimestampRef = React.useRef(null);
    const [reorderPreview, setReorderPreview] = React.useState(null);
    const [reorderPreviewOrder, setReorderPreviewOrder] = React.useState(null);
    const dragRef = React.useRef({
        isDragging: false,
        startX: 0,
        startY: 0,
        startOffset: 0,
        lastX: 0,
        lastTime: 0,
        pointerId: -1,
        didMove: false,
        velocity: 0,
        targetMediaId: null,
        mode: 'pending',
        lastReorderTarget: null,
        reorderTargetMediaId: null,
        reorderPosition: null,
        utilityAction: null,
    });
    const clickGuardRef = React.useRef(false);
    const [offset, setOffsetState] = React.useState(0);
    const [activeGridPlayheadRow, setActiveGridPlayheadRow] = React.useState(null);
    const [gridPlayheadRatio, setGridPlayheadRatio] = React.useState(null);
    const [rulerHoveredX, setRulerHoveredX] = React.useState(null);
    const handleRulerMouseMove = React.useCallback((event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setRulerHoveredX(event.clientX - rect.left);
    }, []);
    const handleRulerMouseLeave = React.useCallback(() => {
        setRulerHoveredX(null);
    }, []);
    const isSharedPlayheadPlaying = playheadIsPlaying !== null && playheadIsPlaying !== void 0 ? playheadIsPlaying : isPreviewPlaying;
    React.useLayoutEffect(() => {
        const content = reorderGhostContentRef.current;
        if (!reorderPreview || !content || window.matchMedia('(prefers-reduced-motion: reduce)').matches)
            return;
        const animation = content.animate([
            { transform: `scale(${reorderPreview.liftScale})`, offset: 0 },
            {
                transform: `scale(${reorderPreview.liftScale})`,
                offset: REORDER_LIFT_HOLD_MS / (REORDER_LIFT_HOLD_MS + REORDER_SHRINK_DURATION_MS),
                easing: 'cubic-bezier(0.42, 0, 1, 1)',
            },
            { transform: 'scale(1)' },
        ], {
            duration: REORDER_LIFT_HOLD_MS + REORDER_SHRINK_DURATION_MS,
            easing: 'linear',
            fill: 'both',
        });
        return () => animation.cancel();
    }, [reorderPreview]);
    const [preparedPreviewMediaId, setPreparedPreviewMediaId] = React.useState(null);
    const [preparedPreviewReady, setPreparedPreviewReady] = React.useState(false);
    const [visiblePreparedPreviewMediaId, setVisiblePreparedPreviewMediaId] = React.useState(null);
    const [directPreviewMediaId, setDirectPreviewMediaId] = React.useState(selectedMediaId);
    const [trimOverlayMediaId, setTrimOverlayMediaIdState] = React.useState(null);
    const trimOverlayMediaIdRef = React.useRef(null);
    const setTrimOverlayMediaId = React.useCallback((value) => {
        trimOverlayMediaIdRef.current = value;
        setTrimOverlayMediaIdState(value);
    }, []);
    const playheadPositionRatioRef = React.useRef(0.5);
    const [playheadPositionRatio, setPlayheadPositionRatio] = React.useState(0.5);
    const gridPanelResizeRef = React.useRef({
        isDragging: false,
        pointerId: -1,
        startClientY: 0,
        startHeight: 280,
    });
    const [isGridPanelResizing, setIsGridPanelResizing] = React.useState(false);
    const [gridDisplayPanelHeight, setGridDisplayPanelHeight] = React.useState(() => {
        if (typeof window === 'undefined')
            return 280;
        const savedHeight = Number(localStorage.getItem('scene-launch-grid-display-panel-height'));
        return Number.isFinite(savedHeight) ? savedHeight : 280;
    });
    React.useEffect(() => {
        if (hidePreview)
            return;
        const savedPosition = Number(localStorage.getItem('scene-launch-playhead-position'));
        const nextPosition = Number.isFinite(savedPosition) && savedPosition > 0 && savedPosition < 1
            ? savedPosition
            : localStorage.getItem('scene-launch-playhead-alignment') === 'left'
                ? 0.1
                : null;
        if (nextPosition === null)
            return;
        const frame = window.requestAnimationFrame(() => {
            playheadPositionRatioRef.current = nextPosition;
            setPlayheadPositionRatio(nextPosition);
        });
        return () => window.cancelAnimationFrame(frame);
    }, [hidePreview]);
    const centerPlayhead = React.useCallback(() => {
        playheadPositionRatioRef.current = 0.5;
        setPlayheadPositionRatio(0.5);
        localStorage.setItem('scene-launch-playhead-position', '0.5');
    }, []);
    React.useEffect(() => {
        if (!trimOverlayMediaId)
            return;
        const handleOutsidePointerDown = (event) => {
            var _a;
            const target = event.target;
            if (target instanceof Node && !((_a = trimOverlayRef.current) === null || _a === void 0 ? void 0 : _a.contains(target))) {
                setTrimOverlayMediaId(null);
            }
        };
        document.addEventListener('pointerdown', handleOutsidePointerDown, true);
        return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    }, [trimOverlayMediaId]);
    const gridItemGap = 6;
    const galleryItemHeight = thumbnailSize === 'xs' ? 40
        : thumbnailSize === 'sm' ? 80
            : thumbnailSize === 'lg' ? 160
                : thumbnailSize === 'xl' ? 200
                    : 120; // 'md'
    const centerX = viewportSize.width > 0 ? viewportSize.width / 2 : 480;
    const playheadX = clamp(viewportSize.width * playheadPositionRatio, 32, Math.max(32, viewportSize.width - 32));
    const playheadOffsetFromCenter = playheadX - centerX;
    const { isGallery, sizeFactor, itemHeight, rowHeight, itemCenterY, rulerTop, itemTop, uniformItemWidth, itemDurations, itemWidths, isGaplessGallery, itemGap, itemStartTimes, totalDurationSeconds, rulerTickStep, itemCenterPositions, reorderItemCenterPositions, itemStartPixels, selectedIndex, gridItemWidth, gridColStride, colStride, itemsPerRow, childGridItemWidth, wrappedRows, getGridRowForMedia, playbackGridRow, externalScrubGridRow, selectedGridRow, visibleGridPlayheadRow, selectedItemType, itemStride, finalIndex, finalCenterOffset, stripEndPixel, timelineOriginOffset, selectedScrubOriginOffset, verticalLineX, indentOffset, maxOffset, minOffset, resolveItemSnapshot, getCollectionDirectCount, getCollectionMediaItems, minGridDisplayPanelHeight, maxGridDisplayPanelHeight, boundedGridDisplayPanelHeight, galleryPreviewHeight, galleryPreviewWidth, } = usePreviewWheelLayout({
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
        offset,
        playheadOffsetFromCenter,
        centerX,
        nestingLevel,
        gridNestingLevels,
        rowIndex,
        gridDisplayPanelHeight,
        gridColumnCount,
    });
    const [playbackSnapshotTime, setPlaybackSnapshotTime] = React.useState(null);
    const snapReferencePositions = React.useMemo(() => ((sizing === 'duration' || isGallery)
        ? itemStartPixels.map(startPixel => startPixel - timelineOriginOffset)
        : itemCenterPositions), [itemCenterPositions, itemStartPixels, sizing, isGallery, timelineOriginOffset]);
    const gridLeftAlignOffset = hidePreview
        ? clamp(indentOffset - centerX + (uniformItemWidth / 2) - playheadOffsetFromCenter, minOffset, maxOffset)
        : maxOffset;
    const onScrubUpdateRef = React.useRef(onScrubUpdate);
    React.useEffect(() => { onScrubUpdateRef.current = onScrubUpdate; }, [onScrubUpdate]);
    const activePlayingIndex = activePlayingMediaId
        ? items.findIndex(item => item.id === activePlayingMediaId)
        : -1;
    const activePlayingProgress = activePlayingIndex >= 0
        ? clamp(activePlayingElapsedSeconds / Math.max(0.001, (_a = itemDurations[activePlayingIndex]) !== null && _a !== void 0 ? _a : 0.5), 0, 1)
        : 0;
    const playbackPlayheadX = activePlayingIndex >= 0
        ? playheadX + offset + ((_b = itemStartPixels[activePlayingIndex]) !== null && _b !== void 0 ? _b : 0) - timelineOriginOffset +
            activePlayingProgress * ((_c = itemWidths[activePlayingIndex]) !== null && _c !== void 0 ? _c : 0)
        : playheadX;
    const renderedPlayheadX = isSharedPlayheadPlaying && activePlayingIndex >= 0
        ? playbackPlayheadX
        : hidePreview && gridPlayheadRatio !== null
            ? gridPlayheadRatio * viewportSize.width
            : playheadX;
    const stripVisualLeft = playheadX + offset - timelineOriginOffset;
    const scrubSnapshot = React.useMemo(() => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
        if (selectedIndex < 0 || items.length === 0)
            return null;
        if (isPreviewPlaying && playbackSnapshotTime !== null) {
            const timelineTimeSeconds = clamp(playbackSnapshotTime, 0, totalDurationSeconds);
            let playbackIndex = finalIndex;
            for (let index = 0; index < itemDurations.length; index += 1) {
                const itemEndTime = ((_a = itemStartTimes[index]) !== null && _a !== void 0 ? _a : 0) + ((_b = itemDurations[index]) !== null && _b !== void 0 ? _b : 0.5);
                if (timelineTimeSeconds < itemEndTime) {
                    playbackIndex = index;
                    break;
                }
            }
            const media = items[playbackIndex];
            if (media) {
                const elapsedSeconds = Math.max(0, timelineTimeSeconds - ((_c = itemStartTimes[playbackIndex]) !== null && _c !== void 0 ? _c : 0));
                return Object.assign(Object.assign({}, resolveItemSnapshot(media, elapsedSeconds)), { timelineTimeSeconds });
            }
        }
        if (directPreviewMediaId && !isPreviewPlaying && !syncPreviewToPlayhead) {
            const directIndex = items.findIndex(item => item.id === directPreviewMediaId);
            const media = items[directIndex];
            if (media && !disabledItemIds.includes(media.id)) {
                const resolved = resolveItemSnapshot(media, 0);
                return Object.assign(Object.assign({}, resolved), { timelineTimeSeconds: (_d = itemStartTimes[directIndex]) !== null && _d !== void 0 ? _d : 0 });
            }
        }
        const playheadPixel = clamp(hidePreview
            ? renderedPlayheadX - playheadX - offset + timelineOriginOffset
            : (sizing === 'duration' || isGallery) ? timelineOriginOffset - offset : -offset, 0, stripEndPixel);
        let scrubbedIndex = finalIndex;
        for (let index = 0; index < items.length; index += 1) {
            const itemStartPixel = (_e = itemStartPixels[index]) !== null && _e !== void 0 ? _e : 0;
            const itemEndPixel = ((_f = itemStartPixels[index]) !== null && _f !== void 0 ? _f : 0) + ((_g = itemWidths[index]) !== null && _g !== void 0 ? _g : 0);
            if (playheadPixel < itemStartPixel) {
                scrubbedIndex = Math.max(0, index - 1);
                break;
            }
            if (playheadPixel <= itemEndPixel) {
                scrubbedIndex = index;
                break;
            }
        }
        if (disabledItemIds.includes((_h = items[scrubbedIndex]) === null || _h === void 0 ? void 0 : _h.id)) {
            const nextEnabled = items.findIndex((candidate, index) => index > scrubbedIndex && !disabledItemIds.includes(candidate.id));
            if (nextEnabled >= 0) {
                scrubbedIndex = nextEnabled;
            }
            else {
                for (let index = scrubbedIndex - 1; index >= 0; index -= 1) {
                    if (!disabledItemIds.includes(items[index].id)) {
                        scrubbedIndex = index;
                        break;
                    }
                }
            }
        }
        const media = items[scrubbedIndex];
        if (!media)
            return null;
        const itemStartPixel = (_j = itemStartPixels[scrubbedIndex]) !== null && _j !== void 0 ? _j : 0;
        const itemWidth = Math.max(1, (_k = itemWidths[scrubbedIndex]) !== null && _k !== void 0 ? _k : 1);
        const progress = clamp((playheadPixel - itemStartPixel) / itemWidth, 0, 1);
        const itemDuration = (_l = itemDurations[scrubbedIndex]) !== null && _l !== void 0 ? _l : 0.5;
        const timelineTimeSeconds = ((_m = itemStartTimes[scrubbedIndex]) !== null && _m !== void 0 ? _m : 0) + progress * itemDuration;
        const resolved = resolveItemSnapshot(media, progress * itemDuration);
        return Object.assign(Object.assign({}, resolved), { timelineTimeSeconds });
    }, [
        directPreviewMediaId,
        disabledItemIds,
        finalIndex,
        hidePreview,
        itemDurations,
        itemStartPixels,
        itemStartTimes,
        itemWidths,
        items,
        isGallery,
        isPreviewPlaying,
        offset,
        playheadX,
        playbackSnapshotTime,
        renderedPlayheadX,
        resolveItemSnapshot,
        selectedIndex,
        sizing,
        stripEndPixel,
        syncPreviewToPlayhead,
        timelineOriginOffset,
        totalDurationSeconds,
    ]);
    const effectiveScrubSnapshot = React.useMemo(() => {
        var _a;
        if (externalScrubMediaId && externalScrubSourceTime !== null && externalScrubSourceTime !== undefined) {
            const media = (_a = items.find(item => item.id === externalScrubMediaId)) !== null && _a !== void 0 ? _a : Object.values(itemSequences !== null && itemSequences !== void 0 ? itemSequences : {})
                .flat()
                .find(item => item.id === externalScrubMediaId);
            if (media) {
                return {
                    media,
                    sourceTimeSeconds: externalScrubSourceTime,
                    timelineTimeSeconds: externalScrubTimelineTime !== null && externalScrubTimelineTime !== void 0 ? externalScrubTimelineTime : 0,
                };
            }
        }
        return scrubSnapshot;
    }, [externalScrubMediaId, externalScrubSourceTime, externalScrubTimelineTime, itemSequences, scrubSnapshot, items]);
    const setOffset = React.useCallback((nextOffset) => {
        const isDragMode = dragRef.current.isDragging && hidePreview;
        const boundedOffset = isDragMode
            ? nextOffset
            : clamp(nextOffset, minOffset, maxOffset);
        offsetRef.current = boundedOffset;
        setOffsetState(boundedOffset);
    }, [maxOffset, minOffset, hidePreview]);
    const { isDragging, collectionDropTargetId, utilityDropTarget, isSpinning, isSnapping, clickGuardTimeoutRef, momentumFrameRef, snapFrameRef, dragFrameRef, pendingDragOffsetRef, dropSettleTimeoutRef, pendingReorderSelectionRef, skipNextReorderAlignmentRef, skipNextSelectedAlignmentRef, snapCompletionRef, reorderAutoPanFrameRef, reorderPointerRef, beginDrag, moveDrag, endDrag, snapToIndex, snapToNearest, snapToGridLeftAlign, alignItemToOffset, spinWithMomentum, stopAnimation, clearClickGuardSoon, getCenteredMediaIdForOrder, prepareFixedCenterPreview, updateFastNavigation, } = usePreviewWheelDragDrop({
        items,
        disabledItemIds,
        itemSequences,
        selectedMediaId,
        sizing,
        durationScale,
        effect,
        hidePreview,
        viewportSize,
        gridView,
        customChunks,
        breakoutTitles,
        breakoutIsCollection,
        breakoutRepresentativeUrls,
        breakoutCollectionsEnabled,
        breakoutNestingLevels,
        allCollections,
        getRecursiveMediaItems,
        thumbnailSize,
        showRuler,
        subRowIndex,
        nestingLevel,
        gridNestingLevels,
        rowIndex,
        gridDisplayPanelHeight,
        gridColumnCount,
        offset,
        setOffset,
        offsetRef,
        playheadX,
        renderedPlayheadX,
        playheadPositionRatio,
        setPlayheadPositionRatio,
        setGridPlayheadRatio,
        onCenteredMediaChange,
        onCollectionOpen,
        onItemsReorder,
        onItemMoveIntoCollection,
        onUtilityDrop,
        selectReorderedItem,
        slideOnClick,
        selectItemsWhilePreviewHidden,
        syncPreviewToPlayhead,
        onScrubUpdateRef,
        resolveItemSnapshot,
        playbackTimeRef,
        preparedPreviewMediaIdRef,
        preparedPreviewHandoffTimeoutRef,
        setPreparedPreviewMediaId,
        setPreparedPreviewReady,
        setVisiblePreparedPreviewMediaId,
        setDirectPreviewMediaId,
        setTrimOverlayMediaId,
        isPreviewPlaying,
        viewportRef,
        reorderGhostRef,
        reorderGhostContentRef,
        isGallery,
        uniformItemWidth,
        itemDurations,
        itemWidths,
        isGaplessGallery,
        itemGap,
        itemStartTimes,
        totalDurationSeconds,
        itemCenterPositions,
        itemStartPixels,
        selectedIndex,
        childGridItemWidth,
        verticalLineX,
        indentOffset,
        maxOffset,
        minOffset,
        timelineOriginOffset,
        stripEndPixel,
        finalIndex,
        gridLeftAlignOffset,
        snapReferencePositions,
        collectionItemIds,
        reorderPreview,
        setReorderPreview,
        reorderPreviewOrder,
        setReorderPreviewOrder,
        freeDrag,
        dragRef,
        clickGuardRef,
    });
    const { isPlayheadDragging, playheadDragRef, beginPlayheadDrag, movePlayheadDrag, endPlayheadDrag, seekGridPlayheadToXRef, scrubWithPlayhead, } = usePreviewWheelPlayback({
        isPreviewPlaying,
        loopPreviewPlayback,
        totalDurationSeconds,
        itemDurations,
        itemStartTimes,
        items,
        sizing,
        isGallery,
        timelineOriginOffset,
        itemStartPixels,
        itemCenterPositions,
        finalIndex,
        selectedMediaId,
        onPreviewPlaybackComplete,
        onPlaybackMediaChange,
        onPlaybackTimeUpdate,
        setOffset,
        resolveItemSnapshot,
        effectiveScrubSnapshot,
        hidePreview,
        viewportSize,
        playheadX,
        renderedPlayheadX,
        gridPlayheadRatio,
        setGridPlayheadRatio,
        stopAnimation,
        offsetRef,
        playheadPositionRatio,
        setPlayheadPositionRatio,
        onCenteredMediaChange,
        setTrimOverlayMediaId,
        setDirectPreviewMediaId,
        playbackTimeRef,
        wasPreviewPlayingRef,
        playbackSelectedMediaIdRef,
        playbackResolvedMediaKeyRef,
        prominentTimestampRef,
        playbackSnapshotTime,
        setPlaybackSnapshotTime,
    });
    const handleGridScrubUpdate = React.useCallback((rowIndex, mediaId, sourceTimeSeconds, rowTimelineTimeSeconds) => {
        var _a, _b, _c;
        if (mediaId !== null && sourceTimeSeconds !== null) {
            activeGridScrubRowRef.current = rowIndex;
            setActiveGridPlayheadRow(rowIndex);
            const rowItems = (_a = wrappedRows[rowIndex]) === null || _a === void 0 ? void 0 : _a.items;
            const firstItem = rowItems === null || rowItems === void 0 ? void 0 : rowItems[0];
            const firstItemIndex = firstItem ? items.findIndex(item => item.id === firstItem.id) : -1;
            const rowStartTime = firstItemIndex >= 0 ? ((_b = itemStartTimes[firstItemIndex]) !== null && _b !== void 0 ? _b : 0) : 0;
            (_c = onScrubUpdateRef.current) === null || _c === void 0 ? void 0 : _c.call(onScrubUpdateRef, mediaId, sourceTimeSeconds, rowStartTime + (rowTimelineTimeSeconds !== null && rowTimelineTimeSeconds !== void 0 ? rowTimelineTimeSeconds : 0));
            return;
        }
        if (activeGridScrubRowRef.current !== rowIndex)
            return;
        activeGridScrubRowRef.current = null;
    }, [items, itemStartTimes, wrappedRows]);
    const centeredIndex = getNearestIndexForOffset(offset, snapReferencePositions);
    const centeredItem = (_d = items[centeredIndex]) !== null && _d !== void 0 ? _d : null;
    const { leftOffscreenCount, rightOffscreenCount } = React.useMemo(() => {
        let leftCount = 0;
        let rightCount = 0;
        const halfViewportWidth = viewportSize.width / 2;
        items.forEach((item, index) => {
            var _a, _b, _c, _d;
            const itemWidth = (_a = itemWidths[index]) !== null && _a !== void 0 ? _a : uniformItemWidth;
            const itemCenterOffset = ((_c = (_b = reorderItemCenterPositions === null || reorderItemCenterPositions === void 0 ? void 0 : reorderItemCenterPositions.get(item.id)) !== null && _b !== void 0 ? _b : itemCenterPositions[index]) !== null && _c !== void 0 ? _c : 0) + offset;
            const offsetFromCenter = itemCenterOffset / itemStride;
            let x = itemCenterOffset + playheadOffsetFromCenter;
            if (effect === 'cylinder') {
                const angle = clamp(offsetFromCenter * MAX_WHEEL_ANGLE / 2, -MAX_WHEEL_ANGLE, MAX_WHEEL_ANGLE);
                const angleRadians = degreesToRadians(angle);
                const radius = itemStride * 3.05;
                x = Math.sin(angleRadians) * radius + playheadOffsetFromCenter;
            }
            else if (effect === 'cylinder2') {
                const angle = clamp(offsetFromCenter * 20, -54, 54);
                const angleRadians = degreesToRadians(angle);
                const radius = itemStride * 2.9;
                const centeredItemWidth = (_d = itemWidths[centeredIndex]) !== null && _d !== void 0 ? _d : uniformItemWidth;
                const minimumCenterSpacing = (itemWidth + centeredItemWidth) / 2 + itemGap;
                x = Math.sin(angleRadians) * radius;
                const absOffsetFromCenter = Math.abs(offsetFromCenter);
                if (absOffsetFromCenter >= 0.5) {
                    x =
                        Math.sign(offsetFromCenter) *
                            Math.max(Math.abs(x), minimumCenterSpacing +
                                Math.max(0, absOffsetFromCenter - 1) * itemWidth * 0.74);
                }
                x += playheadOffsetFromCenter;
            }
            else if (effect === 'coverflow') {
                x = itemCenterOffset * 0.82 + playheadOffsetFromCenter;
            }
            else if (effect === 'stack') {
                x = itemCenterOffset * 0.58 + playheadOffsetFromCenter;
            }
            const itemLeft = x - itemWidth / 2;
            const itemRight = x + itemWidth / 2;
            if (itemRight < -halfViewportWidth) {
                leftCount++;
            }
            else if (itemLeft > halfViewportWidth) {
                rightCount++;
            }
        });
        return { leftOffscreenCount: leftCount, rightOffscreenCount: rightCount };
    }, [
        items,
        itemWidths,
        uniformItemWidth,
        reorderItemCenterPositions,
        itemCenterPositions,
        offset,
        itemStride,
        playheadOffsetFromCenter,
        effect,
        centeredIndex,
        itemGap,
        viewportSize.width,
    ]);
    const isWheelMoving = isDragging || isPlayheadDragging || isSpinning;
    React.useEffect(() => {
        if (gridView)
            return;
        const publishScrubUpdate = onScrubUpdateRef.current;
        if (publishScrubUpdate) {
            if (scrubSnapshot && (isWheelMoving || syncPreviewToPlayhead)) {
                publishScrubUpdate(scrubSnapshot.media.id, scrubSnapshot.sourceTimeSeconds, scrubSnapshot.timelineTimeSeconds);
            }
            else if (!isWheelMoving && !syncPreviewToPlayhead) {
                publishScrubUpdate(null, null);
            }
        }
    }, [gridView, scrubSnapshot, isWheelMoving, syncPreviewToPlayhead]);
    const rulerPlayheadTimeSeconds = React.useMemo(() => {
        var _a, _b, _c, _d, _e, _f;
        if (items.length === 0)
            return 0;
        const playheadPixel = clamp(timelineOriginOffset - offset, 0, stripEndPixel);
        let playheadIndex = finalIndex;
        for (let index = 0; index < items.length; index += 1) {
            const itemEndPixel = ((_a = itemStartPixels[index]) !== null && _a !== void 0 ? _a : 0) + ((_b = itemWidths[index]) !== null && _b !== void 0 ? _b : 0);
            if (playheadPixel <= itemEndPixel) {
                playheadIndex = index;
                break;
            }
        }
        const itemStartPixel = (_c = itemStartPixels[playheadIndex]) !== null && _c !== void 0 ? _c : 0;
        const itemWidth = Math.max(1, (_d = itemWidths[playheadIndex]) !== null && _d !== void 0 ? _d : 1);
        const progress = clamp((playheadPixel - itemStartPixel) / itemWidth, 0, 1);
        return ((_e = itemStartTimes[playheadIndex]) !== null && _e !== void 0 ? _e : 0) + progress * ((_f = itemDurations[playheadIndex]) !== null && _f !== void 0 ? _f : 0.5);
    }, [finalIndex, itemDurations, itemStartPixels, itemStartTimes, itemWidths, items.length, offset, stripEndPixel, timelineOriginOffset]);
    React.useEffect(() => {
        if (effect !== 'gallery')
            return;
        const handleDisplayHover = (event) => {
            var _a;
            if (event.pointerType !== 'mouse')
                return;
            const bounds = (_a = galleryPreviewRef.current) === null || _a === void 0 ? void 0 : _a.getBoundingClientRect();
            if (!bounds)
                return;
            const isInsideDisplay = event.clientX >= bounds.left &&
                event.clientX <= bounds.right &&
                event.clientY >= bounds.top &&
                event.clientY <= bounds.bottom;
            const canShowTrim = isInsideDisplay &&
                selectedItemType === 'video' &&
                (effectiveScrubSnapshot === null || effectiveScrubSnapshot === void 0 ? void 0 : effectiveScrubSnapshot.media.id) === selectedMediaId;
            const next = canShowTrim ? selectedMediaId : null;
            if (trimOverlayMediaIdRef.current !== next) {
                trimOverlayMediaIdRef.current = next;
                window.requestAnimationFrame(() => {
                    setTrimOverlayMediaIdState(next);
                });
            }
        };
        document.addEventListener('pointermove', handleDisplayHover, true);
        return () => document.removeEventListener('pointermove', handleDisplayHover, true);
    }, [effect, effectiveScrubSnapshot === null || effectiveScrubSnapshot === void 0 ? void 0 : effectiveScrubSnapshot.media.id, selectedItemType, selectedMediaId]);
    const handlePlayheadKeyDown = React.useCallback((event) => {
        let nextPlayheadX = null;
        const currentPlayheadX = hidePreview ? renderedPlayheadX : playheadX;
        const edgeInset = hidePreview ? 8 : 32;
        if (event.key === 'ArrowLeft')
            nextPlayheadX = currentPlayheadX - (event.shiftKey ? 24 : 8);
        if (event.key === 'ArrowRight')
            nextPlayheadX = currentPlayheadX + (event.shiftKey ? 24 : 8);
        if (event.key === 'Home')
            nextPlayheadX = edgeInset;
        if (event.key === 'End')
            nextPlayheadX = Math.max(edgeInset, viewportSize.width - edgeInset);
        if (nextPlayheadX === null)
            return;
        event.preventDefault();
        event.stopPropagation();
        stopAnimation();
        if (hidePreview) {
            seekGridPlayheadToXRef.current(nextPlayheadX);
            return;
        }
        scrubWithPlayhead(nextPlayheadX, playheadX, offsetRef.current);
        const nextRatio = clamp(nextPlayheadX, 32, Math.max(32, viewportSize.width - 32)) /
            Math.max(1, viewportSize.width);
        localStorage.setItem('scene-launch-playhead-position', String(nextRatio));
    }, [hidePreview, playheadX, renderedPlayheadX, scrubWithPlayhead, stopAnimation, viewportSize.width]);
    React.useEffect(() => {
        return () => {
            if (containerResizeObserverRef.current) {
                containerResizeObserverRef.current.disconnect();
            }
            if (viewportResizeObserverRef.current) {
                viewportResizeObserverRef.current.disconnect();
            }
        };
    }, []);
    const focusItem = React.useCallback((index) => {
        window.requestAnimationFrame(() => {
            var _a, _b;
            (_b = (_a = viewportRef.current) === null || _a === void 0 ? void 0 : _a.querySelector(`[data-preview-wheel-index="${index}"]`)) === null || _b === void 0 ? void 0 : _b.focus({ preventScroll: true });
        });
    }, []);
    const moveKeyboardFocus = React.useCallback((nextIndex) => {
        const boundedIndex = clamp(nextIndex, 0, Math.max(0, items.length - 1));
        stopAnimation();
        if (!hidePreview)
            snapToIndex(boundedIndex);
        focusItem(boundedIndex);
    }, [focusItem, hidePreview, items.length, snapToIndex, stopAnimation]);
    const handleKeyboardNavigation = React.useCallback((event) => {
        var _a;
        if (event.target.matches('input, select, textarea, [contenteditable="true"]')) {
            return;
        }
        const focusedIndexValue = (_a = event.target
            .closest('[data-preview-wheel-index]')) === null || _a === void 0 ? void 0 : _a.dataset.previewWheelIndex;
        const focusedIndex = focusedIndexValue === undefined
            ? centeredIndex
            : Number(focusedIndexValue);
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            moveKeyboardFocus(focusedIndex + 1);
            return;
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            moveKeyboardFocus(focusedIndex - 1);
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            moveKeyboardFocus(0);
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            moveKeyboardFocus(items.length - 1);
        }
    }, [centeredIndex, items.length, moveKeyboardFocus]);
    const seekGridPlayheadToX = React.useCallback((nextPlayheadX) => {
        var _a, _b, _c, _d, _e, _f, _g;
        const boundedPlayheadX = clamp(nextPlayheadX, 8, Math.max(8, viewportSize.width - 8));
        const timelinePixel = clamp(boundedPlayheadX - playheadX - offsetRef.current + timelineOriginOffset, 0, stripEndPixel);
        let itemIndex = finalIndex;
        for (let index = 0; index < items.length; index += 1) {
            const itemEndPixel = ((_a = itemStartPixels[index]) !== null && _a !== void 0 ? _a : 0) + ((_b = itemWidths[index]) !== null && _b !== void 0 ? _b : 0);
            if (timelinePixel <= itemEndPixel) {
                itemIndex = index;
                break;
            }
        }
        const media = items[itemIndex];
        setGridPlayheadRatio(boundedPlayheadX / Math.max(1, viewportSize.width));
        if (!media || disabledItemIds.includes(media.id))
            return;
        const itemStartPixel = (_c = itemStartPixels[itemIndex]) !== null && _c !== void 0 ? _c : 0;
        const itemWidth = Math.max(1, (_d = itemWidths[itemIndex]) !== null && _d !== void 0 ? _d : 1);
        const progress = clamp((timelinePixel - itemStartPixel) / itemWidth, 0, 1);
        const itemDuration = (_e = itemDurations[itemIndex]) !== null && _e !== void 0 ? _e : 0.5;
        const elapsedSeconds = progress * itemDuration;
        const resolved = resolveItemSnapshot(media, elapsedSeconds);
        playbackTimeRef.current = ((_f = itemStartTimes[itemIndex]) !== null && _f !== void 0 ? _f : 0) + elapsedSeconds;
        (_g = onScrubUpdateRef.current) === null || _g === void 0 ? void 0 : _g.call(onScrubUpdateRef, resolved.media.id, resolved.sourceTimeSeconds, playbackTimeRef.current);
    }, [disabledItemIds, finalIndex, itemDurations, itemStartPixels, itemStartTimes, itemWidths, items, playheadX, resolveItemSnapshot, stripEndPixel, timelineOriginOffset, viewportSize.width]);
    React.useLayoutEffect(() => {
        seekGridPlayheadToXRef.current = seekGridPlayheadToX;
    }, [seekGridPlayheadToX]);
    const handleGridSeekRailClick = React.useCallback((event) => {
        var _a;
        if (event.detail === 0)
            return;
        const viewportBounds = (_a = viewportRef.current) === null || _a === void 0 ? void 0 : _a.getBoundingClientRect();
        if (!viewportBounds)
            return;
        seekGridPlayheadToX(event.clientX - viewportBounds.left);
    }, [seekGridPlayheadToX]);
    const handleGridSeekRailKeyDown = React.useCallback((event) => {
        const currentX = (gridPlayheadRatio !== null && gridPlayheadRatio !== void 0 ? gridPlayheadRatio : playheadPositionRatioRef.current) * viewportSize.width;
        let nextX = null;
        if (event.key === 'ArrowLeft')
            nextX = currentX - (event.shiftKey ? 24 : 8);
        if (event.key === 'ArrowRight')
            nextX = currentX + (event.shiftKey ? 24 : 8);
        if (event.key === 'Home')
            nextX = 8;
        if (event.key === 'End')
            nextX = Math.max(8, viewportSize.width - 8);
        if (nextX === null)
            return;
        event.preventDefault();
        event.stopPropagation();
        seekGridPlayheadToX(nextX);
    }, [gridPlayheadRatio, seekGridPlayheadToX, viewportSize.width]);
    const applyDurationResize = React.useCallback((item, edge, initialDuration, initialTrimStart, deltaSeconds) => {
        var _a;
        if (!onSelectedItemDurationChange)
            return null;
        if (edge === 'start' && item.type === 'video') {
            const nextTrimStart = clamp(initialTrimStart + deltaSeconds, 0, initialTrimStart + initialDuration - 0.5);
            const nextDuration = initialDuration - (nextTrimStart - initialTrimStart);
            const result = {
                durationSeconds: Number(nextDuration.toFixed(2)),
                trimStartSeconds: Number(nextTrimStart.toFixed(2)),
            };
            onSelectedItemDurationChange(result.durationSeconds, result.trimStartSeconds);
            return result;
        }
        const sourceDuration = item.type === 'video'
            ? Math.max(0.5, (_a = item.mediaDurationSeconds) !== null && _a !== void 0 ? _a : initialTrimStart + initialDuration)
            : MAX_IMAGE_DURATION_SECONDS;
        const durationDelta = edge === 'start' ? -deltaSeconds : deltaSeconds;
        const nextDuration = clamp(initialDuration + durationDelta, 0.5, item.type === 'video' ? sourceDuration - initialTrimStart : MAX_IMAGE_DURATION_SECONDS);
        const result = {
            durationSeconds: Number(nextDuration.toFixed(2)),
            trimStartSeconds: initialTrimStart,
        };
        onSelectedItemDurationChange(result.durationSeconds, result.trimStartSeconds);
        return result;
    }, [onSelectedItemDurationChange]);
    const beginDurationResize = React.useCallback((event, item, index, edge) => {
        var _a, _b, _c;
        if (sizing !== 'duration' || !onSelectedItemDurationChange)
            return;
        event.preventDefault();
        event.stopPropagation();
        const handle = event.currentTarget;
        const pointerId = event.pointerId;
        handle.setPointerCapture(pointerId);
        const initialDuration = Math.max(0.5, (_a = selectedItemDurationSeconds !== null && selectedItemDurationSeconds !== void 0 ? selectedItemDurationSeconds : item.durationSeconds) !== null && _a !== void 0 ? _a : 3);
        const initialTrimStart = Math.max(0, (_b = selectedItemTrimStartSeconds !== null && selectedItemTrimStartSeconds !== void 0 ? selectedItemTrimStartSeconds : item.trimStartSeconds) !== null && _b !== void 0 ? _b : 0);
        const secondsPerPixel = initialDuration / Math.max(1, (_c = itemWidths[index]) !== null && _c !== void 0 ? _c : 1);
        const startX = event.clientX;
        let latestResult = null;
        const onPointerMove = (moveEvent) => {
            latestResult = applyDurationResize(item, edge, initialDuration, initialTrimStart, (moveEvent.clientX - startX) * secondsPerPixel);
        };
        const onPointerUp = () => {
            if (latestResult) {
                onSelectedItemDurationChangeEnd === null || onSelectedItemDurationChangeEnd === void 0 ? void 0 : onSelectedItemDurationChangeEnd(latestResult.durationSeconds, latestResult.trimStartSeconds);
            }
            if (handle.hasPointerCapture(pointerId)) {
                handle.releasePointerCapture(pointerId);
            }
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('pointercancel', onPointerUp);
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        window.addEventListener('pointercancel', onPointerUp);
    }, [
        applyDurationResize,
        itemWidths,
        onSelectedItemDurationChange,
        onSelectedItemDurationChangeEnd,
        selectedItemDurationSeconds,
        selectedItemTrimStartSeconds,
        sizing,
    ]);
    const handleDurationResizeKey = React.useCallback((event, item, edge) => {
        var _a, _b;
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
            return;
        event.preventDefault();
        event.stopPropagation();
        const initialDuration = Math.max(0.5, (_a = selectedItemDurationSeconds !== null && selectedItemDurationSeconds !== void 0 ? selectedItemDurationSeconds : item.durationSeconds) !== null && _a !== void 0 ? _a : 3);
        const initialTrimStart = Math.max(0, (_b = selectedItemTrimStartSeconds !== null && selectedItemTrimStartSeconds !== void 0 ? selectedItemTrimStartSeconds : item.trimStartSeconds) !== null && _b !== void 0 ? _b : 0);
        const deltaSeconds = event.key === 'ArrowRight' ? 0.1 : -0.1;
        const result = applyDurationResize(item, edge, initialDuration, initialTrimStart, deltaSeconds);
        if (result) {
            onSelectedItemDurationChangeEnd === null || onSelectedItemDurationChangeEnd === void 0 ? void 0 : onSelectedItemDurationChangeEnd(result.durationSeconds, result.trimStartSeconds);
        }
    }, [applyDurationResize, onSelectedItemDurationChangeEnd, selectedItemDurationSeconds, selectedItemTrimStartSeconds]);
    const resizeGridDisplayPanel = React.useCallback((nextHeight) => {
        setGridDisplayPanelHeight(clamp(nextHeight, minGridDisplayPanelHeight, maxGridDisplayPanelHeight));
    }, [maxGridDisplayPanelHeight]);
    const beginGridPanelResize = React.useCallback((event) => {
        if (event.button !== 0)
            return;
        event.preventDefault();
        gridPanelResizeRef.current = {
            isDragging: true,
            pointerId: event.pointerId,
            startClientY: event.clientY,
            startHeight: boundedGridDisplayPanelHeight,
        };
        setIsGridPanelResizing(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    }, [boundedGridDisplayPanelHeight]);
    const moveGridPanelResize = React.useCallback((event) => {
        const resize = gridPanelResizeRef.current;
        if (!resize.isDragging || resize.pointerId !== event.pointerId)
            return;
        event.preventDefault();
        resizeGridDisplayPanel(resize.startHeight + event.clientY - resize.startClientY);
    }, [resizeGridDisplayPanel]);
    const endGridPanelResize = React.useCallback((event) => {
        const resize = gridPanelResizeRef.current;
        if (!resize.isDragging || resize.pointerId !== event.pointerId)
            return;
        resize.isDragging = false;
        setIsGridPanelResizing(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        localStorage.setItem('scene-launch-grid-display-panel-height', String(gridDisplayPanelHeight));
    }, [gridDisplayPanelHeight]);
    const handleGridPanelResizeKeyDown = React.useCallback((event) => {
        let nextHeight = null;
        if (event.key === 'ArrowUp')
            nextHeight = boundedGridDisplayPanelHeight - (event.shiftKey ? 32 : 8);
        if (event.key === 'ArrowDown')
            nextHeight = boundedGridDisplayPanelHeight + (event.shiftKey ? 32 : 8);
        if (event.key === 'Home')
            nextHeight = minGridDisplayPanelHeight;
        if (event.key === 'End')
            nextHeight = maxGridDisplayPanelHeight;
        if (nextHeight === null)
            return;
        event.preventDefault();
        resizeGridDisplayPanel(nextHeight);
        localStorage.setItem('scene-launch-grid-display-panel-height', String(nextHeight));
    }, [boundedGridDisplayPanelHeight, maxGridDisplayPanelHeight, resizeGridDisplayPanel]);
    const renderPlayer = () => (_jsx(PreviewWheelPlayer, { isGallery: isGallery, hidePreview: hidePreview, effectiveScrubSnapshot: effectiveScrubSnapshot, gridView: gridView, isPreviewPlaying: isPreviewPlaying, loopPreviewPlayback: loopPreviewPlayback, playheadPositionRatio: playheadPositionRatio, centeredIndex: centeredIndex, itemsCount: items.length, selectedMediaId: selectedMediaId, showSelectedTrimOverlay: showSelectedTrimOverlay, trimOverlayMediaId: trimOverlayMediaId, galleryPreviewHeight: galleryPreviewHeight, galleryPreviewWidth: galleryPreviewWidth, totalDurationSeconds: totalDurationSeconds, snapToIndex: snapToIndex, onTogglePlayback: onTogglePlayback, onToggleLoop: onToggleLoop, centerPlayhead: centerPlayhead, renderGalleryTrimOverlay: renderGalleryTrimOverlay, trimOverlayRef: trimOverlayRef, prominentTimestampRef: prominentTimestampRef, galleryPreviewRef: galleryPreviewRef }));
    const layoutData = React.useMemo(() => ({
        uniformItemWidth,
        itemGap,
        itemStride,
        itemHeight,
        itemCenterY,
        centerX,
        viewportSize,
        itemWidths,
        itemCenterPositions,
        itemStartTimes,
        itemDurations,
        itemStartPixels,
        reorderItemCenterPositions,
        timelineOriginOffset,
        totalDurationSeconds,
        finalIndex,
        stripEndPixel,
        centeredIndex,
        indentOffset,
        minOffset,
        maxOffset,
        isGaplessGallery,
    }), [
        uniformItemWidth,
        itemGap,
        itemStride,
        itemHeight,
        itemCenterY,
        centerX,
        viewportSize,
        itemWidths,
        itemCenterPositions,
        itemStartTimes,
        itemDurations,
        itemStartPixels,
        reorderItemCenterPositions,
        timelineOriginOffset,
        totalDurationSeconds,
        finalIndex,
        stripEndPixel,
        centeredIndex,
        indentOffset,
        minOffset,
        maxOffset,
        isGaplessGallery,
    ]);
    const playbackData = React.useMemo(() => ({
        activePlayingMediaId,
        activePlayingElapsedSeconds,
        playbackSnapshotTime,
        scrubSnapshot,
        effectiveScrubSnapshot,
        renderedPlayheadX,
        playheadX,
        playbackTimeRef,
        skipNextSelectedAlignmentRef,
        setTrimOverlayMediaId,
        isPreviewPlaying,
    }), [
        activePlayingMediaId,
        activePlayingElapsedSeconds,
        playbackSnapshotTime,
        scrubSnapshot,
        effectiveScrubSnapshot,
        renderedPlayheadX,
        playheadX,
        playbackTimeRef,
        skipNextSelectedAlignmentRef,
        setTrimOverlayMediaId,
        isPreviewPlaying,
    ]);
    const dragDropData = React.useMemo(() => ({
        isDragging,
        isSnapping,
        isWheelMoving,
        dragRef,
        clickGuardRef,
        reorderPreview,
        collectionDropTargetId,
        snapCompletionRef,
        offset,
        offsetRef,
    }), [
        isDragging,
        isSnapping,
        isWheelMoving,
        dragRef,
        clickGuardRef,
        reorderPreview,
        collectionDropTargetId,
        snapCompletionRef,
        offset,
        offsetRef,
    ]);
    const actionsData = React.useMemo(() => ({
        snapToIndex,
        setDirectPreviewMediaId,
        updateFastNavigation,
        setGridPlayheadRatio,
        onCenteredMediaChange,
        onCollectionOpen,
        getCollectionMediaItems,
        getCollectionDirectCount,
        renderSelectedItemOverlay,
        onSelectedItemDurationChange,
        beginDurationResize,
        handleDurationResizeKey,
        slideOnClick,
        selectItemsWhilePreviewHidden,
        syncPreviewToPlayhead,
    }), [
        snapToIndex,
        setDirectPreviewMediaId,
        updateFastNavigation,
        setGridPlayheadRatio,
        onCenteredMediaChange,
        onCollectionOpen,
        getCollectionMediaItems,
        getCollectionDirectCount,
        renderSelectedItemOverlay,
        onSelectedItemDurationChange,
        beginDurationResize,
        handleDurationResizeKey,
        slideOnClick,
        selectItemsWhilePreviewHidden,
        syncPreviewToPlayhead,
    ]);
    const settingsValue = React.useMemo(() => ({
        sizing,
        effect,
        thumbnailSize,
        disabledItemIds,
        collectionItemIds,
        collectionMultiCircleEnabled,
        isGaplessGallery,
        showRuler,
        showUniformRuler,
        rulerTickStep,
        rulerTop,
        hidePreview,
        selectedMediaId,
        itemSequenceThumbnails,
    }), [
        sizing,
        effect,
        thumbnailSize,
        disabledItemIds,
        collectionItemIds,
        collectionMultiCircleEnabled,
        isGaplessGallery,
        showRuler,
        showUniformRuler,
        rulerTickStep,
        rulerTop,
        hidePreview,
        selectedMediaId,
        itemSequenceThumbnails,
    ]);
    if (items.length === 0)
        return null;
    return (_jsx(PreviewWheelSettingsContext.Provider, { value: settingsValue, children: _jsxs("div", { ref: containerRefCallback, className: cn("relative flex min-h-0 w-full", hidePreview
                ? "h-auto items-center justify-center overflow-visible py-0.5 px-0 bg-transparent"
                : gridView
                    ? "h-full items-start justify-start overflow-y-auto px-4 [scrollbar-gutter:stable]"
                    : "items-center justify-center overflow-hidden px-4", !hidePreview && gridView
                ? "h-full pt-1.5 pb-2.5 bg-black"
                : !hidePreview
                    ? "h-full py-3 bg-black"
                    : ""), children: [_jsx(PreviewWheelNestingGuides, { nestingLevel: nestingLevel, childGridItemWidth: childGridItemWidth, gridItemGap: gridItemGap, gridNestingLevels: gridNestingLevels, rowIndex: rowIndex, subRowIndex: subRowIndex, indentOffset: indentOffset }), _jsxs("div", { className: cn("min-h-0 w-full rounded-md", hidePreview
                        ? "bg-transparent shadow-none border-none h-auto overflow-visible"
                        : "bg-[#0c0c0e]/85 shadow-lg overflow-hidden", hidePreview
                        ? "h-auto"
                        : gridView
                            ? "flex min-h-full flex-col overflow-visible"
                            : isGallery
                                ? "flex h-full flex-col"
                                : "h-full"), children: [gridView && !hidePreview ? (_jsxs("div", { className: "sticky top-0 z-40 flex w-full shrink-0 flex-col bg-[#0c0c0e] shadow-md", children: [!minimized && (_jsx("div", { className: "flex w-full shrink-0 items-center justify-center overflow-hidden bg-[#0c0c0e]", style: { height: boundedGridDisplayPanelHeight }, children: renderPlayer() })), !minimized && (_jsx("div", { role: "separator", "aria-label": "Resize display and wheel panels", "aria-orientation": "horizontal", "aria-valuemin": minGridDisplayPanelHeight, "aria-valuemax": maxGridDisplayPanelHeight, "aria-valuenow": Math.round(boundedGridDisplayPanelHeight), tabIndex: 0, onPointerDown: beginGridPanelResize, onPointerMove: moveGridPanelResize, onPointerUp: endGridPanelResize, onPointerCancel: endGridPanelResize, onLostPointerCapture: endGridPanelResize, onKeyDown: handleGridPanelResizeKeyDown, className: cn('group relative z-40 flex h-3 w-full shrink-0 touch-none cursor-row-resize items-center justify-center border-y border-zinc-800 bg-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400', isGridPanelResizing && 'bg-zinc-900'), children: _jsx("span", { className: "h-1 w-12 rounded-full bg-zinc-600 transition-colors group-hover:bg-zinc-400 group-focus-visible:bg-indigo-300" }) })), _jsx(PreviewWheelHeaderControls, { items: items, rowTitle: rowTitle, isFirstGridRow: isFirstGridRow, canNavigateBack: canNavigateBack, onNavigateBack: onNavigateBack, parentCollectionName: parentCollectionName, parentCollectionThumbnailUrl: parentCollectionThumbnailUrl, breadcrumbs: breadcrumbs, onBreadcrumbClick: onBreadcrumbClick, currentCollectionName: currentCollectionName, onBreakoutCollectionsChange: onBreakoutCollectionsChange, breakoutCollectionsEnabled: breakoutCollectionsEnabled, onBreakoutNestingDepthChange: onBreakoutNestingDepthChange, breakoutNestingDepth: breakoutNestingDepth, onTimelineWrappedChange: onTimelineWrappedChange, timelineWrapped: timelineWrapped })] })) : (renderPlayer()), gridView ? (_jsx(PreviewWheelGridView, { wrappedRows: wrappedRows, hidePreview: hidePreview, customChunks: customChunks, itemSequences: itemSequences, itemSequenceThumbnails: itemSequenceThumbnails, onCollectionOpen: onCollectionOpen, allCollections: allCollections, getRecursiveMediaItems: getRecursiveMediaItems, collectionMultiCircleEnabled: collectionMultiCircleEnabled, breakoutSelectedMediaIds: breakoutSelectedMediaIds, selectedMediaId: selectedMediaId, effect: effect, thumbnailSize: thumbnailSize, durationScale: durationScale, selectedItemDurationSeconds: selectedItemDurationSeconds, selectedItemTrimStartSeconds: selectedItemTrimStartSeconds, onSelectedItemDurationChange: onSelectedItemDurationChange, onSelectedItemDurationChangeEnd: onSelectedItemDurationChangeEnd, onCenteredMediaChange: onCenteredMediaChange, renderSelectedItemOverlay: renderSelectedItemOverlay, renderGalleryTrimOverlay: renderGalleryTrimOverlay, isPreviewPlaying: isPreviewPlaying, loopPreviewPlayback: loopPreviewPlayback, onPreviewPlaybackComplete: onPreviewPlaybackComplete, onPlaybackMediaChange: onPlaybackMediaChange, onItemsReorder: onItemsReorder, collectionItemIds: collectionItemIds, onItemMoveIntoCollection: onItemMoveIntoCollection, disabledItemIds: disabledItemIds, onUtilityDrop: onUtilityDrop, selectReorderedItem: selectReorderedItem, onTogglePlayback: onTogglePlayback, onToggleLoop: onToggleLoop, showUniformRuler: showUniformRuler, showRuler: showRuler, slideOnClick: slideOnClick, itemsPerRow: itemsPerRow, showPlayhead: showPlayhead, visibleGridPlayheadRow: visibleGridPlayheadRow, activePlayingMediaId: activePlayingMediaId, activePlayingElapsedSeconds: activePlayingElapsedSeconds, onScrubUpdate: onScrubUpdate, handleGridScrubUpdate: handleGridScrubUpdate })) : (!hideTrack && (_jsxs("div", { ref: viewportRefCallback, "aria-label": "Timeline media wheel", className: cn("relative flex items-center overflow-hidden", (isGallery || hidePreview) ? cn("shrink-0 bg-zinc-950/20", !hidePreview && "border-t border-zinc-900") : "h-full min-h-0", reorderPreview ? "cursor-grabbing select-none" : isDragging ? "cursor-grabbing select-none" : "cursor-grab"), style: Object.assign({ perspective: 1200, touchAction: hidePreview ? 'pan-y' : 'none' }, ((isGallery || hidePreview) ? { height: rowHeight } : {})), onPointerDown: beginDrag, onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag, onKeyDown: handleKeyboardNavigation, children: [hidePreview && showRuler && (_jsxs(_Fragment, { children: [_jsxs("div", { className: cn("absolute left-0 right-0 top-0 z-[20] cursor-ew-resize pointer-events-auto flex items-center", subRowIndex > 0
                                                ? "h-2 bg-transparent border-none"
                                                : cn("h-8", rowIsCollection
                                                    ? "bg-zinc-900/35 border-b border-indigo-950/45"
                                                    : "bg-zinc-900/60 border-b border-zinc-800")), style: {
                                                paddingLeft: isIndented ? indentOffset : 16,
                                            }, onPointerDown: (event) => event.stopPropagation(), onMouseMove: handleRulerMouseMove, onMouseLeave: handleRulerMouseLeave, onClick: handleGridSeekRailClick, children: [rowIsCollection && (!subRowIndex || subRowIndex === 0) && (_jsx("div", { className: "absolute inset-y-0 w-1 rounded-r bg-indigo-400", style: {
                                                        left: isIndented ? indentOffset - 16 : 0
                                                    } })), rowTitle && (_jsxs("span", { className: cn("pointer-events-none flex select-none items-center font-mono font-black uppercase", rowIsCollection
                                                        ? "gap-2 text-xs tracking-widest text-indigo-100"
                                                        : "gap-1.5 text-[10px] tracking-wider text-zinc-500/95"), children: [rowIsCollection ? (_jsx("span", { className: "flex size-6 shrink-0 items-center justify-center rounded-md border border-indigo-400/50 bg-indigo-500/20 shadow-sm shadow-indigo-950/60", children: _jsx(Folder, { className: "size-4 text-indigo-200" }) })) : (_jsx(Clapperboard, { className: "h-3.5 w-3.5 text-zinc-500/80" })), _jsx("span", { className: cn(rowIsCollection && "[text-box:trim-both_cap_alphabetic]"), children: rowTitle })] }))] }), rulerHoveredX !== null && (_jsx("div", { className: "pointer-events-none absolute bottom-0 z-[195] w-px bg-indigo-400/50 shadow-[0_0_6px_rgba(129,140,248,0.7)]", style: {
                                                left: rulerHoveredX,
                                                top: 0,
                                                height: rowHeight,
                                            } }))] })), _jsx("div", { className: "sr-only", "aria-live": "polite", children: centeredItem ? `Centered media ${centeredItem.name}` : 'Timeline media wheel' }), _jsx(PreviewWheelReorderPortal, { reorderPreview: reorderPreview, items: items, collectionItemIds: collectionItemIds, disabledItemIds: disabledItemIds, utilityDropTarget: utilityDropTarget, collectionMultiCircleEnabled: collectionMultiCircleEnabled, getCollectionMediaItems: getCollectionMediaItems, getCollectionDirectCount: getCollectionDirectCount, scrubSnapshot: scrubSnapshot, itemSequenceThumbnails: itemSequenceThumbnails, thumbnailSize: thumbnailSize, reorderGhostRef: reorderGhostRef, reorderGhostContentRef: reorderGhostContentRef }), _jsx(PreviewWheelPlayhead, { renderedPlayheadX: renderedPlayheadX, itemTop: itemTop, itemHeight: itemHeight, rulerPlayheadTimeSeconds: rulerPlayheadTimeSeconds, isPlayheadDragging: isPlayheadDragging, beginPlayheadDrag: beginPlayheadDrag, movePlayheadDrag: movePlayheadDrag, endPlayheadDrag: endPlayheadDrag, handlePlayheadKeyDown: handlePlayheadKeyDown, onNavigateBack: onNavigateBack, canNavigateBack: canNavigateBack, isFirstGridRow: isFirstGridRow, parentCollectionName: parentCollectionName, parentCollectionThumbnailUrl: parentCollectionThumbnailUrl, shouldShowPlayhead: shouldShowPlayhead, isSharedPlayheadPlaying: isSharedPlayheadPlaying, sizing: sizing, isGallery: isGallery }), sizing !== 'duration' && !isGallery && (_jsx("div", { "aria-hidden": "true", className: "pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-lg border-x border-white/10 bg-zinc-800/72 shadow-[inset_14px_0_26px_rgba(0,0,0,0.28),inset_-14px_0_26px_rgba(0,0,0,0.28)]", style: { width: ((_e = itemWidths[selectedIndex]) !== null && _e !== void 0 ? _e : uniformItemWidth) + itemGap } })), !hidePreview && (_jsx("div", { "aria-hidden": "true", className: "pointer-events-none absolute inset-y-0 left-0 w-1/5 bg-gradient-to-r from-black/62 via-black/28 to-transparent" })), _jsxs("div", { className: "absolute inset-0 will-change-transform", style: { transformStyle: 'preserve-3d' }, children: [(isDragging || isSnapping) && prevRowPreviewItem && (rowIndex > 0 || subRowIndex > 0) && (_jsx(PreviewWheelAdjacentPreviewItem, { item: prevRowPreviewItem, centerOffset: -uniformItemWidth - itemGap, direction: "prev", layout: layoutData, playback: playbackData, dragDrop: dragDropData, actions: actionsData })), items.map((item, index) => (_jsx(PreviewWheelTrackItem, { item: item, index: index, items: items, layout: layoutData, playback: playbackData, dragDrop: dragDropData, actions: actionsData }, `${item.id}-${index}`))), (isDragging || isSnapping) && nextRowPreviewItem && !isLastGridRow && (_jsx(PreviewWheelAdjacentPreviewItem, { item: nextRowPreviewItem, centerOffset: itemCenterPositions[finalIndex] + uniformItemWidth + itemGap, direction: "next", layout: layoutData, playback: playbackData, dragDrop: dragDropData, actions: actionsData }))] }), leftOffscreenCount > 0 && (_jsxs("button", { type: "button", onPointerDown: (e) => e.stopPropagation(), onClick: (e) => {
                                        e.stopPropagation();
                                        if (!hidePreview) {
                                            snapToIndex(Math.max(0, centeredIndex - 1));
                                        }
                                        else {
                                            setOffset(offset + uniformItemWidth);
                                        }
                                    }, style: {
                                        top: itemCenterY,
                                    }, className: "absolute left-2 z-[210] -translate-y-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-800/90 bg-zinc-950/80 backdrop-blur-md text-[10px] font-black tracking-wider text-zinc-300 font-sans uppercase shadow-lg shadow-black/60 hover:bg-zinc-900 hover:border-indigo-500/50 hover:text-white transition-all select-none cursor-pointer", children: [_jsx(ChevronLeft, { className: "size-3 text-indigo-400" }), _jsx("span", { children: leftOffscreenCount })] })), rightOffscreenCount > 0 && (_jsxs("button", { type: "button", onPointerDown: (e) => e.stopPropagation(), onClick: (e) => {
                                        e.stopPropagation();
                                        if (!hidePreview) {
                                            snapToIndex(Math.min(items.length - 1, centeredIndex + 1));
                                        }
                                        else {
                                            setOffset(offset - uniformItemWidth);
                                        }
                                    }, style: {
                                        top: itemCenterY,
                                    }, className: "absolute right-2 z-[210] -translate-y-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-zinc-800/90 bg-zinc-950/80 backdrop-blur-md text-[10px] font-black tracking-wider text-zinc-300 font-sans uppercase shadow-lg shadow-black/60 hover:bg-zinc-900 hover:border-indigo-500/50 hover:text-white transition-all select-none cursor-pointer", children: [_jsx("span", { children: rightOffscreenCount }), _jsx(ChevronRight, { className: "size-3 text-indigo-400" })] }))] })))] })] }) }));
}

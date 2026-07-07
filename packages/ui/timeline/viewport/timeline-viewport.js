import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState, } from "react";
import { createPortal } from "react-dom";
import { TimelineClipItem } from "../clip/TimelineClipItem";
import { TimelineClipItemProvider } from "../clip/TimelineClipItemContext";
import { ArrowLeft, ArrowRight, Play } from "lucide-react";
import { CLIP_GAP_SECONDS, FILMSTRIP_GAP, FILMSTRIP_HEIGHT, THUMBNAIL_GAP, TIMELINE_LEADING_PADDING_SECONDS, } from "../constants";
import { useTimelineDropTargets, } from "../hooks/use-timeline-drop-targets";
import { getTimelineGridItemLayout, } from "../timeline-grid";
import { TimelineContextMenu } from "../controls/timeline-context-menu";
import { TimelineDropIndicator, TimelineDropOverlay, } from "../overlays/timeline-drop-overlays";
import { TimelinePlayhead } from "../overlays/timeline-playhead";
import { PassiveVideoFilmStrip, VideoSourceFilmStrip } from "../media/video-source-filmstrip";
import { formatSeconds } from "../utils";
import { VideoTile } from "../media/video-tile";
import { useTimelineDocuments } from "../timeline-document-store";
export function TimelineViewport({ collections, dropHandlers, frame, interactions, isZooming, layout, overhang, playback, selection, timelineId, }) {
    var _a, _b;
    const { getCollectionClipFramePreview } = useTimelineDocuments();
    const { handleScroll, parentRef, resolvedViewportWidth, scrollLeft, scrollTop, timelineHeight, timelineWidth, } = frame;
    const { gridMetrics, hasClips, itemHeight, itemTop, pixelsPerSecond, thumbnailMode, thumbnailWidth, visibleClips, } = layout;
    const { closingOverhangOffset, firstOverhang, isClosingOverhang, isResizingFirstClipLeft, manualOverhangScroll, prevFirstOverhang, } = overhang;
    const { handleClipDurationLoad, scrubPreview, selectedIndex } = selection;
    const { exposedCollectionEndpointIds, getCollectionHref, onOpenCollection, onRenameCollection, onToggleCollectionEndpoint, } = collections !== null && collections !== void 0 ? collections : {};
    const { onDropClip, onDropClipIntoCollection, onDropFiles, onDropSidebarClip, onDropSidebarClipIntoCollection, } = dropHandlers !== null && dropHandlers !== void 0 ? dropHandlers : {};
    const { onPlayheadTimeChange, playheadTime: propPlayheadTime, previewLargeSurface = false, selectedVideoClip, showPassiveFilmstrips, showPlayBarArea, } = playback;
    const contentRef = useRef(null);
    const trackTransition = interactions.isResizing ||
        interactions.isSnappingBack ||
        interactions.isFilmStripEditing ||
        interactions.isUnfreezing ||
        isClosingOverhang ||
        isZooming
        ? "none"
        : "transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), width 0.35s cubic-bezier(0.16, 1, 0.3, 1), min-width 0.35s cubic-bezier(0.16, 1, 0.3, 1)";
    const overhangIsGrowing = manualOverhangScroll && firstOverhang > prevFirstOverhang;
    const hiddenOverhangIsClosing = manualOverhangScroll &&
        firstOverhang < prevFirstOverhang &&
        scrollLeft >= prevFirstOverhang - 1;
    const contentTransition = interactions.isResizing ||
        interactions.isFilmStripEditing ||
        interactions.isUnfreezing ||
        isResizingFirstClipLeft ||
        isClosingOverhang ||
        isZooming ||
        overhangIsGrowing ||
        hiddenOverhangIsClosing
        ? "none"
        : "transform 0.35s cubic-bezier(0.16, 1, 0.3, 1)";
    const viewportStyle = {
        width: resolvedViewportWidth,
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        scrollbarGutter: gridMetrics.enabled ? undefined : "stable both-edges",
        WebkitOverflowScrolling: "touch",
    };
    const getClipLeft = useCallback((clip) => thumbnailMode && gridMetrics.enabled
        ? getTimelineGridItemLayout(clip.index, gridMetrics).left
        : thumbnailMode
            ? clip.index * (thumbnailWidth + THUMBNAIL_GAP)
            : clip.startTime * pixelsPerSecond, [gridMetrics, pixelsPerSecond, thumbnailMode, thumbnailWidth]);
    const getClipTop = useCallback((clip) => thumbnailMode
        ? itemTop +
            (gridMetrics.enabled
                ? getTimelineGridItemLayout(clip.index, gridMetrics).top
                : 0)
        : itemTop, [gridMetrics, itemTop, thumbnailMode]);
    const getClipWidth = useCallback((clip) => thumbnailMode && gridMetrics.enabled
        ? getTimelineGridItemLayout(clip.index, gridMetrics).width
        : thumbnailMode
            ? thumbnailWidth
            : clip.duration * pixelsPerSecond, [gridMetrics, pixelsPerSecond, thumbnailMode, thumbnailWidth]);
    const getClipPlaybackStart = useCallback((clip) => { var _a; return (_a = clip.playbackStartTime) !== null && _a !== void 0 ? _a : clip.startTime; }, []);
    const getClipPlaybackDuration = useCallback((clip) => { var _a; return Math.max(0.001, (_a = clip.playbackDuration) !== null && _a !== void 0 ? _a : clip.duration); }, []);
    const getClipPlaybackTimeAtX = useCallback((clip, contentX) => {
        const left = getClipLeft(clip);
        const width = getClipWidth(clip);
        const ratio = Math.max(0, Math.min(1, (contentX - left) / Math.max(1, width)));
        return getClipPlaybackStart(clip) + ratio * getClipPlaybackDuration(clip);
    }, [getClipLeft, getClipPlaybackDuration, getClipPlaybackStart, getClipWidth]);
    const getCollectionPreviewClip = useCallback((clip) => {
        const playbackDuration = getClipPlaybackDuration(clip);
        return Object.assign(Object.assign({}, clip), { duration: playbackDuration, sourceDuration: Math.max(clip.sourceDuration, playbackDuration) });
    }, [getClipPlaybackDuration]);
    const getDropIndicatorLeft = useCallback((index) => {
        if (visibleClips.length === 0) {
            return TIMELINE_LEADING_PADDING_SECONDS * pixelsPerSecond;
        }
        if (index === 0) {
            return getClipLeft(visibleClips[0]);
        }
        if (index >= visibleClips.length) {
            const lastClip = visibleClips[visibleClips.length - 1];
            return getClipLeft(lastClip) + getClipWidth(lastClip) + CLIP_GAP_SECONDS * pixelsPerSecond;
        }
        const prevClip = visibleClips[index - 1];
        const nextClip = visibleClips[index];
        const prevRight = getClipLeft(prevClip) + getClipWidth(prevClip);
        const nextLeft = getClipLeft(nextClip);
        return prevRight + (nextLeft - prevRight) / 2;
    }, [getClipLeft, getClipWidth, pixelsPerSecond, visibleClips]);
    const collectionEndpointLinkMarkers = useMemo(() => {
        const markers = [];
        for (let index = 0; index < visibleClips.length - 1; index += 1) {
            const leftClip = visibleClips[index];
            const rightClip = visibleClips[index + 1];
            const collectionClip = leftClip.kind === "collection" ? leftClip :
                rightClip.kind === "collection" ? rightClip :
                    null;
            const endpointClip = leftClip.viewRole === "collection-endpoint" ? leftClip :
                rightClip.viewRole === "collection-endpoint" ? rightClip :
                    null;
            if (!collectionClip || !endpointClip)
                continue;
            if (!collectionClip.viewExpansionKey)
                continue;
            if (endpointClip.viewParentCollectionKey !== collectionClip.viewExpansionKey)
                continue;
            if (!endpointClip.viewEndpoint)
                continue;
            const leftTop = getClipTop(leftClip);
            const rightTop = getClipTop(rightClip);
            if (Math.abs(leftTop - rightTop) > 1)
                continue;
            const leftRight = getClipLeft(leftClip) + getClipWidth(leftClip);
            const rightLeft = getClipLeft(rightClip);
            markers.push({
                collectionClip,
                id: `${collectionClip.viewExpansionKey}:${endpointClip.viewEndpoint}`,
                endpoint: endpointClip.viewEndpoint,
                left: leftRight + (rightLeft - leftRight) / 2,
                top: leftTop + itemHeight / 2,
            });
        }
        return markers;
    }, [getClipLeft, getClipTop, getClipWidth, itemHeight, visibleClips]);
    const { activeCollectionHoverId, activeDropIndex, handleDragEnter, handleDragLeave, handleDragOver, handleDrop, isAnyDragActive, isDragOver, } = useTimelineDropTargets({
        contentRef,
        getClipLeft,
        getClipWidth,
        hasClips,
        onDropClip,
        onDropClipIntoCollection,
        onDropFiles,
        onDropSidebarClip,
        onDropSidebarClipIntoCollection,
        timelineId,
        visibleClips,
    });
    const [contextMenu, setContextMenu] = useState(null);
    const handleContextMenu = useCallback((e) => {
        e.preventDefault();
        if (!contentRef.current)
            return;
        const rect = contentRef.current.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const timelineTime = Math.max(0, clickX / pixelsPerSecond);
        let insertIndex = visibleClips.length;
        for (let i = 0; i < visibleClips.length; i++) {
            const clip = visibleClips[i];
            const left = getClipLeft(clip);
            const width = getClipWidth(clip);
            const midpoint = left + width / 2;
            if (clickX < midpoint) {
                insertIndex = clip.index;
                break;
            }
        }
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            timelineTime,
            insertIndex,
        });
    }, [visibleClips, getClipLeft, getClipWidth, pixelsPerSecond]);
    useEffect(() => {
        if (!contextMenu)
            return;
        const handleKeyDown = (e) => {
            if (e.key === "Escape") {
                setContextMenu(null);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [contextMenu]);
    const [playheadTimeState, setPlayheadTimeState] = useState(null);
    const playheadTime = propPlayheadTime !== null && propPlayheadTime !== void 0 ? propPlayheadTime : playheadTimeState;
    const updatePlayheadTime = useCallback((time, activeClipId) => {
        setPlayheadTimeState(time);
        onPlayheadTimeChange === null || onPlayheadTimeChange === void 0 ? void 0 : onPlayheadTimeChange(time, visibleClips, activeClipId);
    }, [onPlayheadTimeChange, visibleClips]);
    const [scrubbingState, setScrubbingState] = useState(null);
    const showFloatingDragPreview = !previewLargeSurface;
    const getClipContainingX = useCallback((contentX) => {
        var _a;
        return (_a = visibleClips.find((clip) => {
            const left = getClipLeft(clip);
            const right = left + getClipWidth(clip);
            return contentX >= left && contentX <= right;
        })) !== null && _a !== void 0 ? _a : null;
    }, [getClipLeft, getClipWidth, visibleClips]);
    const getPlayBarScrubSample = useCallback((contentX) => {
        const clip = getClipContainingX(contentX);
        if (!clip)
            return null;
        const left = getClipLeft(clip);
        const right = left + getClipWidth(clip);
        const resolvedContentX = Math.max(left, Math.min(right, contentX));
        return {
            clip,
            contentX: resolvedContentX,
        };
    }, [getClipContainingX, getClipLeft, getClipWidth]);
    const getPlayheadLeft = useCallback((time) => {
        if (time === null)
            return null;
        const activeClip = visibleClips.find((clip) => {
            const playbackStart = getClipPlaybackStart(clip);
            const playbackDuration = getClipPlaybackDuration(clip);
            return time >= playbackStart && time <= playbackStart + playbackDuration;
        });
        if (activeClip) {
            const playbackStart = getClipPlaybackStart(activeClip);
            const playbackDuration = getClipPlaybackDuration(activeClip);
            const ratio = Math.max(0, Math.min(1, (time - playbackStart) / playbackDuration));
            return getClipLeft(activeClip) + ratio * getClipWidth(activeClip);
        }
        if (!thumbnailMode) {
            return time * pixelsPerSecond;
        }
        return null;
    }, [thumbnailMode, pixelsPerSecond, visibleClips, getClipLeft, getClipPlaybackDuration, getClipPlaybackStart, getClipWidth]);
    const updatePlayheadFromScrubSample = useCallback((sample) => {
        const playheadTime = getClipPlaybackTimeAtX(sample.clip, sample.contentX);
        updatePlayheadTime(playheadTime, sample.clip.id);
        return playheadTime;
    }, [getClipPlaybackTimeAtX, updatePlayheadTime]);
    const handlePlayBarPointerDown = useCallback((e) => {
        e.stopPropagation();
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const content = contentRef.current;
        if (!content)
            return;
        const rect = content.getBoundingClientRect();
        const initialContentX = e.clientX - rect.left;
        const sample = getPlayBarScrubSample(initialContentX);
        if (!sample)
            return;
        const resolvedPlayheadTime = updatePlayheadFromScrubSample(sample);
        setScrubbingState({
            startX: e.clientX,
            startContentX: initialContentX,
            currentContentX: initialContentX,
            resolvedContentX: sample.contentX,
            resolvedPlayheadTime,
            activeClipId: sample.clip.id,
            clientX: e.clientX,
            clientY: e.clientY,
        });
    }, [getPlayBarScrubSample, updatePlayheadFromScrubSample]);
    const handleDragBarPointerMove = useCallback((e) => {
        if (!scrubbingState)
            return;
        e.stopPropagation();
        const deltaX = e.clientX - scrubbingState.startX;
        const currentContentX = scrubbingState.startContentX + deltaX;
        const sample = getPlayBarScrubSample(currentContentX);
        if (sample) {
            const resolvedPlayheadTime = updatePlayheadFromScrubSample(sample);
            setScrubbingState(Object.assign(Object.assign({}, scrubbingState), { currentContentX, resolvedContentX: sample.contentX, resolvedPlayheadTime, activeClipId: sample.clip.id, clientX: e.clientX, clientY: e.clientY }));
            return;
        }
        setScrubbingState(Object.assign(Object.assign({}, scrubbingState), { currentContentX, clientX: e.clientX, clientY: e.clientY }));
    }, [getPlayBarScrubSample, scrubbingState, updatePlayheadFromScrubSample]);
    const handleDragBarPointerUp = useCallback((e) => {
        if (!scrubbingState)
            return;
        e.stopPropagation();
        e.currentTarget.releasePointerCapture(e.pointerId);
        setScrubbingState(null);
    }, [scrubbingState]);
    const clipItemProviderValue = useMemo(() => ({
        metrics: {
            pixelsPerSecond,
            itemTop,
            itemHeight,
            thumbnailMode,
            gridMetrics,
            thumbnailWidth,
            thumbnailGap: THUMBNAIL_GAP,
        },
        resizeHandlers: {
            onResizeDown: interactions.handleResizeDown,
            onResizeMove: interactions.handleResizeMove,
            onResizeUp: interactions.handleResizeUp,
            onResizeKeyDown: interactions.handleResizeKeyDown,
        },
        mediaActions: {
            onDurationLoaded: handleClipDurationLoad,
        },
        collectionActions: {
            getCollectionHref,
            onOpenCollection,
            onRenameCollection,
            onToggleCollectionEndpoint,
        },
    }), [
        getCollectionHref,
        gridMetrics,
        handleClipDurationLoad,
        interactions.handleResizeDown,
        interactions.handleResizeKeyDown,
        interactions.handleResizeMove,
        interactions.handleResizeUp,
        itemHeight,
        itemTop,
        onOpenCollection,
        onRenameCollection,
        onToggleCollectionEndpoint,
        pixelsPerSecond,
        thumbnailMode,
        thumbnailWidth,
    ]);
    const selectedFilmstripOverlay = showPlayBarArea && selectedVideoClip && !interactions.isReordering ? (_jsx("div", { className: "pointer-events-none absolute inset-0 z-[45]", style: {
            clipPath: `inset(-${FILMSTRIP_HEIGHT + FILMSTRIP_GAP + 12}px 0 -12px 0)`,
        }, children: _jsx(VideoSourceFilmStrip, { clip: selectedVideoClip, pixelsPerSecond: pixelsPerSecond, leftOffset: firstOverhang + closingOverhangOffset + interactions.trackTranslateX - scrollLeft, thumbnailMode: thumbnailMode, gridMetrics: gridMetrics, thumbnailWidth: thumbnailWidth, thumbnailGap: THUMBNAIL_GAP, topOffset: itemTop +
                (thumbnailMode && gridMetrics.enabled
                    ? getTimelineGridItemLayout(selectedVideoClip.index, gridMetrics).top
                    : 0) -
                FILMSTRIP_HEIGHT -
                FILMSTRIP_GAP, editingMode: interactions.isFilmStripEditing &&
                ((_a = interactions.activeFilmStripEdit) === null || _a === void 0 ? void 0 : _a.index) === selectedVideoClip.index
                ? interactions.activeFilmStripEdit.mode
                : interactions.isResizing &&
                    ((_b = interactions.activeResize) === null || _b === void 0 ? void 0 : _b.index) === selectedVideoClip.index
                    ? interactions.activeResize.edge
                    : null, onSourceWindowPointerDown: interactions.handleFilmStripPointerDown }, `filmstrip-${selectedVideoClip.id}`) })) : null;
    const viewportWrapperStyle = {
        width: resolvedViewportWidth,
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
    };
    return (_jsxs("div", { className: "relative block w-full max-w-full min-w-0", style: viewportWrapperStyle, children: [_jsxs("div", { ref: parentRef, "data-testid": "timeline-scroll-viewport", "data-scroll-left": scrollLeft, "data-scroll-top": scrollTop, onScroll: handleScroll, onPointerDown: interactions.handlePointerDown, onPointerCancel: interactions.handlePointerCancel, onDragStart: (event) => event.preventDefault(), onDragEnter: handleDragEnter, onDragLeave: handleDragLeave, onDragOver: handleDragOver, onDrop: handleDrop, className: `relative block w-full max-w-full min-w-0 select-none rounded-lg border transition-all duration-200 ${isDragOver
                    ? "border-sky-500 bg-sky-950/20 ring-2 ring-sky-500/50"
                    : isAnyDragActive
                        ? "border-dashed border-sky-400 bg-sky-950/5 animate-pulse"
                        : "border-zinc-800 bg-zinc-950"} ${gridMetrics.enabled
                    ? "overflow-x-clip overflow-y-visible"
                    : "cursor-grab touch-none overflow-x-scroll overflow-y-hidden pb-1.5 active:cursor-grabbing"}`, onContextMenu: handleContextMenu, style: viewportStyle, children: [_jsx("div", { className: "relative block", style: {
                            width: `${timelineWidth}px`,
                            minWidth: `${timelineWidth}px`,
                            maxWidth: "none",
                            height: `${timelineHeight}px`,
                            boxSizing: "border-box",
                            transform: `translateX(${interactions.trackTranslateX}px)`,
                            transition: trackTransition,
                        }, children: _jsx("div", { ref: contentRef, className: "relative w-full h-full", style: {
                                transform: `translateX(${firstOverhang + closingOverhangOffset}px)`,
                                transition: contentTransition,
                            }, children: !hasClips ? (_jsx("div", { className: "flex h-full w-full items-center justify-center text-xs text-zinc-500", children: "No items" })) : (_jsxs(_Fragment, { children: [_jsx(TimelineClipItemProvider, { value: clipItemProviderValue, children: visibleClips.map((clip) => {
                                            var _a, _b, _c, _d;
                                            return (_jsx(TimelineClipItem, { clip: clip, state: {
                                                    isSelected: selectedIndex === clip.index,
                                                    isGrowingOpposite: ((_a = interactions.activeResize) === null || _a === void 0 ? void 0 : _a.index) === 0 &&
                                                        interactions.activeResize.edge === "left" &&
                                                        clip.index === 0,
                                                    scrubPreviewTime: (scrubPreview === null || scrubPreview === void 0 ? void 0 : scrubPreview.clipIndex) === clip.index
                                                        ? scrubPreview.time
                                                        : null,
                                                    isReordering: interactions.isReordering,
                                                    isCollectionHovered: activeCollectionHoverId === clip.id,
                                                    reorderPreview: ((_b = interactions.reorderPreview) === null || _b === void 0 ? void 0 : _b.activeClipId) === clip.id
                                                        ? interactions.reorderPreview
                                                        : null,
                                                    collectionEndpointSelection: clip.kind === "collection"
                                                        ? {
                                                            first: Boolean(exposedCollectionEndpointIds === null || exposedCollectionEndpointIds === void 0 ? void 0 : exposedCollectionEndpointIds.has(`${(_c = clip.viewExpansionKey) !== null && _c !== void 0 ? _c : clip.id}::first`)),
                                                            last: Boolean(exposedCollectionEndpointIds === null || exposedCollectionEndpointIds === void 0 ? void 0 : exposedCollectionEndpointIds.has(`${(_d = clip.viewExpansionKey) !== null && _d !== void 0 ? _d : clip.id}::last`)),
                                                        }
                                                        : undefined,
                                                } }, clip.id));
                                        }) }), collectionEndpointLinkMarkers.map((marker) => {
                                        const ArrowIcon = marker.endpoint === "first" ? ArrowRight : ArrowLeft;
                                        return (_jsx("button", { type: "button", "data-testid": "timeline-collection-endpoint-link", "data-endpoint": marker.endpoint, "aria-label": `Hide ${marker.endpoint} collection endpoint`, title: `Hide ${marker.endpoint} endpoint`, className: "absolute z-[42] grid h-8 w-8 place-items-center rounded-full border border-sky-300/50 bg-zinc-950/85 text-sky-200 shadow-[0_8px_20px_rgba(2,132,199,0.35)] ring-1 ring-black/40 backdrop-blur transition-colors hover:border-sky-200 hover:bg-sky-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 focus-visible:outline-offset-2", style: {
                                                left: `${marker.left}px`,
                                                top: `${marker.top}px`,
                                                transform: "translate(-50%, -50%)",
                                            }, onPointerDown: (event) => {
                                                event.stopPropagation();
                                            }, onClick: (event) => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                onToggleCollectionEndpoint === null || onToggleCollectionEndpoint === void 0 ? void 0 : onToggleCollectionEndpoint(marker.collectionClip, marker.endpoint);
                                            }, children: _jsx(ArrowIcon, { className: "h-4 w-4", "aria-hidden": "true" }) }, marker.id));
                                    }), playheadTime !== null && (() => {
                                        const pLeft = getPlayheadLeft(playheadTime);
                                        if (pLeft === null)
                                            return null;
                                        return (_jsx(TimelinePlayhead, { itemHeight: itemHeight, itemTop: itemTop, left: pLeft }));
                                    })(), !interactions.isReordering &&
                                        selectedIndex === null &&
                                        showPlayBarArea &&
                                        visibleClips.map((clip) => clip.kind === "video" || clip.kind === "image" || clip.kind === "collection" ? (_jsx(PassiveVideoFilmStrip, { clip: clip, pixelsPerSecond: pixelsPerSecond, thumbnailMode: thumbnailMode, gridMetrics: gridMetrics, thumbnailWidth: thumbnailWidth, thumbnailGap: THUMBNAIL_GAP, onPointerDown: (event) => handlePlayBarPointerDown(event), onPointerMove: (event) => handleDragBarPointerMove(event), onPointerUp: (event) => handleDragBarPointerUp(event), onPointerCancel: (event) => handleDragBarPointerUp(event), showFilmstrip: showPassiveFilmstrips }, `${clip.id}-passive-filmstrip`)) : null)] })) }) }), _jsx(TimelineDropOverlay, { isVisible: isDragOver }), activeDropIndex !== null && (_jsx(TimelineDropIndicator, { itemHeight: itemHeight, itemTop: itemTop, left: getDropIndicatorLeft(activeDropIndex) })), contextMenu && createPortal(_jsx(TimelineContextMenu, { insertIndex: contextMenu.insertIndex, onAddClip: onDropSidebarClip, onClose: () => setContextMenu(null), thumbnailMode: thumbnailMode, timelineTime: contextMenu.timelineTime, x: contextMenu.x, y: contextMenu.y }), document.body), scrubbingState && showFloatingDragPreview && (() => {
                        var _a;
                        const previewClip = visibleClips.find((clip) => clip.id === scrubbingState.activeClipId);
                        let previewSrc = "";
                        let mediaTime = 0;
                        let displayTime = 0;
                        let previewKind = null;
                        let previewVideoSrc = "";
                        let previewVideoTime = 0;
                        let previewVideoDuration = 0;
                        if (previewClip) {
                            const left = getClipLeft(previewClip);
                            const width = getClipWidth(previewClip);
                            const ratio = Math.max(0, Math.min(1, (scrubbingState.resolvedContentX - left) / Math.max(1, width)));
                            mediaTime = previewClip.kind === "collection"
                                ? ratio * getClipPlaybackDuration(previewClip)
                                : previewClip.trimIn + ratio * previewClip.duration;
                            displayTime = scrubbingState.resolvedPlayheadTime;
                            previewKind = previewClip.kind;
                            if (previewClip.kind === "video") {
                                previewVideoSrc = previewClip.src;
                                previewVideoTime = mediaTime;
                                previewVideoDuration = previewClip.duration;
                                previewSrc = previewClip.src;
                            }
                            else if (previewClip.kind === "collection") {
                                const activePreview = getCollectionClipFramePreview(getCollectionPreviewClip(previewClip), mediaTime);
                                if (activePreview) {
                                    if (activePreview.kind === "video") {
                                        previewKind = "video";
                                        previewVideoSrc = activePreview.src;
                                        previewVideoTime = activePreview.previewTime;
                                        previewVideoDuration = activePreview.sourceDuration || 6;
                                        previewSrc = activePreview.src;
                                    }
                                    else {
                                        previewKind = "image";
                                        previewSrc = activePreview.src;
                                    }
                                }
                                else {
                                    const firstItem = (_a = previewClip.previewItems) === null || _a === void 0 ? void 0 : _a[0];
                                    if (firstItem) {
                                        if (firstItem.kind === "video") {
                                            previewKind = "video";
                                            previewVideoSrc = firstItem.src;
                                            previewVideoTime = 0;
                                            previewVideoDuration = 6;
                                            previewSrc = firstItem.src;
                                        }
                                        else {
                                            previewKind = "image";
                                            previewSrc = firstItem.src;
                                        }
                                    }
                                }
                            }
                            else if (previewClip.kind === "image") {
                                previewSrc = previewClip.src;
                            }
                        }
                        return createPortal(_jsxs("div", { className: "fixed z-[99999] rounded-xl bg-zinc-950/95 border border-zinc-800 p-2 shadow-2xl backdrop-blur-md text-[10px] font-bold text-zinc-100 flex flex-col items-center gap-2 animate-in fade-in zoom-in-95 duration-100 w-44 select-none", style: {
                                left: `${scrubbingState.clientX}px`,
                                top: `${scrubbingState.clientY - 145}px`,
                                transform: "translateX(-50%)",
                                pointerEvents: "none",
                            }, children: [_jsx("div", { className: "w-full aspect-video bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800/80 relative flex items-center justify-center", children: previewSrc ? (previewKind === "video" ? (_jsx(VideoTile, { src: previewVideoSrc, alt: "Video preview", previewTime: previewVideoTime, sourceDuration: previewVideoDuration, preferVideoPreview: true })) : (_jsx("img", { src: previewSrc, alt: "Scrub frame preview", className: "w-full h-full object-cover", draggable: false }))) : (_jsxs("div", { className: "flex flex-col items-center justify-center text-zinc-600 gap-1", children: [_jsx(Play, { className: "h-4 w-4 opacity-40" }), _jsx("span", { className: "text-[8px] uppercase tracking-wider", children: "No Media" })] })) }), _jsxs("div", { className: "flex w-full items-center justify-between px-1", children: [_jsx("span", { className: "text-amber-400 font-extrabold uppercase tracking-wide", children: previewClip ? `${previewClip.kind} #${previewClip.index + 1}` : "Playhead" }), _jsx("span", { className: "text-zinc-300 font-extrabold", children: formatSeconds(displayTime) })] })] }), document.body);
                    })()] }), selectedFilmstripOverlay] }));
}

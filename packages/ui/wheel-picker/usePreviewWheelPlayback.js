import React from 'react';
const clamp = (value, min, max) => (Math.max(min, Math.min(max, value)));
const formatPlaybackTime = (seconds) => {
    const totalTenths = Math.round(Math.max(0, seconds) * 10);
    const minutes = Math.floor(totalTenths / 600);
    const remainingSeconds = (totalTenths % 600) / 10;
    return `${String(minutes).padStart(2, '0')}:${remainingSeconds.toFixed(1).padStart(4, '0')}`;
};
const formatPlaybackTimestamp = (currentSeconds, totalSeconds) => (`${formatPlaybackTime(currentSeconds)} / ${formatPlaybackTime(totalSeconds)}`);
export function usePreviewWheelPlayback({ isPreviewPlaying, loopPreviewPlayback, totalDurationSeconds, itemDurations, itemStartTimes, items, sizing, isGallery, timelineOriginOffset, itemStartPixels, itemCenterPositions, finalIndex, selectedMediaId, onPreviewPlaybackComplete, onPlaybackMediaChange, onPlaybackTimeUpdate, setOffset, resolveItemSnapshot, effectiveScrubSnapshot, hidePreview, viewportSize, playheadX, renderedPlayheadX, gridPlayheadRatio, setGridPlayheadRatio, stopAnimation, offsetRef, setPlayheadPositionRatio, onCenteredMediaChange, setTrimOverlayMediaId, setDirectPreviewMediaId, playbackTimeRef, wasPreviewPlayingRef, playbackSelectedMediaIdRef, playbackResolvedMediaKeyRef, prominentTimestampRef, playbackSnapshotTime, setPlaybackSnapshotTime, }) {
    const playbackFrameRef = React.useRef(null);
    const [isPlayheadDragging, setIsPlayheadDragging] = React.useState(false);
    const playheadDragRef = React.useRef({
        isDragging: false,
        pointerId: -1,
        startClientX: 0,
        startPlayheadX: 0,
        startOffset: 0,
    });
    const scrubWithPlayhead = React.useCallback((nextPlayheadX, originPlayheadX, originOffset) => {
        const boundedPlayheadX = clamp(nextPlayheadX, 32, Math.max(32, viewportSize.width - 32));
        const nextRatio = boundedPlayheadX / Math.max(1, viewportSize.width);
        setPlayheadPositionRatio(nextRatio);
        if (hidePreview)
            setGridPlayheadRatio(nextRatio);
        setOffset(originOffset - (boundedPlayheadX - originPlayheadX));
        setDirectPreviewMediaId(null);
    }, [hidePreview, setOffset, viewportSize.width, setPlayheadPositionRatio, setGridPlayheadRatio, setDirectPreviewMediaId]);
    const seekGridPlayheadToXRef = React.useRef(() => undefined);
    // Sync snapshot times when preview is not playing
    React.useLayoutEffect(() => {
        var _a;
        const wasPlaying = wasPreviewPlayingRef.current;
        wasPreviewPlayingRef.current = isPreviewPlaying;
        if (isPreviewPlaying)
            return;
        const nextTime = wasPlaying
            ? playbackTimeRef.current
            : (_a = effectiveScrubSnapshot === null || effectiveScrubSnapshot === void 0 ? void 0 : effectiveScrubSnapshot.timelineTimeSeconds) !== null && _a !== void 0 ? _a : 0;
        playbackTimeRef.current = nextTime;
        playbackSelectedMediaIdRef.current = selectedMediaId;
        if (prominentTimestampRef.current) {
            prominentTimestampRef.current.textContent = formatPlaybackTimestamp(nextTime, totalDurationSeconds);
        }
    }, [effectiveScrubSnapshot === null || effectiveScrubSnapshot === void 0 ? void 0 : effectiveScrubSnapshot.timelineTimeSeconds, isPreviewPlaying, selectedMediaId, totalDurationSeconds, playbackTimeRef, wasPreviewPlayingRef, playbackSelectedMediaIdRef, prominentTimestampRef]);
    // Main playback tick animation loop
    React.useEffect(() => {
        if (hidePreview)
            return;
        if (!isPreviewPlaying || totalDurationSeconds <= 0) {
            playbackResolvedMediaKeyRef.current = null;
            return;
        }
        let lastTime = performance.now();
        const tick = (now) => {
            var _a, _b, _c, _d, _e;
            const deltaSeconds = Math.max(0, (now - lastTime) / 1000);
            lastTime = now;
            let nextTime = playbackTimeRef.current + deltaSeconds;
            let didLoop = false;
            if (nextTime >= totalDurationSeconds) {
                if (loopPreviewPlayback) {
                    nextTime %= totalDurationSeconds;
                    didLoop = true;
                }
                else {
                    playbackTimeRef.current = totalDurationSeconds;
                    if (prominentTimestampRef.current) {
                        prominentTimestampRef.current.textContent = formatPlaybackTimestamp(totalDurationSeconds, totalDurationSeconds);
                    }
                    onPreviewPlaybackComplete === null || onPreviewPlaybackComplete === void 0 ? void 0 : onPreviewPlaybackComplete();
                    return;
                }
            }
            playbackTimeRef.current = nextTime;
            if (prominentTimestampRef.current) {
                prominentTimestampRef.current.textContent = formatPlaybackTimestamp(nextTime, totalDurationSeconds);
            }
            let playbackIndex = finalIndex;
            for (let index = 0; index < itemDurations.length; index += 1) {
                const itemEndTime = ((_a = itemStartTimes[index]) !== null && _a !== void 0 ? _a : 0) + ((_b = itemDurations[index]) !== null && _b !== void 0 ? _b : 0.5);
                if (nextTime < itemEndTime) {
                    playbackIndex = index;
                    break;
                }
            }
            const playbackItem = items[playbackIndex];
            if (playbackItem) {
                const itemElapsedSeconds = Math.max(0, nextTime - ((_c = itemStartTimes[playbackIndex]) !== null && _c !== void 0 ? _c : 0));
                onPlaybackTimeUpdate === null || onPlaybackTimeUpdate === void 0 ? void 0 : onPlaybackTimeUpdate(playbackItem.id, itemElapsedSeconds);
                const resolvedMedia = resolveItemSnapshot(playbackItem, itemElapsedSeconds).media;
                const resolvedMediaKey = `${playbackIndex}:${resolvedMedia.id}`;
                if (didLoop || playbackResolvedMediaKeyRef.current !== resolvedMediaKey) {
                    playbackResolvedMediaKeyRef.current = resolvedMediaKey;
                    setPlaybackSnapshotTime(nextTime);
                }
            }
            if (playbackItem && playbackSelectedMediaIdRef.current !== playbackItem.id) {
                playbackSelectedMediaIdRef.current = playbackItem.id;
                setOffset((sizing === 'duration' || isGallery)
                    ? timelineOriginOffset - ((_d = itemStartPixels[playbackIndex]) !== null && _d !== void 0 ? _d : 0)
                    : -((_e = itemCenterPositions[playbackIndex]) !== null && _e !== void 0 ? _e : 0));
                onPlaybackMediaChange === null || onPlaybackMediaChange === void 0 ? void 0 : onPlaybackMediaChange(playbackItem.id);
            }
            playbackFrameRef.current = window.requestAnimationFrame(tick);
        };
        playbackFrameRef.current = window.requestAnimationFrame(tick);
        return () => {
            if (playbackFrameRef.current !== null) {
                window.cancelAnimationFrame(playbackFrameRef.current);
                playbackFrameRef.current = null;
            }
        };
    }, [
        finalIndex,
        isPreviewPlaying,
        itemCenterPositions,
        itemDurations,
        itemStartPixels,
        itemStartTimes,
        items,
        loopPreviewPlayback,
        onPlaybackMediaChange,
        onPreviewPlaybackComplete,
        resolveItemSnapshot,
        setOffset,
        sizing,
        timelineOriginOffset,
        totalDurationSeconds,
        hidePreview,
        onPlaybackTimeUpdate,
        playbackResolvedMediaKeyRef,
        playbackSelectedMediaIdRef,
        playbackTimeRef,
        prominentTimestampRef,
    ]);
    const beginPlayheadDrag = React.useCallback((event) => {
        if (event.button !== 0)
            return;
        event.preventDefault();
        event.stopPropagation();
        stopAnimation();
        playheadDragRef.current = {
            isDragging: true,
            pointerId: event.pointerId,
            startClientX: event.clientX,
            startPlayheadX: renderedPlayheadX,
            startOffset: offsetRef.current,
        };
        setIsPlayheadDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    }, [renderedPlayheadX, stopAnimation, offsetRef]);
    const movePlayheadDrag = React.useCallback((event) => {
        const drag = playheadDragRef.current;
        if (!drag.isDragging || drag.pointerId !== event.pointerId)
            return;
        event.preventDefault();
        event.stopPropagation();
        if (hidePreview) {
            seekGridPlayheadToXRef.current(drag.startPlayheadX + event.clientX - drag.startClientX);
            return;
        }
        scrubWithPlayhead(drag.startPlayheadX + event.clientX - drag.startClientX, playheadX, drag.startOffset);
    }, [hidePreview, playheadX, scrubWithPlayhead]);
    const endPlayheadDrag = React.useCallback((event) => {
        const drag = playheadDragRef.current;
        if (!drag.isDragging || drag.pointerId !== event.pointerId)
            return;
        event.preventDefault();
        event.stopPropagation();
        drag.isDragging = false;
        drag.pointerId = -1;
        setIsPlayheadDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        const nextPlayheadX = drag.startPlayheadX + event.clientX - drag.startClientX;
        if (hidePreview) {
            seekGridPlayheadToXRef.current(nextPlayheadX);
            return;
        }
        scrubWithPlayhead(nextPlayheadX, playheadX, drag.startOffset);
        const nextRatio = clamp(nextPlayheadX, 32, Math.max(32, viewportSize.width - 32)) /
            Math.max(1, viewportSize.width);
        localStorage.setItem('scene-launch-playhead-position', String(nextRatio));
    }, [hidePreview, playheadX, scrubWithPlayhead, viewportSize.width]);
    return {
        playbackSnapshotTime,
        isPlayheadDragging,
        playheadDragRef,
        beginPlayheadDrag,
        movePlayheadDrag,
        endPlayheadDrag,
        seekGridPlayheadToXRef,
        scrubWithPlayhead,
    };
}

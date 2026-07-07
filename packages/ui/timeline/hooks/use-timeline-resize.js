import { useCallback, useRef, useState } from "react";
import { MAX_WIDTH, RESIZE_KEY_STEP_PX, TIMELINE_TRAILING_PADDING_SECONDS, } from "../constants";
import { getTrimHandleSourceTime } from "../utils";
import { resizeClipsFromBaseline } from "./use-timeline-clips";
export function useTimelineResize({ applyClipsNow, clips, minDuration, parentRef, pendingScrollLeftRef, safePixelsPerSecond, setScrollLeft, setScrubPreview, setSelectedIndex, setTrackTranslateX, stopInertia, }) {
    const [isResizing, setIsResizing] = useState(false);
    const [activeResize, setActiveResize] = useState(null);
    const [isSnappingBack, setIsSnappingBack] = useState(false);
    const resizeState = useRef({
        active: false,
        anchorIndex: -1,
        edge: "right",
        startX: 0,
        startScrollLeft: 0,
        baselineClips: null,
    });
    const writeScrollLeft = useCallback((value) => {
        setScrollLeft(value);
        if (pendingScrollLeftRef) {
            pendingScrollLeftRef.current = value;
        }
        else if (parentRef.current) {
            parentRef.current.scrollLeft = value;
        }
    }, [parentRef, pendingScrollLeftRef, setScrollLeft]);
    const getResizedClips = useCallback((clientX) => {
        const state = resizeState.current;
        if (!state.baselineClips)
            return clips;
        return resizeClipsFromBaseline({
            baselineClips: state.baselineClips,
            anchorIndex: state.anchorIndex,
            edge: state.edge,
            deltaTime: (clientX - state.startX) / safePixelsPerSecond,
            minDuration,
        });
    }, [clips, minDuration, safePixelsPerSecond]);
    const compensateLeftResize = useCallback((nextClips) => {
        const state = resizeState.current;
        if (!state.baselineClips || state.anchorIndex === 0) {
            setTrackTranslateX(0);
            return;
        }
        const durationDelta = nextClips[state.anchorIndex].duration -
            state.baselineClips[state.anchorIndex].duration;
        const targetScrollLeft = state.startScrollLeft + durationDelta * safePixelsPerSecond;
        const nextScrollLeft = Math.max(0, targetScrollLeft);
        writeScrollLeft(nextScrollLeft);
        setTrackTranslateX(targetScrollLeft < 0 ? -targetScrollLeft : 0);
    }, [safePixelsPerSecond, setTrackTranslateX, writeScrollLeft]);
    const handleResizeDown = useCallback((event, clip, edge) => {
        var _a, _b;
        event.stopPropagation();
        event.preventDefault();
        stopInertia();
        setSelectedIndex(clip.index);
        setScrubPreview(clip.kind === "video"
            ? { clipIndex: clip.index, time: getTrimHandleSourceTime(clip, edge) }
            : null);
        Object.assign(resizeState.current, {
            active: true,
            anchorIndex: clip.index,
            edge,
            startX: event.clientX,
            startScrollLeft: (_b = (_a = parentRef.current) === null || _a === void 0 ? void 0 : _a.scrollLeft) !== null && _b !== void 0 ? _b : 0,
            baselineClips: clips.map((currentClip) => (Object.assign({}, currentClip))),
        });
        setIsResizing(true);
        setActiveResize({ index: clip.index, edge });
        event.currentTarget.setPointerCapture(event.pointerId);
    }, [clips, parentRef, setScrubPreview, setSelectedIndex, stopInertia]);
    const handleResizeMove = useCallback((event) => {
        const state = resizeState.current;
        if (!state.active || !state.baselineClips)
            return;
        event.stopPropagation();
        event.preventDefault();
        const nextClips = getResizedClips(event.clientX);
        const previewClip = nextClips[state.anchorIndex];
        if ((previewClip === null || previewClip === void 0 ? void 0 : previewClip.kind) === "video") {
            setScrubPreview({
                clipIndex: previewClip.index,
                time: getTrimHandleSourceTime(previewClip, state.edge),
            });
        }
        if (state.edge === "left")
            compensateLeftResize(nextClips);
        else
            setTrackTranslateX(0);
        applyClipsNow(nextClips);
    }, [
        applyClipsNow,
        compensateLeftResize,
        getResizedClips,
        setScrubPreview,
        setTrackTranslateX,
    ]);
    const resetResize = useCallback(() => {
        const state = resizeState.current;
        state.active = false;
        state.anchorIndex = -1;
        state.baselineClips = null;
        setIsResizing(false);
        setActiveResize(null);
    }, []);
    const handleResizeUp = useCallback((event) => {
        var _a, _b;
        const state = resizeState.current;
        if (!state.active || !state.baselineClips)
            return;
        event.stopPropagation();
        event.preventDefault();
        const nextClips = getResizedClips(event.clientX);
        if (state.edge === "left") {
            compensateLeftResize(nextClips);
            setTrackTranslateX(0);
        }
        else {
            const maxDuration = nextClips.reduce((maximum, clip) => Math.max(maximum, clip.startTime + clip.duration), 0) + TIMELINE_TRAILING_PADDING_SECONDS;
            const expectedScrollLeft = Math.max(0, Math.ceil(maxDuration * safePixelsPerSecond) -
                (((_a = parentRef.current) === null || _a === void 0 ? void 0 : _a.clientWidth) || 0));
            const currentScrollLeft = ((_b = parentRef.current) === null || _b === void 0 ? void 0 : _b.scrollLeft) || 0;
            if (currentScrollLeft > expectedScrollLeft) {
                setTrackTranslateX(-(currentScrollLeft - expectedScrollLeft));
                setIsSnappingBack(true);
                setIsResizing(false);
                setActiveResize(null);
                if (pendingScrollLeftRef) {
                    pendingScrollLeftRef.current = expectedScrollLeft;
                }
                requestAnimationFrame(() => {
                    setTrackTranslateX(0);
                    setIsSnappingBack(false);
                });
                applyClipsNow(nextClips);
                setScrubPreview(null);
                state.active = false;
                state.anchorIndex = -1;
                state.baselineClips = null;
                const target = event.currentTarget;
                if (target.hasPointerCapture(event.pointerId)) {
                    target.releasePointerCapture(event.pointerId);
                }
                return;
            }
            setTrackTranslateX(0);
        }
        applyClipsNow(nextClips);
        setScrubPreview(null);
        resetResize();
        const target = event.currentTarget;
        if (target.hasPointerCapture(event.pointerId)) {
            target.releasePointerCapture(event.pointerId);
        }
    }, [
        applyClipsNow,
        compensateLeftResize,
        getResizedClips,
        parentRef,
        pendingScrollLeftRef,
        resetResize,
        safePixelsPerSecond,
        setScrubPreview,
        setTrackTranslateX,
    ]);
    const handleResizeKeyDown = useCallback((event, clip, edge) => {
        var _a, _b;
        const deltaPixels = event.key === "Home"
            ? -MAX_WIDTH
            : event.key === "End"
                ? MAX_WIDTH
                : event.key === "ArrowLeft"
                    ? -RESIZE_KEY_STEP_PX
                    : event.key === "ArrowRight"
                        ? RESIZE_KEY_STEP_PX
                        : null;
        if (deltaPixels === null)
            return;
        event.preventDefault();
        event.stopPropagation();
        stopInertia();
        setSelectedIndex(clip.index);
        setScrubPreview(null);
        const nextClips = resizeClipsFromBaseline({
            baselineClips: clips.map((currentClip) => (Object.assign({}, currentClip))),
            anchorIndex: clip.index,
            edge,
            deltaTime: deltaPixels / safePixelsPerSecond,
            minDuration,
        });
        if (edge === "left") {
            if (clip.index !== 0) {
                const durationDelta = nextClips[clip.index].duration - clips[clip.index].duration;
                writeScrollLeft(Math.max(0, ((_b = (_a = parentRef.current) === null || _a === void 0 ? void 0 : _a.scrollLeft) !== null && _b !== void 0 ? _b : 0) +
                    durationDelta * safePixelsPerSecond));
            }
            setTrackTranslateX(0);
        }
        applyClipsNow(nextClips);
    }, [
        applyClipsNow,
        clips,
        minDuration,
        parentRef,
        safePixelsPerSecond,
        setScrubPreview,
        setSelectedIndex,
        setTrackTranslateX,
        stopInertia,
        writeScrollLeft,
    ]);
    const cancelResize = useCallback(() => {
        if (!resizeState.current.active)
            return;
        resetResize();
        setTrackTranslateX(0);
    }, [resetResize, setTrackTranslateX]);
    return {
        handleResizeDown,
        handleResizeMove,
        handleResizeUp,
        handleResizeKeyDown,
        cancelResize,
        isResizing,
        activeResize,
        isSnappingBack,
    };
}

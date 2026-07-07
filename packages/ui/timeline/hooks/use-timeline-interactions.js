import { useCallback, useMemo, useRef, useState } from "react";
import { useTimelineFilmstripEdit } from "./use-timeline-filmstrip-edit";
import { useTimelinePan } from "./use-timeline-pan";
import { useTimelineResize } from "./use-timeline-resize";
export function useTimelineInteractions({ parentRef, clips, safePixelsPerSecond, minDuration, gridMetrics, itemTop, thumbnailMode = false, thumbnailWidth = 0, setScrollLeft, setSelectedIndex, setScrubPreview, applyClipsNow, pendingScrollLeftRef, timelineId, }) {
    const [trackTranslateX, setTrackTranslateX] = useState(0);
    const windowDragCleanupRef = useRef(null);
    const cleanupWindowDragListeners = useCallback(() => {
        var _a;
        (_a = windowDragCleanupRef.current) === null || _a === void 0 ? void 0 : _a.call(windowDragCleanupRef);
        windowDragCleanupRef.current = null;
    }, []);
    const setWindowDragCleanup = useCallback((cleanup) => {
        windowDragCleanupRef.current = cleanup;
    }, []);
    const windowDrag = useMemo(() => ({
        cleanup: cleanupWindowDragListeners,
        setCleanup: setWindowDragCleanup,
    }), [cleanupWindowDragListeners, setWindowDragCleanup]);
    const pan = useTimelinePan({
        applyClipsNow,
        clips,
        parentRef,
        safePixelsPerSecond,
        setScrollLeft,
        setSelectedIndex,
        gridMetrics,
        itemTop,
        thumbnailMode,
        thumbnailWidth: thumbnailWidth !== null && thumbnailWidth !== void 0 ? thumbnailWidth : 0,
        windowDrag,
        timelineId,
    });
    const sharedOptions = {
        applyClipsNow,
        clips,
        minDuration,
        parentRef,
        pendingScrollLeftRef,
        safePixelsPerSecond,
        setScrollLeft,
        setScrubPreview,
        setSelectedIndex,
        setTrackTranslateX,
        stopInertia: pan.stopInertia,
        windowDrag,
    };
    const resize = useTimelineResize(sharedOptions);
    const filmstrip = useTimelineFilmstripEdit(Object.assign(Object.assign({}, sharedOptions), { thumbnailMode }));
    const handlePointerCancel = useCallback(() => {
        pan.cancelPan();
        resize.cancelResize();
        filmstrip.cancelFilmstripEdit();
        setScrubPreview(null);
        cleanupWindowDragListeners();
    }, [
        cleanupWindowDragListeners,
        filmstrip,
        pan,
        resize,
        setScrubPreview,
    ]);
    return {
        handlePointerDown: pan.handlePointerDown,
        handlePointerCancel,
        handleResizeDown: resize.handleResizeDown,
        handleResizeMove: resize.handleResizeMove,
        handleResizeUp: resize.handleResizeUp,
        handleResizeKeyDown: resize.handleResizeKeyDown,
        handleFilmStripPointerDown: filmstrip.handleFilmStripPointerDown,
        cleanupWindowDragListeners,
        stopInertia: pan.stopInertia,
        runInertia: pan.runInertia,
        trackTranslateX,
        isReordering: pan.isReordering,
        reorderPreview: pan.reorderPreview,
        isResizing: resize.isResizing,
        activeResize: resize.activeResize,
        isSnappingBack: resize.isSnappingBack,
        isFilmStripEditing: filmstrip.isFilmStripEditing,
        activeFilmStripEdit: filmstrip.activeFilmStripEdit,
        isUnfreezing: filmstrip.isUnfreezing,
    };
}

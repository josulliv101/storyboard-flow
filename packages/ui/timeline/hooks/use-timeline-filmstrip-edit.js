import { useCallback, useRef, useState } from "react";
import { DRAG_THRESHOLD_PX } from "../constants";
import { getSourceTimeFromClientX } from "../utils";
import { editVideoSourceWindowFromBaseline } from "./use-timeline-clips";
import { useTimelineDocuments } from "../timeline-document-store";
export function useTimelineFilmstripEdit({ applyClipsNow, clips, minDuration, parentRef, pendingScrollLeftRef, safePixelsPerSecond, setScrollLeft, setScrubPreview, setSelectedIndex, setTrackTranslateX, stopInertia, thumbnailMode, windowDrag, }) {
    const { getCollectionEndpointSummary } = useTimelineDocuments();
    const [isFilmStripEditing, setIsFilmStripEditing] = useState(false);
    const [activeFilmStripEdit, setActiveFilmStripEdit] = useState(null);
    const [isUnfreezing, setIsUnfreezing] = useState(false);
    const editState = useRef({
        active: false,
        anchorIndex: -1,
        mode: "move",
        startX: 0,
        lastX: 0,
        startSourceTime: 0,
        lastSourceTime: 0,
        pointerId: -1,
        sourceSecondsPerPixel: 0,
        startScrollLeft: 0,
        moved: false,
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
    const resetFilmstripEdit = useCallback(() => {
        const state = editState.current;
        state.active = false;
        state.anchorIndex = -1;
        state.pointerId = -1;
        state.moved = false;
        state.baselineClips = null;
        setIsFilmStripEditing(false);
        setActiveFilmStripEdit(null);
        setTrackTranslateX(0);
        setIsUnfreezing(true);
        requestAnimationFrame(() => setIsUnfreezing(false));
    }, [setTrackTranslateX]);
    const handleFilmStripPointerDown = useCallback((event, clip, mode) => {
        var _a, _b;
        if (clip.kind !== "video" && clip.kind !== "collection" && clip.kind !== "image")
            return;
        if (clip.kind === "collection" && mode !== "left" && mode !== "right")
            return;
        if (clip.kind === "image" && mode !== "left" && mode !== "right")
            return;
        if (event.pointerType === "mouse" && event.button !== 0)
            return;
        const filmStripElement = event.target.closest("[data-video-filmstrip]");
        if (!filmStripElement)
            return;
        event.stopPropagation();
        event.preventDefault();
        stopInertia();
        windowDrag.cleanup();
        setSelectedIndex(clip.index);
        const rect = filmStripElement.getBoundingClientRect();
        const sourceDuration = clip.kind === "collection"
            ? getCollectionEndpointSummary(clip).sourceDuration
            : clip.sourceDuration;
        const startSourceTime = getSourceTimeFromClientX({
            clientX: event.clientX,
            rectLeft: rect.left,
            rectWidth: Math.max(1, rect.width),
            sourceDuration,
        });
        const baselineClips = clips.map((currentClip) => (Object.assign({}, currentClip)));
        if (clip.kind === "collection") {
            const baselineClip = baselineClips[clip.index];
            if ((baselineClip === null || baselineClip === void 0 ? void 0 : baselineClip.kind) === "collection") {
                baselineClips[clip.index] = Object.assign(Object.assign({}, baselineClip), { sourceDuration });
            }
        }
        const state = editState.current;
        Object.assign(state, {
            active: true,
            anchorIndex: clip.index,
            mode,
            startX: event.clientX,
            lastX: event.clientX,
            startSourceTime,
            lastSourceTime: startSourceTime,
            pointerId: event.pointerId,
            sourceSecondsPerPixel: 1 / safePixelsPerSecond,
            startScrollLeft: (_b = (_a = parentRef.current) === null || _a === void 0 ? void 0 : _a.scrollLeft) !== null && _b !== void 0 ? _b : 0,
            moved: mode === "center",
            baselineClips,
        });
        setIsFilmStripEditing(true);
        setActiveFilmStripEdit({ index: clip.index, mode });
        const getEditedClips = (clientX) => {
            const currentState = editState.current;
            if (!currentState.baselineClips)
                return clips;
            const sourceTime = currentState.startSourceTime +
                (clientX - currentState.startX) *
                    currentState.sourceSecondsPerPixel;
            currentState.lastX = clientX;
            currentState.lastSourceTime = sourceTime;
            return editVideoSourceWindowFromBaseline({
                baselineClips: currentState.baselineClips,
                anchorIndex: currentState.anchorIndex,
                mode: currentState.mode,
                deltaTime: sourceTime - currentState.startSourceTime,
                sourceTime,
                minDuration,
            });
        };
        const previewEditedClips = (nextClips) => {
            const currentState = editState.current;
            const previewClip = nextClips[currentState.anchorIndex];
            if (currentState.mode === "left" && currentState.baselineClips) {
                if (currentState.anchorIndex !== 0) {
                    const durationDelta = nextClips[currentState.anchorIndex].duration -
                        currentState.baselineClips[currentState.anchorIndex].duration;
                    const scrollDelta = thumbnailMode
                        ? 0
                        : durationDelta * safePixelsPerSecond;
                    const targetScrollLeft = currentState.startScrollLeft + scrollDelta;
                    writeScrollLeft(Math.max(0, targetScrollLeft));
                    if (!thumbnailMode) {
                        setTrackTranslateX(targetScrollLeft < 0 ? -targetScrollLeft : 0);
                    }
                }
                else {
                    setTrackTranslateX(0);
                }
            }
            else if (!thumbnailMode && currentState.mode === "right") {
                setTrackTranslateX(0);
            }
            if ((previewClip === null || previewClip === void 0 ? void 0 : previewClip.kind) === "video" || (previewClip === null || previewClip === void 0 ? void 0 : previewClip.kind) === "collection") {
                setScrubPreview({
                    clipIndex: previewClip.index,
                    time: previewClip.trimIn,
                });
            }
        };
        setScrubPreview({ clipIndex: clip.index, time: clip.trimIn });
        if (mode === "center") {
            const nextClips = getEditedClips(event.clientX);
            previewEditedClips(nextClips);
            applyClipsNow(nextClips);
        }
        const targetElement = event.currentTarget;
        try {
            targetElement.setPointerCapture(event.pointerId);
        }
        catch (_c) { }
        const onPointerMove = (pointerEvent) => {
            const currentState = editState.current;
            if (pointerEvent.pointerId !== currentState.pointerId)
                return;
            pointerEvent.preventDefault();
            if (!currentState.moved &&
                Math.abs(pointerEvent.clientX - currentState.startX) <=
                    DRAG_THRESHOLD_PX) {
                return;
            }
            currentState.moved = true;
            const nextClips = getEditedClips(pointerEvent.clientX);
            previewEditedClips(nextClips);
            applyClipsNow(nextClips);
        };
        const finishEdit = (pointerEvent) => {
            const currentState = editState.current;
            if (pointerEvent.pointerId !== currentState.pointerId)
                return;
            const nextClips = currentState.baselineClips
                ? getEditedClips(currentState.moved ? pointerEvent.clientX : currentState.lastX)
                : clips;
            if (currentState.moved)
                applyClipsNow(nextClips);
            setScrubPreview(null);
            resetFilmstripEdit();
            try {
                if (targetElement.hasPointerCapture(pointerEvent.pointerId)) {
                    targetElement.releasePointerCapture(pointerEvent.pointerId);
                }
            }
            catch (_a) { }
            windowDrag.cleanup();
        };
        const cancelEdit = (pointerEvent) => {
            if (pointerEvent.pointerId !== editState.current.pointerId)
                return;
            setScrubPreview(null);
            resetFilmstripEdit();
            try {
                if (targetElement.hasPointerCapture(pointerEvent.pointerId)) {
                    targetElement.releasePointerCapture(pointerEvent.pointerId);
                }
            }
            catch (_a) { }
            windowDrag.cleanup();
        };
        window.addEventListener("pointermove", onPointerMove, { passive: false });
        window.addEventListener("pointerup", finishEdit);
        window.addEventListener("pointercancel", cancelEdit);
        windowDrag.setCleanup(() => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", finishEdit);
            window.removeEventListener("pointercancel", cancelEdit);
        });
    }, [
        applyClipsNow,
        clips,
        minDuration,
        parentRef,
        resetFilmstripEdit,
        safePixelsPerSecond,
        setScrubPreview,
        setSelectedIndex,
        setTrackTranslateX,
        stopInertia,
        thumbnailMode,
        windowDrag,
        writeScrollLeft,
    ]);
    const cancelFilmstripEdit = useCallback(() => {
        if (!editState.current.active)
            return;
        setScrubPreview(null);
        resetFilmstripEdit();
    }, [resetFilmstripEdit, setScrubPreview]);
    return {
        handleFilmStripPointerDown,
        cancelFilmstripEdit,
        isFilmStripEditing,
        activeFilmStripEdit,
        isUnfreezing,
    };
}

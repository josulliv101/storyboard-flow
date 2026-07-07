import { useCallback, useRef, useState } from "react";
import { DRAG_THRESHOLD_PX, THUMBNAIL_GAP } from "../constants";
import { getTimelineGridItemLayout, getTimelineGridTargetIndex, } from "../timeline-grid";
import { clamp } from "../utils";
import { reorderClipsFromBaseline } from "./use-timeline-clips";
const REORDER_AUTO_SCROLL_ZONE_PX = 96;
const REORDER_MAX_AUTO_SCROLL_PX_PER_FRAME = 28;
export function useTimelinePan({ applyClipsNow, clips, parentRef, safePixelsPerSecond, setScrollLeft, setSelectedIndex, gridMetrics, itemTop, thumbnailMode, thumbnailWidth, windowDrag, timelineId, }) {
    const inertiaFrameRef = useRef(null);
    const reorderAutoScrollFrameRef = useRef(null);
    const [reorderPreview, setReorderPreview] = useState(null);
    const dragState = useRef({
        isDragging: false,
        mode: "pending",
        startX: 0,
        startY: 0,
        startScrollLeft: 0,
        startScrollTop: 0,
        lastClientX: 0,
        lastClientY: 0,
        lastX: 0,
        lastTime: 0,
        velocity: 0,
        moved: false,
        pointerId: -1,
        pressedIndex: null,
        activeClipId: "",
        activeClipLeft: 0,
        activeClipTop: 0,
        contentOriginX: 0,
        contentOriginY: 0,
        pointerOffsetX: 0,
        pointerOffsetY: 0,
        targetIndex: -1,
        baselineClips: null,
    });
    const getClipLeft = useCallback((clip) => thumbnailMode && gridMetrics.enabled
        ? getTimelineGridItemLayout(clip.index, gridMetrics).left
        : thumbnailMode
            ? clip.index * (thumbnailWidth + THUMBNAIL_GAP)
            : clip.startTime * safePixelsPerSecond, [gridMetrics, safePixelsPerSecond, thumbnailMode, thumbnailWidth]);
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
            : clip.duration * safePixelsPerSecond, [gridMetrics, safePixelsPerSecond, thumbnailMode, thumbnailWidth]);
    const stopInertia = useCallback(() => {
        if (inertiaFrameRef.current !== null) {
            cancelAnimationFrame(inertiaFrameRef.current);
            inertiaFrameRef.current = null;
        }
    }, []);
    const stopReorderAutoScroll = useCallback(() => {
        if (reorderAutoScrollFrameRef.current !== null) {
            cancelAnimationFrame(reorderAutoScrollFrameRef.current);
            reorderAutoScrollFrameRef.current = null;
        }
    }, []);
    const runInertia = useCallback(() => {
        const element = parentRef.current;
        if (!element)
            return;
        const step = () => {
            const state = dragState.current;
            state.velocity *= 0.95;
            if (Math.abs(state.velocity) < 0.1) {
                inertiaFrameRef.current = null;
                return;
            }
            const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth);
            const nextScrollLeft = clamp(element.scrollLeft + state.velocity, 0, maxScroll);
            element.scrollLeft = nextScrollLeft;
            setScrollLeft(nextScrollLeft);
            if (nextScrollLeft === 0 || nextScrollLeft === maxScroll) {
                state.velocity = 0;
                inertiaFrameRef.current = null;
                return;
            }
            inertiaFrameRef.current = requestAnimationFrame(step);
        };
        inertiaFrameRef.current = requestAnimationFrame(step);
    }, [parentRef, setScrollLeft]);
    const handlePointerDown = useCallback((event) => {
        var _a, _b;
        if (event.pointerType === "mouse" && event.button !== 0)
            return;
        const element = parentRef.current;
        if (!element)
            return;
        if (event.target.closest("[data-trim-handle]"))
            return;
        stopInertia();
        windowDrag.cleanup();
        const clipElement = event.target.closest("[data-clip-index]");
        const parsedIndex = Number(clipElement === null || clipElement === void 0 ? void 0 : clipElement.dataset.clipIndex);
        const pressedIndex = Number.isFinite(parsedIndex) ? parsedIndex : null;
        const activeClip = pressedIndex === null
            ? null
            : (_a = clips.find((clip) => clip.index === pressedIndex)) !== null && _a !== void 0 ? _a : null;
        const activeClipLeft = activeClip ? getClipLeft(activeClip) : 0;
        const activeClipTop = activeClip ? getClipTop(activeClip) : 0;
        const activeClipRect = clipElement === null || clipElement === void 0 ? void 0 : clipElement.getBoundingClientRect();
        const contentOriginX = activeClipRect
            ? activeClipRect.left - activeClipLeft
            : 0;
        const contentOriginY = activeClipRect
            ? activeClipRect.top - activeClipTop
            : 0;
        const state = dragState.current;
        Object.assign(state, {
            isDragging: true,
            mode: "pending",
            moved: false,
            startX: event.clientX,
            startY: event.clientY,
            startScrollLeft: element.scrollLeft,
            startScrollTop: gridMetrics.enabled ? window.scrollY : element.scrollTop,
            lastClientX: event.clientX,
            lastClientY: event.clientY,
            lastX: event.clientX,
            lastTime: event.timeStamp,
            velocity: 0,
            pointerId: event.pointerId,
            pressedIndex,
            activeClipId: (_b = activeClip === null || activeClip === void 0 ? void 0 : activeClip.id) !== null && _b !== void 0 ? _b : "",
            activeClipLeft,
            activeClipTop,
            contentOriginX,
            contentOriginY,
            pointerOffsetX: activeClip
                ? event.clientX - contentOriginX - activeClipLeft
                : 0,
            pointerOffsetY: activeClip
                ? event.clientY - contentOriginY - activeClipTop
                : 0,
            targetIndex: pressedIndex !== null && pressedIndex !== void 0 ? pressedIndex : -1,
            baselineClips: activeClip
                ? clips.map((currentClip) => (Object.assign({}, currentClip)))
                : null,
        });
        try {
            element.setPointerCapture(event.pointerId);
        }
        catch (_c) { }
        const moveTimeline = (clientX, timeStamp) => {
            const currentState = dragState.current;
            const currentElement = parentRef.current;
            if (!currentState.isDragging || !currentElement)
                return;
            const deltaX = clientX - currentState.startX;
            if (!currentState.moved &&
                Math.abs(deltaX) <= DRAG_THRESHOLD_PX) {
                return;
            }
            currentState.moved = true;
            const maxScroll = Math.max(0, currentElement.scrollWidth - currentElement.clientWidth);
            const nextScrollLeft = clamp(currentState.startScrollLeft - deltaX, 0, maxScroll);
            currentElement.scrollLeft = nextScrollLeft;
            setScrollLeft(nextScrollLeft);
            const elapsed = timeStamp - currentState.lastTime;
            if (elapsed > 0) {
                const instantaneous = (-(clientX - currentState.lastX) / elapsed) * 16.67;
                currentState.velocity =
                    0.7 * instantaneous + 0.3 * currentState.velocity;
            }
            currentState.lastX = clientX;
            currentState.lastTime = timeStamp;
        };
        const getPointerContentX = (clientX) => {
            var _a;
            const currentState = dragState.current;
            const currentElement = parentRef.current;
            const scrollDelta = ((_a = currentElement === null || currentElement === void 0 ? void 0 : currentElement.scrollLeft) !== null && _a !== void 0 ? _a : currentState.startScrollLeft) -
                currentState.startScrollLeft;
            return clientX - currentState.contentOriginX + scrollDelta;
        };
        const getPointerContentY = (clientY) => {
            var _a;
            const currentState = dragState.current;
            const currentElement = parentRef.current;
            const scrollDelta = (gridMetrics.enabled
                ? window.scrollY
                : (_a = currentElement === null || currentElement === void 0 ? void 0 : currentElement.scrollTop) !== null && _a !== void 0 ? _a : currentState.startScrollTop) -
                currentState.startScrollTop;
            return clientY - currentState.contentOriginY + scrollDelta;
        };
        const getReorderTargetIndex = (clientX, clientY) => {
            var _a;
            const currentState = dragState.current;
            if (!currentState.baselineClips || !currentState.activeClipId) {
                return (_a = currentState.pressedIndex) !== null && _a !== void 0 ? _a : 0;
            }
            const pointerContentX = getPointerContentX(clientX);
            if (thumbnailMode && gridMetrics.enabled) {
                return getTimelineGridTargetIndex({
                    contentX: pointerContentX,
                    contentY: getPointerContentY(clientY) - itemTop,
                    itemCount: currentState.baselineClips.length,
                    metrics: gridMetrics,
                });
            }
            const clipsWithoutActive = currentState.baselineClips.filter((clip) => clip.id !== currentState.activeClipId);
            const targetIndex = clipsWithoutActive.findIndex((clip) => {
                const center = getClipLeft(clip) + getClipWidth(clip) / 2;
                return pointerContentX < center;
            });
            return clamp(targetIndex === -1 ? clipsWithoutActive.length : targetIndex, 0, currentState.baselineClips.length - 1);
        };
        const previewReorder = (clientX, clientY) => {
            const currentState = dragState.current;
            if (!currentState.baselineClips || !currentState.activeClipId)
                return;
            const targetIndex = getReorderTargetIndex(clientX, clientY);
            currentState.targetIndex = targetIndex;
            currentState.lastClientX = clientX;
            currentState.lastClientY = clientY;
            setReorderPreview({
                activeClipId: currentState.activeClipId,
                dragLeft: getPointerContentX(clientX) - currentState.pointerOffsetX,
                dragTop: getPointerContentY(clientY) - currentState.pointerOffsetY,
                dragOffsetY: clientY - currentState.startY,
                targetIndex,
                clientX,
                clientY,
                pointerOffsetX: currentState.pointerOffsetX,
                pointerOffsetY: currentState.pointerOffsetY,
            });
            // Dispatch window event for cross-timeline pointer dragging
            const activeClip = currentState.baselineClips.find(c => c.id === currentState.activeClipId);
            if (activeClip) {
                window.dispatchEvent(new CustomEvent("gstudio-clip-drag", {
                    detail: {
                        clip: activeClip,
                        sourceTimelineId: timelineId || "",
                        clientX,
                        clientY,
                        isDropping: false,
                    },
                }));
            }
            applyClipsNow(reorderClipsFromBaseline({
                activeClipId: currentState.activeClipId,
                baselineClips: currentState.baselineClips,
                targetIndex,
            }));
        };
        const startReorder = (clientX, clientY) => {
            const currentState = dragState.current;
            currentState.mode = "reorder";
            currentState.moved = true;
            currentState.velocity = 0;
            if (currentState.pressedIndex !== null) {
                setSelectedIndex(currentState.pressedIndex);
            }
            // Dispatch global start so other viewports show their drop state highlight
            window.dispatchEvent(new CustomEvent("gstudio-drag-start", { detail: { type: "clip" } }));
            previewReorder(clientX, clientY);
        };
        const getReorderAutoScrollVelocity = (clientX, clientY) => {
            const currentElement = parentRef.current;
            if (!currentElement)
                return { x: 0, y: 0 };
            const rect = currentElement.getBoundingClientRect();
            const maxScrollLeft = Math.max(0, currentElement.scrollWidth - currentElement.clientWidth);
            const maxScrollTop = gridMetrics.enabled
                ? Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
                : Math.max(0, currentElement.scrollHeight - currentElement.clientHeight);
            let x = 0;
            let y = 0;
            const leftDistance = clientX - rect.left;
            if (maxScrollLeft > 0 && leftDistance < REORDER_AUTO_SCROLL_ZONE_PX) {
                const intensity = (REORDER_AUTO_SCROLL_ZONE_PX - leftDistance) /
                    REORDER_AUTO_SCROLL_ZONE_PX;
                x = -REORDER_MAX_AUTO_SCROLL_PX_PER_FRAME * clamp(intensity, 0, 1.5);
            }
            const rightDistance = rect.right - clientX;
            if (maxScrollLeft > 0 && rightDistance < REORDER_AUTO_SCROLL_ZONE_PX) {
                const intensity = (REORDER_AUTO_SCROLL_ZONE_PX - rightDistance) /
                    REORDER_AUTO_SCROLL_ZONE_PX;
                x = REORDER_MAX_AUTO_SCROLL_PX_PER_FRAME * clamp(intensity, 0, 1.5);
            }
            const topDistance = clientY - rect.top;
            if (maxScrollTop > 0 && topDistance < REORDER_AUTO_SCROLL_ZONE_PX) {
                const intensity = (REORDER_AUTO_SCROLL_ZONE_PX - topDistance) /
                    REORDER_AUTO_SCROLL_ZONE_PX;
                y = -REORDER_MAX_AUTO_SCROLL_PX_PER_FRAME * clamp(intensity, 0, 1.5);
            }
            const bottomDistance = rect.bottom - clientY;
            if (maxScrollTop > 0 && bottomDistance < REORDER_AUTO_SCROLL_ZONE_PX) {
                const intensity = (REORDER_AUTO_SCROLL_ZONE_PX - bottomDistance) /
                    REORDER_AUTO_SCROLL_ZONE_PX;
                y = REORDER_MAX_AUTO_SCROLL_PX_PER_FRAME * clamp(intensity, 0, 1.5);
            }
            return { x, y };
        };
        const runReorderAutoScroll = () => {
            const currentState = dragState.current;
            const currentElement = parentRef.current;
            if (!currentElement ||
                !currentState.isDragging ||
                currentState.mode !== "reorder") {
                reorderAutoScrollFrameRef.current = null;
                return;
            }
            const velocity = getReorderAutoScrollVelocity(currentState.lastClientX, currentState.lastClientY);
            if (velocity.x === 0 && velocity.y === 0) {
                reorderAutoScrollFrameRef.current = null;
                return;
            }
            const maxScrollLeft = Math.max(0, currentElement.scrollWidth - currentElement.clientWidth);
            const currentScrollTop = gridMetrics.enabled
                ? window.scrollY
                : currentElement.scrollTop;
            const maxScrollTop = gridMetrics.enabled
                ? Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
                : Math.max(0, currentElement.scrollHeight - currentElement.clientHeight);
            const nextScrollLeft = clamp(currentElement.scrollLeft + velocity.x, 0, maxScrollLeft);
            const nextScrollTop = clamp(currentScrollTop + velocity.y, 0, maxScrollTop);
            if (nextScrollLeft !== currentElement.scrollLeft ||
                nextScrollTop !== currentScrollTop) {
                currentElement.scrollLeft = nextScrollLeft;
                if (gridMetrics.enabled) {
                    window.scrollTo({ top: nextScrollTop });
                }
                else {
                    currentElement.scrollTop = nextScrollTop;
                }
                setScrollLeft(nextScrollLeft);
                previewReorder(currentState.lastClientX, currentState.lastClientY);
            }
            reorderAutoScrollFrameRef.current =
                (velocity.x < 0 && nextScrollLeft === 0) ||
                    (velocity.x > 0 && nextScrollLeft === maxScrollLeft) ||
                    (velocity.y < 0 && nextScrollTop === 0) ||
                    (velocity.y > 0 && nextScrollTop === maxScrollTop)
                    ? null
                    : requestAnimationFrame(runReorderAutoScroll);
        };
        const scheduleReorderAutoScroll = () => {
            if (reorderAutoScrollFrameRef.current !== null)
                return;
            reorderAutoScrollFrameRef.current = requestAnimationFrame(runReorderAutoScroll);
        };
        const finishTimelineDrag = (pointerId, timeStamp) => {
            const currentState = dragState.current;
            const currentElement = parentRef.current;
            if (!currentState.isDragging || !currentElement)
                return;
            if (currentState.mode === "reorder" &&
                currentState.baselineClips &&
                currentState.activeClipId) {
                stopReorderAutoScroll();
                const targetIndex = currentState.targetIndex;
                // Dispatch drop event on window for cross-timeline drag
                const activeClip = currentState.baselineClips.find(c => c.id === currentState.activeClipId);
                let wasHandledByOtherTimeline = false;
                if (activeClip) {
                    const dropEvent = new CustomEvent("gstudio-clip-drag", {
                        detail: {
                            clip: activeClip,
                            sourceTimelineId: timelineId || "",
                            clientX: currentState.lastClientX,
                            clientY: currentState.lastClientY,
                            isDropping: true,
                            handled: false,
                        },
                    });
                    window.dispatchEvent(dropEvent);
                    wasHandledByOtherTimeline = !!dropEvent.detail.handled;
                }
                window.dispatchEvent(new CustomEvent("gstudio-drag-end"));
                if (wasHandledByOtherTimeline) {
                    setReorderPreview(null);
                }
                else {
                    applyClipsNow(reorderClipsFromBaseline({
                        activeClipId: currentState.activeClipId,
                        baselineClips: currentState.baselineClips,
                        targetIndex,
                    }));
                    setSelectedIndex(targetIndex);
                    setReorderPreview(null);
                }
            }
            currentState.isDragging = false;
            try {
                if (currentElement.hasPointerCapture(pointerId)) {
                    currentElement.releasePointerCapture(pointerId);
                }
            }
            catch (_a) { }
            if (currentState.mode !== "reorder" && timeStamp - currentState.lastTime > 50) {
                currentState.velocity = 0;
            }
            if (!currentState.moved && currentState.pressedIndex !== null) {
                const index = currentState.pressedIndex;
                setSelectedIndex((previous) => (previous === index ? null : index));
            }
            else if (currentState.mode === "pan" &&
                Math.abs(currentState.velocity) > 1) {
                runInertia();
            }
            currentState.mode = "pending";
            currentState.pointerId = -1;
            currentState.pressedIndex = null;
            currentState.activeClipId = "";
            currentState.targetIndex = -1;
            currentState.baselineClips = null;
            windowDrag.cleanup();
        };
        const onPointerMove = (pointerEvent) => {
            if (pointerEvent.pointerId !== dragState.current.pointerId)
                return;
            pointerEvent.preventDefault();
            const currentState = dragState.current;
            const deltaX = pointerEvent.clientX - currentState.startX;
            const deltaY = pointerEvent.clientY - currentState.startY;
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);
            if (currentState.mode === "pending") {
                if (absX <= DRAG_THRESHOLD_PX && absY <= DRAG_THRESHOLD_PX)
                    return;
                if (currentState.pressedIndex !== null &&
                    currentState.baselineClips &&
                    deltaY < -DRAG_THRESHOLD_PX &&
                    absY > absX) {
                    startReorder(pointerEvent.clientX, pointerEvent.clientY);
                    return;
                }
                currentState.mode = "pan";
            }
            if (currentState.mode === "reorder") {
                previewReorder(pointerEvent.clientX, pointerEvent.clientY);
                scheduleReorderAutoScroll();
                return;
            }
            moveTimeline(pointerEvent.clientX, pointerEvent.timeStamp);
        };
        const onPointerUp = (pointerEvent) => {
            if (pointerEvent.pointerId !== dragState.current.pointerId)
                return;
            finishTimelineDrag(pointerEvent.pointerId, pointerEvent.timeStamp);
        };
        const onPointerCancel = (pointerEvent) => {
            if (pointerEvent.pointerId !== dragState.current.pointerId)
                return;
            finishTimelineDrag(pointerEvent.pointerId, pointerEvent.timeStamp);
        };
        window.addEventListener("pointermove", onPointerMove, { passive: false });
        window.addEventListener("pointerup", onPointerUp);
        window.addEventListener("pointercancel", onPointerCancel);
        windowDrag.setCleanup(() => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            window.removeEventListener("pointercancel", onPointerCancel);
            stopReorderAutoScroll();
        });
    }, [
        applyClipsNow,
        clips,
        getClipLeft,
        getClipTop,
        getClipWidth,
        gridMetrics,
        itemTop,
        parentRef,
        runInertia,
        setScrollLeft,
        setSelectedIndex,
        stopInertia,
        stopReorderAutoScroll,
        thumbnailMode,
        windowDrag,
    ]);
    const cancelPan = useCallback(() => {
        const state = dragState.current;
        state.isDragging = false;
        state.mode = "pending";
        state.pointerId = -1;
        state.pressedIndex = null;
        state.activeClipId = "";
        state.targetIndex = -1;
        state.baselineClips = null;
        stopReorderAutoScroll();
        setReorderPreview(null);
    }, [stopReorderAutoScroll]);
    return {
        handlePointerDown,
        cancelPan,
        stopInertia,
        runInertia,
        isReordering: reorderPreview !== null,
        reorderPreview,
    };
}
